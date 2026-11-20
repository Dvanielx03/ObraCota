"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ViewerWorkspace } from "@/modules/model-file/ui/viewer-workspace";
import { versionRepository, remoteNotes } from "../infrastructure/version-http";

export function StoredViewer({ project, version }: { project: string; version: string }) {
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
  if(file) return <ViewerWorkspace initialFile={file} storedNotes={notes} returnHref={href} returnLabel="Volver a archivos"/>;
  return <main className="panel-content"><h1>Abrir versión</h1>{error ? <><p role="alert">{error}</p><button onClick={()=>{setError("");retry(v=>v+1);}}>Reintentar</button></> : <p role="status">Descargando el original…</p>}
    <Link className="panel-action" href={href}>Volver a archivos</Link></main>;
}
