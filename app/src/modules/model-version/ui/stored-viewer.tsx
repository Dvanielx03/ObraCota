"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ViewerWorkspace } from "@/modules/model-file/ui/viewer-workspace";
import { versionRepository, remoteNotes } from "../infrastructure/version-http";
import {revisionLabel,type ModelVersion} from "../domain/model-version";
import {authenticated} from "@/core/http/http-client";
import {projectHttpRepository} from "@/modules/project/infrastructure/project-http-repository";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { BrandMark } from "@/shared/ui/brand-mark";
import { ModelPreparing, Skeleton } from "@/shared/ui/loading";
import { documentTitle, useDocumentTitle } from "@/shared/ui/document-title";

export function StoredViewer({ project, version, previous }: { project: string; version: string; previous?:string }) {
  const href="/proyectos/"+project+"/archivos";
  const [file,setFile]=useState<File>();
  const [error,setError]=useState("");
  const [attempt,retry]=useState(0);
  const [projectName,setProjectName]=useState<string>();
  const [revision,setRevision]=useState<{label:string;date:string}>();
  // "v2 · Duplex.ifc", under the phase of the wait while the original downloads.
  const [source,setSource]=useState<string>();
  const notes=useMemo(()=>remoteNotes(project,version),[project,version]);
  // Tab title: "Dúplex · v2 · ObraCota" once the project and the revision are known.
  useDocumentTitle(projectName || revision ? documentTitle(projectName, revision?.label) : null);
  // The header shows "project · file"; without the name it shows the file alone.
  useEffect(()=>{
    let live=true;
    projectHttpRepository.get(project).then(value=>{if(live)setProjectName(value.name);}).catch(()=>undefined);
    return ()=>{live=false;};
  },[project]);
  // "v2" and its upload date, for the presentation cover and the export index.
  useEffect(()=>{
    const controller=new AbortController();
    setRevision(undefined);setSource(undefined);
    versionRepository.get(project,version,controller.signal)
      .then(value=>{if(!controller.signal.aborted){setRevision({label:revisionLabel(value),date:value.uploadedAt});setSource(revisionLabel(value)+" · "+value.name);}}).catch(()=>undefined);
    return ()=>controller.abort();
  },[project,version]);
  useEffect(()=>{
    const controller=new AbortController();
    versionRepository.open(project,version,controller.signal).then(value=>{
      if(!controller.signal.aborted) setFile(value);
    }).catch(e=>{ if(!controller.signal.aborted) setError(e.message); });
    return ()=>controller.abort();
  },[project,version,attempt]);
  async function loadPrevious(signal:AbortSignal){
    if(!previous)throw new Error("Elige una revisión anterior.");
    const base=`projects/${project}/versions/`;
    const [current,prior]=await Promise.all([version,previous].map(id=>authenticated<ModelVersion>(base+id,{signal})));
    // The walk compares two models in metres: IFC, or FBX with its declared unit, of the same file.
    if(prior.fileId!==current.fileId || prior.revision>=current.revision || prior.format!==current.format || !["IFC","FBX"].includes(prior.format))
      throw new Error("La comparación requiere una revisión IFC o FBX anterior del mismo archivo.");
    return versionRepository.open(project,previous,signal);
  }
  if(file) return <ViewerWorkspace initialFile={file} storedVersion={{project,version}} storedNotes={notes} returnHref={href} returnLabel="Volver a archivos" loadPrevious={previous?loadPrevious:undefined} projectName={projectName} revision={revision}/>;
  // Until the original arrives: the canvas and its header as the viewer will show them, with the wait in the middle.
  return <main className="workspace-pending" aria-busy={!error || undefined}>
    <h1 className="visually-hidden">Abrir versión</h1>
    <header className="workspace-pending-bar">
      <div className="workspace-pending-crumbs">
        <Link href={href} aria-label="Volver a archivos" title="Volver a archivos">
          <BrandMark wordmark={false}/>
        </Link>
        <ChevronRight size={24} strokeWidth={2} aria-hidden="true"/>
        <p className="workspace-pending-name">{projectName ?? <Skeleton/>}</p>
      </div>
      <ThemeToggle/>
    </header>
    {error ? <div className="workspace-pending-error">
        <h2 role="alert">No se pudo descargar la versión</h2><p>{error}</p>
        <div className="model-preparing-actions"><button type="button" onClick={()=>{setError("");retry(v=>v+1);}}>Reintentar</button></div>
      </div>
      : <ModelPreparing phase="Descargando el original…" stage="viewer" detail={source}>
        <Link href={href} title="Volver a archivos">Cancelar</Link>
      </ModelPreparing>}
  </main>;
}
