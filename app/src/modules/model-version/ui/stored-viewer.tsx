"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ViewerWorkspace } from "@/modules/model-file/ui/viewer-workspace";
import { versionRepository, remoteNotes } from "../infrastructure/version-http";
import type {ModelVersion} from "../domain/model-version";
import {authenticated} from "@/core/http/http-client";

export function StoredViewer({ project, version, previous }: { project: string; version: string; previous?:string }) {
  const href="/proyectos/"+project+"/archivos";
  const [file,setFile]=useState<File>();
  const [error,setError]=useState("");
  const [attempt,retry]=useState(0);
  const notes=useMemo(()=>remoteNotes(project,version),[project,version]);
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
    if(prior.fileId!==current.fileId || prior.revision>=current.revision || prior.format!=="IFC")
      throw new Error("La comparación requiere una revisión IFC anterior del mismo archivo.");
    return versionRepository.open(project,previous,signal);
  }
  if(file) return <ViewerWorkspace initialFile={file} storedVersion={{project,version}} storedNotes={notes} returnHref={href} returnLabel="Volver a archivos" loadPrevious={previous?loadPrevious:undefined}/>;
  return <main className="panel-content"><h1>Abrir versión</h1>{error ? <><p role="alert">{error}</p><button onClick={()=>{setError("");retry(v=>v+1);}}>Reintentar</button></> : <p role="status">Descargando el original…</p>}
    <Link className="panel-action" href={href}>Volver a archivos</Link></main>;
}
