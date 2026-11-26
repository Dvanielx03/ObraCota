import { LibreDwg, Dwg_File_Type } from "../dwg/dist/reader.js";
import { Vector3, Matrix4 } from "../dwg/math.js";
import {fileVersion} from "./file-version.js";

const vec = p => new Vector3(p.x,p.y,p.z ?? 0);
const identity = new Matrix4();
const tau = 2*Math.PI;

// AutoCAD arbitrary-axis algorithm, from object coordinates to drawing coordinates.
function ocs(normal) {
  if (!normal || (normal.x===0 && normal.y===0 && normal.z===1)) return identity;
  const z=vec(normal).normalize();
  const x=(Math.abs(z.x)<1/64 && Math.abs(z.y)<1/64 ? new Vector3(0,1,0) : new Vector3(0,0,1)).cross(z).normalize();
  return new Matrix4().makeBasis(x,new Vector3().crossVectors(z,x),z);
}
function sweep(start,end) {const d=(end-start)%tau;return d<=0 ? d+tau : d;}

/**
 * Polyface meshes (POLYLINE_PFACE with its VERTEX_PFACE and VERTEX_PFACE_FACE records) are how many
 * manufacturer 3D DWG files keep their geometry, but the converter of libredwg-web leaves them out.
 * They are read here from the raw objects: vertex points through the dynamic API, and the four face
 * indices (`vertind`, a fixed array the bindings do not return) straight from the WASM memory at the
 * field's offset. Each mesh is handed to `extract` as a synthetic entity in its owner block, so block
 * inserts, layers and visibility apply to it like to any other entity.
 */
const PFACE=29, PFACE_VERTEX=13, PFACE_FACE=14;
const hexId=id=>BigInt(id??0).toString(16).toUpperCase();
export function addPolyfaceMeshes(reader,ptr,database){
  const meshes=new Map();
  const heap=reader.wasmInstance.HEAP16;
  const total=reader.dwg_get_num_objects(ptr);
  for(let i=0;i<total;i++){
    const object=reader.dwg_get_object(ptr,i), type=reader.dwg_object_get_fixedtype(object);
    if(type!==PFACE && type!==PFACE_VERTEX && type!==PFACE_FACE)continue;
    const entity=reader.dwg_object_to_entity(object), tio=reader.dwg_object_to_entity_tio(object);
    if(!entity || !tio)continue;
    const owner=hexId(reader.dwg_object_entity_get_ownerhandle_object(entity).absolute_ref);
    if(type===PFACE){
      const handle=hexId(reader.dwg_object_entity_get_handle_object(entity).value);
      const layerRef=reader.dwg_object_entity_get_layer_object_ref(entity);
      const layer=database.tables.LAYER.entries.find(l=>l.handle===hexId(layerRef?.handleref?.value))?.name ?? "0";
      const mesh=meshes.get(handle) ?? {vertices:[],faces:[]};
      Object.assign(mesh,{type:"PFACE_MESH",handle,owner,layer,isVisible:!reader.dwg_object_entity_get_invisible(entity)});
      meshes.set(handle,mesh);
    }else{
      const mesh=meshes.get(owner) ?? {vertices:[],faces:[]};
      meshes.set(owner,mesh);
      if(type===PFACE_VERTEX)mesh.vertices.push(reader.dwg_dynapi_entity_data(tio,"point"));
      else{
        const at=(tio+reader.dwg_dynapi_entity_field_offset(tio,"vertind"))>>1;
        mesh.faces.push([heap[at],heap[at+1],heap[at+2],heap[at+3]]);
      }
    }
  }
  const blocks=new Map(database.tables.BLOCK_RECORD.entries.map(b=>[b.handle,b]));
  let added=0;
  for(const mesh of meshes.values()){
    if(mesh.type!=="PFACE_MESH" || !mesh.vertices.length || !mesh.faces.length)continue;
    // Old files leave the owner of model-space entities empty (0).
    const block=blocks.get(mesh.owner);
    if(block && block.name!=="*Model_Space" && !block.name.startsWith("*Paper_Space"))(block.entities??=[]).push(mesh);
    else if(!block?.name?.startsWith("*Paper_Space"))database.entities.push(mesh);
    added++;
  }
  return added;
}

