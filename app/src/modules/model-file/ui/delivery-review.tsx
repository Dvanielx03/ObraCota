"use client";
import {DrawingComparison} from "./drawing-comparison";
import {NotesContext,localNotes} from "./notes-source";
import {createPortal} from "react-dom";
import {useContext,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState,type ReactNode,type Ref,type RefObject} from "react";
import {ListChecks,X} from "lucide-react";
import type {ModelInfo} from "@/viewer/domain/viewer.port";
import {reviewDelivery} from "../application/review-delivery";
import {ToolPopover} from "./tool-popover";
import Link from "next/link";
import {loadServerReview,operationLines,roleLabel,serverReportLines,summaryLine,topClasses,type ReviewScope,type ServerReview} from "../infrastructure/server-review";
import {ChangeDiff,ChangeFindings,ChangeRecipe,ChangeValidation} from "@/modules/model-change/ui/change-report";
import {useOperationLabels} from "@/modules/model-change/ui/change-card";
import {statusLabel,type ModelChange} from "@/modules/model-change/domain/model-change";

/** One model change in the server part of the report: its recipe, notices, diff and validation (change-report.tsx). */
function ServerChange({role,change}:{role:Parameters<typeof roleLabel>[0];change:ModelChange}){
  const labels=useOperationLabels(change);
  return <article className="review-server-change" aria-label={roleLabel(role)+": "+change.description}>
    <h4>{roleLabel(role)}</h4>
    <p>{change.description} · {statusLabel(change.status)}{change.origin==="AGENT"?" · generado con IA":""} · <Link href={"/proyectos/"+change.project+"/cambios#"+change.id}>Abrir su tarjeta</Link></p>
    <ChangeRecipe change={change} labels={labels}/>
    <ChangeFindings change={change}/>
    <ChangeDiff change={change}/>
    <ChangeValidation change={change}/>
  </article>;
}

/** What the workspace can ask of the review (guides close it before they start). */
export interface DeliveryReviewHandle{close():void}

/**
 * REVISAR (DU-16): a 340 px panel anchored above its button, like the other tools of the bar
 * (03-herramientas.md §1.1), with the file, what is checked and «Preparar informe». The report itself
 * is long, so it opens in a modal dialog («Informe de revisión»); closing it gives the focus back to
 * REVISAR. `trigger` draws the bar's mode button; it receives the toggle, the anchor ref and whether
 * the panel is open.
 */
