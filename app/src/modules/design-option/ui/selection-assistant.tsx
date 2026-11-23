"use client";
import {useState} from "react";
import {Pencil} from "lucide-react";
import type {ElementInfo,ViewerPort} from "@/viewer/domain/viewer.port";
import {ExternalEdit} from "./external-edit";
import {DoorProposal} from "@/modules/design-change/ui/door-proposal";
import type {MaskStep} from "./prisma-tour";
import {SelectedDocuments} from "@/modules/chat-conversation/ui/document-assistant";
import {AgentHistory} from "@/modules/model-change/ui/agent-history";
import styles from "./selection-assistant.module.css";

export function SelectionAssistant({elements,ids,grouping,onGroup,onPick,onRemove,color,onColor,viewer,scope,fold,onGuide,onFrame,onExport,onMaskGuide,onMaskPrepared,onMaskImported,onMaskSaved,working=false}:{
  elements:ElementInfo[];ids:string[];grouping:boolean;onGroup:()=>void;onPick:(id:string)=>void;onRemove:(id:string)=>void;
  color:string|null;onColor:(value:string|null)=>void;viewer:ViewerPort;scope?:{project:string;version:string};fold:()=>void;
  onGuide:()=>void;onFrame:()=>void;onExport:()=>void;
  onMaskGuide:(step:MaskStep)=>void;onMaskPrepared:()=>void;onMaskImported:()=>void;onMaskSaved:()=>void;
  /** A batch of options for this selection is being generated (the request lives in the bottom bar). */
  working?:boolean;
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
  return <section className={styles.panel} aria-labelledby="edit-selection-title">
    <div className={styles.head}><span className={styles.editEntry}><Pencil className={styles.editGlyph} size={18} strokeWidth={2} aria-hidden="true"/></span>
      <div><small>Editar</small><h2 id="edit-selection-title">Selección</h2></div><button onClick={fold} aria-label="Plegar selección">‹</button></div>
    <div className={styles.scroll} data-working={working}>
      <section className={styles.intro}><p>Las piezas que marcas con Seleccionar aparecen aquí. También puedes buscarlas, probar un color o preparar una edición externa.</p>
        <button data-prisma-tour="help" onClick={onGuide}>Guía de Editar</button></section>
      {scope && <AgentHistory key={scope.version} {...scope}/>}
      <div className={styles.row}><h3>Piezas ({ids.length})</h3><button data-prisma-tour="group" aria-pressed={grouping} onClick={onGroup} title="Agrupar: los resultados de la búsqueda se suman a la selección">Agrupar</button></div>
      <label>Buscar pieza<input data-prisma-tour="search" aria-label="Buscar pieza para la propuesta" placeholder="Nombre, clase o ID" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      {term && <div className={styles.results}>{matches.length?matches.map(i=><button key={i.id} data-prisma-tour={ids.includes(i.id)?"selected-result":"result"} onClick={()=>{onPick(i.id);setQuery("");}}>{i.name} · {i.id}</button>):<small>Sin coincidencias.</small>}</div>}
      {selected.length===0?<p>Haz clic en una pieza del modelo con Seleccionar o usa el buscador.</p>:<ul>{selected.map(i=><li key={i.id}><span>{i.name}<small>{i.level} · {i.id}</small></span><button aria-label={"Quitar "+i.name} onClick={()=>onRemove(i.id)}>×</button></li>)}</ul>}
      {!!ids.length && <><button data-prisma-tour="frame" onClick={()=>{viewer.frameGroup(ids);onFrame();}}>Encuadrar selección</button>
      <section><h3>Vista previa local</h3><label className={styles.row}>Color del acabado<input type="color" value={finish} onChange={e=>{setFinish(e.target.value);if(color)onColor(e.target.value);}}/></label>
      <div className={styles.actions}><button data-prisma-tour="preview" onClick={()=>onColor(color?null:finish)}>{color?"Descartar color":"Probar color"}</button>{color && <button data-prisma-tour="export" onClick={download}>Exportar PNG</button>}</div></section>
      </>}
      <ExternalEdit pieces={selected} viewer={viewer} onGuide={onMaskGuide} onPrepared={onMaskPrepared} onImported={onMaskImported} onSaved={onMaskSaved}/>
      {scope && selected.length===1 && selected[0].type.toUpperCase()==="IFCDOOR" && selected[0].guid &&
        <DoorProposal key={scope.version+key} {...scope} element={selected[0].guid} capture={()=>viewer.capture("png")}/>}
      {!!ids.length && <>
      <p className={styles.hint}>{!scope?"Para generar con Gemini, abre una versión guardada en tu proyecto."
        :key.length>512?"Reduce la selección para generar con Gemini."
        :"Para pedir opciones visuales de esta selección, pulsa Renderizar en la barra inferior. Para describir un cambio concreto, escríbelo en la marca de la pieza y envíalo."}</p>
      {scope && <details onToggle={e=>setDocs(e.currentTarget.open)}><summary>Consultar fichas de la selección</summary>
        {docs && <SelectedDocuments key={key} {...scope} keys={keys}/>}</details>}</>}
    </div></section>;
}
