"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {ElementInfo,ViewerPort} from "@/viewer/domain/viewer.port";
import {diffCounts,flagLabels,ifcText,shortGuid,type Diff} from "../domain/model-change";

/**
 * «Comparar con la base» over the 3D preview (H1 §7.5): the elements IfcDiff found changed, with their flags in
 * words, and «Resaltar en 3D». Pieces are matched to the open model by GlobalId, never by the viewer's id, which
 * nothing keeps stable between versions.
 */
export function ChangeCompare({diff,elements,viewer,selected}:{diff:Diff|null|undefined;elements:ElementInfo[];
  viewer:()=>ViewerPort|null;selected:string|null}){
  const [highlight,setHighlight]=useState(false);
  const changed=useMemo(()=>diff?.changed??[],[diff]);
  const byGuid=useMemo(()=>new Map(elements.filter(item=>item.guid).map(item=>[item.guid!,item.id])),[elements]);
  const ids=useMemo(()=>changed.map(entry=>byGuid.get(entry.guid)).filter((id):id is string=>!!id),[changed,byGuid]);
  const missing=changed.length-ids.length;
  // The selection to give back to the model when the highlight goes.
  const chosen=useRef(selected);
  chosen.current=selected;
  const lit=useRef(false);
  function toggle(next:boolean){
    setHighlight(next);lit.current=next;
    const port=viewer();
    if(!port)return;
    if(next)port.previewGroup(ids);
    else{port.previewGroup([]);port.select(chosen.current);}
  }
  // Leaving the preview (another file, the walk) takes the highlight along.
  useEffect(()=>()=>{if(lit.current)viewer()?.previewGroup([]);},[viewer]);
  if(!diff)return <div className="tool-popover-body change-compare">
    <p className="change-compare-note">El informe de la vista previa no trae la comparación con la base.</p>
  </div>;
  const counts=diffCounts(diff);
  return <div className="tool-popover-body change-compare">
    <p className="change-compare-counts">{counts.changed} cambiados · {counts.added} añadidos · {counts.deleted} eliminados{diff.truncated?" · lista recortada":""}</p>
    {changed.length?<ul className="change-compare-list" aria-label="Elementos cambiados">{changed.map(entry=><li key={entry.guid}>
      <span className="change-compare-name">{entry.class} · {ifcText(entry.name)??"Sin nombre"}</span>
      <code title={entry.guid}>{shortGuid(entry.guid)}</code>
      {!!entry.flags?.length && <span className="change-compare-flags">{flagLabels(entry).join(" · ")}</span>}
      {byGuid.has(entry.guid)
        ?<button type="button" className="change-compare-locate" onClick={()=>viewer()?.locate(byGuid.get(entry.guid)!)}>Localizar en 3D</button>
        :<span className="change-compare-flags">No está en el modelo abierto</span>}
    </li>)}</ul>:<p className="change-compare-note">IfcDiff no encontró elementos cambiados.</p>}
    {!!diff.unexpected.length && <p className="change-compare-unexpected">{diff.unexpected.length} fuera del alcance declarado: revísalos en la tarjeta del cambio.</p>}
    <label className="change-compare-toggle" title={ids.length?undefined:"Ningún elemento cambiado está en el modelo abierto"}>
      <input type="checkbox" checked={highlight} disabled={!ids.length} onChange={event=>toggle(event.target.checked)}/>
      Resaltar en 3D{missing>0 && ids.length?" ("+ids.length+" de "+changed.length+")":""}
    </label>
    <p className="change-compare-note">Para verlas desde el mismo punto, usa RECORRIDO › Base o Propuesta.</p>
  </div>;
}