// Says what the drawing holds when nothing in it can be drawn, so the person knows whether the file
// is a 3D model (solids need a geometry kernel; meshes arrive with the DWG engine) or simply empty.
const SOLIDS=["3DSOLID","REGION","BODY","SURFACE","EXTRUDEDSURFACE","LOFTEDSURFACE","REVOLVEDSURFACE","SWEPTSURFACE","PLANESURFACE","NURBSURFACE"];
export function emptyReason(skipped){
  const solids=SOLIDS.reduce((n,type)=>n+(skipped.get(type)||0),0);
  if(solids)return "Este DWG es un modelo 3D con "+solids+(solids===1?" sólido":" sólidos")+" ACIS. Abierto desde tu equipo, el visor solo dibuja planos (líneas, arcos, polilíneas, caras 3D y textos): guárdalo en un proyecto para verlo en 3D, porque el servidor calcula sus sólidos.";
  const names={INSERT:"referencias a bloques sin geometría dibujable",TEXT:"textos vacíos",MTEXT:"textos vacíos",DIMENSION:"cotas no admitidas"};
  const found=[...skipped].filter(([type])=>type!=="Otros objetos sin decodificar").map(([type,n])=>n+" "+(names[type]??"entidades "+type)).join(", ");
  return found
    ? "No hay geometría de plano que dibujar: el espacio modelo solo contiene "+found+". Si es un modelo 3D con mallas, se podrá abrir cuando llegue el motor DWG."
    : "El espacio modelo del DWG está vacío.";
}

/**
 * One line of text without MTEXT formatting codes: font, height, colour, width and alignment switches go, a stacked
 * fraction (\S1/2; \S1^2; \S1#2;) reads «1/2», and the %%c/%%d/%%p symbols become Ø, ° and ±.
 */
