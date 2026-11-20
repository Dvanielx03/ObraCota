"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuestionIcon, SelectionIcon, HouseIcon, ArrowsOutCardinalIcon, CornersOutIcon, CubeIcon, FolderOpenIcon, HandIcon, MinusIcon, PlusIcon, SidebarSimpleIcon, XIcon } from "@phosphor-icons/react";
import type {ModelInfo,ViewerPort} from "@/viewer/domain/viewer.port";
import { ViewCube } from "./view-cube";
import {SidebarWidth} from "./sidebar-width";
import { Explorer,type SidebarTab } from "./explorer";
import {DeliveryReview} from "./delivery-review";
import {VisualTour} from "./visual-tour";

export function ViewerWorkspace({ returnHref, returnLabel = "Volver al panel" }: { returnHref: string; returnLabel?: string }) {
  const container = useRef<HTMLDivElement>(null), viewer = useRef<ViewerPort|null>(null), input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController|null>(null), last = useRef<File|null>(null);
  const [model,setModel] = useState<ModelInfo|null>(null), [selected,setSelected] = useState<string|null>(null);
  const [status,setStatus] = useState("Abriendo ReStage…"), [error,setError] = useState(""), [pan,setPan] = useState(false);
  const [panel,setPanel] = useState(true), [session,setSession] = useState(0);
  const [tab,setTab]=useState<SidebarTab>("reading");
  const [windowMode,setWindowMode] = useState(false);
  const [guide,setGuide]=useState<"off"|"welcome"|"select"|"note"|"review"|"done">("off");
  const [paused,setPaused]=useState(false);
  const pauseRef=useRef(false);
  const helpDialog=useRef<HTMLDialogElement>(null),helpButton=useRef<HTMLButtonElement>(null);
  function pauseTour(value:boolean){pauseRef.current=value;setPaused(value);}
  function startTour(){
    document.querySelector<HTMLDialogElement>(".delivery-review[open]")?.close();
    pauseTour(false);setPanel(true);setTab("reading");setGuide("select");
  }
  function stopTour(){rememberGuide();pauseTour(false);setGuide("off");}
  useEffect(()=>{
    try{if(!localStorage.getItem("obracota.guide.v1"))setGuide("welcome");}
    catch{setGuide("welcome");}
  },[]);
  function rememberGuide(){try{localStorage.setItem("obracota.guide.v1","seen");}catch{/* Available again next visit. */}}
  const chosen = model?.elements.find(item=>item.id===selected) || null;
  const pick = useCallback((id:string|null)=>{
    if(id)setTab("properties");
    setSelected(id);viewer.current?.select(id);
    if(id && !pauseRef.current)setGuide(step=>step==="select"?"note":step);
  },[]);
  const open = useCallback(async (file:File|null)=>{
    if (!viewer.current) return;
    request.current?.abort();
    const job = new AbortController();
    request.current = job;
    setError("");setStatus(file?"Leyendo archivo…":"Abriendo ReStage…");
    try {
      const next = await viewer.current.open(file,job.signal,setStatus);
      if (!job.signal.aborted) {
        last.current=file;setPan(false);
        setTab("reading");setModel(next);
        setGuide(step=>step==="done"?"off":step==="note"||step==="review"?"select":step);
        const initial = next.sample ? next.elements.find(item=>item.id.endsWith("_d-viga")) : undefined;
        setSelected(initial?.id ?? null);viewer.current?.select(initial?.id ?? null);setStatus("");
      }
    } catch (e) {
      if (!job.signal.aborted) {setError(e instanceof Error ? e.message : "No se pudo abrir el modelo.");setStatus("");}
    }
  },[]);
  useEffect(()=>{
    let active = true;
    import("@/viewer/infrastructure/three-viewer").then(({createViewer})=>{
      if (!active || !container.current) return;
      viewer.current = createViewer(container.current,pick,()=>{
        request.current?.abort();viewer.current?.dispose();viewer.current=null;
        setStatus("");setError("Se perdió la conexión con el visor gráfico.");
      },()=>setWindowMode(false));
      setPan(false);setWindowMode(false);
      void open(last.current);
    }).catch(()=>{
      if (active) {setStatus("");setError("El navegador no pudo iniciar WebGL 2. Comprueba la aceleración gráfica.");}
    });
    return ()=>{active=false;request.current?.abort();viewer.current?.dispose();viewer.current=null;};
  },[open,pick,session]);
  function closeModel() {
    request.current?.abort();viewer.current?.clear();last.current=null;
    setModel(null);setSelected(null);setError("");setStatus("");
  }
  function togglePan() {viewer.current?.pan(!pan);setPan(!pan);}
  const plan=model?.environment==="plan";
  const ready = !!model && !status && !error;
  useEffect(()=>{
    const dialog=helpDialog.current;
    if(!dialog)return;
    if(ready && (guide==="welcome"||guide==="done")){
      if(!dialog.open)dialog.showModal();
      rememberGuide();
    }else if(dialog.open){
      dialog.close();
      if(guide==="off")helpButton.current?.focus();
    }
  },[ready,guide]);
  return <main className="workspace" data-guide={ready?guide:"off"}>
    <header><a href={returnHref} className="brand viewer-back" aria-label={returnLabel} title={returnLabel}><svg width="25" height="23" viewBox="0 0 25 23" fill="currentColor" aria-hidden="true"><path d="M1 2h23l-5 5H6l-5 5zm0 13 5-5v7h13l5 5H1z"/></svg>ObraCota</a>
      <span className="separator">/</span><span className="project">{model?.name || "Visor de modelos"}</span>
      <input hidden ref={input} type="file" accept=".ifc,.dwg" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void open(file);}}/>
      <button className="open" onClick={()=>input.current?.click()} disabled={!viewer.current && !!error}><FolderOpenIcon/>Abrir archivo</button>
      <button ref={helpButton} className="help-icon" aria-label="Guía de uso" title="Guía de uso" aria-haspopup="dialog" disabled={!ready} onClick={()=>setGuide("welcome")}><QuestionIcon aria-hidden="true"/></button>
    </header>
    <div className={"workarea " + (panel?"":"collapsed")}>
      <aside id="explorer" hidden={!panel} inert={!!status} aria-busy={!!status}><Explorer tab={tab} changeTab={setTab} onNoteSaved={()=>{if(!paused)setGuide(step=>step==="note"?"review":step);}} key={model?.versionId??model?.name} version={model?.versionId} elements={model?.elements || []} selected={chosen} drawing={model?.drawing} locate={(id,preview)=>{pick(id);if(preview && guide!=="select")setTab("reading");viewer.current?.locate(id);}}/><SidebarWidth/></aside>
      <section className="stage" aria-label={plan?"Mesa de planos":"Modelo 3D"}>
        <div className="stagebar"><button aria-label={panel?"Ocultar explorador":"Mostrar explorador"} aria-expanded={panel} onClick={()=>setPanel(!panel)}><SidebarSimpleIcon/></button><span>{plan?"Plano 2D":"Vista 3D"}</span>
          {ready && model && <DeliveryReview guided={guide==="review"&&!paused} onDownloaded={()=>{if(guide==="review"&&!paused){setGuide("done");rememberGuide();}}} key={model.versionId??model.name} model={model} locate={id=>{setPanel(true);pick(id);viewer.current?.locate(id);}}/>}
          {model && <><small>{model.schema}</small><button className="close" aria-label="Cerrar modelo" onClick={closeModel}><XIcon/></button></>}
        </div>
        <div className="view" style={{visibility:ready?"visible":"hidden"}} ref={container}/>
        {!ready && <div className="feedback" role="status"><CubeIcon size={32}/><h2>{error?"No se pudo abrir":status || "Abrir un modelo"}</h2>
          {error && <p>{error}</p>}
          {!status && <div>{viewer.current ? <><button onClick={()=>input.current?.click()}>Elegir archivo</button>
            <button onClick={()=>model?setError(""):open(null)}>{model?"Volver al modelo":"Explorar ReStage"}</button></> :
            <button onClick={()=>{setError("");setStatus("Iniciando visor…");setSession(s=>s+1);}}>Reintentar</button>}</div>}
          {status && viewer.current && <button onClick={()=>{request.current?.abort();setStatus("");}}>Cancelar</button>}
        </div>}
        {!plan && <div className="cube-host" hidden={!ready}><ViewCube flat={false} orient={view=>viewer.current?.orient(view)}/></div>}
        {ready && <div className="tools" aria-label="Controles del modelo">
          {!plan && <><button aria-label="Orbitar" title="Orbitar" aria-pressed={!pan} onClick={()=>{if(pan)togglePan();}}><ArrowsOutCardinalIcon/></button>
          <button aria-label="Desplazar" title="Desplazar" aria-pressed={pan} onClick={()=>{if(!pan)togglePan();}}><HandIcon/></button></>}
          {!plan && <i/>}<button aria-label="Acercar" title="Acercar" onClick={()=>viewer.current?.zoom(1.25)}><PlusIcon/></button>
          <button aria-label="Alejar" title="Alejar" onClick={()=>viewer.current?.zoom(0.8)}><MinusIcon/></button>
          <button aria-label="Zoom ventana" title="Zoom ventana · arrastra un rectángulo, Esc para cancelar" aria-pressed={windowMode} onClick={()=>{setWindowMode(!windowMode);viewer.current?.windowZoom();}}><SelectionIcon/></button>
          <button aria-label={plan?"Encuadrar plano":"Encuadrar modelo"} title="Extensión completa · doble clic central" onClick={()=>viewer.current?.extents()}><CornersOutIcon/></button>
          <button aria-label="Restablecer cámara" title={plan?"Volver a la vista inicial del plano · Inicio":"Restablecer isométrica · Inicio"} onClick={()=>viewer.current?.fit()}><HouseIcon/></button>
        </div>}
      </section>
    </div>
    <dialog className="help-sheet" ref={helpDialog} aria-labelledby="help-title" onCancel={stopTour}>
      <h2 id="help-title">{guide==="done"?"Guía completada":"Tu primera revisión"}</h2>
      <p>{guide==="done"?"Abre el archivo .txt en tus descargas para leer tu observación junto a la referencia del modelo.":"El cursor te llevará desde la selección de una referencia hasta la descarga de tu primer informe. Puedes practicar con ReStage o con tu propio archivo."}</p>
      {guide==="done"?<button onClick={stopTour}>Finalizar</button>:<><button onClick={startTour} disabled={!ready}>Iniciar guía</button><button onClick={stopTour}>Ahora no</button></>}
      {model?.sample && <p><a href="/models/creditos.txt" target="_blank" rel="noreferrer">Créditos del modelo ReStage ↗</a></p>}
    </dialog>
    {guide==="note" && !model?.versionId && <button className="guide-skip-note" onClick={()=>setGuide("review")}>Continuar sin nota local</button>}
    {ready && (guide==="select"||guide==="note"||guide==="review") && <VisualTour phase={guide} selected={!!chosen} paused={paused} pause={()=>pauseTour(!paused)} restart={startTour} exit={stopTour} back={()=>{
      const dialog=document.querySelector<HTMLDialogElement>(".delivery-review[open]");
      if(dialog){dialog.close();return;}
      setPanel(true);setTab(guide==="review"?"properties":"reading");setGuide(guide==="review"?"note":"select");
    }}/>}
  </main>;
}