export function DeliveryReview({model,locate,guided,onDownloaded,trigger,control,onOpenChange,server}:{guided:boolean;onDownloaded:()=>void;model:ModelInfo;locate:(id:string)=>void;
  /** Where the open IFC lives on the server: Revisar adds the server's report (H7) to the one made in the browser. */
  server?:ReviewScope;
  trigger?:(toggle:()=>void,anchor:RefObject<HTMLButtonElement|null>,open:boolean)=>ReactNode;control?:Ref<DeliveryReviewHandle>;
  /** The panel opened or closed: the bar hides Editar's sub-bar meanwhile, as it does for its own panels. */
  onOpenChange?:(open:boolean)=>void}){
  const dialog=useRef<HTMLDialogElement>(null),anchor=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false);
  // The trigger lives inside the bar, whose backdrop blur would become the panel's containing block:
  // the panel and the report are portalled to the stage, next to the other tool panels.
  const [host,setHost]=useState<HTMLElement|null>(null);
  useLayoutEffect(()=>{setHost(anchor.current?.closest<HTMLElement>(".stage")??document.body);},[]);
  const changed=useRef(onOpenChange);
  changed.current=onOpenChange;
  useEffect(()=>{changed.current?.(open);},[open]);
  useEffect(()=>()=>changed.current?.(false),[]);
  const [input,setInput]=useState(""),[error,setError]=useState(""),[running,setRunning]=useState(false);
  const [report,setReport]=useState<ReturnType<typeof reviewDelivery>|null>(null);
  const [serverReview,setServerReview]=useState<ServerReview|null>(null),[serverError,setServerError]=useState("");
  // Only an IFC has a reading and model changes on the server.
  const scope=server && /^IFC/i.test(model.schema)?server:undefined;
  const stored=useContext(NotesContext);
  useImperativeHandle(control,()=>({close(){setOpen(false);dialog.current?.close();}}),[]);
  async function run(){
    setReport(null);setError("");setRunning(true);setServerReview(null);setServerError("");
    try{
      // The server's report is read alongside; if it fails, the browser's report still opens and says why.
      const remote=scope?loadServerReview(scope).then(value=>{setServerReview(value);return value;},failure=>{
        setServerError(failure instanceof Error?failure.message:"No se pudo leer el informe del servidor.");return null;}):Promise.resolve(null);
      const notes=stored ? await stored.load() : model.versionId ? await localNotes(model.versionId).load() : {};
      const local=reviewDelivery(model,input,notes);
      await remote;
      setReport(local);
      setOpen(false);
      dialog.current?.showModal();
    }catch(e){setError(e instanceof Error?e.message:"No se pudo preparar la revisión.");}
    finally{setRunning(false);}
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
    if(serverReview)lines.push(...serverReportLines(serverReview));
    else if(scope)lines.push("","INFORME DEL SERVIDOR","No disponible: "+(serverError||"sin respuesta"));
    const url=URL.createObjectURL(new Blob([lines.join("\r\n")],{type:"text/plain;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download=model.name+"-revision.txt";link.click();onDownloaded();setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(guided)dialog.current?.close();
  }
  const toggle=()=>{if(!open){setError("");}setOpen(!open);};
  const goTo=(id:string)=>{dialog.current?.close();setOpen(false);locate(id);};
  return <>{trigger?trigger(toggle,anchor,open):<button ref={anchor} className="review-trigger" aria-expanded={open} aria-controls="tool-review" onClick={toggle}><ListChecks size={16} aria-hidden="true"/>Revisar entrega</button>}
    {host && createPortal(<>
    <ToolPopover open={open} anchor={anchor} id="tool-review" className="review-popover" label="Revisión de entrega" title="Revisión de entrega"
      closeLabel="Cerrar revisión" width={340} keepMounted onClose={()=>setOpen(false)}>
      <div className="tool-popover-body review-body">
        <p className="review-file" title={model.name+" · "+model.schema}>{model.name} · {model.schema}</p>
        {guided && <p className="guide-tip" role="status">{model.drawing?"Paso 3 de 4 · Escribe un concepto que hayas visto en el plano y pulsa Preparar informe.":"Paso 3 de 4 · Pulsa Preparar informe para reunir los datos y tu observación."}</p>}
        {model.drawing?<label className="review-concepts"><span className="section-label">Conceptos que pide la entrega</span><textarea placeholder={"Rebose\nCuarto de bombas"} value={input} onChange={e=>{setInput(e.target.value);setReport(null);setError("");}}/></label>:
        <p className="options-note">{model.sample?"El ejemplo GLB permite recopilar observaciones. Abre el IFC original para revisar sus propiedades.":"Comprueba GlobalId, nivel y material directos de las piezas importadas, y reúne tus observaciones."}</p>}
        {error && <p role="alert" className="options-alert">{error}</p>}
        {model.drawing && <DrawingComparison model={model} locate={goTo}/>}
      </div>
      <div className="tool-popover-foot">
        <button type="button" className="main-button review-run" data-tour="prepare" aria-busy={running || undefined} disabled={running} onClick={()=>void run()}>
          <ListChecks size={16} strokeWidth={2} aria-hidden="true"/>Preparar informe</button>
      </div>
    </ToolPopover>
    <dialog className="delivery-review" ref={dialog} aria-labelledby="delivery-title" onClose={()=>anchor.current?.focus({preventScroll:true})}>
      <div className="review-heading"><h2 id="delivery-title">Informe de revisión</h2>
        <button type="button" className="review-close" aria-label="Cerrar revisión" title="Cerrar · Esc" onClick={()=>dialog.current?.close()}><X size={16} strokeWidth={2} aria-hidden="true"/></button></div>
      <p>{model.name} · {model.schema}</p>{guided && report && <p className="guide-tip" role="status">Paso 4 de 4 · Comprueba que tu observación aparece en el resultado y pulsa Descargar informe para conservarlo.</p>}
      {report && <section aria-label="Resultados de revisión"><p role="status">{report.inspected} registros · {report.scope}</p>
      {report.omissions && <p>Sin representar: {report.omissions}</p>}
      {scope && <section className="review-server" aria-label="Informe del servidor"><h3>Informe del servidor</h3>
        {serverError?<p role="alert">No se pudo leer el informe del servidor: {serverError}</p>:serverReview && <>
          {serverReview.summary?<>
            <p>{summaryLine(serverReview.summary)}</p>
            <p className="review-server-classes">{topClasses(serverReview.summary)}</p>
            <ul className="review-server-operations">{operationLines(serverReview.summary).map(line=><li key={line}>{line}</li>)}</ul>
          </>:<p>La lectura del motor no está disponible: {serverReview.summaryError}</p>}
          {serverReview.changes.length?serverReview.changes.map(item=><ServerChange key={item.role+item.change.id} role={item.role} change={item.change}/>)
            :<p>Ningún cambio de modelo publicó esta versión ni está abierto sobre ella.</p>}
        </>}
      </section>}
      {report.excerpts.length>0 && <div><h3>Extractos del revisor</h3>{report.excerpts.map(note=><p key={note.id}>{note.text} · {note.source?.name??"Vínculo perdido"}</p>)}</div>}
      {report.checks.map(row=><details key={row.check}><summary>{row.check} · {row.result} ({row.evidence.length})</summary>
        {row.evidence.slice(0,12).map(item=><button key={item.id} onClick={()=>goTo(item.id)}>{item.name} · {item.group}</button>)}
        {row.evidence.length>12 && <p>El informe incluye los {row.evidence.length} registros.</p>}
      </details>)}
      <p>Observaciones del revisor: {report.observations.length}</p><button className="review-run" data-tour="download" onClick={download}>Descargar informe</button></section>}
    </dialog></>,host)}</>;
}
