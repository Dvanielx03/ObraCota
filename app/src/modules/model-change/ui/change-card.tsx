"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {authenticatedResponse} from "@/core/http/http-client";
import {BusyButton,LoadingStatus,Skeleton} from "@/shared/ui/loading";
import {isDrawingFormat,operationLabel,statusLabel,type ModelChange} from "../domain/model-change";
import {modelChangeRepository} from "../infrastructure/model-change-http";
import {ChangeEstimate,formatDay} from "./change-estimate";
import {AgentSteps} from "./agent-steps";
import "./agent-run.css";
import {VerifiedDownload} from "@/modules/model-version/ui/verified-download";
import {ChangeAffected,ChangeDiff,ChangeFindings,ChangeRecipe,ChangeValidation,proposalHref} from "./change-report";

type Work="preview"|"submit"|"discard"|"apply"|"restore";
const working:Record<Work,{button:string;status:string}>={
  preview:{button:"Preparando vista previa…",status:"Vista previa en cola o en verificación…"},
  submit:{button:"Enviando…",status:"Enviando el cambio a aprobación…"},
  discard:{button:"Descartando…",status:"Descartando el cambio…"},
  apply:{button:"Aplicando…",status:"Comprobando y guardando la revisión IFC…"},
  restore:{button:"Restaurando…",status:"Comprobando y guardando la revisión IFC…"},
};
const failure:Record<Work,string>={preview:"No se pudo previsualizar el cambio.",submit:"No se pudo enviar el cambio.",
  discard:"No se pudo descartar el cambio.",apply:"No se pudo publicar la revisión.",restore:"No se pudo publicar la revisión."};

