"use client";
import {useState,useEffect,useRef} from "react";
import {authenticated,authenticatedResponse} from "@/core/http/http-client";
import type {ElementInfo,GroupCapture} from "@/viewer/domain/viewer.port";
import {CompareSlider} from "./compare-slider";
import {ChipChoice,ChipToggles} from "./option-chips";
import {AreaMarker,areaMask} from "./area-marker";
import type {Area} from "../domain/selection-area";
import {DAYLIGHTS,DEFAULT_CHOICES,FINISHES,KEEPS,REQUEST_LIMIT,TONES,asksForChange,composeRequest,formatUsd,type OptionChoices} from "../domain/option-request";

type Batch={id:string;request:string;state:"QUEUED"|"WORKING"|"READY"|"FAILED";selected:number|null;
  drafts?:string[];options:{slot:number;description:string}[];runs:{model_id:string;status:string;error_code:string|null;total_tokens:number|null}[]};
type History={available:boolean;batches:Batch[];budget?:{reserve_cents:number;remaining_cents:number}};

function usePrivateImage(path:string|null) {
  const [url,setUrl]=useState(""),[error,setError]=useState(false);
  useEffect(()=>{
    setUrl("");setError(false);
    if(!path)return;
    const controller=new AbortController();let objectUrl="";
    authenticatedResponse(path,{signal:controller.signal}).then(r=>r.blob()).then(blob=>{
      if(!controller.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[path]);
  return {url,error};
}
function PrivateImage({path,label}:{path:string;label:string}) {
  const {url,error}=usePrivateImage(path);
  return url?<img src={url} alt={label}/>:<p>{error?"No se pudo cargar la imagen.":"Cargando imagen…"}</p>;
}
function OptionComparison({images,slot,onClose}:{images:string;slot:number;onClose:()=>void}) {
  const before=usePrivateImage(images+"/0"),after=usePrivateImage(images+"/"+slot);
  if(before.error||after.error)return <p role="alert">No se pudo cargar la comparación. <button onClick={onClose}>Cerrar comparación</button></p>;
  if(!before.url||!after.url)return <p role="status">Preparando la comparación…</p>;
  return <CompareSlider before={before.url} after={after.url} beforeLabel="Vista del modelo" afterLabel={"Opción "+slot+" · Generado con IA"}
    label={"Comparar la opción "+slot+" con la vista del modelo"} onClose={onClose}/>;
}
export function VisualOptions({project,version,element,capture,groupCapture}:{project:string;version:string;element:ElementInfo;capture:()=>string;groupCapture?:()=>GroupCapture}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [preview,setPreview]=useState(""),[request,setRequest]=useState(""),[message,notify]=useState("");
  const [history,setHistory]=useState<History>(),[busy,setBusy]=useState(false),[refresh,reload]=useState(0);
  const retryId=useRef<string|null>(null);
  const [compare,setCompare]=useState<{batch:string;slot:number}|null>(null);
  const [choices,setChoices]=useState<OptionChoices>(DEFAULT_CHOICES);
  // Optional rectangle over the capture; it travels as the mask the image model already accepts.
  const [area,setArea]=useState<Area|null>(null);
  const captureSize=useRef({width:0,height:0});
  function mark(next:Area|null){setArea(next);retryId.current=null;}
  // The chips only compose the text that was already being sent as the request.
  const composed=composeRequest(choices,request);
  function choose(next:Partial<OptionChoices>){setChoices(current=>({...current,...next}));retryId.current=null;}
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
    setPreview(capture());setArea(null);notify("");setHistory(undefined);retryId.current=null;dialog.current?.showModal();
  }
  async function submit(){
    setBusy(true);notify("");
    try{
      const frame=groupCapture?.();
      if(frame?.missing){notify("Hay piezas ocultas o fuera del encuadre. Gira la cámara o encuadra la selección antes de enviar.");return;}
      retryId.current??=crypto.randomUUID();
      await authenticated(base,{method:"POST",body:JSON.stringify({id:retryId.current,element:key,name:element.name.slice(0,512),request:composed,jpeg:(frame?.image??preview).split(",")[1],
        mask:frame?frame.mask.split(",")[1]:area && captureSize.current.width?areaMask(area,captureSize.current.width,captureSize.current.height).split(",")[1]:undefined})});
      retryId.current=null;setRequest("");setChoices(DEFAULT_CHOICES);setArea(null);reload(n=>n+1);
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
    <p>{element.name}</p>{preview && <details className="capture-details"><summary>Captura que se enviará a Gemini{area && <small> · con un área marcada</small>}</summary>
      {groupCapture?<img src={preview} alt="Encuadre original del visor"/>
        :<AreaMarker src={preview} alt="Encuadre original del visor" area={area} onChange={mark} disabled={busy} onSize={(width,height)=>{captureSize.current={width,height};}}/>}</details>}
    {groupCapture && <small>Al enviar se comparte con Gemini el encuadre actual y la máscara de las piezas seleccionadas.</small>}
    <fieldset className="option-request" disabled={busy}><legend>Qué quieres probar</legend>
      <ChipChoice legend="Acabado o material" items={FINISHES} value={choices.finish} onChange={finish=>choose({finish})}/>
      <ChipChoice legend="Tono" items={TONES} value={choices.tone} onChange={tone=>choose({tone})}/>
      <ChipChoice legend="Luz del día" items={DAYLIGHTS} value={choices.daylight} onChange={daylight=>choose({daylight})}/>
      <ChipToggles legend="Qué conservar" items={KEEPS} value={choices.keep} onChange={keep=>choose({keep})}/>
    </fieldset>
    <label>Cambio solicitado <small>(opcional si eliges opciones)</small><textarea maxLength={REQUEST_LIMIT} value={request} onChange={e=>{setRequest(e.target.value);retryId.current=null;}}/></label>
    <p className="request-preview" data-empty={!composed || undefined}><b>Se enviará:</b> <span data-request-preview="">{composed || "elige al menos una opción o escribe el cambio."}</span></p>
    {history && !history.available && <p>Para generar imágenes falta configurar Gemini en el servidor.</p>}
    {history?.budget && history.budget.remaining_cents<history.budget.reserve_cents && <p role="alert">Se agotó el presupuesto mensual de IA. No se pueden generar más opciones este mes.</p>}
    <button className="review-run" disabled={busy || !history?.available || !asksForChange(choices,request) || (!!history.budget && history.budget.remaining_cents<history.budget.reserve_cents)} onClick={submit}>Enviar captura y generar tres opciones{history?.budget && <span className="run-cost"> · reserva {formatUsd(history.budget.reserve_cents)}</span>}</button>
    {history?.budget && <p className="budget-note">Cada envío reserva {formatUsd(history.budget.reserve_cents)} del presupuesto mensual de IA. Quedan {formatUsd(history.budget.remaining_cents)}.</p>}
    <p role="status">{message}</p>{message && <button onClick={()=>reload(n=>n+1)}>Actualizar historial</button>}
    {history?.batches.map(b=><section key={b.id}><h3>{b.request}</h3>
      <details><summary>Ver captura original</summary>{(preview||groupCapture) && <PrivateImage path={base+"/"+b.id+"/images/0"} label="Captura usada para esta terna"/>}</details>
      {b.state==="FAILED"?<p>La generación quedó incompleta. {b.runs.some(r=>r.error_code==="HTTP_429")?"Gemini alcanzó un límite de solicitudes o de cuota. Revisa la cuota del modelo antes de volver a enviar la captura.":"Consulta el detalle en Consumo de la generación."}</p>:b.state!=="READY" && <p role="status">Preparando las opciones…</p>}
      {b.state==="FAILED" && !!b.drafts?.length && <section aria-label="Alternativas de texto"><h4>Propuestas de Gemini</h4><ol>{b.drafts.map(d=><li key={d}>{d}</li>)}</ol></section>}
      {compare?.batch===b.id && <OptionComparison key={compare.slot} images={base+"/"+b.id+"/images"} slot={compare.slot} onClose={()=>setCompare(null)}/>}
      <div className="visual-grid">{b.options.map(o=><figure key={o.slot}>{(preview||groupCapture) && <PrivateImage path={base+"/"+b.id+"/images/"+o.slot} label={"Opción "+o.slot}/>}
        <figcaption><small>Generado con IA</small><p>{o.description}</p>
        <button disabled={busy||b.state!=="READY"||b.selected===o.slot} onClick={()=>select(b.id,o.slot)}>{b.selected===o.slot?"Elegida":"Elegir opción "+o.slot}</button>
        <button className="compare-open" disabled={b.state!=="READY"} aria-pressed={compare?.batch===b.id && compare.slot===o.slot}
          onClick={()=>setCompare(compare?.batch===b.id && compare.slot===o.slot?null:{batch:b.id,slot:o.slot})}>{"Comparar opción "+o.slot}</button></figcaption></figure>)}</div>
      <details><summary>Consumo de la generación</summary>{b.runs.map((r,n)=><p key={n}>{r.model_id} · {r.status} · {r.total_tokens===null?"Consumo sin confirmar":r.total_tokens+" tokens"} {r.error_code}</p>)}</details>
    </section>)}</>;
  if(groupCapture)return <section className="prism-request" data-working={working}>{content}</section>;
  return <><button className="review-trigger" onClick={open}>Opciones visuales</button>
    <dialog className="delivery-review visual-options" ref={dialog} onClose={()=>{setPreview("");setCompare(null);}} aria-label="Opciones visuales">
    <div className="review-heading"><h2>Opciones visuales</h2><button aria-label="Cerrar opciones" onClick={()=>dialog.current?.close()}>×</button></div>{content}</dialog></>;
}
