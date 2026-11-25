"use client";
import {useEffect,useState} from "react";
import {authenticated,authenticatedResponse,HttpError} from "@/core/http/http-client";
import {documentStatus,isIndexPending,type DocumentIndex} from "../domain/document-index";
import type {SheetScope} from "../domain/element-identity";

type Citation={document:string;filename:string;page:number;excerpt:string};
type Evidence={documents:({id:string;filename:string}&DocumentIndex)[];citations:Citation[]};

/**
 * The PDFs linked to one element of one saved version: attach, index state and text search. `element` is the IFC
 * GlobalId of a piece, or the key of a DWG selection (`drawing`). The caller keys it by version and element, so a
 * change of selection never shows the documents of the previous one; requests of a previous key are aborted.
 */
export function Specifications({scope,element,drawing=false,initialQuery="acabado",onDocuments}:{scope:SheetScope;element:string;drawing?:boolean;initialQuery?:string;
  /** The documents of the element whenever they are read (to tell the assistant when a sheet is ready). */
  onDocuments?:(documents:Evidence["documents"])=>void}){
  const base="projects/"+scope.project+"/versions/"+scope.version+"/specifications";
  const [term,setTerm]=useState(initialQuery),[query,search]=useState(initialQuery);
  const [resolved,setResolved]=useState<{url:string;value:Evidence}>(),[revision,refresh]=useState(0);
  const urlQuery=base+"?"+new URLSearchParams({element,q:query});
  const result=resolved?.url===urlQuery?resolved.value:undefined;
  const [busy,setBusy]=useState(false),[error,notify]=useState(""),[opened,setOpened]=useState<{blob:Blob;page:number}|null>(null);
  const [url,setUrl]=useState("");
  useEffect(()=>{
    if(!opened){setUrl("");return;}
    const object=URL.createObjectURL(opened.blob);setUrl(object+"#page="+opened.page);
    return ()=>URL.revokeObjectURL(object);
  },[opened]);
  useEffect(()=>{
    const control=new AbortController();
    authenticated<Evidence>(urlQuery,{signal:control.signal})
      .then(value=>{if(!control.signal.aborted){setResolved({url:urlQuery,value});onDocuments?.(value.documents);}})
      .catch(()=>{if(!control.signal.aborted)notify("No se pudo consultar la ficha.");});
    return ()=>control.abort();
  },[urlQuery,revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(!result?.documents.some(isIndexPending))return;
    const timer=window.setTimeout(()=>refresh(n=>n+1),2000);
    return ()=>window.clearTimeout(timer);
  },[result]);
  async function attach(file:File){
    if(file.size>4*1024*1024){notify("El máximo por ficha es 4 MiB.");return;}
    setBusy(true);notify("");
    try{
      await authenticated(base+"?"+new URLSearchParams({element,name:file.name}),{method:"POST",headers:{"Content-Type":"application/pdf"},body:file});
      refresh(n=>n+1);
    }catch(e){
      // The server explains identity problems (a GlobalId the IFC lacks); other failures keep the general advice.
      notify(e instanceof HttpError && e.status===400 && /GlobalId|identidad|plano DWG/.test(e.message)?e.message
        :"No se pudo vincular el PDF. Usa un documento legible, sin contraseña, de hasta 100 páginas.");
    }
    finally{setBusy(false);}
  }
  async function open(id:string,page:number){
    setBusy(true);notify("");setOpened(null);
    try{const response=await authenticatedResponse(base+"/"+id);setOpened({blob:await response.blob(),page});}
    catch{notify("No se pudo abrir el documento.");}finally{setBusy(false);}
  }
  return <div className="specifications"><label>{drawing?"Vincular PDF a esta selección":"Vincular ficha PDF a esta pieza"}<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void attach(file);}}/></label>
    <p>Conserva el PDF en tu equipo. El servidor procesa una copia temporal y conserva el texto indexado.</p>
    {result?.documents.length===0 && <p>{drawing?"La selección no tiene un PDF vinculado en esta versión.":"Esta pieza aún no tiene una ficha vinculada en esta versión."}</p>}
    {!!result?.documents.length && <ul aria-live="polite" aria-label="Fichas vinculadas">{result.documents.map(d=><li key={d.id} data-document={d.id}>
      {d.originalAvailable?<button disabled={busy} onClick={()=>open(d.id,1)}>{d.filename}</button>:<span>{d.filename}</span>}
      {" · "}{documentStatus(d)}</li>)}</ul>}
    <form onSubmit={e=>{e.preventDefault();notify("");search(term.trim());refresh(n=>n+1);}}>
      <label>Buscar en la ficha<input value={term} required maxLength={160} onChange={e=>setTerm(e.target.value)}/></label><button>Consultar</button>
    </form>
    {query.trim() && result?.documents.some(d=>d.status==="LEGACY"||d.status==="INDEXED"||d.status==="TEXT_ONLY") && !result.citations.length && <p>Sin coincidencias en el texto indexado. Puedes revisar el PDF en tu equipo.</p>}
    {query.trim() && !!result?.citations.length && <><p>{drawing?"Coincidencias en los documentos vinculados.":"Coincidencias documentales. Un catálogo puede ofrecer varios acabados para una misma medida."}</p>
      {result.citations.map(c=><blockquote key={c.document+c.page}>{c.excerpt}<footer>
        {result.documents.find(d=>d.id===c.document)?.originalAvailable
          ?<button disabled={busy} onClick={()=>open(c.document,c.page)}>{c.filename} · pág. {c.page}</button>
          :<cite>{c.filename} · pág. {c.page}</cite>}</footer></blockquote>)}</>}
    {url && <a href={url} target="_blank" rel="noopener noreferrer">Abrir PDF en la página {opened?.page}</a>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
