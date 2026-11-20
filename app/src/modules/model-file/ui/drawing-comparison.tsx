import {useEffect,useRef,useState} from "react";
import type {ModelInfo,ElementInfo} from "@/viewer/domain/viewer.port";
import {compareDrawings} from "../application/compare-drawings";

function caption(item?:ElementInfo){
  if(!item)return "Ausente";
  return item.dimension?(item.annotation?.raw||"<>")+" · "+item.dimension.value.toLocaleString("es-CO",{maximumFractionDigits:6}):item.name;
}
export function DrawingComparison({model,locate}:{model:ModelInfo;locate:(id:string)=>void}){
  const [expanded,setExpanded]=useState(false),[message,setMessage]=useState(""),[limit,setLimit]=useState(20);
  const [result,setResult]=useState<ReturnType<typeof compareDrawings>>();
  const job=useRef<AbortController|null>(null);
  useEffect(()=>()=>job.current?.abort(),[]);
  async function compare(file:File){
    job.current?.abort();
    const controller=new AbortController();job.current=controller;
    setResult(undefined);setLimit(20);setMessage("Leyendo "+file.name+"…");
    try{
      const {readDrawingIndex,drawingUnits}=await import("@/viewer/infrastructure/model-source");
      const old=await readDrawingIndex(file,controller.signal);
      if(drawingUnits(old.units)!==model.drawing?.units)throw new Error("Las unidades declaradas difieren. Revisa la escala antes de comparar.");
      setResult(compareDrawings(old.labels,model.elements));setMessage(file.name+" → "+model.name);
    }catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"Error de lectura.");}
  }
  return <section><button aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>Comparar versiones DWG</button>{expanded && <>
    <p>Abre la versión anterior del mismo dibujo. Se comparan textos y cotas lineales o alineadas por identificador CAD.</p>
    <label>Versión anterior<input type="file" accept=".dwg" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void compare(file);}}/></label>
    <p role="status">{message}</p>{result && <><p>{result.changes.length} diferencias · {result.ambiguous} identificadores sin correspondencia única</p>
      {result.changes.slice(0,limit).map(c=><div key={c.handle}><strong>{c.handle} · {c.reason}</strong><p>{caption(c.before)} → {caption(c.after)}</p>{c.after && <button onClick={()=>locate(c.after!.id)}>Localizar {c.handle}</button>}</div>)}
      {result.changes.length>limit && <button onClick={()=>setLimit(limit+20)}>Ver más diferencias</button>}
    </>}</>}</section>;
}