function plainLine(line){
  return line.replace(/\\S([^;^/#]*)[\^/#]([^;]*);/g,(m,top,bottom)=>" "+top.trim()+"/"+bottom.trim())
    .replace(/\\[ACFHQTWcfhp][^;]*;/g,"").replace(/\\[LlOoKkNX]/g,"")
    .replace(/\\~/g," ").replace(/\\([\\{}])/g,"$1").replace(/[{}]/g,"")
    .replace(/%%([cCdDpP])/g,(m,c)=>({c:"Ø",d:"°",p:"±"})[c.toLowerCase()]).replace(/ {2,}/g," ").trim();
}
/** MTEXT content as lines without formatting codes (\P breaks a line). */
function textLines(raw){
  return String(raw).split("\\P").map(plainLine).filter(line=>line.length);
}
/**
 * How a TEXT or MTEXT is drawn on the plan: its lines, the angle of its baseline and which point of its box sits on the
 * insertion point (fractions of the width from the left and of the height from the bottom).
 */
function textDraw(e,parent,raw){
  const lines=e.type==="MTEXT"?textLines(raw):[String(raw).replace(/%%([cCdDpP])/g,(m,c)=>({c:"Ø",d:"°",p:"±"})[c.toLowerCase()]).trim()];
  let angle=e.rotation||0;
  if(e.type==="MTEXT" && e.direction && (e.direction.x||e.direction.y))angle=Math.atan2(e.direction.y,e.direction.x);
  // The block's rotation and mirroring carry the text along.
  const axis=new Vector3(Math.cos(angle),Math.sin(angle),0).transformDirection(parent);
  let ax=0,ay=0;
  if(e.type==="MTEXT"){const a=Math.min(9,Math.max(1,e.attachmentPoint||1));ax=((a-1)%3)/2;ay=1-Math.floor((a-1)/3)/2;}
  else{
    const h=e.halign||0,v=e.valign||0;
    ax=h===1||h===4?.5:h===2?1:0;
    ay=h===4?.5:v===2?.5:v===3?1:0;
  }
  return {lines,angle:Math.atan2(axis.y,axis.x),ax,ay};
}

export function extract(db, unknown,indexOnly=false) {
  const blocks=new Map(db.tables.BLOCK_RECORD.entries.map(b=>[b.name,b]));
  const layers=new Map(db.tables.LAYER.entries.map(l=>[l.name,l]));
  const batches=new Map(), skipped=new Map();
  const labels=[];
  const dimensions=[];
  const omit=type=>skipped.set(type,(skipped.get(type)||0)+1);
  let origin=null,minZ=Infinity,maxZ=-Infinity;
  // The model space entity being drawn: every vertex of a batch remembers it (an INSERT stands for its whole block),
  // so a click on a stroke of the plan names the DWG entity under it (its handle, the identity of model changes).
  let top=null;
  function visit(e,parent=identity,inherited="0",ancestors=[]) {
    const layer=e.layer==="0"?inherited:e.layer || inherited;
    const properties=layers.get(layer);
    if(e.isVisible===false || properties?.off || properties?.frozen)return;
    if(e.type==="DIMENSION"){
      const aligned=e.subclassMarker==="AcDbAlignedDimension";
      const n=e.extrusionDirection;
      if((!aligned && e.subclassMarker!=="AcDbRotatedDimension") || ancestors.length || (n && (n.x!==0||n.y!==0||n.z!==1)) || !e.subDefinitionPoint1 || !e.subDefinitionPoint2){omit("DIMENSION");return;}
      const a=vec(e.subDefinitionPoint1),b=vec(e.subDefinitionPoint2);
      const dx=b.x-a.x,dy=b.y-a.y;
      const angle=e.rotationAngle??0;
      const value=aligned?Math.hypot(dx,dy):Math.abs(dx*Math.cos(angle)+dy*Math.sin(angle));
      if(![...a.toArray(),...b.toArray(),value].every(Number.isFinite) || Math.abs(a.z-b.z)>1e-7){omit("DIMENSION");return;}
      const handle=String(e.handle),raw=e.text??"",kind=aligned?"Alineada":"Lineal";
      const position=a.clone().lerp(b,.5).toArray();
      dimensions.push({id:"dimension:"+handle,name:"Cota "+kind.toLowerCase()+" · "+handle,type:"DIMENSION",level:layer,
        dimension:{kind,value,style:e.styleName??"",endpoints:[...a.toArray(),...b.toArray()]},
        annotation:{handle,raw,position,anchor:position,height:Math.max(a.distanceTo(b)/24,0.001)}});
      return;
    }
    if(e.type==="TEXT" || e.type==="MTEXT"){
      const raw=e.text || "";
      const name=e.type==="MTEXT"?textLines(raw).join(" "):plainLine(String(raw));
      const point=e.type==="TEXT"?e.startPoint:e.insertionPoint;
      if(!point || !name){omit(e.type);return;}
      // A TEXT aligned other than left-baseline sits on its alignment point (fit and aligned keep the start point).
      const halign=e.halign||0,aligned=e.type==="TEXT" && (halign!==0 || (e.valign||0)!==0) && halign!==3 && halign!==5 && e.endPoint;
      const location=vec(aligned?e.endPoint:point);
      if(e.type==="TEXT"){location.z=e.elevation??0;location.applyMatrix4(ocs(e.extrusionDirection));}
      location.applyMatrix4(parent);
      if(!location.toArray().every(Number.isFinite)){omit(e.type);return;}
      labels.push({id:"annotation:"+labels.length,name,level:layer,type:e.type,
        annotation:{handle:String(e.handle??""),raw,position:location.toArray(),anchor:location.toArray(),
          height:Math.abs(e.textHeight||0)*parent.getMaxScaleOnAxis(),
          ...(ancestors.length && top?{owner:{handle:String(top.handle??""),type:top.type}}:{}),
          draw:textDraw(e,parent,raw)}});
      return;
    }
    if(e.type==="INSERT"){
      const block=blocks.get(e.name);
      if(!block?.entities?.length || ancestors.includes(e.name) || ancestors.length>=32 || (e.rowCount>1 || e.columnCount>1)){omit("INSERT");return;}
      const transform=parent.clone().multiply(ocs(e.extrusionDirection))
        .multiply(new Matrix4().makeTranslation(vec(e.insertionPoint)))
        .multiply(new Matrix4().makeRotationZ(e.rotation || 0))
        .multiply(new Matrix4().makeScale(e.xScale??1,e.yScale??1,e.zScale??1))
        .multiply(new Matrix4().makeTranslation(vec(block.basePoint).negate()));
      for(const child of block.entities)visit(child,transform,layer,[...ancestors,e.name]);
      return;
    }
    if(indexOnly)return;
    const space=["ARC","CIRCLE","LWPOLYLINE","POLYLINE2D"].includes(e.type)?parent.clone().multiply(ocs(e.extrusionDirection)):parent;
    const kind=e.type==="3DFACE" || e.type==="PFACE_MESH"?"faces":e.type==="POINT"?"points":"lines";
    let batch;
    function vertex(p){
      p.applyMatrix4(space);
      if(![p.x,p.y,p.z].every(Number.isFinite))throw new Error("Coordenadas DWG inválidas.");
      origin??=p.clone();
      minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);
      if(!batch){
        const id=layer+"/"+kind;
        if(!batches.has(id))batches.set(id,{id,layer,kind,color:properties?.color,count:0,positions:[],
          cad:{types:{},min:[Infinity,Infinity],max:[-Infinity,-Infinity]},entities:[]});
        batch=batches.get(id);batch.count++;
        batch.cad.types[e.type]=(batch.cad.types[e.type]??0)+1;
      }
      const owner=top??e,marks=batch.entities,last=marks[marks.length-1],handle=String(owner.handle??"");
      if(!last || last.handle!==handle)marks.push({start:batch.positions.length/3,handle,type:owner.type});
      const {min,max}=batch.cad;
      min[0]=Math.min(min[0],p.x);min[1]=Math.min(min[1],p.y);
      max[0]=Math.max(max[0],p.x);max[1]=Math.max(max[1],p.y);
      batch.positions.push(p.x-origin.x,p.z-origin.z,origin.y-p.y);
    }
    function segment(a,b){vertex(a.clone());vertex(b.clone());}
    function curve(angle,at){
      const n=Math.max(2,Math.ceil(Math.abs(angle)*32/Math.PI));let previous=at(0);
      for(let i=1;i<=n;i++){const next=at(angle*i/n);segment(previous,next);previous=next;}
    }
    switch(e.type){
      case "LINE":segment(vec(e.startPoint),vec(e.endPoint));break;
      case "POINT":vertex(vec(e.position));break;
      case "PFACE_MESH":{
        // Faces of 3 or 4 corners; indices start at 1, a negative one only hides that edge, 0 means "no corner".
        const corners=e.vertices.map(vec);
        for(const face of e.faces){
          const ids=face.filter(i=>i!==0).map(i=>Math.abs(i)-1);
          if(ids.length<3 || ids.some(i=>i>=corners.length))continue;
          for(let k=1;k+1<ids.length;k++)for(const i of [ids[0],ids[k],ids[k+1]])vertex(corners[i].clone());
        }
        break;
      }
      case "3DFACE":{
        const [a,b,c,d]=[e.corner1,e.corner2,e.corner3,e.corner4||e.corner3].map(vec);
        for(const p of [a,b,c])vertex(p.clone());
        if(!d.equals(c))for(const p of [a,c,d])vertex(p.clone());
        break;
      }
      case "ARC":case "CIRCLE":{
        const center=vec(e.center),start=e.startAngle || 0;
        curve(e.type==="CIRCLE"?tau:sweep(start,e.endAngle),t=>new Vector3(center.x+e.radius*Math.cos(start+t),center.y+e.radius*Math.sin(start+t),center.z));break;
      }
      case "ELLIPSE":{
        const center=vec(e.center),major=vec(e.majorAxisEndPoint);
        const minor=new Vector3().crossVectors(vec(e.extrusionDirection||{x:0,y:0,z:1}).normalize(),major).multiplyScalar(e.axisRatio);
        curve(sweep(e.startAngle,e.endAngle),t=>center.clone().addScaledVector(major,Math.cos(e.startAngle+t)).addScaledVector(minor,Math.sin(e.startAngle+t)));break;
      }
      case "LWPOLYLINE":case "POLYLINE3D":case "POLYLINE2D":{
        const points=e.vertices,closed=!!(e.flag&1);
        for(let i=0;i<points.length-(closed?0:1);i++){
          const a=vec(points[i]),b=vec(points[(i+1)%points.length]);
          if(e.type!=="POLYLINE3D")a.z=b.z=e.elevation??0;
          const bulge=points[i].bulge || 0;
          if(!bulge){segment(a,b);continue;}
          const k=(1-bulge*bulge)/(4*bulge),cx=(a.x+b.x)/2-(b.y-a.y)*k,cy=(a.y+b.y)/2+(b.x-a.x)*k;
          const start=Math.atan2(a.y-cy,a.x-cx),r=Math.hypot(a.x-cx,a.y-cy);
          curve(4*Math.atan(bulge),t=>new Vector3(cx+r*Math.cos(start+t),cy+r*Math.sin(start+t),a.z));
        }
        break;
      }
      default:omit(e.type);return;
    }
    if(e.thickness)omit("Espesor de extrusión");
  }
  for(const entity of db.entities){top=entity;visit(entity);}
  top=null;
  if(unknown)skipped.set("Otros objetos sin decodificar",unknown);
  const records=labels.concat(dimensions);
  if(indexOnly)return {groups:[],labels:records,units:db.header.INSUNITS??0};
  // ACIS solids are drawn from the server's mesh (GET …/versions/{id}/solids) when the file is a stored version;
  // the viewer needs how many there are and each layer's colour to draw them beside the lines.
  const acis=SOLIDS.reduce((n,type)=>n+(skipped.get(type)||0),0);
  const layerColors=Object.fromEntries(db.tables.LAYER.entries.map(l=>[l.name,l.color]));
  if(!batches.size){
    const error=new Error(emptyReason(skipped));
    // Only a model of ACIS solids is the manufacturer case the stored thumbnail and the mesh hint serve.
    if(acis){error.code="acis";error.solids={acis,layerColors,units:db.header.INSUNITS??0,omissions:[...skipped].map(([t,n])=>t+" ("+n+")").join(", ")};}
    throw error;
  }
  const groups=Array.from(batches.values(),batch=>({...batch,positions:new Float32Array(batch.positions)}));
  for(const {annotation} of records){
    const [x,y,z]=annotation.anchor;
    annotation.anchor=[x-origin.x,z-origin.z,origin.y-y];
  }
  return {groups,labels:records,units:db.header.INSUNITS??0,depth:maxZ-minZ,omissions:[...skipped].map(([t,n])=>t+" ("+n+")").join(", "),
    origin:[origin.x,origin.y,origin.z],acis,layerColors};
}
/**
 * The thumbnail AutoCAD saves in the DWG (shown in its file dialog), as an image a browser can draw:
 * PNG as stored; a BMP is a bare DIB, so it gets its 14-byte file header; WMF (vector metafile) and
 * files without a picture give null.
 */
export function storedThumbnail(reader,ptr){
  const thumbnail=reader.dwg_bmp(ptr);
  const bytes=thumbnail?.data;
  if(!bytes?.length)return null;
  if(thumbnail.type===6 && bytes[0]===0x89 && bytes[1]===0x50)return {kind:"PNG",mime:"image/png",bytes:new Uint8Array(bytes)};
  if(thumbnail.type!==2 || bytes.length<40)return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const size=view.getUint32(0,true),bits=view.getUint16(14,true),compression=view.getUint32(16,true),used=view.getUint32(32,true);
  if(size<40 || size>bytes.length)return null;
  const palette=(used || (bits<=8?1<<bits:0))*4,masks=size===40 && compression===3?12:0;
  const file=new Uint8Array(14+bytes.length),header=new DataView(file.buffer);
  file[0]=0x42;file[1]=0x4D;
  header.setUint32(2,file.length,true);
  header.setUint32(10,14+size+masks+palette,true);
  file.set(bytes,14);
  return {kind:"BMP",mime:"image/bmp",bytes:file};
}

/**
 * AutoCAD draws the thumbnail on the drawing's background with the design small in the middle. Crop
 * the uniform margin (the colour of the corner) so the design fills the picture; the pixels are the
 * stored ones, only the frame changes. Without OffscreenCanvas, or if nothing stands out, the stored
 * picture is kept as is.
 */
export async function framedThumbnail(image){
  if(typeof OffscreenCanvas==="undefined" || typeof createImageBitmap!=="function")return image;
  try{
    const bitmap=await createImageBitmap(new Blob([image.bytes],{type:image.mime}));
    const {width,height}=bitmap;
    const context=new OffscreenCanvas(width,height).getContext("2d",{willReadFrequently:true});
    context.drawImage(bitmap,0,0);
    const pixels=context.getImageData(0,0,width,height).data;
    const [r,g,b]=pixels;
    let left=width,top=height,right=-1,bottom=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      if(Math.abs(pixels[i]-r)+Math.abs(pixels[i+1]-g)+Math.abs(pixels[i+2]-b)<=36)continue;
      if(x<left)left=x;if(x>right)right=x;if(y<top)top=y;if(y>bottom)bottom=y;
    }
    if(right<0)return image;
    const pad=Math.round(Math.max(right-left,bottom-top)*.12)+2;
    left=Math.max(0,left-pad);top=Math.max(0,top-pad);right=Math.min(width-1,right+pad);bottom=Math.min(height-1,bottom+pad);
    const w=right-left+1,h=bottom-top+1;
    if(w*h>=width*height*.9)return image;
    const out=new OffscreenCanvas(w,h);
    out.getContext("2d").drawImage(bitmap,left,top,w,h,0,0,w,h);
    const blob=await out.convertToBlob({type:"image/png"});
    return {...image,mime:"image/png",bytes:new Uint8Array(await blob.arrayBuffer()),crop:[left,top,w,h,width,height]};
  }catch{return image;}
}

self.onmessage=async({data})=>{
  const file=data.file??data;
  let reader,ptr,thumbnail=null;
  try{
    const bytes=await file.arrayBuffer();
    const head=new TextDecoder().decode(bytes.slice(0,4096));
    // A DXF (the revisions ObraCota writes of a drawing, or an uploaded one): ASCII with its first section, or binary.
    const dxf=/^AutoCAD Binary DXF/.test(head) || /^\s*(?:999\s*\r?\n[^\n]*\r?\n\s*)*0\s*\r?\n\s*SECTION\b/.test(head);
    const version=dxf?"DXF":head.slice(0,6);
    if(!dxf && !/^AC\d{4}$/.test(version))throw new Error("La cabecera del archivo DWG no es válida.");
    self.postMessage({status:"Leyendo espacio modelo y capas…"});
    reader=await LibreDwg.create(new URL("../dwg/wasm",self.location.href).href);
    ptr=reader.dwg_read_data(bytes,dxf?Dwg_File_Type.DXF:Dwg_File_Type.DWG);
    if(!ptr)throw new Error(dxf?"No se pudo decodificar el DXF.":"No se pudo decodificar el DWG.");
    const {database,stats}=reader.convertEx(ptr);
    if(!data.indexOnly){
      try{addPolyfaceMeshes(reader,ptr,database);}
      catch{/* A file whose meshes cannot be read still opens with the rest of its geometry. */}
    }
    self.postMessage({status:"Agrupando geometría por capa…"});
    let result;
    try{result=extract(database,stats.unknownEntityCount,data.indexOnly);}
    catch(error){
      // A model of ACIS solids draws nothing, but its stored thumbnail still shows the design. Any other
      // failure (an empty model space, content only in layouts) keeps its reason alone.
      const message=error instanceof Error?error.message:"Error de lectura DWG.";
      if(error?.code==="acis" && !data.indexOnly){
        try{thumbnail=storedThumbnail(reader,ptr);}
        catch{/* The picture only completes the message; without it the message stands alone. */}
      }
      if(error?.code==="acis" && !data.indexOnly){
        const framed=thumbnail?await framedThumbnail(thumbnail):null;
        const preview=framed?{kind:framed.kind,mime:framed.mime,bytes:framed.bytes,crop:framed.crop}:undefined;
        self.postMessage({error:message,reason:"acis",preview,solids:error.solids,version,versionId:await fileVersion(bytes)},framed?[framed.bytes.buffer]:[]);
        return;
      }
      throw error;
    }
    reader.dwg_free(ptr);ptr=null;
    self.postMessage({...result,version,versionId:await fileVersion(bytes)},result.groups.map(g=>g.positions.buffer));
  }catch(error){self.postMessage({error:error instanceof Error?error.message:"Error de lectura DWG."});}
  finally{if(ptr)reader.dwg_free(ptr);}
};
