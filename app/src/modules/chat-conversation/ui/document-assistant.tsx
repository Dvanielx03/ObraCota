"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {PanelView} from "@/shared/ui/panel-view";
import {LoadingStatus} from "@/shared/ui/loading";
import {authenticated,authenticatedResponse} from "@/core/http/http-client";
import {PieceAssistant} from "@/modules/knowledge/ui/piece-assistant";
import styles from "./document-assistant.module.css";
import {fileCatalog} from "@/modules/model-file/infrastructure/file-catalog";
import {versionRepository} from "@/modules/model-version/infrastructure/version-http";
import {documentStatus,isIndexPending,type DocumentIndex} from "@/modules/knowledge/domain/document-index";

type Source={id:string;filename:string;version:string;model:string;revision:number;element:string;ocrPages:number}&DocumentIndex;

/**
 * One sheet of the project: its piece, version and index state, and the questions about that piece. Answers cite only
 * the sheets linked to the same GlobalId in the same version; «Ver en el modelo» opens the viewer on that piece.
 */
function Consultation({project,source}:{project:string;source:Source}){
  const [pdf,setPdf]=useState(""),[error,setError]=useState("");
  const ready=!isIndexPending(source)&&source.status!=="FAILED";
  useEffect(()=>{
    if(!source.originalAvailable)return;
    let active=true,url="";
    authenticatedResponse("projects/"+project+"/versions/"+source.version+"/specifications/"+source.id)
      .then(r=>r.blob()).then(blob=>{if(active){url=URL.createObjectURL(blob);setPdf(url);}})
      .catch(()=>{if(active)setError("No se pudo abrir el PDF original.");});
    return ()=>{active=false;if(url)URL.revokeObjectURL(url);};
  },[project,source.id,source.version,source.originalAvailable]);
  const viewer="/proyectos/"+project+"/visor/"+source.version+"?element="+encodeURIComponent(source.element);
  return <><p>{source.model} · Versión {source.revision} · Elemento {source.element}</p>
    <p role="status">{documentStatus(source)}{source.ocrPages>0 && " · OCR en "+source.ocrPages+" pág."}</p>
    {pdf && <a href={pdf} target="_blank" rel="noreferrer">Abrir ficha original</a>}
    {!source.originalAvailable && <p>Para comprobar imágenes, firmas o sellos, consulta el PDF que conservas en tu equipo.</p>}
    <p><Link href={viewer}>Localizar elemento en el visor</Link></p>
    {error && <p role="alert">{error}</p>}
    <PieceAssistant key={source.version+":"+source.element} scope={{project,version:source.version}} element={source.element}
      ready={ready} viewerHref={viewer} fallbackName={source.filename}/></>;
}

function useDocumentSources(project:string){
  const [sources,setSources]=useState<Source[]>(),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    let timer:number|undefined;
    async function load(){
      try{
        const rows=await authenticated<Source[]>("projects/"+project+"/assistant",{signal:controller.signal});
        if(controller.signal.aborted)return;
        setSources(rows);setError("");
        if(rows.some(isIndexPending))timer=window.setTimeout(()=>void load(),2000);
      }catch(error){
        if(!controller.signal.aborted)setError(error instanceof Error?error.message:"No se pudieron consultar las fichas.");
      }
    }
    void load();
    return ()=>{controller.abort();window.clearTimeout(timer);};
  },[project]);
  return {sources,error};
}
export function SelectedDocuments({project,version,keys}:{project:string;version:string;keys:string[]}){
  const {sources,error}=useDocumentSources(project);
  const [id,setId]=useState("");
  const rows=sources?.filter(row=>row.version===version && keys.includes(row.element));
  if(error)return <p role="alert">{error}</p>;
  if(!rows)return <LoadingStatus>Buscando fichas…</LoadingStatus>;
  if(!rows.length)return <p>Esta selección no tiene fichas vinculadas en esta versión.</p>;
  const source=rows.find(s=>s.id===id)??rows[0];
  return <><label>Ficha vinculada<select value={source.id} onChange={e=>setId(e.target.value)}>{rows.map(s=><option key={s.id} value={s.id}>{s.filename} · {s.element}</option>)}</select></label>
    <Consultation key={source.id} project={project} source={source}/></>;
}
export function DocumentAssistant({project,piece}:{project:string;piece?:{version:string;element:string}}){
  const [models,setModels]=useState<{id:string;label:string}[]>([]),[current,choose]=useState("");
  useEffect(()=>{
    let live=true;
    fileCatalog.list(project).then(files=>Promise.all(files.filter(f=>f.format==="IFC").map(f=>versionRepository.list(project,f.id))))
      .then(rows=>{if(live){const options=rows.flat().map(v=>({id:v.id,label:v.name+" · v"+v.revision}));setModels(options);choose(options.find(option=>option.id===piece?.version)?.id??options[0]?.id??"");}})
      .catch(()=>{if(live)setModels([]);});
    return ()=>{live=false;};
  },[project,piece?.version]);
  const {sources,error}=useDocumentSources(project);
  const [selected,select]=useState("");
  const matching=piece && sources?.find(s=>s.version===piece.version && s.element===piece.element);
  const source=sources?.find(s=>s.id===selected)??(piece?matching:sources?.[0]);
  return <PanelView title="Asistente" project={false}>
    <section className={styles.workspace}><h2>Editar · Asistente de diseño</h2>
      {current?<><label>Versión del modelo<select value={current} onChange={e=>choose(e.target.value)}>{models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <Link className="panel-action" href={"/proyectos/"+project+"/visor/"+current+"?panel=asistente"}>Abrir Editar en el modelo</Link></>:
      <p><Link href={"/proyectos/"+project+"/archivos"}>Subir un IFC</Link> o <Link href="/proyectos/restage/visor?panel=asistente">probar Editar en ReStage</Link></p>}</section>
    {error && <p role="alert">{error}</p>}
    {!sources && !error && <LoadingStatus>Buscando fichas del proyecto…</LoadingStatus>}
    {sources?.length===0 && <section><h2>Vincula la primera ficha</h2><p>Abre una versión guardada en el visor y adjunta un PDF desde «Ficha técnica» en las propiedades de cualquier pieza IFC, o desde una selección del plano DWG.</p><Link href={"/proyectos/"+project+"/archivos"}>Archivos y versiones</Link></section>}
    {piece && sources && !source && <p role="status">La pieza seleccionada no tiene una ficha vinculada en esta versión.</p>}
    {!!sources?.length && <section className={styles.workspace}><label>Ficha del proyecto <select value={source?.id??""} onChange={e=>select(e.target.value)}>{!source && <option value="" disabled>Selecciona una ficha</option>}{sources.map(s=><option key={s.id} value={s.id}>{s.filename} · {s.model} · v{s.revision} · {s.element}</option>)}</select></label>
      {source && <Consultation key={source.id} project={project} source={source}/>}</section>}
  </PanelView>;
}
