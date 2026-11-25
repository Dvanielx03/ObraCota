"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {authenticated} from "@/core/http/http-client";
import {BusyButton,LoadingStatus} from "@/shared/ui/loading";
import type {SheetScope} from "../domain/element-identity";

/** A quote the server verified verbatim against the indexed text of one authorised sheet. */
export type Citation={page:number;quote:string;section?:string|null;document?:string|null;filename?:string|null;datum?:string|null};
export type PieceAnswer={status:string;answer:string;evidence:Citation[];retrieval:string;datum?:string|null;omitted?:number;
  version?:string|null;element?:string|null};
type Entry={question:string;result:PieceAnswer};

const KIND:Record<string,string>={
  ANSWERED:"Respuesta asistida por IA (modelo local). El servidor verificó la cita contra el texto de la ficha.",
  DISCREPANCY:"Las fichas autorizadas de esta pieza no coinciden. Se citan todas; revisa cuál rige antes de usar el dato.",
  INSUFFICIENT:"Sin evidencia suficiente: no se publica una respuesta que la ficha no respalde.",
};

/** One question and its answer, each quote with its document, page, section and the way back to the piece. */
export function AnswerView({entry,fallbackName,locate}:{entry:Entry;fallbackName?:string;
  /** «Ver en el modelo»: a button inside the viewer, a link from the assistant page. */
  locate?:{onClick?:()=>void;href?:string}}){
  const {result}=entry;
  return <article className="piece-answer" data-status={result.status}>
    <h4>{entry.question}</h4>
    {KIND[result.status] && <p className="piece-answer-kind">{KIND[result.status]}</p>}
    <p className="piece-answer-text">{result.answer}</p>
    {result.datum && <p className="piece-answer-datum">Dato citado: <b>{result.datum}</b></p>}
    {!!result.omitted && <p className="piece-answer-omitted">El PDF contiene {result.omitted===1?"una frase":result.omitted+" frases"} con forma de instrucción para el asistente. Se trató como dato y no se usó para responder.</p>}
    {result.evidence.map((c,index)=><blockquote key={index} data-document={c.document??undefined} data-page={c.page}>{c.quote}<footer>
      <cite>{(c.filename??fallbackName??"Ficha")+" · pág. "+c.page}</cite>{c.section && " · "+c.section}
      {locate?.href ? <> · <Link href={locate.href}>Ver en el modelo</Link></>
        : locate?.onClick ? <> · <button type="button" className="link-button" onClick={locate.onClick}>Ver en el modelo</button></> : null}
    </footer></blockquote>)}
  </article>;
}

/**
 * Questions about the sheets of one piece of one saved version. The caller keys it by version and element: a new
 * selection or revision starts empty, the request in flight for the previous one is aborted, and an answer whose
 * piece is not this one is discarded.
 */
export function PieceAssistant({scope,element,ready,locate,viewerHref,fallbackName}:{scope:SheetScope;element:string;ready:boolean;
  locate?:()=>void;viewerHref?:string;fallbackName?:string}){
  const base="projects/"+scope.project+"/assistant";
  const [entries,setEntries]=useState<Entry[]>([]),[question,setQuestion]=useState("");
  const [loading,setLoading]=useState(true),[asking,setAsking]=useState(false),[error,setError]=useState("");
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setEntries([]);
    authenticated<{question:string;result:string}[]>(base+"/history?"+new URLSearchParams({version:scope.version,element}),{signal:controller.signal})
      .then(rows=>{
        if(controller.signal.aborted)return;
        setEntries(rows.map(r=>({question:r.question,result:JSON.parse(r.result) as PieceAnswer}))
          .filter(e=>(!e.result.version||e.result.version===scope.version)&&(!e.result.element||e.result.element===element)));
      })
      .catch(()=>{if(!controller.signal.aborted)setError("No se pudo cargar el historial de la ficha.");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[base,scope.version,element]);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function ask(){
    pending.current?.abort();
    const control=new AbortController();pending.current=control;
    const text=question.trim();
    setAsking(true);setError("");
    try{
      const result=await authenticated<PieceAnswer>(base,{method:"POST",signal:control.signal,
        body:JSON.stringify({version:scope.version,element,question:text})});
      if(control.signal.aborted)return;
      if(result.version!==scope.version || result.element!==element){setError("La respuesta no correspondía a esta pieza y se descartó.");return;}
      setEntries(prior=>[{question:text,result},...prior].slice(0,10));setQuestion("");
    }catch(e){if(!control.signal.aborted)setError(e instanceof Error?e.message:"No se pudo consultar la ficha.");}
    finally{if(!control.signal.aborted){setAsking(false);pending.current=null;}}
  }
  const where=viewerHref?{href:viewerHref}:locate?{onClick:locate}:undefined;
  return <section className="piece-assistant" aria-label="Preguntar a las fichas de la pieza" data-element={element} data-version={scope.version}>
    {ready ? <form className="account-form" data-working={asking} onSubmit={e=>{e.preventDefault();void ask();}}>
      <label>Pregunta sobre la ficha<textarea required maxLength={600} value={question} onChange={e=>setQuestion(e.target.value)}/></label>
      <small>El modelo local recibe la pregunta y fragmentos de las fichas de esta pieza en esta versión. Respuesta asistida por IA.</small>
      <BusyButton className="panel-action" busy={asking} busyLabel="Consultando…" spinnerSize={14} disabled={asking||loading||!question.trim()}>Consultar ficha</BusyButton>
    </form> : <p>Las preguntas se habilitan cuando una ficha de esta pieza está lista para consultar.</p>}
    {asking && <LoadingStatus>Consultando las fichas de esta pieza…</LoadingStatus>}
    {loading && !asking && <LoadingStatus>Cargando el historial…</LoadingStatus>}
    {error && <p role="alert">{error}</p>}
    {entries.map((entry,index)=><AnswerView key={entries.length-index} entry={entry} fallbackName={fallbackName} locate={where}/>)}
  </section>;
}
