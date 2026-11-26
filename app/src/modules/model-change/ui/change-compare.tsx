"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {ElementInfo,ViewerPort} from "@/viewer/domain/viewer.port";
import {diffCounts,flagLabels,ifcText,shortGuid,type Diff,type DiffEntry} from "../domain/model-change";
import "./change-compare.css";

type Section={title:string;entries:DiffEntry[];flags:boolean};

/**
 * The elements IfcDiff found changed, added or deleted, with their flags in words, «Localizar en 3D» and «Resaltar en
 * 3D». Pieces are matched to the open model by GlobalId, never by the viewer's id, which nothing keeps stable between
 * versions. Used by «Comparar con la base» over a 3D preview (H1 §7.5) and by «Comparar versiones» of the rail (H7).
 * `note` closes the panel (where to look next); `empty` replaces the message when there is no diff.
 */
export function ChangeCompare({diff,elements,viewer,selected,note="Para verlas desde el mismo punto, usa RECORRIDO › Base o Propuesta.",
  empty="El informe de la vista previa no trae la comparación con la base."}:{diff:Diff|null|undefined;elements:ElementInfo[];
  viewer:()=>ViewerPort|null;selected:string|null;note?:string;empty?:string}){
  const [highlight,setHighlight]=useState(false);
  const sections=useMemo<Section[]>(()=>diff?[
    {title:"Elementos cambiados",entries:diff.changed,flags:true},
    {title:"Elementos añadidos",entries:diff.added,flags:false},
    {title:"Elementos eliminados",entries:diff.deleted,flags:false},
  ].filter(section=>section.entries.length):[],[diff]);
  // A drawing's entries are DWG handles: its texts and dimensions are found by their handle.
  const byGuid=useMemo(()=>new Map([...elements.filter(item=>item.annotation?.handle).map(item=>[item.annotation!.handle,item.id] as const),
    ...elements.filter(item=>item.guid).map(item=>[item.guid!,item.id] as const)]),[elements]);
  const listed=useMemo(()=>sections.flatMap(section=>section.entries),[sections]);
  const ids=useMemo(()=>[...new Set(listed.map(entry=>byGuid.get(entry.guid)).filter((id):id is string=>!!id))],[listed,byGuid]);
  const shown=listed.filter(entry=>byGuid.has(entry.guid)).length;
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
  // Another diff (another revision to compare with) starts without the highlight of the previous one.
  useEffect(()=>{
    if(!lit.current)return;
    lit.current=false;setHighlight(false);
    const port=viewer();
    port?.previewGroup([]);port?.select(chosen.current);
  },[diff,viewer]);
  // Leaving the preview (another file, the walk) takes the highlight along.
  useEffect(()=>()=>{if(lit.current)viewer()?.previewGroup([]);},[viewer]);
  if(!diff)return <div className="tool-popover-body change-compare">
    <p className="change-compare-note">{empty}</p>
  </div>;
  const counts=diffCounts(diff);
  return <div className="tool-popover-body change-compare">
    <p className="change-compare-counts">{counts.changed} cambiados · {counts.added} añadidos · {counts.deleted} eliminados{diff.truncated?" · lista recortada":""}</p>
    {sections.length?sections.map(section=><ul key={section.title} className="change-compare-list" aria-label={section.title}>{section.entries.map(entry=><li key={entry.guid}>
      <span className="change-compare-name">{entry.class} · {ifcText(entry.name)??"Sin nombre"}</span>
      <code title={entry.guid}>{shortGuid(entry.guid)}</code>
      {section.flags && !!entry.flags?.length && <span className="change-compare-flags">{flagLabels(entry).join(" · ")}</span>}
      {byGuid.has(entry.guid)
        ?<button type="button" className="change-compare-locate" onClick={()=>viewer()?.locate(byGuid.get(entry.guid)!)}>{diff.drawing?"Localizar en el plano":"Localizar en 3D"}</button>
        :<span className="change-compare-flags">No está en el modelo abierto</span>}
    </li>)}</ul>):<p className="change-compare-note">IfcDiff no encontró elementos cambiados, añadidos ni eliminados.</p>}
    {!!diff.unexpected?.length && <p className="change-compare-unexpected">{diff.unexpected.length} fuera del alcance declarado: revísalos en la tarjeta del cambio.</p>}
    <label className="change-compare-toggle" title={ids.length?undefined:"Ningún elemento de la lista está en el modelo abierto"}>
      <input type="checkbox" checked={highlight} disabled={!ids.length} onChange={event=>toggle(event.target.checked)}/>
      {diff.drawing?"Resaltar en el plano":"Resaltar en 3D"}{shown<listed.length && ids.length?" ("+shown+" de "+listed.length+")":""}
    </label>
    {note && <p className="change-compare-note">{note}</p>}
  </div>;
}
