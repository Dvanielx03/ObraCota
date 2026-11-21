"use client";
import {useState} from "react";
import type {ElementInfo,ViewerPort} from "@/viewer/domain/viewer.port";
import {VisualOptions} from "./visual-options";
import {ExternalEdit} from "./external-edit";
import {DoorProposal} from "@/modules/design-change/ui/door-proposal";
import type {MaskStep} from "./prisma-tour";
import {SelectedDocuments} from "@/modules/chat-conversation/ui/document-assistant";
import styles from "./selection-assistant.module.css";

export function SelectionAssistant({elements,ids,grouping,onGroup,onPick,onRemove,color,onColor,viewer,scope,fold,onGuide,onFrame,onExport,onMaskGuide,onMaskPrepared,onMaskImported,onMaskSaved}:{
  elements:ElementInfo[];ids:string[];grouping:boolean;onGroup:()=>void;onPick:(id:string)=>void;onRemove:(id:string)=>void;
  color:string|null;onColor:(value:string|null)=>void;viewer:ViewerPort;scope?:{project:string;version:string};fold:()=>void;
  onGuide:()=>void;onFrame:()=>void;onExport:()=>void;
  onMaskGuide:(step:MaskStep)=>void;onMaskPrepared:()=>void;onMaskImported:()=>void;onMaskSaved:()=>void;
}){
  const [query,setQuery]=useState(""),[finish,setFinish]=useState("#98734f");
  const [docs,setDocs]=useState(false);
  const selected=ids.map(id=>elements.find(i=>i.id===id)).filter((i):i is ElementInfo=>!!i);
  const term=query.trim().toLowerCase();
  const matches=term?elements.filter(i=>[i.name,i.id,i.type,i.guid].some(v=>v?.toLowerCase().includes(term))).slice(0,15):[];
  const keys=selected.map(i=>i.guid||i.id).sort();
  const key=keys.length===1?keys[0]:"group:"+JSON.stringify(keys);
  function download(){
    const link=document.createElement("a");link.href=viewer.capture("png");link.download="ObraCota-propuesta-local.png";link.click();
    onExport();
  }
  return <section className={styles.panel} aria-label="Asistente de diseño">
    <div className={styles.head}><span className={styles.prismEntry}><svg className={styles.prism} viewBox="0 0 48 52" aria-hidden="true">
      <path d="M4 14 23 3l20 11-11 22H15Z" fill="#f2b25c" stroke="currentColor" strokeWidth="2"/>
      <path d="m4 14 19 6 20-6M23 3v17l-8 16m8-16 9 16M20 36l-3 12m11-12 3 12" fill="none" stroke="currentColor" strokeWidth="2"/>
      <circle cx="23" cy="23" r="3" fill="currentColor"/></svg></span>
      <div><small>Asistente de diseño</small><h2>Prisma</h2></div><button onClick={fold} aria-label="Plegar asistente">‹</button></div>
    <div className={styles.scroll}>
      <section className={styles.intro}><p>Selecciona piezas para probar acabados y consultar sus fichas.</p>
        <button data-prisma-tour="help" onClick={onGuide}>Guía de Prisma</button></section>
      <div className={styles.row}><h3>Selección ({ids.length})</h3><button data-prisma-tour="group" aria-pressed={grouping} onClick={onGroup}>Agrupar</button></div>
      <label>Buscar pieza<input data-prisma-tour="search" aria-label="Buscar pieza para la propuesta" placeholder="Nombre, clase o ID" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      {term && <div className={styles.results}>{matches.length?matches.map(i=><button key={i.id} data-prisma-tour={ids.includes(i.id)?"selected-result":"result"} onClick={()=>{onPick(i.id);setQuery("");}}>{i.name} · {i.id}</button>):<small>Sin coincidencias.</small>}</div>}
      {selected.length===0?<p>Elige una pieza en el modelo o usa el buscador.</p>:<ul>{selected.map(i=><li key={i.id}><span>{i.name}<small>{i.level} · {i.id}</small></span><button aria-label={"Quitar "+i.name} onClick={()=>onRemove(i.id)}>×</button></li>)}</ul>}
      {!!ids.length && <><button data-prisma-tour="frame" onClick={()=>{viewer.frameGroup(ids);onFrame();}}>Encuadrar selección</button>
      <section><h3>Vista previa local</h3><label className={styles.row}>Color del acabado<input type="color" value={finish} onChange={e=>{setFinish(e.target.value);if(color)onColor(e.target.value);}}/></label>
      <div className={styles.actions}><button data-prisma-tour="preview" onClick={()=>onColor(color?null:finish)}>{color?"Descartar color":"Probar color"}</button>{color && <button data-prisma-tour="export" onClick={download}>Exportar PNG</button>}</div></section>
      </>}
      <ExternalEdit pieces={selected} viewer={viewer} onGuide={onMaskGuide} onPrepared={onMaskPrepared} onImported={onMaskImported} onSaved={onMaskSaved}/>
      {scope && selected.length===1 && selected[0].type.toUpperCase()==="IFCDOOR" && selected[0].guid &&
        <DoorProposal key={scope.version+key} {...scope} element={selected[0].guid} capture={()=>viewer.capture("png")}/>}
      {!!ids.length && <>
      {scope && key.length<=512?<VisualOptions key={key} {...scope} element={{...selected[0],guid:key,name:selected.map(i=>i.name).join(", ")}} capture={()=>viewer.capture()} groupCapture={()=>viewer.captureGroup(ids)}/>:
        <p>{scope?"Reduce la selección para generar con Gemini.":"Para generar con Gemini, abre una versión guardada en tu proyecto."}</p>}
      {scope && <details onToggle={e=>setDocs(e.currentTarget.open)}><summary>Consultar fichas de la selección</summary>
        {docs && <SelectedDocuments key={key} {...scope} keys={keys}/>}</details>}</>}
    </div></section>;
}
