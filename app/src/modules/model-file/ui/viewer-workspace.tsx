"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuestionIcon, SelectionIcon, HouseIcon, ArrowsOutCardinalIcon, CornersOutIcon, CubeIcon, DiamondIcon, FolderOpenIcon, HandIcon, MinusIcon, PlusIcon, SidebarSimpleIcon, XIcon } from "@phosphor-icons/react";
import type {ModelInfo,ViewerPort} from "@/viewer/domain/viewer.port";
import { ViewCube } from "./view-cube";
import {SidebarWidth} from "./sidebar-width";
import { Explorer,type SidebarTab } from "./explorer";
import {DeliveryReview} from "./delivery-review";
import {VisualTour} from "./visual-tour";

import { VisualOptions } from "@/modules/design-option/ui/visual-options";
import { SelectionAssistant } from "@/modules/design-option/ui/selection-assistant";
import { PrismaTour,type MaskStep,type PrismaStep } from "@/modules/design-option/ui/prisma-tour";
import { NotesContext } from "./notes-source";
import type { VersionNotes } from "@/modules/model-version/domain/model-version";

export function ViewerWorkspace({ returnHref, returnLabel = "Volver al panel", initialFile, storedNotes, storedVersion, loadPrevious }: {
  returnHref: string; returnLabel?: string; initialFile?: File; storedNotes?: VersionNotes; storedVersion?: {project:string;version:string};
  loadPrevious?: (signal:AbortSignal)=>Promise<File>;
}) {
  const container = useRef<HTMLDivElement>(null), viewer = useRef<ViewerPort|null>(null), input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController|null>(null), last = useRef<File|null>(initialFile ?? null);
  const [model,setModel] = useState<ModelInfo|null>(null), [selected,setSelected] = useState<string|null>(null);
  const [status,setStatus] = useState("Abriendo ReStage…"), [error,setError] = useState(""), [pan,setPan] = useState(false);
  const [panel,setPanel] = useState(true), [session,setSession] = useState(0);
  const [walk,setWalk]=useState<"idle"|"mark"|"active">("idle");
  const [walkError,setWalkError]=useState(""),[walkLoading,setWalkLoading]=useState(""),[walkOlder,setWalkOlder]=useState(false);
  const walkRequest=useRef<AbortController|null>(null),previousFile=useRef<File|undefined>(undefined),beforeWalk=useRef(true);
  const stopWalk=useCallback(()=>{
    walkRequest.current?.abort();
    viewer.current?.cancelWalk();
    setPanel(beforeWalk.current);setWalk("idle");setWalkError("");setWalkLoading("");setWalkOlder(false);
  },[]);
  useEffect(()=>{
    if(walk==="idle")return;
    function escape(event:KeyboardEvent){if(event.key==="Escape")stopWalk();}
    window.addEventListener("keydown",escape);
    return ()=>window.removeEventListener("keydown",escape);
  },[stopWalk,walk]);
  useEffect(()=>()=>walkRequest.current?.abort(),[]);
  const [assistant,setAssistant]=useState(false),[ids,setIds]=useState<string[]>([]),[grouping,setGrouping]=useState(false),[color,setColor]=useState<string|null>(null);
  const [prismaStep,setPrismaStep]=useState<PrismaStep|null>(null);
  const [prismaPaused,setPrismaPaused]=useState(false);
  const mode=useRef({assistant:false,grouping:false});
  mode.current={assistant,grouping};
  function selectForDesign(id:string){
    setColor(null);
    setIds(current=>mode.current.grouping ? current.includes(id)?current.filter(i=>i!==id):[...current,id] : [id]);
  }
  function toggleAssistant(){
    if(!assistant){setIds(selected?[selected]:[]);setColor(null);setGrouping(false);}
    if(assistant){setTab("reading");setPrismaStep(null);}
    setAssistant(!assistant);setPanel(true);
  }
  const previouslyDesign=useRef(false);
  useEffect(()=>{
    if(assistant)viewer.current?.previewGroup(ids,color??undefined);
    else if(previouslyDesign.current)viewer.current?.select(selected);
    previouslyDesign.current=assistant;
  },[assistant,ids,color,selected]);
  useEffect(()=>{
    if(!assistant||!grouping)return;
    const escape=(e:KeyboardEvent)=>{if(e.key==="Escape")setGrouping(false);};
    window.addEventListener("keydown",escape);return ()=>window.removeEventListener("keydown",escape);
  },[assistant,grouping]);
  const [tab,setTab]=useState<SidebarTab>("reading");
  const [windowMode,setWindowMode] = useState(false);
  const [guide,setGuide]=useState<"off"|"welcome"|"select"|"note"|"review"|"done">("off");
  const [paused,setPaused]=useState(false);
  const pauseRef=useRef(false);
  const helpDialog=useRef<HTMLDialogElement>(null),helpButton=useRef<HTMLButtonElement>(null);
  function pauseTour(value:boolean){pauseRef.current=value;setPaused(value);}
  function startTour(){
    document.querySelector<HTMLDialogElement>(".delivery-review[open]")?.close();
    setPrismaStep(null);setAssistant(false);pauseTour(false);setPanel(true);setTab("reading");setGuide("select");
  }
  function startPrismaTour(){
    stopTour();
    setPrismaPaused(false);
    setPrismaStep(assistant && panel?"select":"open");
  }
  function advancePrisma(from:PrismaStep,to:PrismaStep){
    if(!prismaPaused)setPrismaStep(step=>step===from?to:step);
  }
  function startMaskGuide(step:MaskStep){
    stopTour();
    setPrismaPaused(false);
    setPrismaStep(step);
  }
  useEffect(()=>{
    if(prismaPaused || !assistant || !panel)return;
    if(prismaStep==="open")setPrismaStep("select");
    else if(prismaStep==="select" && ids.length)setPrismaStep("group");
    else if(prismaStep==="group" && grouping)setPrismaStep("add");
    else if(prismaStep==="add" && !grouping)setPrismaStep("group");
    else if(prismaStep==="add" && ids.length>=2)setPrismaStep("frame");
    else if(prismaStep==="preview" && color)setPrismaStep("export");
    else if(prismaStep==="export" && !color)setPrismaStep("preview");
    if(prismaStep && ["group","add","frame","preview","export"].includes(prismaStep) && !ids.length)setPrismaStep("select");
  },[prismaStep,prismaPaused,assistant,panel,ids.length,grouping,color]);
  function stopTour(){rememberGuide();pauseTour(false);setGuide("off");}
  useEffect(()=>{
    try{if(!localStorage.getItem("obracota.guide.v1"))setGuide("welcome");}
    catch{setGuide("welcome");}
  },[]);
  function rememberGuide(){try{localStorage.setItem("obracota.guide.v1","seen");}catch{/* Available again next visit. */}}
  const chosen = model?.elements.find(item=>item.id===selected) || null;
  const pick = useCallback((id:string|null)=>{
    if(mode.current.assistant){if(id)selectForDesign(id);return;}
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
        setPrismaStep(null);
        const design=!next.drawing && next.environment!=="plan" && new URLSearchParams(window.location.search).get("panel")==="asistente";
        setAssistant(design);setGrouping(false);setColor(null);
        setTab("reading");setModel(next);
        setGuide(step=>step==="done"?"off":step==="note"||step==="review"?"select":step);
        const target=file && file===initialFile ? new URLSearchParams(window.location.search).get("element") : null;
        const initial = target ? next.elements.find(item=>item.guid===target || item.id===target)
          : next.sample ? next.elements.find(item=>item.id.endsWith("_d-viga")) : undefined;
        if(target && initial){viewer.current.locate(initial.id);setTab("properties");}
        if(target && !initial)setError("La referencia del documento no coincide con una pieza visible de esta versión.");
        setIds(initial?[initial.id]:[]);
        setSelected(initial?.id ?? null);viewer.current?.select(initial?.id ?? null);setStatus("");
      }
    } catch (e) {
      if (!job.signal.aborted) {setError(e instanceof Error ? e.message : "No se pudo abrir el modelo.");setStatus("");}
    }
  },[initialFile]);
  useEffect(()=>{
    let active = true;
    import("@/viewer/infrastructure/three-viewer").then(({createViewer})=>{
      if (!active || !container.current) return;
      viewer.current = createViewer(container.current,pick,()=>{
        request.current?.abort();walkRequest.current?.abort();viewer.current?.dispose();viewer.current=null;setWalk("idle");
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
    setPrismaStep(null);
    setAssistant(false);setIds([]);setColor(null);
    request.current?.abort();viewer.current?.clear();last.current=null;
    setModel(null);setSelected(null);setError("");setStatus("");
  }
  function togglePan() {viewer.current?.pan(!pan);setPan(!pan);}
  const plan=model?.environment==="plan";
  const ready = !!model && !status && !error;
  const prismaAvailable=ready && !plan && !model?.drawing;
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
  const serverNotes = initialFile && last.current === initialFile ? storedNotes : undefined;
  function startWalk(){
    stopTour();setPrismaStep(null);
    beforeWalk.current=panel;setPanel(false);setWalk("mark");setWalkError("");
    viewer.current?.enterWalk(message=>{setWalkError(message??"");if(!message)setWalk("active");});
  }
  async function compareWalk(older:boolean){
    if(!initialFile || !loadPrevious || !viewer.current || walkOlder===older || walkLoading)return;
    const operation=new AbortController();walkRequest.current=operation;
    setWalkError("");setWalkLoading("Abriendo la otra versión…");
    try {
      const file=older?(previousFile.current??=await loadPrevious(operation.signal)):initialFile;
      await viewer.current.switchWalk(file,operation.signal,setWalkLoading);
      if(!operation.signal.aborted)setWalkOlder(older);
    }catch(error){
      if(!operation.signal.aborted)setWalkError(error instanceof Error?error.message:"No se pudo comparar la versión.");
    }finally{if(!operation.signal.aborted)setWalkLoading("");}
  }
  const touring=walk!=="idle";
  return <NotesContext.Provider value={serverNotes}><main className="workspace" data-walk={touring?"on":undefined} data-guide={ready?guide:"off"}>
    <header><a href={returnHref} className="brand viewer-back" aria-label={returnLabel} title={returnLabel}><svg width="25" height="23" viewBox="0 0 25 23" fill="currentColor" aria-hidden="true"><path d="M1 2h23l-5 5H6l-5 5zm0 13 5-5v7h13l5 5H1z"/></svg>ObraCota</a>
      <span className="separator">/</span><span className="project">{model?.name || "Visor de modelos"}</span>
      <input hidden ref={input} type="file" accept=".ifc,.dwg" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void open(file);}}/>
      <button className="open" onClick={()=>input.current?.click()} disabled={touring || (!viewer.current && !!error)}><FolderOpenIcon/>Abrir archivo</button>
      <button ref={helpButton} className="help-icon" aria-label="Guía de uso" title="Guía de uso" aria-haspopup="dialog" disabled={!ready || touring} onClick={()=>setGuide("welcome")}><QuestionIcon aria-hidden="true"/></button>
    </header>
    <div className={"workarea " + (panel?"":"collapsed")}>
      <aside id="explorer" hidden={!panel} inert={!!status} aria-busy={!!status}>{assistant && ready && viewer.current && model?
       <SelectionAssistant viewer={viewer.current} scope={serverNotes?storedVersion:undefined} elements={model.elements} ids={ids} grouping={grouping} onGroup={()=>setGrouping(!grouping)} onPick={selectForDesign} onRemove={id=>{setIds(ids.filter(i=>i!==id));setColor(null);}} color={color} onColor={setColor} fold={()=>setPanel(false)}
        onGuide={startPrismaTour} onFrame={()=>advancePrisma("frame","preview")} onExport={()=>advancePrisma("export","edit-package")} onMaskGuide={startMaskGuide}
        onMaskPrepared={()=>setPrismaStep(step=>step==="edit-package"||step==="edit-save"?"edit-import":step)}
        onMaskImported={()=>setPrismaStep(step=>step==="edit-import"||step==="edit-package"?"edit-save":step)}
        onMaskSaved={()=>setPrismaStep(step=>step==="edit-save"?"done":step)}/>:
       <Explorer scope={serverNotes ? storedVersion : undefined} options={ready && !plan && serverNotes && storedVersion && chosen && <VisualOptions key={chosen.id} {...storedVersion} element={chosen} capture={()=>viewer.current!.capture()}/>} tab={tab} changeTab={setTab} onNoteSaved={()=>{if(!paused)setGuide(step=>step==="note"?"review":step);}} key={(serverNotes?"server:":"local:")+(model?.versionId??model?.name)} version={model?.versionId ?? (serverNotes ? "server" : undefined)} elements={model?.elements || []} selected={chosen} drawing={model?.drawing} locate={(id,preview)=>{pick(id);if(preview && guide!=="select")setTab("reading");viewer.current?.locate(id);}}/>}<SidebarWidth/></aside>
      <section className="stage" aria-label={plan?"Mesa de planos":"Modelo 3D"}>
        {touring?<div className="stagebar walk-bar" aria-label="Controles del recorrido">
          <span>Recorrido</span>
          {serverNotes && loadPrevious && walk==="active" && <div className="walk-versions" aria-label="Comparar versiones">
            <button disabled={!!walkLoading} aria-pressed={walkOlder} onClick={()=>void compareWalk(true)}>Anterior</button>
            <button disabled={!!walkLoading} aria-pressed={!walkOlder} onClick={()=>void compareWalk(false)}>Nueva</button>
          </div>}
          <button className="close" onClick={stopWalk}>Salir</button>
        </div>:<div className="stagebar"><button aria-label={panel?"Ocultar explorador":"Mostrar explorador"} aria-expanded={panel} onClick={()=>setPanel(!panel)}><SidebarSimpleIcon/></button><span>{plan?"Plano 2D":"Vista 3D"}</span>
          {prismaAvailable && <button className="assistant-trigger" data-prisma-tour="open" aria-controls="explorer" aria-pressed={assistant && panel}
            aria-label={assistant && panel?"Volver a lectura":"Abrir Prisma"} onClick={()=>{
              if(guide!=="off")stopTour();
              if(assistant && !panel)setPanel(true);else toggleAssistant();
            }}><DiamondIcon aria-hidden="true"/><span>Prisma</span><span className="assistant-trigger-caption">{assistant && panel?"Volver a lectura":"Asistente de diseño"}</span></button>}
          {ready && model && <DeliveryReview guided={guide==="review"&&!paused} onDownloaded={()=>{if(guide==="review"&&!paused){setGuide("done");rememberGuide();}}} key={(serverNotes?"server:":"local:")+(model.versionId??model.name)} model={model} locate={id=>{setPanel(true);pick(id);viewer.current?.locate(id);}}/>}
          {ready && model?.walk && <button className="walk-trigger" onClick={startWalk}>Recorrer</button>}
          {model && <><small>{model.schema}</small><button className="close" aria-label="Cerrar modelo" onClick={closeModel}><XIcon/></button></>}
        </div>}
        <div className="view" style={{visibility:ready?"visible":"hidden"}} ref={container}/>
        {!ready && <div className="feedback" role="status"><CubeIcon size={32}/><h2>{error?"No se pudo abrir":status || "Abrir un modelo"}</h2>
          {error && <p>{error}</p>}
          {!status && <div>{viewer.current ? <><button onClick={()=>input.current?.click()}>Elegir archivo</button>
            <button onClick={()=>model?setError(""):open(null)}>{model?"Volver al modelo":"Explorar ReStage"}</button></> :
            <button onClick={()=>{setError("");setStatus("Iniciando visor…");setSession(s=>s+1);}}>Reintentar</button>}</div>}
          {status && viewer.current && <button onClick={()=>{request.current?.abort();setStatus("");}}>Cancelar</button>}
        </div>}
        {!plan && !touring && <div className="cube-host" hidden={!ready}><ViewCube flat={false} orient={view=>viewer.current?.orient(view)}/></div>}
        {touring && <div className="walk-hint" role="status">{walkError||walkLoading||(walk==="mark"?"Elige un punto libre en el piso. Pulsa Intro para probar el centro.":<><span className="walk-keyboard">Arrastra para mirar · WASD o flechas para caminar</span><span className="walk-touch">Arrastra para mirar. Mantén pulsada una flecha para caminar.</span></>)}</div>}
        {walk==="active" && <div className="walk-pad" aria-label="Dirección del recorrido">{([["forward","Adelante","↑"],["left","Izquierda","←"],["back","Atrás","↓"],["right","Derecha","→"]]).map(([direction,label,icon])=><button key={direction} data-direction={direction} aria-label={label}
          onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);viewer.current?.walkMove(direction,true);}}
          onPointerUp={()=>viewer.current?.walkMove(direction,false)}
          onLostPointerCapture={()=>viewer.current?.walkMove(direction,false)}>{icon}</button>)}</div>}
        {ready && !touring && <div className="tools" aria-label="Controles del modelo">
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
      {guide==="done"?<button onClick={stopTour}>Finalizar</button>:<><button onClick={startTour} disabled={!ready}>Iniciar guía</button>{prismaAvailable && <button onClick={startPrismaTour}>Guía de Prisma</button>}<button onClick={stopTour}>Ahora no</button></>}
      {model?.sample && <p><a href="/models/creditos.txt" target="_blank" rel="noreferrer">Créditos del modelo ReStage ↗</a></p>}
    </dialog>
    {guide==="note" && !model?.versionId && <button className="guide-skip-note" onClick={()=>setGuide("review")}>Continuar sin nota local</button>}
    {prismaAvailable && prismaStep && guide==="off" && <PrismaTour step={prismaStep} paused={prismaPaused} onPause={()=>setPrismaPaused(!prismaPaused)} onRestart={startPrismaTour} onExit={()=>setPrismaStep(null)}/>}
    {ready && (guide==="select"||guide==="note"||guide==="review") && <VisualTour phase={guide} selected={!!chosen} paused={paused} pause={()=>pauseTour(!paused)} restart={startTour} exit={stopTour} back={()=>{
      const dialog=document.querySelector<HTMLDialogElement>(".delivery-review[open]");
      if(dialog){dialog.close();return;}
      setPanel(true);setTab(guide==="review"?"properties":"reading");setGuide(guide==="review"?"note":"select");
    }}/>}
  </main></NotesContext.Provider>;
}
