"use client";
import {useState,useEffect,useRef} from "react";
import {authenticated,authenticatedResponse} from "@/core/http/http-client";
import type {ElementInfo,GroupCapture} from "@/viewer/domain/viewer.port";

type Batch={id:string;request:string;state:"QUEUED"|"WORKING"|"READY"|"FAILED";selected:number|null;
  drafts?:string[];options:{slot:number;description:string}[];runs:{model_id:string;status:string;error_code:string|null;total_tokens:number|null}[]};
type History={available:boolean;batches:Batch[]};

function PrivateImage({path,label}:{path:string;label:string}) {
  const [url,setUrl]=useState(""),[error,setError]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();let objectUrl="";
    authenticatedResponse(path,{signal:controller.signal}).then(r=>r.blob()).then(blob=>{
      if(!controller.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[path]);
  return url?<img src={url} alt={label}/>:<p>{error?"No se pudo cargar la imagen.":"Cargando imagen…"}</p>;
}
export function VisualOptions({project,version,element,capture,groupCapture}:{project:string;version:string;element:ElementInfo;capture:()=>string;groupCapture?:()=>GroupCapture}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [preview,setPreview]=useState(""),[request,setRequest]=useState(""),[message,notify]=useState("");
  const [history,setHistory]=useState<History>(),[busy,setBusy]=useState(false),[refresh,reload]=useState(0);
  const retryId=useRef<string|null>(null);
  const base="projects/"+project+"/versions/"+version+"/options";
  const key=element.guid || element.id;
  useEffect(()=>{
    if(!preview && !groupCapture)return;
    const ctl=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function read(){
      try{
        const h=await authenticated<History>(base+"?element="+encodeURIComponent(key),{signal:ctl.signal});
        if(ctl.signal.aborted)return;
        setHistory(h);
        if(h.batches.some(b=>b.state==="WORKING"||b.state==="QUEUED"))timer=setTimeout(read,1800);
      }catch{if(!ctl.signal.aborted)notify("No se pudo consultar el historial.");}
    }
    void read();return ()=>{ctl.abort();clearTimeout(timer);};
  },[preview,base,key,refresh,!!groupCapture]);
  function open(){
    setPreview(capture());notify("");setHistory(undefined);retryId.current=null;dialog.current?.showModal();
  }
  async function submit(){
    setBusy(true);notify("");
    try{
      const frame=groupCapture?.();
      if(frame?.missing){notify("Hay piezas ocultas o fuera del encuadre. Gira la cámara o encuadra la selección antes de enviar.");return;}
      retryId.current??=crypto.randomUUID();
      await authenticated(base,{method:"POST",body:JSON.stringify({id:retryId.current,element:key,name:element.name.slice(0,512),request:request.trim(),jpeg:(frame?.image??preview).split(",")[1],mask:frame?.mask.split(",")[1]})});
      retryId.current=null;setRequest("");reload(n=>n+1);
    }catch(e){notify(e instanceof Error?e.message:"No se pudo iniciar la generación.");}
    finally{setBusy(false);}
  }
  async function select(id:string,slot:number){
    setBusy(true);
    try{await authenticated(base+"/"+id+"/selection/"+slot,{method:"PUT"});reload(n=>n+1);notify("Elección guardada.");}
    catch(e){notify(e instanceof Error?e.message:"No se pudo guardar la elección.");}finally{setBusy(false);}
  }
  const working=busy || !!history?.batches.some(b=>b.state==="WORKING"||b.state==="QUEUED");
  const content=<>
    <p>{element.name}</p>{preview && <details><summary>Captura que se enviará a Gemini</summary><img src={preview} alt="Encuadre original del visor"/></details>}
    {groupCapture && <small>Al enviar se comparte con Gemini el encuadre actual y la máscara de las piezas seleccionadas.</small>}
    <label>Cambio solicitado<textarea maxLength={2000} value={request} onChange={e=>{setRequest(e.target.value);retryId.current=null;}}/></label>
    {history && !history.available && <p>Para generar imágenes falta configurar Gemini en el servidor.</p>}
    <button className="review-run" disabled={busy || !history?.available || !request.trim()} onClick={submit}>Enviar captura y generar tres opciones</button>
    <p role="status">{message}</p>{message && <button onClick={()=>reload(n=>n+1)}>Actualizar historial</button>}
    {history?.batches.map(b=><section key={b.id}><h3>{b.request}</h3>
      <details><summary>Ver captura original</summary>{(preview||groupCapture) && <PrivateImage path={base+"/"+b.id+"/images/0"} label="Captura usada para esta terna"/>}</details>
      {b.state==="FAILED"?<p>La generación quedó incompleta. {b.runs.some(r=>r.error_code==="HTTP_429")?"Gemini alcanzó un límite de solicitudes o de cuota. Revisa la cuota del modelo antes de volver a enviar la captura.":"Consulta el detalle en Consumo de la generación."}</p>:b.state!=="READY" && <p role="status">Preparando las opciones…</p>}
      {b.state==="FAILED" && !!b.drafts?.length && <section aria-label="Alternativas de texto"><h4>Propuestas de Gemini</h4><ol>{b.drafts.map(d=><li key={d}>{d}</li>)}</ol></section>}
      <div className="visual-grid">{b.options.map(o=><figure key={o.slot}>{(preview||groupCapture) && <PrivateImage path={base+"/"+b.id+"/images/"+o.slot} label={"Opción "+o.slot}/>}
        <figcaption><small>Generado con IA</small><p>{o.description}</p>
        <button disabled={busy||b.state!=="READY"||b.selected===o.slot} onClick={()=>select(b.id,o.slot)}>{b.selected===o.slot?"Elegida":"Elegir opción "+o.slot}</button></figcaption></figure>)}</div>
      <details><summary>Consumo de la generación</summary>{b.runs.map((r,n)=><p key={n}>{r.model_id} · {r.status} · {r.total_tokens===null?"Consumo sin confirmar":r.total_tokens+" tokens"} {r.error_code}</p>)}</details>
    </section>)}</>;
  if(groupCapture)return <section className="prism-request" data-working={working}>{content}</section>;
  return <><button className="review-trigger" onClick={open}>Opciones visuales</button>
    <dialog className="delivery-review visual-options" ref={dialog} onClose={()=>setPreview("")} aria-label="Opciones visuales">
    <div className="review-heading"><h2>Opciones visuales</h2><button aria-label="Cerrar opciones" onClick={()=>dialog.current?.close()}>×</button></div>{content}</dialog></>;
}
