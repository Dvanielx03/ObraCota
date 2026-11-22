"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {PanelView} from "@/shared/ui/panel-view";
import {LoadingStatus} from "@/shared/ui/loading";
import type {ModelChange} from "../domain/model-change";
import {modelChangeRepository} from "../infrastructure/model-change-http";
import {ChangeCard,ChangeHeader,useOperationLabels} from "./change-card";
import {ChangeEstimate} from "./change-estimate";

function BudgetCard({change}:{change:ModelChange}){
  const labels=useOperationLabels(change);
  return <article id={change.id} className="change-card"><ChangeHeader change={change}/><ChangeEstimate change={change} labels={labels}/></article>;
}

/**
 * «Cambios de diseño» and «Presupuesto» of a project (§7.1–§7.3): every model change, newest first. The budget view
 * shows only each change's estimate: the frozen one once applied, the live one otherwise.
 */
export function ModelChanges({project,budget=false}:{project:string;budget?:boolean}){
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
  return <PanelView title={budget?"Presupuesto":"Cambios de diseño"} project={false}>
    {error && <p role="alert">{error}</p>}
    {!rows && !error && <LoadingStatus>Cargando revisiones…</LoadingStatus>}
    {rows?.length===0 && <p>Selecciona una puerta de una <Link href={"/proyectos/"+project+"/archivos"}>versión IFC guardada</Link> para registrar una propuesta.</p>}
    <div className="estimate-sheet">{rows?.map(change=>budget?<BudgetCard key={change.id} change={change}/>
      :<ChangeCard key={change.id} change={change} onChange={next=>void changed(next)} locked={busy>0}
        onWork={working=>setBusy(count=>count+(working?1:-1))}/>)}</div>
  </PanelView>;
}
