import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { ElementInfo, ModelInfo } from "../domain/viewer.port";

export type SceneModel = ModelInfo & {root: T.Group};
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
      if (child instanceof T.Mesh) {child.userData.elementId = info.id; child.material = finish;}
      if (child instanceof T.LineSegments) child.material = edges;
    });
  });
  return {root, elements, name:"ReStage", schema:index.fuente.esquema, sample:true,versionId:"restage-sample-v1"};
}

interface Part {key:number; matrix:number[]; color:number[]}
interface Payload {schema:string; versionId?:string; geometry:Map<number,{vertices:Float32Array;indices:Uint32Array}>; elements:(ElementInfo & {parts:Part[]})[]}
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
  const elements = payload.elements.map(({parts,...info}) => {
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
      root.add(mesh);
    }
    return info;
  });
  return {root,elements,schema:payload.schema,name:file.name,sample:false,versionId:payload.versionId};
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
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.postMessage(indexOnly?{file,indexOnly}:file);
  });
}
interface DrawingData {
  versionId?:string;
  labels:ElementInfo[];
  version:string; units:number; depth:number; omissions:string;
  groups:{id:string;layer:string;kind:"faces"|"lines"|"points";color:number;count:number;positions:Float32Array}[];
}
export function drawingUnits(code:number){
  const names:Record<number,string>={0:"Sin unidad declarada",1:"in",2:"ft",4:"mm",5:"cm",6:"m",7:"km"};
  return names[code]??"INSUNITS "+code;
}
export function readDrawingIndex(file: File, signal: AbortSignal) {
  return readWorker<DrawingData>("dwg",file,signal,()=>{},true);
}
export async function loadModel(file: File | null, signal: AbortSignal, status:(s:string)=>void): Promise<SceneModel> {
  if (!file) return readSample(signal);
  if (/\.ifc$/i.test(file.name)) return assemble(file,await readWorker<Payload>("ifc",file,signal,status));
  if (!/\.dwg$/i.test(file.name)) throw new Error("Elige un archivo DWG o IFC.");
  const data=await readWorker<DrawingData>("dwg",file,signal,status);
  const root=new T.Group();
  const elements=data.groups.map(group=>{
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
    return {id:group.id,name:type+" · "+group.layer,level:group.layer,type,count:group.count};
  });

  return {root,elements:[...elements,...data.labels],sample:false,name:file.name,schema:"DWG "+data.version,versionId:data.versionId,
    drawing:{units:drawingUnits(data.units),depth:data.depth,omissions:data.omissions}};
}