function Picture({path}:{path:string}){
  const [url,setUrl]=useState(""),[error,setError]=useState(false);
  useEffect(()=>{
    const control=new AbortController();
    let objectUrl="";
    authenticatedResponse(path,{signal:control.signal}).then(r=>r.blob()).then(blob=>{
      if(!control.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}
    }).catch(()=>{if(!control.signal.aborted)setError(true);});
    return ()=>{control.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[path]);
  return url?<img src={url} width={320} style={{maxWidth:"100%",height:"auto"}} alt="Propuesta visual elegida"/>
    :error?<p>No se pudo abrir la propuesta.</p>
    :<><Skeleton shape="thumb" width={320} style={{maxWidth:"100%"}}/><LoadingStatus hidden>Cargando propuesta…</LoadingStatus></>;
}

/** Recipe lines in words, keyed by operation id; the estimate reuses them to name its lines. */
export function useOperationLabels(change:ModelChange){
  return useMemo(()=>{
    const results=new Map(change.report?.operations.map(result=>[result.id,result])??[]);
    return Object.fromEntries(change.recipe.operations.map(operation=>[operation.id,operationLabel(operation,results.get(operation.id),change.legacyReview)]));
  },[change]);
}

/** Header (§7.2 section 1): the origin. The run journal identifies which provider was used. */
export function ChangeHeader({change}:{change:ModelChange}){
  const origin=change.origin==="AGENT"?"Propuesta por el agente":"Propuesta por "+(change.author?.email??"una persona");
  return <div className="change-head">
    <div className="change-title"><h2>{change.description}</h2><span className="change-chip" data-status={change.status}>{statusLabel(change.status)}</span></div>
    <p className="change-meta"><span>{origin}</span><span>Base v{change.baseRevision} · {change.baseName}</span>
      {change.createdAt && <span>{formatDay(change.createdAt)}</span>}</p>
  </div>;
}

/**
 * One model change (§7.2): its recipe, affected pieces, notices, estimate, diff and validation, then the actions its
 * state allows. Each action the server does not allow stays visible, disabled, with the server's «Pendiente: …» reason.
 */
export function ChangeCard({change,onChange,locked,onWork}:{change:ModelChange;onChange:(next:ModelChange)=>void;locked:boolean;onWork:(busy:boolean)=>void}){
  const [work,setWork]=useState<Work>(),[error,setError]=useState("");
  const labels=useOperationLabels(change);
  const {actions}=change,prefix="/proyectos/"+change.project;
  const target=change.recipe.operations[0]?.element??change.legacyReview?.door.element;
  async function run(kind:Work){
    setWork(kind);setError("");onWork(true);
    try{onChange(await modelChangeRepository[kind](change.project,change.id));}
    catch(e){setError(e instanceof Error?e.message:failure[kind]);}
    finally{setWork(undefined);onWork(false);}
  }
  const button=(kind:Work,allowed:boolean,label:string,className="panel-action")=><BusyButton key={kind} className={className} busy={work===kind}
    busyLabel={working[kind].button} spinnerSize={14} disabled={locked||!allowed} title={allowed?undefined:actions.reasons[kind]} onClick={()=>void run(kind)}>{label}</BusyButton>;
  const reason=(kind:"preview"|"apply")=>actions.reasons[kind];
  const proposalReady=change.preview.available && change.reportCurrent && !!change.report?.ok;
  const drawing=isDrawingFormat(change.format);
  const look=drawing?"Ver propuesta en el plano":"Ver propuesta en 3D";
  const busy=work && (work==="apply"||work==="restore") && drawing?"Comprobando y guardando la revisión DXF…":work?working[work].status:"";
  return <article id={change.id} className="change-card">
    <ChangeHeader change={change}/>
    {change.agentRun && <AgentSteps project={change.project} run={change.agentRun} change={change.id}/>}
    <ChangeRecipe change={change} labels={labels}/>
    {change.report && !change.reportCurrent && <p className="change-note">La receta cambió después de esta vista previa. Previsualízala de nuevo para enviarla.</p>}
    {change.report && change.reportCurrent && !change.preview.available && (change.status==="DRAFT"||change.status==="READY") && change.report.ok &&
      <p className="change-note">El archivo de la vista previa ya no está disponible. Previsualízalo de nuevo para enviarlo.</p>}
    {change.report && !change.report.ok && <p className="change-fail">La vista previa no superó las comprobaciones: el cambio no se puede enviar a aprobación.</p>}
    <ChangeAffected change={change}/>
    <ChangeFindings change={change}/>
    {(change.report||!change.legacyReview) && <ChangeEstimate change={change} labels={labels}/>}
    <ChangeDiff change={change}/>
    <ChangeValidation change={change}/>
    {change.picture && <figure><Picture path={"projects/"+change.project+"/model-changes/"+change.id+"/picture"}/><figcaption>Referencia visual</figcaption></figure>}
    <div className="change-actions">
      {change.status==="DRAFT" && <>
        {button("preview",actions.preview,"Previsualizar cambio")}
        {button("submit",actions.submit,"Enviar a aprobación")}
        {button("discard",actions.discard,"Descartar borrador","panel-action change-secondary")}
      </>}
      {change.status==="READY" && <>
        {proposalReady && actions.apply?<Link className="panel-action" href={proposalHref(change)}>{look}</Link>
          :<button className="panel-action" disabled title={actions.apply?"Pendiente: previsualiza el cambio de nuevo para verlo":reason("apply")}>{look}</button>}
        {/* The proposal file expired or the report is stale: offer the way back instead of only a disabled button. */}
        {!proposalReady && actions.preview && button("preview",true,"Previsualizar de nuevo","panel-action change-secondary")}
        {button("apply",actions.apply,"Aprobar y aplicar cambio")}
        {button("discard",actions.discard,"Rechazar","panel-action change-secondary")}
        {!actions.preview && reason("preview") && <span className="change-note">{reason("preview")}</span>}
      </>}
      {change.status==="APPLIED" && change.appliedVersion && <>
        <p role="status">{drawing?"Cambio aplicado como revisión DXF. ":"Cambio aplicado. "}<Link href={prefix+"/visor/"+change.appliedVersion+(target?"?element="+encodeURIComponent(target)+"&":"?")+"anterior="+change.baseVersion}>Abrir nueva versión</Link></p>
        <VerifiedDownload project={change.project} version={change.appliedVersion} label="Descargar revisión publicada"/>
        {button("restore",actions.restore,"Crear revisión de restauración","panel-action restore-action")}
      </>}
      {change.status==="RESTORED" && change.restoredVersion && <p><Link href={prefix+"/visor/"+change.restoredVersion}>Abrir revisión restaurada</Link></p>}
      {change.status==="DISCARDED" && <p className="change-note">{change.discardedBy?.kind==="AGENT"
        ?"Descartada por el agente el "+formatDay(change.discardedAt)+" · propuesto por el agente de diseño"
        :"Descartada el "+formatDay(change.discardedAt)+" por "+(change.discardedBy?.email??"la propietaria")}</p>}
    </div>
    {work && <LoadingStatus>{busy}</LoadingStatus>}
    {error && <p role="alert">{error}</p>}
  </article>;
}
