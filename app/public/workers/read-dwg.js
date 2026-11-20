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

export function extract(db, unknown,indexOnly=false) {
  const blocks=new Map(db.tables.BLOCK_RECORD.entries.map(b=>[b.name,b]));
  const layers=new Map(db.tables.LAYER.entries.map(l=>[l.name,l]));
  const batches=new Map(), skipped=new Map();
  const labels=[];
  const dimensions=[];
  const omit=type=>skipped.set(type,(skipped.get(type)||0)+1);
  let origin=null,minZ=Infinity,maxZ=-Infinity;
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
      const name=raw.replace(/\\P/g," ").replace(/\\[ACFHQTWcfhp][^;]*;/g,"")
        .replace(/\\[LlOoKk]/g,"").replace(/\\~/g," ").replace(/[{}]/g,"").trim();
      const point=e.type==="TEXT"?e.startPoint:e.insertionPoint;
      if(!point || !name){omit(e.type);return;}
      const location=vec(point);
      if(e.type==="TEXT"){location.z=e.elevation??0;location.applyMatrix4(ocs(e.extrusionDirection));}
      location.applyMatrix4(parent);
      if(!location.toArray().every(Number.isFinite)){omit(e.type);return;}
      labels.push({id:"annotation:"+labels.length,name,level:layer,type:e.type,
        annotation:{handle:String(e.handle??""),raw,position:location.toArray(),anchor:location.toArray(),
          height:Math.abs(e.textHeight||0)*parent.getMaxScaleOnAxis()}});
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
    const kind=e.type==="3DFACE"?"faces":e.type==="POINT"?"points":"lines";
    let batch;
    function vertex(p){
      p.applyMatrix4(space);
      if(![p.x,p.y,p.z].every(Number.isFinite))throw new Error("Coordenadas DWG inválidas.");
      origin??=p.clone();
      minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);
      if(!batch){
        const id=layer+"/"+kind;
        if(!batches.has(id))batches.set(id,{id,layer,kind,color:properties?.color,count:0,positions:[]});
        batch=batches.get(id);batch.count++;
      }
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
  for(const entity of db.entities)visit(entity);
  if(unknown)skipped.set("Otros objetos sin decodificar",unknown);
  const records=labels.concat(dimensions);
  if(indexOnly)return {groups:[],labels:records,units:db.header.INSUNITS??0};
  if(!batches.size)throw new Error("El espacio modelo no contiene geometría DWG compatible.");
  const groups=Array.from(batches.values(),batch=>({...batch,positions:new Float32Array(batch.positions)}));
  for(const {annotation} of records){
    const [x,y,z]=annotation.anchor;
    annotation.anchor=[x-origin.x,z-origin.z,origin.y-y];
  }
  return {groups,labels:records,units:db.header.INSUNITS??0,depth:maxZ-minZ,omissions:[...skipped].map(([t,n])=>t+" ("+n+")").join(", ")};
}
self.onmessage=async({data})=>{
  const file=data.file??data;
  let reader,ptr;
  try{
    const bytes=await file.arrayBuffer();
    const version=new TextDecoder().decode(bytes.slice(0,6));
    if(!/^AC\d{4}$/.test(version))throw new Error("La cabecera del archivo DWG no es válida.");
    self.postMessage({status:"Leyendo espacio modelo y capas…"});
    reader=await LibreDwg.create(new URL("../dwg/wasm",self.location.href).href);
    ptr=reader.dwg_read_data(bytes,Dwg_File_Type.DWG);
    if(!ptr)throw new Error("No se pudo decodificar el DWG.");
    const {database,stats}=reader.convertEx(ptr);
    reader.dwg_free(ptr);ptr=null;
    self.postMessage({status:"Agrupando geometría por capa…"});
    const result=extract(database,stats.unknownEntityCount,data.indexOnly);
    self.postMessage({...result,version,versionId:await fileVersion(bytes)},result.groups.map(g=>g.positions.buffer));
  }catch(error){self.postMessage({error:error instanceof Error?error.message:"Error de lectura DWG."});}
  finally{if(ptr)reader.dwg_free(ptr);}
};
