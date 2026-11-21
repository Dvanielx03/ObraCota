import {IFCPROJECT, IFCRELDEFINESBYTYPE, IFCRELDEFINESBYPROPERTIES} from "../ifc/web-ifc-api.js";

// Read only relationships for visible doors. A Revit placeholder such as Finish=Finish is not a specification.
export function readDoorEvidence(api, model, doors, geometry) {
  if(!doors.length)return;
  const read=ref=>ref?.value?api.GetLine(model,ref.value):null;
  const ids=type=>api.GetLineIDsWithType(model,type);
  const projects=ids(IFCPROJECT);
  const project=projects.size()===1 ? api.GetLine(model,projects.get(0)) : null;
  const units=read(project?.UnitsInContext)?.Units || [];
  const length=units.map(read).find(u=>u?.UnitType?.value==="LENGTHUNIT");
  const prefixes={MILLI:"mm",CENTI:"cm",DECI:"dm",KILO:"km"};
  const name=length?.Name?.value;
  const unit=name==="METRE" ? (length.Prefix?.value ? prefixes[length.Prefix.value] || length.Prefix.value+"METRE" : "m") : name || "unidad sin identificar";
  const byId=new Map(doors.map(d=>[Number(d.id),d]));
  const value=v=>typeof v?.value==="number" && Number.isFinite(v.value)?v.value:null;
  for(const door of doors){
    const line=api.GetLine(model,Number(door.id));
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const part of door.parts){
      const m=part.matrix,{vertices,indices}=geometry.get(part.key);
      for(const index of new Set(indices)){
        const k=index*6;
        for(let axis=0;axis<3;axis++){
          const world=m[axis]*vertices[k]+m[4+axis]*vertices[k+1]+m[8+axis]*vertices[k+2]+m[12+axis];
          min[axis]=Math.min(min[axis],world);max[axis]=Math.max(max[axis],world);
        }
      }
    }
    door.evidence={unit,width:value(line.OverallWidth),height:value(line.OverallHeight),extents:max.map((v,i)=>v-min[i]),finishes:[],widths:[]};
  }
  function properties(door,ref,scope){
    const set=read(ref);
    for(const prop of set?.HasProperties || []){
      const item=read(prop), key=item?.Name?.value?.trim(), raw=item?.NominalValue?.value;
      if(!key || raw==null)continue;
      const source=scope+" · "+set.Name?.value+"."+key+" · #"+prop.value;
      if(/^(finish|acabado|surface finish|door finish)$/i.test(key) && typeof raw==="string" && raw.trim() &&
          ![key.toLowerCase(),"n/a","none","not defined","sin definir","-"].includes(raw.trim().toLowerCase())){
        door.evidence.finishes.push({value:raw.trim(),source});
      }
      if(/^(width|nominalwidth|ancho)$/i.test(key) && typeof raw==="number" && !item.Unit && item.NominalValue.name?.includes("LENGTHMEASURE")){
        door.evidence.widths.push({value:raw,source});
      }
    }
  }
  for(const relation of [IFCRELDEFINESBYTYPE,IFCRELDEFINESBYPROPERTIES]){
    const links=ids(relation);
    for(let i=0;i<links.size();i++){
      const rel=api.GetLine(model,links.get(i));
      for(const obj of rel.RelatedObjects || []){
        const door=byId.get(obj.value);
        if(!door)continue;
        if(relation===IFCRELDEFINESBYTYPE){
          const type=read(rel.RelatingType);
          for(const ref of type?.HasPropertySets || []) properties(door,ref,"Tipo");
        }else if(rel.RelatingPropertyDefinition) properties(door,rel.RelatingPropertyDefinition,"Elemento");
      }
    }
  }
}
