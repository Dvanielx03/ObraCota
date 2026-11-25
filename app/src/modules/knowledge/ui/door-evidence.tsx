"use client";
import {useState} from "react";
import type {ElementInfo} from "@/viewer/domain/viewer.port";

/**
 * Nominal measures and finish an IfcDoor declares, read in the browser. The technical sheet of any piece, doors
 * included, lives apart in «Ficha técnica» (element-sheet.tsx): it does not depend on these measures.
 */
export function DoorEvidence({item}:{item:ElementInfo}){
  const [expanded,setExpanded]=useState(false);
  const e=item.evidence;
  if(!e)return null;
  const fmt=(v:number|null)=>v===null?"Sin dato IFC":new Intl.NumberFormat("es-CO",{maximumSignificantDigits:8}).format(v)+" "+e.unit;
  return <details className="door-evidence" open={expanded} onToggle={ev=>setExpanded(ev.currentTarget.open)}>
    <summary>Medidas y acabado</summary>{expanded && <>
      <dl><dt>Ancho nominal</dt><dd>{fmt(e.width)}</dd><dt>Alto nominal</dt><dd>{fmt(e.height)}</dd></dl>
      <small>IfcDoor #{item.id} · OverallWidth / OverallHeight · unidad del proyecto</small>
      <details><summary>Envolvente de la geometría visible</summary><p>{[0,2,1].map(i=>new Intl.NumberFormat("es-CO",{maximumFractionDigits:4}).format(e.extents[i])).join(" × ")} m</p><small>Dos ejes horizontales del visor y altura. Incluye el marco si está modelado y depende de la orientación de la puerta.</small></details>
      {e.widths.filter(w=>e.width!==null && Math.abs(w.value-e.width)>Math.max(1e-8,Math.abs(w.value)*1e-6)).map(w=>
        <p key={w.source}>Discrepancia de ancho: {fmt(w.value)} en {w.source}.</p>)}
      <h3>Acabado en el IFC</h3>{e.finishes.length?e.finishes.map(f=><p key={f.source}>{f.value} · {f.source}</p>):<p>El IFC no declara un acabado verificable para esta puerta.</p>}
    </>}
  </details>;
}
