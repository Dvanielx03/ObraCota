"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {EmptyState,PanelView} from "@/shared/ui/panel-view";
import {EmptyArt,LoadingStatus} from "@/shared/ui/loading";
import type {ModelChange} from "../domain/model-change";
import {modelChangeRepository} from "../infrastructure/model-change-http";
import {ChangeCard} from "./change-card";

export function ModelChanges({project}:{project:string}){
  const [rows,setRows]=useState<ModelChange[]>(),[error,setError]=useState(""),[busy,setBusy]=useState(0);
  useEffect(()=>{
    const control=new AbortController();
    modelChangeRepository.list(project,control.signal).then(setRows).catch(e=>{if(!control.signal.aborted)setError(e.message);});
    return ()=>control.abort();
  },[project]);
  const loaded=!!rows;
  useEffect(()=>{
    // The cards arrive after the page: «Revisar y decidir si aplicar» links to `#id`, so scroll once they exist.
    const id=loaded?decodeURIComponent(location.hash.slice(1)):"";
    if(id)document.getElementById(id)?.scrollIntoView({block:"start"});
  },[loaded]);
  async function changed(next:ModelChange){
    setRows(previous=>previous?.map(row=>row.id===next.id?next:row));
    // Applying or restoring publishes a revision: the siblings on the same file lose their base, so their actions change.
    if(next.status==="APPLIED"||next.status==="RESTORED")
      modelChangeRepository.list(project).then(setRows).catch(()=>undefined);
  }
  return <PanelView title="Cambios de diseño" project={false}>
    {error && <p role="alert">{error}</p>}
    {!rows && !error && (
      <div className="changes-loading">
        <EmptyArt kind="changes" width={132}/>
        <LoadingStatus>Cargando revisiones…</LoadingStatus>
      </div>)}
    {rows?.length===0 && (
      <EmptyState heading="Sin cambios registrados" icon={<EmptyArt kind="changes" width={184}/>}>
        Abre una <Link href={"/proyectos/"+project+"/archivos"}>versión IFC o DWG guardada</Link> para registrar una propuesta.
      </EmptyState>)}
    <div className="change-cards">{rows?.map(change=><ChangeCard key={change.id} change={change} onChange={next=>void changed(next)} locked={busy>0}
        onWork={working=>setBusy(count=>count+(working?1:-1))}/>)}</div>
  </PanelView>;
}
