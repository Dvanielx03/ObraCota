"use client";
import {useEffect,useState} from "react";
import type {ElementInfo} from "@/viewer/domain/viewer.port";
import {authenticated,authenticatedResponse} from "@/core/http/http-client";

type Scope={project:string;version:string};
type Citation={document:string;filename:string;page:number;excerpt:string};
type Evidence={documents:{id:string;filename:string}[];citations:Citation[]};

export function Specifications({scope,element,drawing=false,initialQuery="acabado"}:{scope:Scope;element:string;drawing?:boolean;initialQuery?:string}){
  const base="projects/"+scope.project+"/versions/"+scope.version+"/specifications";
  const [term,setTerm]=useState(initialQuery),[query,search]=useState(initialQuery);
  const [result,setResult]=useState<Evidence>(),[revision,refresh]=useState(0);
  const [busy,setBusy]=useState(false),[error,notify]=useState(""),[opened,setOpened]=useState<{blob:Blob;page:number}|null>(null);
  const [url,setUrl]=useState("");
  useEffect(()=>{
    if(!opened){setUrl("");return;}
    const object=URL.createObjectURL(opened.blob);setUrl(object+"#page="+opened.page);
    return ()=>URL.revokeObjectURL(object);
  },[opened]);
  useEffect(()=>{
    const control=new AbortController();setResult(undefined);
    authenticated<Evidence>(base+"?"+new URLSearchParams({element,q:query}),{signal:control.signal})
      .then(value=>{if(!control.signal.aborted)setResult(value);}).catch(()=>{if(!control.signal.aborted)notify("No se pudo consultar la ficha.");});
    return ()=>control.abort();
  },[base,element,query,revision]);
  async function attach(file:File){
    if(file.size>4*1024*1024){notify("El máximo por ficha es 4 MiB.");return;}
    setBusy(true);notify("");
    try{
      await authenticated(base+"?"+new URLSearchParams({element,name:file.name}),{method:"POST",headers:{"Content-Type":"application/pdf"},body:file});
      refresh(n=>n+1);
    }catch{notify("No se pudo vincular el PDF. Usa un documento legible, sin contraseña, de hasta 100 páginas.");}
    finally{setBusy(false);}
  }
  async function open(id:string,page:number){
    setBusy(true);notify("");setOpened(null);
    try{const response=await authenticatedResponse(base+"/"+id);setOpened({blob:await response.blob(),page});}
    catch{notify("No se pudo abrir el documento.");}finally{setBusy(false);}
  }
  return <div><label>{drawing?"Vincular PDF a esta selección":"Vincular ficha PDF a esta puerta"}<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void attach(file);}}/></label>
    {result?.documents.length===0 && <p>{drawing?"La selección no tiene un PDF vinculado en esta versión.":"Esta puerta aún no tiene una ficha vinculada en esta versión."}</p>}
    {!!result?.documents.length && <ul>{result.documents.map(d=><li key={d.id}><button disabled={busy} onClick={()=>open(d.id,1)}>{d.filename}</button></li>)}</ul>}
    <form onSubmit={e=>{e.preventDefault();notify("");search(term.trim());refresh(n=>n+1);}}>
      <label>Buscar en la ficha<input value={term} required maxLength={160} onChange={e=>setTerm(e.target.value)}/></label><button>Consultar</button>
    </form>
    {query.trim() && !!result?.documents.length && !result.citations.length && <p>Sin coincidencias en el texto extraíble. Puedes revisar el PDF original.</p>}
    {query.trim() && !!result?.citations.length && <><p>{drawing?"Coincidencias en los documentos vinculados.":"Coincidencias documentales. Un catálogo puede ofrecer varios acabados para una misma medida."}</p>
      {result.citations.map(c=><blockquote key={c.document+c.page}>{c.excerpt}<footer><button disabled={busy} onClick={()=>open(c.document,c.page)}>{c.filename} · pág. {c.page}</button></footer></blockquote>)}</>}
    {url && <a href={url} target="_blank" rel="noopener noreferrer">Abrir PDF en la página {opened?.page}</a>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
export function DoorEvidence({item,scope}:{item:ElementInfo;scope?:Scope}){
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
      <h3>Ficha técnica</h3>{scope?<Specifications scope={scope} element={item.guid||item.id}/>:<p>Abre una versión guardada en un proyecto para vincular su ficha.</p>}
    </>}
  </details>;
}
