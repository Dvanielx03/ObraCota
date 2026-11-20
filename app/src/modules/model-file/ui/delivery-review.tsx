import {DrawingComparison} from "./drawing-comparison";
import {useRef,useState} from "react";
import type {ModelInfo} from "@/viewer/domain/viewer.port";
import {reviewDelivery} from "../application/review-delivery";

export function DeliveryReview({model,locate,guided,onDownloaded}:{guided:boolean;onDownloaded:()=>void;model:ModelInfo;locate:(id:string)=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [input,setInput]=useState(""),[error,setError]=useState("");
  const [report,setReport]=useState<ReturnType<typeof reviewDelivery>|null>(null);
  function run(){
    setReport(null);setError("");
    try{
      const notes:Record<string,string>={};
      if(model.versionId){
        const prefix="obracota.review.v1."+model.versionId+".";
        for(const key of Object.keys(localStorage))if(key.startsWith(prefix))notes[key.slice(prefix.length)]=localStorage.getItem(key)??"";
      }
      setReport(reviewDelivery(model,input,notes));
    }catch(e){setError(e instanceof Error?e.message:"No se pudo preparar la revisión.");}
  }
  function download(){
    if(!report)return;
    const lines=["REVISIÓN DE ENTREGA",report.file,report.schema,"Versión: "+(report.version??"Sin huella"),"Alcance: "+report.scope,
      "Registros revisados: "+report.inspected];
    if(report.units)lines.push("Unidades: "+report.units);
    if(report.omissions)lines.push("Sin representar: "+report.omissions);
    if(report.excerpts.length)lines.push("","Extractos del revisor",...report.excerpts.map(n=>n.text+" — ID "+n.id));
    for(const row of report.checks){
      lines.push("",row.check+" — "+row.result+" ("+row.evidence.length+")");
      for(const item of row.evidence)lines.push("  "+[item.name,item.group,item.type,"ID "+item.id,item.sourceId].filter(Boolean).join(" · "),...(item.original?["    Original: "+item.original]:[]));
    }
    lines.push("","Observaciones del revisor ("+report.observations.length+")");
    for(const note of report.observations)lines.push(note.text+" — "+[note.source?.name??"Vínculo perdido",note.source?.group,note.id,note.source?.sourceId,note.source?.measure!==undefined?"Medida geométrica "+note.source.measure+" "+report.units:undefined,note.source?.measure!==undefined?note.source.original:undefined].filter(Boolean).join(" · "));
    const url=URL.createObjectURL(new Blob([lines.join("\r\n")],{type:"text/plain;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download=model.name+"-revision.txt";link.click();onDownloaded();setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(guided)dialog.current?.close();
  }
  return <><button className="review-trigger" onClick={()=>{setReport(null);setError("");dialog.current?.showModal();}}>Revisar entrega</button>
    <dialog className="delivery-review" ref={dialog} aria-labelledby="delivery-title">
      <div className="review-heading"><h2 id="delivery-title">Revisión de entrega</h2><button aria-label="Cerrar revisión" onClick={()=>dialog.current?.close()}>×</button></div>
      <p>{model.name} · {model.schema}</p>{guided && <p className="guide-tip" role="status">{report?"Paso 4 de 4 · Comprueba que tu observación aparece en el resultado y pulsa Descargar informe para conservarlo.":model.drawing?"Paso 3 de 4 · Escribe un concepto que hayas visto en el plano y pulsa Preparar informe.":"Paso 3 de 4 · Pulsa Preparar informe para reunir los datos y tu observación."}</p>}
      {model.drawing?<label>Conceptos que pide la entrega<textarea placeholder={"Rebose\nCuarto de bombas"} value={input} onChange={e=>{setInput(e.target.value);setReport(null);setError("");}}/></label>:
      <p>{model.sample?"El ejemplo GLB permite recopilar observaciones. Abre el IFC original para revisar sus propiedades.":"Comprobar GlobalId, nivel y material directos de las piezas importadas."}</p>}
      <button className="review-run" data-tour="prepare" onClick={run}>Preparar informe</button>
      {error && <p role="alert">{error}</p>}
      {report && <section aria-label="Resultados de revisión"><p role="status">{report.inspected} registros · {report.scope}</p>
      {report.omissions && <p>Sin representar: {report.omissions}</p>}
      {report.excerpts.length>0 && <div><h3>Extractos del revisor</h3>{report.excerpts.map(note=><p key={note.id}>{note.text} · {note.source?.name??"Vínculo perdido"}</p>)}</div>}
      {report.checks.map(row=><details key={row.check}><summary>{row.check} · {row.result} ({row.evidence.length})</summary>
        {row.evidence.slice(0,12).map(item=><button key={item.id} onClick={()=>{dialog.current?.close();locate(item.id);}}>{item.name} · {item.group}</button>)}
        {row.evidence.length>12 && <p>El informe incluye los {row.evidence.length} registros.</p>}
      </details>)}
      <p>Observaciones del revisor: {report.observations.length}</p><button className="review-run" data-tour="download" onClick={download}>Descargar informe</button></section>}
      {model.drawing && <DrawingComparison model={model} locate={id=>{dialog.current?.close();locate(id);}}/>}
    </dialog></>;
}
