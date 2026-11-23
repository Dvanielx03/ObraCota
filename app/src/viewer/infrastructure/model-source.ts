import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { ElementInfo, ModelInfo } from "../domain/viewer.port";
import { openFailures } from "../domain/open-failure";
import { readMesh, walkableFloor } from "./mesh-source";
import { fetchSolids, solidGroups, type StoredSource } from "./dwg-solids";
import { readRevit, revitReason } from "./revit-file";

export type SceneModel = ModelInfo & {root: T.Group;coordination?: number[]};
interface SampleIndex {
  fuente: {esquema: string};
  niveles: {nombre: string}[];
  destacados: {clave: string; piezas: {guid:string; nombre:string; clase:string; material:string}[]}[];
}

async function readSample(signal: AbortSignal): Promise<SceneModel> {
  const responses = await Promise.all(["glb","json"].map(ext => fetch("/models/restage." + ext,{signal})));
  if (responses.some(r => !r.ok)) throw new Error("No se pudo abrir el ejemplo ReStage.");
  const [bytes, index]: [ArrayBuffer, SampleIndex] = await Promise.all([responses[0].arrayBuffer(),responses[1].json()]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const { scene: root } = await loader.parseAsync(bytes,"");
  const elements: ElementInfo[] = [];
  const colors: Record<string,number> = {hormigon:0xdcd8cf, armadura:0x77838f, acero:0x8493a2,
    uniones:0x3b4753,madera:0xd3b489,cubierta:0xaab2b9,fachada:0x8fa38a,instalaciones:0x65717d,aislamiento:0xe9e2d3};
  const edges = new T.LineBasicMaterial({color:0x0a1522,transparent:true,opacity:0.32});
  root.traverse(node => {
    const {nivel, grupo, destacado, elementos, hito} = node.userData;
    if (typeof nivel !== "number") return;
    const entries = index.destacados.find(group => group.clave === destacado)?.piezas;
    const piece = entries?.length === 1 && elementos === 1 ? entries[0] : undefined;
    const group = String(grupo).replace(/^./, c => c.toUpperCase());
    const info = {id:node.name, level:index.niveles[nivel].nombre, name:piece?.nombre ||
      (destacado ? String(destacado) : group) + " · " + (hito ? "hito " + hito : "base"),
      guid:piece?.guid, type:piece?.clase || "Conjunto · " + group, material:piece?.material, count:elementos};
    elements.push(info);
    const glass = !!node.userData.vidrio;
    const finish = new T.MeshStandardMaterial({color:glass?0x9cc0d8:colors[grupo]??0x8493a2,flatShading:true,
      side:T.DoubleSide,transparent:glass,opacity:glass?0.3:1,depthWrite:!glass});
    node.traverse(child => {
      if (child instanceof T.Mesh) {
        child.userData.elementId = info.id; child.material = finish;
        // The sample's façade and roof groups are its envelope (exterior finish preview).
        if (grupo === "fachada" && !glass) child.userData.envelope = "wall";
        if (grupo === "cubierta") child.userData.envelope = "roof";
      }
      if (child instanceof T.LineSegments) child.material = edges;
    });
  });
  // The GLB was converted from the IFC in metres (Y up): it is walked on its own floor, and a scene's ground goes
  // around it, as with an IFC. No coordination offset: the walk works in the GLB's own coordinates.
  const meshes:T.Mesh[]=[];
  root.traverse(node=>{if(node instanceof T.Mesh)meshes.push(node);});
  return {root, elements, name:"ReStage", schema:index.fuente.esquema, sample:true,versionId:"restage-sample-v1",
    walk:walkableFloor(root,meshes),coordination:Array.from(new T.Matrix4().elements)};
}

interface Part {key:number; matrix:number[]; color:number[]}
interface Payload {schema:string; versionId?:string; walk?:number[]; geometry:Map<number,{vertices:Float32Array;indices:Uint32Array}>; elements:(ElementInfo & {parts:Part[];external?:boolean;predefined?:string})[]}
function assemble(file:File, payload:Payload):SceneModel {
  const root = new T.Group();
  const geometries = new Map<number,T.BufferGeometry>();
  const materials = new Map<string,T.MeshStandardMaterial>();
  for (const [key, data] of payload.geometry) {
    const geo = new T.BufferGeometry();
    const buffer = new T.InterleavedBuffer(data.vertices,6);
    geo.setAttribute("position",new T.InterleavedBufferAttribute(buffer,3,0));
    geo.setAttribute("normal",new T.InterleavedBufferAttribute(buffer,3,3));
    geo.setIndex(new T.BufferAttribute(data.indices,1));
    geometries.set(key,geo);
  }
  const elements = payload.elements.map(({parts,external,predefined,...info}) => {
    for (const part of parts) {
      const key = part.color.join(",");
      let material = materials.get(key);
      if (!material) {
        const [r,g,b,a] = part.color;
        material = new T.MeshStandardMaterial({color:new T.Color(r,g,b),opacity:a,transparent:a<1,side:T.DoubleSide});
        materials.set(key,material);
      }
      const mesh = new T.Mesh(geometries.get(part.key),material);
      mesh.applyMatrix4(new T.Matrix4().fromArray(part.matrix));
      mesh.userData.elementId = info.id;
      mesh.userData.ifcType=info.type.toUpperCase();
      // Envelope hints for the exterior finish preview: Pset_*Common.IsExternal and the IFC predefined type.
      if(external!==undefined)mesh.userData.external=external;
      if(predefined)mesh.userData.predefined=predefined.toUpperCase();
      root.add(mesh);
    }
    return info;
  });
  const matrix=payload.walk;
  const compatible=matrix?.length===16 && matrix.every(Number.isFinite) && Math.abs(new T.Matrix4().fromArray(matrix).determinant())>.99;
  return {root,elements,schema:payload.schema,name:file.name,sample:false,walk:compatible,coordination:compatible?matrix:undefined,versionId:payload.versionId};
}

async function readWorker<T>(format:"ifc"|"dwg",file:File,signal:AbortSignal,status:(s:string)=>void,indexOnly=false) {
  signal.throwIfAborted();
  return new Promise<T>((resolve,reject) => {
    const worker = new Worker("/workers/read-"+format+".js",{type:"module"});
    function close() {worker.terminate(); signal.removeEventListener("abort",abort);}
    function abort() {close(); reject(new DOMException("Cancelado","AbortError"));}
    signal.addEventListener("abort",abort,{once:true});
    worker.onerror = () => {close(); reject(new Error("No se pudo procesar el "+format.toUpperCase()+" en este navegador."));};
    worker.onmessage = ({data}) => {
      if (data.status) {status(data.status); return;}
      close();
      if (data.error) {
        // An index read (labels for a revision) never replaces the picture of the failed open; the caller
        // reports it once it knows whether the server can draw the solids instead.
        const error:WorkerError=new Error(data.error);
        if (!indexOnly && data.reason==="acis" && data.solids) error.acis={preview:data.preview,solids:data.solids,version:data.version,versionId:data.versionId};
        reject(error);
      }
      else resolve(data);
    };
    worker.postMessage(indexOnly?{file,indexOnly}:file);
  });
}
interface DrawingData {
  versionId?:string;
  labels:ElementInfo[];
  version:string; units:number; depth:number; omissions:string;
  groups:{id:string;layer:string;kind:"faces"|"lines"|"points";color:number;count:number;positions:Float32Array;cad:ElementInfo["cad"]}[];
  /** Drawing coordinates the positions are relative to, ACIS solids left out and the colour of each layer. */
  origin?:number[]; acis?:number; layerColors?:Record<string,number|undefined>;
}
interface AcisPreview {kind:string;mime:string;bytes:Uint8Array;crop?:number[]}
/** A DWG whose model space holds only ACIS solids: what the reader found, for the server's mesh or the failure card. */
type WorkerError=Error & {acis?:{preview?:AcisPreview;version:string;versionId?:string;
  solids:{acis:number;layerColors:Record<string,number|undefined>;units:number;omissions:string}}};
function reportAcis(file:File,message:string,preview?:AcisPreview){
  if(preview?.bytes)openFailures.report({message,file:file.name,reason:"acis",kind:preview.kind,cropped:!!preview.crop,
    preview:URL.createObjectURL(new Blob([preview.bytes as BlobPart],{type:preview.mime}))});
}
/** Solid types the server tessellates: once drawn they leave the omissions. */
const DRAWN_SOLIDS=/^(3DSOLID|BODY|REGION) \(\d+\)$/;
/** Whether a stored picture shows anything: Revit often keeps a blank (one-colour) preview. */
async function showsSomething(png:Uint8Array){
  try{
    const bitmap=await createImageBitmap(new Blob([png as BlobPart],{type:"image/png"}));
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext("2d");
    if(!context)return false;
    context.drawImage(bitmap,0,0);bitmap.close();
    const pixels=new Uint32Array(context.getImageData(0,0,canvas.width,canvas.height).data.buffer);
    return pixels.some(pixel=>pixel!==pixels[0]);
  }catch{return false;}
}
/**
 * A Revit original: nothing to draw (its geometry is Autodesk's own format), so the viewer rejects it
 * with the release that saved it and the way to see it (an IFC export), and the picture Revit stored.
 */
async function rejectRevit(file:File,signal:AbortSignal,status:(s:string)=>void,stored:boolean):Promise<never>{
  status("Leyendo el archivo de Revit…");
  const info=readRevit(new Uint8Array(await file.arrayBuffer()));
  signal.throwIfAborted();
  const preview=info.preview && await showsSomething(info.preview) ? URL.createObjectURL(new Blob([info.preview as BlobPart],{type:"image/png"})) : undefined;
  signal.throwIfAborted();
  const message=revitReason(info,stored);
  openFailures.report({message,file:file.name,reason:"revit",kind:"PNG",preview,revit:{release:info.release,build:info.build,stored}});
  throw new Error(message);
}
/** Metres in one drawing unit, for the INSUNITS codes a 3D drawing can be shown in metres with. */
const METRES_PER_UNIT:Record<number,number|undefined>={1:.0254,2:.3048,4:.001,5:.01,6:1,7:1000};
export function drawingUnits(code:number){
  const names:Record<number,string>={0:"Sin unidad declarada",1:"in",2:"ft",4:"mm",5:"cm",6:"m",7:"km"};
  return names[code]??"INSUNITS "+code;
}
export function readDrawingIndex(file: File, signal: AbortSignal) {
  return readWorker<DrawingData>("dwg",file,signal,()=>{},true);
}
export async function loadModel(file: File | null, signal: AbortSignal, status:(s:string)=>void, source?:StoredSource): Promise<SceneModel> {
  openFailures.clear();
  if (!file) return readSample(signal);
  if (/\.ifc$/i.test(file.name)) return assemble(file,await readWorker<Payload>("ifc",file,signal,status));
  if (/\.(fbx|obj)$/i.test(file.name)) return readMesh(file,signal,status);
  if (/\.rvt$/i.test(file.name)) return rejectRevit(file,signal,status,!!source);
  if (!/\.dwg$/i.test(file.name)) throw new Error("Elige un archivo IFC, DWG, RVT, FBX u OBJ.");
  let data:DrawingData, failure:{message:string;preview?:AcisPreview}|undefined;
  try{data=await readWorker<DrawingData>("dwg",file,signal,status);}
  catch(error){
    const acis=(error as WorkerError).acis;
    if(!acis || !source){if(acis)reportAcis(file,(error as Error).message,acis.preview);throw error;}
    failure={message:(error as Error).message,preview:acis.preview};
    data={labels:[],groups:[],version:acis.version,versionId:acis.versionId,units:acis.solids.units,depth:0,
      omissions:acis.solids.omissions,acis:acis.solids.acis,layerColors:acis.solids.layerColors};
  }
  const root=new T.Group();
  const elements:ElementInfo[]=data.groups.map(group=>{
    const geometry=new T.BufferGeometry();
    geometry.setAttribute("position",new T.BufferAttribute(group.positions,3));
    const color = group.color===0xffffff || group.color===0 || group.color==null ? 0x35404a : group.color;
    let node:T.Mesh|T.LineSegments|T.Points;
    if(group.kind==="faces"){
      geometry.computeVertexNormals();
      node=new T.Mesh(geometry,new T.MeshStandardMaterial({color,side:T.DoubleSide}));
    }else if(group.kind==="points")node=new T.Points(geometry,new T.PointsMaterial({color,size:3,sizeAttenuation:false}));
    else node=new T.LineSegments(geometry,new T.LineBasicMaterial({color}));
    node.userData.elementId=group.id;root.add(node);
    const type={faces:"Caras",points:"Puntos",lines:"Trazos"}[group.kind];
    return {id:group.id,name:type+" · "+group.layer,level:group.layer,type,count:group.count,cad:group.cad};
  });

  let depth=data.depth,omissions=data.omissions;
  if(data.acis && source){
    // A stored version: the server tessellates its ACIS solids (the first time it may take some seconds).
    const count=data.acis+(data.acis===1?" sólido ACIS":" sólidos ACIS");
    status("Calculando "+count+" en el servidor… la primera vez puede tardar unos segundos");
    try{
      const solids=solidGroups(await fetchSolids(source,signal),data.groups.length?data.origin??null:null,data.layerColors??{});
      if(!solids.nodes.length)throw new Error("ningún cuerpo se pudo teselar.");
      for(const node of solids.nodes)root.add(node);
      elements.push(...solids.elements);
      depth=Math.max(depth,solids.depth);
      omissions=[...omissions.split(", ").filter(entry=>entry && !DRAWN_SOLIDS.test(entry)),...solids.omissions].join(", ");
    }catch(error){
      if(signal.aborted)throw error;
      const reason=error instanceof Error?error.message:"error desconocido.";
      if(!data.groups.length){
        release(root);
        const message="Este DWG es un modelo 3D con "+count+". El servidor no pudo calcularlos: "+reason;
        reportAcis(file,message,failure?.preview);
        throw new Error(message);
      }
      omissions=[omissions,"Sólidos ACIS sin dibujar ("+data.acis+"): "+reason].filter(Boolean).join(", ");
    }
  }
  // A 3D drawing with a declared unit is shown in metres, as an IFC or an FBX: the scene around the model
  // (trees, sky, the walker's height), the finish textures at real scale and the walk then read it the same way.
  // A plan, or a drawing without a unit, keeps its own units.
  const metres=METRES_PER_UNIT[data.units];
  const solid=depth>0 && root.children.some(node=>node instanceof T.Mesh);
  if(metres && solid)root.scale.setScalar(metres);
  return {root,elements:[...elements,...data.labels],sample:false,name:file.name,schema:"DWG "+data.version,versionId:data.versionId,
    drawing:{units:drawingUnits(data.units),depth,omissions},
    // In metres it can be walked: on its own floor if it has one, otherwise on the ground of a scene around it.
    ...(metres && solid?{walk:walkableFloor(root,root.children.filter((node):node is T.Mesh=>node instanceof T.Mesh)),coordination:Array.from(new T.Matrix4().elements)}:{})};
}
function release(root:T.Object3D){
  root.traverse(node=>{if(node instanceof T.Mesh || node instanceof T.LineSegments || node instanceof T.Points){node.geometry.dispose();(node.material as T.Material).dispose();}});
}
