import type {ElementInfo} from "@/viewer/domain/viewer.port";

function index(items:ElementInfo[]){
  const groups=new Map<string,ElementInfo[]>();
  for(const item of items){
    if(!item.annotation)continue;
    const handle=item.annotation.handle;
    const bucket=groups.get(handle);
    if(bucket)bucket.push(item);else groups.set(handle,[item]);
  }
  return groups;
}
function near(a:number[],b:number[]){
  return a.length===b.length && a.every((value,i)=>Math.abs(value-b[i])<=1e-7);
}
export function compareDrawings(previous:ElementInfo[],current:ElementInfo[]){
  const old=index(previous),next=index(current);
  const changes:{handle:string;reason:string;before?:ElementInfo;after?:ElementInfo}[]=[];
  let ambiguous=0;
  for(const handle of new Set([...old.keys(),...next.keys()])){
    const a=old.get(handle)??[],b=next.get(handle)??[];
    if(!handle || a.length>1 || b.length>1){ambiguous++;continue;}
    const before=a[0],after=b[0];
    const reasons:string[]=[];
    if(!before)reasons.push("Añadido");
    else if(!after)reasons.push("Retirado");
    else {
      if(before.type!==after.type)reasons.push("Tipo");
      if(before.level!==after.level)reasons.push("Capa");
      const label=(item:ElementInfo)=>item.dimension?(item.annotation!.raw||"<>"):item.name;
      if(label(before)!==label(after))reasons.push("Texto");
      if(!near(before.annotation!.position,after.annotation!.position))reasons.push("Posición");
      const x=before.dimension,y=after.dimension;
      if(x && y && (!near([x.value,...x.endpoints],[y.value,...y.endpoints]) || x.kind!==y.kind || x.style!==y.style))reasons.push("Cota");
    }
    if(reasons.length)changes.push({handle,reason:reasons.join(", "),before,after});
  }
  return {changes,ambiguous};
}
