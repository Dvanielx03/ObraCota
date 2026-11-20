import type {ElementInfo,ModelInfo} from "@/viewer/domain/viewer.port";
import {representativeNotes} from "./representative-notes";

const normalize=(value:string)=>(value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().match(/[\p{L}\p{N}]+|[^\s]/gu)??[]).join(" ");
function grams(word:string){
  const padded="^"+word+"$";
  return new Set(Array.from({length:padded.length-2},(_,i)=>padded.slice(i,i+3)));
}

interface Evidence {id:string; name:string; group:string; type:string; sourceId?:string; original?:string;measure?:number}
interface Finding {check:string; result:string; evidence:Evidence[]}
function evidence(e:ElementInfo):Evidence{
  return {id:e.id,name:e.name,group:e.level,type:e.type,sourceId:e.annotation?.handle||e.guid,original:e.annotation?.raw,measure:e.dimension?.value};
}

// Fit inverse document frequencies to this drawing. Approximate matches stay
// separate from literal evidence even if every term has a close neighbour.
function textChecks(elements:ElementInfo[],terms:string[]):Finding[]{
  const records=elements.filter(e=>e.annotation && !e.dimension).map(e=>({e,words:normalize(e.name).split(" ")}));
  const vocabulary=new Map<string,Set<string>>();
  const frequencies=new Map<string,number>();
  for(const {words} of records){
    const seen=new Set<string>();
    for(const word of words){
      if(!vocabulary.has(word))vocabulary.set(word,grams(word));
      for(const g of vocabulary.get(word)!)seen.add(g);
    }
    for(const g of seen)frequencies.set(g,(frequencies.get(g)??0)+1);
  }
  const weight=(g:string)=>1+Math.log((records.length+1)/((frequencies.get(g)??0)+1));
  return terms.map(check=>{
    const term=normalize(check);
    const literal=records.filter(r=>(" "+r.words.join(" ")+" ").includes(" "+term+" "));
    if(literal.length)return {check,result:"Texto encontrado",evidence:literal.map(r=>evidence(r.e))};
    const suggested=new Set<string>();
    if(term.length>=4 && /^\p{L}+$/u.test(term)){
      const query=grams(term);
      for(const [word,features] of vocabulary){
        let common=0,total=0;
        for(const g of query){total+=weight(g);if(features.has(g))common+=weight(g);}
        for(const g of features)total+=weight(g);
        if(common*2/total>=0.44)suggested.add(word);
      }
    }
    const hits=records.filter(r=>r.words.some(w=>suggested.has(w)));
    return {check,result:hits.length?"Texto parecido · verificar":"Sin evidencia en textos leídos",evidence:hits.map(r=>evidence(r.e))};
  });
}

export function reviewDelivery(model:ModelInfo,input:string,notes:Record<string,string>){
  const terms=input.split(/\r?\n/).map(t=>t.trim()).filter(t=>/[\p{L}\p{N}]/u.test(t));
  const unique=Array.from(new Map(terms.map(t=>[normalize(t),t])).values());
  const checks:Finding[]=[];
  if(model.drawing){
    if((!unique.length && !Object.keys(notes).length) || unique.length>30)throw new Error("Indica entre 1 y 30 conceptos distintos, uno por línea.");
    checks.push(...textChecks(model.elements,unique));
  }else if(!model.sample){
    const rules:[string,(e:ElementInfo)=>boolean][]=[
      ["GlobalId sin extraer",e=>!e.guid],["Nivel directo sin extraer",e=>e.level==="Sin nivel directo"],
      ["Material directo sin extraer",e=>!e.material]
    ];
    for(const [check,predicate] of rules){
      const hits=model.elements.filter(predicate);
      checks.push({check,result:hits.length?"Revisar en el original":"Sin hallazgos en el alcance",evidence:hits.map(evidence)});
    }
  }
  const index=new Map(model.elements.map(e=>[e.id,e]));
  const observations=Object.entries(notes).map(([id,text])=>({text,id,source:index.has(id)?evidence(index.get(id)!):null}));
  return {file:model.name,version:model.versionId??null,schema:model.schema,
    scope:model.drawing?"TEXT y MTEXT indexados del espacio modelo":model.sample?"Conjuntos del ejemplo GLB":"Elementos IFC con geometría importada y relaciones directas",
    inspected:model.drawing?model.elements.filter(e=>e.annotation && !e.dimension).length:model.elements.length,
    units:model.drawing?.units,omissions:model.drawing?.omissions,checks,
    excerpts:representativeNotes(observations),observations};
}
