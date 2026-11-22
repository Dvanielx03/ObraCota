"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {ChevronRight} from "lucide-react";
import {ViewerWorkspace} from "@/modules/model-file/ui/viewer-workspace";
import {versionRepository} from "@/modules/model-version/infrastructure/version-http";
import {projectHttpRepository} from "@/modules/project/infrastructure/project-http-repository";
import {ThemeToggle} from "@/shared/theme/theme-toggle";
import {BrandMark} from "@/shared/ui/brand-mark";
import {ModelPreparing,Skeleton} from "@/shared/ui/loading";
import {documentTitle,useDocumentTitle} from "@/shared/ui/document-title";
import type {ModelChange} from "../domain/model-change";
import {modelChangeRepository} from "../infrastructure/model-change-http";
import {ChangeCompare} from "./change-compare";
import "./proposal-viewer.css";

/** Why a change cannot be opened as a 3D proposal, or nothing when its preview is current, available and ok. */
function unusable(change:ModelChange):string|undefined{
  if(change.status==="APPLIED")return "Este cambio ya se aplicó: ábrelo como versión desde su tarjeta.";
  if(change.status==="RESTORED")return "Este cambio ya se aplicó y se restauró: ábrelo desde su tarjeta.";
  if(change.status==="DISCARDED")return "Este cambio se descartó y ya no tiene vista previa.";
  if(!change.report)return "Previsualiza el cambio desde su tarjeta para verlo en 3D.";
  if(!change.reportCurrent)return "La receta cambió después de la última vista previa. Previsualízalo de nuevo desde su tarjeta.";
  if(!change.report.ok)return "La última vista previa no superó sus comprobaciones, así que no hay un IFC que mostrar.";
  if(!change.preview.available)return "El archivo de la vista previa ya no está disponible. Previsualiza el cambio de nuevo desde su tarjeta.";
  return undefined;
}

/**
 * «Ver propuesta en 3D» (H1 §7.4): the verified IFC of the preview in the usual workspace, without a stored version,
 * so notes, saved views, Renderizar and the rail never write over the base. RECORRIDO compares it with the base
 * («Base» · «Propuesta») and Comparar lists what IfcDiff found.
 */
export function ProposalViewer({project,change:id}:{project:string;change:string}){
  const back="/proyectos/"+project+"/cambios#"+id;
  const [change,setChange]=useState<ModelChange>();
  const [file,setFile]=useState<File>();
  const [error,setError]=useState("");
  const [attempt,retry]=useState(0);
  const [projectName,setProjectName]=useState<string>();
  useDocumentTitle(projectName || change ? documentTitle(projectName,"Vista previa",change?.description) : null);
  useEffect(()=>{
    let live=true;
    projectHttpRepository.get(project).then(value=>{if(live)setProjectName(value.name);}).catch(()=>undefined);
    return ()=>{live=false;};
  },[project]);
  useEffect(()=>{
    const controller=new AbortController();
    setFile(undefined);
    (async()=>{
      const current=await modelChangeRepository.get(project,id,controller.signal);
      if(controller.signal.aborted)return;
      setChange(current);
      const reason=unusable(current);
      if(reason)throw new Error(reason);
      const preview=await modelChangeRepository.openPreview(project,current,controller.signal);
      if(!controller.signal.aborted)setFile(preview);
    })().catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"No se pudo descargar la vista previa.");});
    return ()=>controller.abort();
  },[project,id,attempt]);
  if(file && change)return <ViewerWorkspace initialFile={file} returnHref={back} returnLabel="Volver a cambios" projectName={projectName}
    loadPrevious={signal=>versionRepository.open(project,change.baseVersion,signal)}
    proposal={{label:"Vista previa sin publicar",description:change.description,
      compare:({elements,viewer,selected})=><ChangeCompare diff={change.report?.diff} elements={elements} viewer={viewer} selected={selected}/>}}
    walkLabels={{older:"Base",newer:"Propuesta"}}/>;
  // Until the preview arrives: the header as the viewer will show it, with the wait in the middle (as the stored viewer).
  return <main className="workspace-pending" aria-busy={!error || undefined}>
    <h1 className="visually-hidden">Ver propuesta en 3D</h1>
    <header className="workspace-pending-bar">
      <div className="workspace-pending-crumbs">
        <Link href={back} aria-label="Volver a cambios" title="Volver a cambios">
          <BrandMark wordmark={false}/>
        </Link>
        <ChevronRight size={24} strokeWidth={2} aria-hidden="true"/>
        <p className="workspace-pending-name">{projectName ?? <Skeleton/>}</p>
      </div>
      <ThemeToggle/>
    </header>
    {error ? <div className="workspace-pending-error">
        <h2 role="alert">No se pudo abrir la vista previa</h2><p>{error}</p>
        <div className="model-preparing-actions">
          {(!change || !unusable(change)) && <button type="button" onClick={()=>{setError("");retry(value=>value+1);}}>Reintentar</button>}
          <Link href={back}>Volver a cambios</Link>
        </div>
      </div>
      : <ModelPreparing phase="Descargando la vista previa…" stage="viewer" detail={change?"Propuesta sobre v"+change.baseRevision+" · "+change.baseName:undefined}>
        <Link href={back} title="Volver a cambios">Cancelar</Link>
      </ModelPreparing>}
  </main>;
}
