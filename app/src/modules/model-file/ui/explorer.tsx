import { useEffect, useMemo, useRef, useState } from "react";
import { CaretRightIcon, CubeIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import type {ElementInfo,ModelInfo} from "@/viewer/domain/viewer.port";
import {DoorEvidence} from "@/modules/knowledge/ui/door-evidence";
import {DrawingEvidence} from "./drawing-evidence";
import {ReviewNotes} from "./review-notes";
import {ElementProperties} from "./element-properties";
import {Skeleton} from "@/shared/ui/loading";

export type SidebarTab="reading"|"properties";
/** Widths of the placeholder rows while the first model opens: levels and their pieces. */
const TREE_SKELETON=[["62%",0],["78%",22],["70%",22],["84%",22],["56%",0],["74%",22],["66%",22]] as const;
export function Explorer({tab,changeTab,elements,selected,drawing,locate,version,onNoteSaved,options,scope,loading}:{scope?:{project:string;version:string};options?:import("react").ReactNode;tab:SidebarTab;changeTab:(tab:SidebarTab)=>void;onNoteSaved:()=>void;version?:string;locate:(id:string,preview?:boolean)=>void;drawing?:ModelInfo["drawing"];elements:ElementInfo[];selected:ElementInfo|null;
  /** A model is opening and there is no tree yet: placeholder rows instead of the empty hint. */
  loading?:boolean}) {
  const [query,setQuery] = useState("");
  const activeRow = useRef<HTMLButtonElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const [expanded,setExpanded] = useState<string[]>([]);
  const [foldedResults,setFoldedResults]=useState<string[]>([]);
  const [limits,setLimits] = useState<Record<string,number>>({});
  const groups = useMemo(()=>{
    const result = new Map<string,ElementInfo[]>();
    for (const item of elements) {
      if (query && ![item.name,item.level,item.type,item.guid,item.id,item.annotation?.handle,item.annotation?.raw,...Object.keys(item.cad?.types??{})].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) continue;
      const bucket = result.get(item.level);
      if (bucket) bucket.push(item); else result.set(item.level,[item]);
    }
    return result;
  },[query,elements]);
  const hits=useMemo(()=>query.trim()?Array.from(groups.values()).flat():[],[groups,query]);
  const hitIndex=hits.findIndex(item=>item.id===selected?.id);
  useEffect(()=>{
    if(inspector.current)inspector.current.scrollTop=0;
  },[selected?.id]);
  function step(delta:number){
    const index=hitIndex<0?(delta>0?0:hits.length-1):(hitIndex+delta+hits.length)%hits.length;
    if(hits[index]){
      setFoldedResults(previous=>previous.filter(level=>level!==hits[index].level));
      locate(hits[index].id,true);
    }
  }
  useEffect(()=>{
    if (selected) setExpanded(previous=>previous.includes(selected.level)?previous:[...previous,selected.level]);
  },[selected]);
  useEffect(()=>{
    const list = activeRow.current?.closest(".tree"), row = activeRow.current;
    if (!list || !row) return;
    const delta = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (delta < 0 || delta + row.offsetHeight > list.clientHeight) list.scrollTop += delta - list.clientHeight/2;
  },[selected,expanded,tab]);
  return <>
    <div role="tablist" aria-label="Herramientas del modelo" className="sidebar-tabs">
      {(["reading","properties"] as const).map(key=><button key={key} id={"tab-"+key} role="tab" aria-selected={tab===key} aria-controls={"pane-"+key} tabIndex={tab===key?0:-1}
        onClick={()=>changeTab(key)} onKeyDown={event=>{
          if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
          event.preventDefault();
          const next=event.key==="Home"?"reading":event.key==="End"?"properties":key==="reading"?"properties":"reading";
          changeTab(next);document.getElementById("tab-"+next)?.focus();
        }}>{key==="reading"?<MagnifyingGlassIcon/>:<CubeIcon/>}{key==="reading"?"Lectura":"Propiedades"}</button>)}
    </div>
    <section role="tabpanel" aria-labelledby="tab-reading" id="pane-reading" className="reading-pane" hidden={tab!=="reading"}>
    <div className="panelHead">
      <label className="search"><MagnifyingGlassIcon size={17}/><input type="search" aria-label="Buscar elemento" placeholder={drawing?"Buscar texto o capa":"Buscar pieza, nivel o ID"} value={query} onChange={e=>{setQuery(e.target.value);setFoldedResults([]);}}/></label>
      {query.trim() && <div className="search-results"><small role="status">{hitIndex>=0?(hitIndex+1)+" de "+hits.length:hits.length+" coincidencias"}</small>
        {hits.length>0 && <div><button aria-label="Coincidencia anterior" onClick={()=>step(-1)}>←</button><button aria-label="Coincidencia siguiente" onClick={()=>step(1)}>→</button></div>}</div>}
    </div>
    <div className="tree" aria-label={drawing?"Geometría por capa":"Elementos por nivel"}>
      {[...groups].map(([level,items])=>{
        const open = query.trim()?!foldedResults.includes(level):expanded.includes(level);
        const limit = limits[level] || 60;
        const visible = items.slice(0,limit);
        if (selected && items.includes(selected) && !visible.includes(selected)) visible.push(selected);
        return <div key={level}><button className="level" aria-expanded={open} onClick={()=>(query.trim()?setFoldedResults:setExpanded)(old=>old.includes(level)?old.filter(l=>l!==level):[...old,level])}>
          <CaretRightIcon className={open?"down":""}/><span>{level}</span><small>{items.length}</small></button>
          {open && <div className="branches">{visible.map(item=><button key={item.id} ref={selected?.id===item.id?activeRow:null} className="entry" data-element-id={item.id} aria-pressed={selected?.id===item.id} onClick={()=>locate(item.id,true)}>{item.name}</button>)}
            {items.length>limit && <button onClick={()=>setLimits(old=>({...old,[level]:limit+60}))}>Ver más elementos</button>}</div>}
        </div>;
      })}
      {!groups.size && (loading && !query ? <div className="tree-skeleton" aria-hidden="true">
          {TREE_SKELETON.map(([width,indent],index)=><Skeleton key={index} shape="line" width={width} style={{marginLeft:indent}}/>)}</div>
        : <p>{query?"Ningún elemento coincide.":"Abre un modelo para explorar sus niveles."}</p>)}
    </div>
    </section>
    <section ref={inspector} role="tabpanel" id="pane-properties" aria-labelledby="tab-properties" className="inspector" hidden={tab!=="properties"}>
      {selected ? <><strong>{selected.name}</strong><dl>
        <dt>Clase</dt><dd>{selected.type}</dd><dt>{drawing?"Capa":"Nivel"}</dt><dd>{selected.level}</dd>
        {selected.dimension && <><dt>Medida geométrica</dt><dd>{selected.dimension.value.toLocaleString("es-CO",{maximumFractionDigits:6})} {drawing?.units}</dd><dt>Estilo CAD</dt><dd>{selected.dimension.style || "Sin identificar"}</dd></>}
        {selected.guid && <><dt>GlobalId</dt><dd className="guid">{selected.guid}</dd></>}
        {selected.annotation ? <><dt>Handle CAD</dt><dd>{selected.annotation.handle || "Sin identificador"}</dd></> : selected.count && !selected.guid ? <><dt>{drawing?"Entidades":"Piezas"}</dt><dd>{selected.count}</dd></> : <><dt>Material</dt><dd>{selected.material || "Sin dato disponible"}</dd></>}
      </dl>{scope && selected.guid && !drawing && <ElementProperties scope={scope} guid={selected.guid}/>}
      {selected.annotation && <details><summary>Texto de origen</summary><code>{selected.annotation.raw}</code></details>}
      <button className="locate" onClick={()=>locate(selected.id)}>Volver a encuadrar</button></> : <p>Selecciona un resultado para consultar sus propiedades.</p>}
      {selected?.evidence && <DoorEvidence key={"evidence:"+selected.id} item={selected} scope={scope}/>}
      {drawing && selected && <DrawingEvidence key={"dwg:"+selected.id} item={selected} units={drawing.units} scope={scope}/>}
      {options}
      {version && <ReviewNotes onSaved={onNoteSaved} key={version} version={version} selected={selected} elements={elements} locate={id=>{setQuery("");locate(id);}}/>}
      {drawing && <details className="drawing-info"><summary>Datos de importación{drawing.omissions?" · parcial":""}</summary><dl><dt>Unidad</dt><dd>{drawing.units}</dd><dt>Rango Z visible</dt><dd>{drawing.depth.toLocaleString("es-CO",{maximumSignificantDigits:8})} {drawing.units}</dd></dl>{drawing.omissions && <p>Sin representar: {drawing.omissions}.</p>}</details>}
    </section>
  </>;
}
