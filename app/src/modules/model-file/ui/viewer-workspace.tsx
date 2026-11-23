"use client";
import { changeLimitReason } from "@/modules/model-change/domain/change-limit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CubeIcon, SidebarSimpleIcon, XIcon } from "@phosphor-icons/react";
import { Circle, Footprints, Hand, House, ListChecks, Maximize, Minus, Plus, Rotate3d, Square, SquareDashed, X } from "lucide-react";
import type {CameraPose,ModelInfo,ViewerPort} from "@/viewer/domain/viewer.port";
import { ViewCube } from "./view-cube";
import {SidebarWidth} from "./sidebar-width";
import { Explorer,type SidebarTab } from "./explorer";
import {DeliveryReview,type DeliveryReviewHandle} from "./delivery-review";
import {VisualTour} from "./visual-tour";
import {QuickTour,type QuickStep} from "./quick-tour";

import { SceneStrip, type SceneStripHandle } from "@/modules/scene-view/ui/scene-strip";
import { ExportMenu } from "@/modules/scene-view/ui/export-menu";
import { EXPORT_MAX_SIDE } from "@/modules/scene-view/domain/view-export";
import { SelectionAssistant } from "@/modules/design-option/ui/selection-assistant";
import { PrismaTour,type MaskStep,type PrismaStep } from "@/modules/design-option/ui/prisma-tour";
import { NotesContext } from "./notes-source";
import { ViewerHeader } from "./viewer-header";
import { StoredPreview, useOpenFailure } from "./stored-preview";
import type { VersionNotes } from "@/modules/model-version/domain/model-version";
import { VersionRail, type VersionRailHandle } from "@/modules/model-version/ui/version-rail";
import { VersionCompare } from "@/modules/model-version/ui/version-compare";
import { WorkspaceTools, type WorkspaceToolsHandle } from "./workspace-tools";
import { SceneWalkBar, type WalkScene } from "@/modules/design-option/ui/scene-walk";
import { readScene } from "@/modules/design-option/domain/scene-environment";
import { optionsPath } from "@/modules/design-option/infrastructure/option-http";
import { SAMPLE_SIGN_IN, useSampleScope } from "@/modules/model-version/infrastructure/sample-scope-http";
import { IconTool, ModeButton, RovingToolbar, ToolSeparator } from "./tool-bar";
import { ShortcutSheet } from "./shortcut-sheet";
import { TOOL_KEYS, shortcutFor, toolNotice, type ShortcutAction } from "../domain/shortcuts";
import { EmptyArt, ModelPreparing, Spinner } from "@/shared/ui/loading";
import { ENTRY_SETTLING_PHASE, remainingHold } from "../domain/entry-hold";
import { RECORDING_FPS, RECORDING_LIMIT_MS, recordingClock, recordingName, recordingType, startRecording, type WalkRecording } from "@/viewer/infrastructure/walk-recording";
import { saveBlob } from "@/modules/scene-view/infrastructure/export-files";

/** "Duplex.ifc · 2,3 MB": the file being opened, under the phase of the wait. */
function fileLine(file: File | null): string {
  if (!file) return "ReStage · modelo de ejemplo";
  const megabytes = file.size / 1048576;
  const size = megabytes >= 1 ? megabytes.toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " MB"
    : Math.max(1, Math.round(file.size / 1024)).toLocaleString("es-CO") + " KB";
  return file.name + " · " + size;
}

/** Whether the person left the explorer dock open ("open") or folded ("closed"). */
const PANEL_KEY="obracota.explorer.v1";

/** Fields where letters, digits and arrows are typing, not shortcuts. */
const TYPING = "input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox],[role=searchbox],[role=spinbutton]";
/** Widgets that use the arrow keys themselves. */
const ARROW_WIDGETS = "[role=slider],[role=radiogroup],[role=radio],[role=menu],[role=listbox],[role=tree],[role=tablist],[role=grid],[aria-haspopup=menu],[aria-haspopup=true],[aria-haspopup=listbox],.annotate-layer,#explorer,.tool-popover";

/** Whether the focus lets a shortcut through (DU-12): never while typing or inside a modal dialog. */
function shortcutAllowed(target: EventTarget | null, action: ShortcutAction): boolean {
  if (document.querySelector("dialog[open]")) return false;
  const element = target instanceof Element ? target : null;
  if (element?.closest(TYPING)) return false;
  if ((action.kind === "view" || action.kind === "home") && element?.closest(ARROW_WIDGETS)) return false;
  // Inicio moves inside a toolbar; on the canvas the viewer already answers it.
  if (action.kind === "home" && (element?.closest("[role=toolbar]") || element instanceof HTMLCanvasElement)) return false;
  if (element?.closest("[role=menu]")) return false;
  return true;
}

/** The ReStage sample is a GLB made for viewing: the agent and «Guardar en el modelo» change an IFC. */
const SAMPLE_EDIT="ReStage es un ejemplo en GLB, no un IFC editable: sube tu IFC a un proyecto para cambiar el modelo";
/** Saved views (Presentar, Exportar) live in the versions of a project. */
const SAMPLE_VIEWS="Las vistas guardadas son de los modelos de tus proyectos: sube el tuyo para presentarlas y exportarlas";
/** Why Editar and Renderizar are off over an unpublished preview (H1 §7.4). */
const PROPOSAL_EDIT="Pendiente: Editar trabaja sobre versiones guardadas; esto es una vista previa";
const PROPOSAL_RENDER="Pendiente: renderizar una vista previa llega en H6";

/**
 * An unpublished proposal opened as `initialFile` (H1 §7.4): the header says so, Editar and Renderizar stay off,
 * and Comparar shows `compare`, built by the caller over the open model.
 */
export interface ProposalView {
  label: string;
  description: string;
  compare: (context:{elements:ModelInfo["elements"];viewer:()=>ViewerPort|null;selected:string|null})=>ReactNode;
  /** The change on the server, so Revisar adds its report (H7). */
  scope?: {project:string;change:string};
}

export function ViewerWorkspace({ returnHref, returnLabel = "Volver al panel", initialFile, storedNotes, storedVersion, loadPrevious, projectName, revision, proposal, walkLabels }: {
  returnHref: string; returnLabel?: string; initialFile?: File; storedNotes?: VersionNotes; storedVersion?: {project:string;version:string};
  loadPrevious?: (signal:AbortSignal)=>Promise<File>; projectName?: string;
  /** Revision label ("v2") and upload date of a stored version: cover of the presentation and export index. */
  revision?: {label:string;date:string};
  proposal?: ProposalView;
  /** Names of the two models of the walk comparison; «Anterior» and «Nueva» by default. */
  walkLabels?: {older:string;newer:string};
}) {
  const container = useRef<HTMLDivElement>(null), viewer = useRef<ViewerPort|null>(null), input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController|null>(null), last = useRef<File|null>(initialFile ?? null);
  // Read by `open` without making it change (and restart the viewer) on every render of the stored page.
  const storedRef = useRef(storedVersion);
  storedRef.current = storedVersion;
  const previewing = !!proposal;
  const [model,setModel] = useState<ModelInfo|null>(null), [selected,setSelected] = useState<string|null>(null);
  // Bytes of the file on screen: the IFC engine verifies changes only up to MODEL_CHANGE_MAX_BYTES.
  const [openedBytes,setOpenedBytes] = useState(0);
  const [status,setStatus] = useState("Iniciando visor…"), [error,setError] = useState(""), [pan,setPan] = useState(false);
  /** The thumbnail a DWG of ACIS solids keeps, shown in the «No se pudo abrir» card that tells its failure. */
  const failure = useOpenFailure(error);
  // Minimum time on the preparing screen when arriving from the panel (see domain/entry-hold).
  const [holding,setHolding] = useState(true);
  useEffect(()=>{
    const startedAt=performance.now();
    const timer=setTimeout(()=>setHolding(false),remainingHold(startedAt,performance.now()));
    return ()=>clearTimeout(timer);
  },[]);
  // The wait over the canvas: the editor starting (no viewer yet) or a file being read, and which file.
  const [engine,setEngine] = useState(false), [opening,setOpening] = useState(()=>fileLine(initialFile ?? null));
  // The dock starts folded, as the reference has no side panel; the person's own choice is remembered.
  const [panel,setPanel] = useState(false), [session,setSession] = useState(0);
  useEffect(()=>{try{if(localStorage.getItem(PANEL_KEY)==="open")setPanel(true);}catch{/* Folded by default. */}},[]);
  function showExplorer(next:boolean){
    setPanel(next);
    try{localStorage.setItem(PANEL_KEY,next?"open":"closed");}catch{/* Remembered for this visit only. */}
  }
  const [walk,setWalk]=useState<"idle"|"mark"|"active">("idle");
  // «Recorrer esta escena en 3D»: the scene built around the model, kept across the walk until «Restablecer».
  const [walkScene,setWalkScene]=useState<WalkScene|null>(null);
  useEffect(()=>{setWalkScene(null);},[model]);
  const showScene=useCallback((request:string)=>{
    const port=viewer.current;
    if(!port)return false;
    const {environment,finish}=readScene(request);
    if(finish)port.previewExteriorFinish(finish);
    if(!port.previewEnvironment(environment))return false;
    setWalkScene({environment,request});
    return true;
  },[]);
  const resetScene=useCallback(()=>{viewer.current?.clearEnvironment();viewer.current?.previewExteriorFinish(null);setWalkScene(null);},[]);
  const [walkError,setWalkError]=useState(""),[walkLoading,setWalkLoading]=useState(""),[walkOlder,setWalkOlder]=useState(false);
  const walkRequest=useRef<AbortController|null>(null),previousFile=useRef<File|undefined>(undefined),beforeWalk=useRef(true);
  const walkEnded=useRef(false);
  // «Grabar» of the walk (H7): the recorder, its clock on the button and the WebM type this browser records.
  const recording=useRef<WalkRecording|null>(null);
  const [recordClock,setRecordClock]=useState<string|null>(null),[recordType,setRecordType]=useState<string>();
  useEffect(()=>setRecordType(recordingType()),[]);
  const finishRecording=useRef<()=>void>(()=>undefined);
  const stopWalk=useCallback(()=>{
    finishRecording.current();
    walkRequest.current?.abort();
    viewer.current?.cancelWalk();
    walkEnded.current=true;
    setPanel(beforeWalk.current);setWalk("idle");setWalkError("");setWalkLoading("");setWalkOlder(false);
  },[]);
  // Leaving the walk gives the focus back to RECORRIDO once the bottom bar is back.
  useEffect(()=>{
    if(walk!=="idle" || !walkEnded.current)return;
    walkEnded.current=false;
    const frame=requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(".walk-trigger")?.focus({preventScroll:true}));
    return ()=>cancelAnimationFrame(frame);
  },[walk]);
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
  // True while a batch of options is being generated: the Editar mark in the dock keeps moving meanwhile.
  const [optionsWorking,setOptionsWorking]=useState(false);
  const mode=useRef({assistant:false,grouping:false});
  mode.current={assistant,grouping};
  function selectForDesign(id:string){
    setColor(null);
    setIds(current=>mode.current.grouping ? current.includes(id)?current.filter(i=>i!==id):[...current,id] : [id]);
  }
  // Editar (DU-16, DU-17): the canvas and the sub-bar, as in the reference. The dock keeps its state
  // (folded by default) and, when open, shows the selection of pieces («Selección»); the marks of the
  // sub-bar add their pieces to it and the green dot of Seleccionar tells they are there. Escape while
  // "Agrupar" is on only ends the grouping: the tools handle that key, so Escape has one owner.
  function enterEdit(){
    if(guide!=="off")stopTour();
    setIds(selected?[selected]:[]);setColor(null);setGrouping(false);
    setAssistant(true);
  }
  function exitEdit(){
    setTab("reading");setPrismaStep(null);setGrouping(false);
    setAssistant(false);
  }
  // In Editar the model shows the piece of the open mark (DU-17), or the whole selection while a colour is previewed.
  const [editFocus,setEditFocus]=useState<string|null>(null);
  const previouslyDesign=useRef(false);
  useEffect(()=>{
    if(assistant)viewer.current?.previewGroup(color?ids:editFocus?[editFocus]:[],color??undefined);
    else if(previouslyDesign.current)viewer.current?.select(selected);
    previouslyDesign.current=assistant;
  },[assistant,ids,color,selected,editFocus]);
  const [tab,setTab]=useState<SidebarTab>("reading");
  const [windowMode,setWindowMode] = useState(false);
  const [guide,setGuide]=useState<"off"|"welcome"|"select"|"note"|"review"|"done">("off");
  const [paused,setPaused]=useState(false);
  const [quick,setQuick]=useState<QuickStep|null>(null),[quickPaused,setQuickPaused]=useState(false);
  const quickRef=useRef<QuickStep|null>(null);
  quickRef.current=quickPaused?null:quick;
  const pauseRef=useRef(false);
  const helpDialog=useRef<HTMLDialogElement>(null),helpButton=useRef<HTMLButtonElement>(null);
  const review=useRef<DeliveryReviewHandle>(null);
  const [reviewOpen,setReviewOpen]=useState(false);
  function pauseTour(value:boolean){pauseRef.current=value;setPaused(value);}
  function startTour(){
    review.current?.close();
    setQuick(null);setPrismaStep(null);setAssistant(false);pauseTour(false);setPanel(true);setTab("reading");setGuide("select");
  }
  function startQuickTour(){
    review.current?.close();
    rememberGuide();pauseTour(false);setGuide("off");
    setPrismaStep(null);setAssistant(false);setPanel(true);setTab("reading");setQuickPaused(false);setQuick("select");
  }
  function startPrismaTour(){
    stopTour();setQuick(null);
    setPrismaPaused(false);
    setPrismaStep(assistant && panel?"select":"open");
  }
  function advancePrisma(from:PrismaStep,to:PrismaStep){
    if(!prismaPaused)setPrismaStep(step=>step===from?to:step);
  }
  function startMaskGuide(step:MaskStep){
    stopTour();setQuick(null);
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
    // Arriving from the onboarding starts the quick tour on the real controls, without a dialog.
    if(new URLSearchParams(window.location.search).get("guia")==="rapida"){rememberGuide();setQuick("select");return;}
    try{if(!localStorage.getItem("obracota.guide.v1"))setGuide("welcome");}
    catch{setGuide("welcome");}
  },[]);
  function rememberGuide(){try{localStorage.setItem("obracota.guide.v1","seen");}catch{/* Available again next visit. */}}
  const chosen = model?.elements.find(item=>item.id===selected) || null;
  // While presenting, a click on the model only orbits: the selection stays as it was.
  const presentingRef=useRef(false);
  const pick = useCallback((id:string|null)=>{
    if(presentingRef.current)return;
    // In Editar a click on the model belongs to Seleccionar (it places a mark), never to the dock.
    if(mode.current.assistant)return;
    if(id)setTab("properties");
    setSelected(id);viewer.current?.select(id);
    if(id && !pauseRef.current)setGuide(step=>step==="select"?"note":step);
    if(id && quickRef.current==="select")setQuick("options");
  },[]);
  const open = useCallback(async (file:File|null)=>{
    if (!viewer.current) return;
    request.current?.abort();
    const job = new AbortController();
    request.current = job;
    setError("");setStatus(file?"Leyendo archivo…":"Abriendo ReStage…");setOpening(fileLine(file));
    try {
      // The stored version the file came from: its ACIS solids are tessellated on the server.
      const next = await viewer.current.open(file,job.signal,setStatus,file && file===initialFile ? storedRef.current : undefined);
      if (!job.signal.aborted) {
        last.current=file;setPan(false);
        setPrismaStep(null);
        const design=!previewing && !next.drawing && next.environment!=="plan" && new URLSearchParams(window.location.search).get("panel")==="asistente";
        setAssistant(design);setGrouping(false);setColor(null);
        setTab("reading");setModel(next);setOpenedBytes(file?.size??0);
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
  },[initialFile,previewing]);
  useEffect(()=>{
    let active = true;
    import("@/viewer/infrastructure/three-viewer").then(({createViewer})=>{
      if (!active || !container.current) return;
      viewer.current = createViewer(container.current,pick,()=>{
        request.current?.abort();walkRequest.current?.abort();viewer.current?.dispose();viewer.current=null;setWalk("idle");setEngine(false);
        setStatus("");setError("Se perdió la conexión con el visor gráfico.");
      },()=>setWindowMode(false));
      setPan(false);setWindowMode(false);setEngine(true);
      void open(last.current);
    }).catch(()=>{
      if (active) {setStatus("");setError("El navegador no pudo iniciar WebGL 2. Comprueba la aceleración gráfica.");}
    });
    return ()=>{active=false;request.current?.abort();viewer.current?.dispose();viewer.current=null;setEngine(false);};
  },[open,pick,session]);
  function closeModel() {
    setPrismaStep(null);setQuick(null);
    setAssistant(false);setIds([]);setColor(null);
    request.current?.abort();viewer.current?.clear();last.current=null;
    setModel(null);setSelected(null);setError("");setStatus("");
  }
  function togglePan() {viewer.current?.pan(!pan);setPan(!pan);}
  const plan=model?.environment==="plan";
  const settling = holding && !status && !error && !!model;
  const ready = !!model && !status && !error && !holding;
  // The way in from the panel is one wait with one animation (download, reading and settling alike);
  // later loads in the same visit (another file, another version) show the file being read.
  const [entered,setEntered] = useState(false);
  useEffect(()=>{if(ready)setEntered(true);},[ready]);
  // Editar, Renderizar and the walk work on any 3D model: IFC, a 3D DWG, FBX, OBJ or the sample; not on a plan.
  const prismaAvailable=ready && !plan;
  // The quick tour follows what the person does and skips a stop whose control this file lacks.
  useEffect(()=>{
    if(!ready || !quick || quickPaused)return;
    if(quick==="options" && (!prismaAvailable || assistant))setQuick("walk");
    else if(quick==="walk" && !model?.walk)setQuick("done");
  },[ready,quick,quickPaused,prismaAvailable,assistant,panel,model]);
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
  // Whether the open model is the one the page was opened with (and not a file chosen afterwards): the stored
  // notes and the walk comparison only make sense over it.
  const showingInitial = !!initialFile && last.current === initialFile;
  const serverNotes = showingInitial ? storedNotes : undefined;
  // The ReStage sample (a public GLB): with a session the server keeps a project of its own for it, so Renderizar
  // and the panorama work and persist as on a saved version; without one they ask to sign in.
  const sampleOpen = !!model?.sample;
  const sampleScope = useSampleScope(sampleOpen);
  const toolScope = plan ? undefined : serverNotes && storedVersion ? storedVersion : sampleScope.state === "ready" ? sampleScope.scope : undefined;
  const sampleSignIn = sampleScope.state === "signed-out" ? SAMPLE_SIGN_IN : undefined;
  const sampleReason = sampleScope.state === "checking" ? "Preparando el ejemplo en el servidor…"
    : sampleScope.state === "error" ? "No se pudo preparar el ejemplo en el servidor: " + sampleScope.message : undefined;
  const readPose=useCallback(()=>viewer.current?.pose()??null,[]);
  const applyPose=useCallback((next:CameraPose,duration?:number)=>viewer.current?.applyPose(next,duration),[]);
  const capturePicture=useCallback(()=>viewer.current?.capture("jpeg")??null,[]);
  // The header's "Presentar" drives the presentation that lives in the saved-view strip.
  const strip=useRef<SceneStripHandle>(null),presentButton=useRef<HTMLButtonElement>(null);
  const tools=useRef<WorkspaceToolsHandle>(null),rail=useRef<VersionRailHandle>(null);
  const [viewCount,setViewCount]=useState(0);
  // During the presentation the header and the dock are inert; the focus goes back to "Presentar" after it.
  const [presenting,setPresenting]=useState(false);
  presentingRef.current=presenting;
  const refocusPresent=useRef(false);
  const presentStarted=useCallback(()=>{setPresenting(true);},[]);
  const presentEnded=useCallback(()=>{refocusPresent.current=true;setPresenting(false);},[]);
  useEffect(()=>{
    if(presenting || !refocusPresent.current)return;
    refocusPresent.current=false;
    // The button lives outside the full-screen stage: it can only take the focus once full screen is over.
    const focus=()=>presentButton.current?.focus();
    if(document.fullscreenElement)document.addEventListener("fullscreenchange",()=>requestAnimationFrame(focus),{once:true});
    else focus();
  },[presenting]);
  // Short messages over the canvas: export results and shortcuts that cannot run (also for screen readers).
  const [notice,setNotice]=useState<{text:string;tone:"info"|"error";at:number}|null>(null);
  const say=useCallback((text:string,tone:"info"|"error"="info")=>setNotice({text,tone,at:Date.now()}),[]);
  useEffect(()=>{
    if(!notice)return;
    const timer=setTimeout(()=>setNotice(null),notice.tone==="error"?6000:3200);
    return ()=>clearTimeout(timer);
  },[notice]);
  const [shortcutsOpen,setShortcutsOpen]=useState(false);
  const modelName=model?.name;
  finishRecording.current=()=>{
    const active=recording.current;
    if(!active)return;
    recording.current=null;setRecordClock(null);
    const length=recordingClock(active.elapsed()),name=recordingName(modelName??"modelo",new Date());
    active.stop().then(video=>{saveBlob(name,video);say("Descargado "+name+" · "+length+" de recorrido.");})
      .catch(error=>say(error instanceof Error?error.message:"No se pudo guardar la grabación.","error"));
  };
  function toggleRecording(){
    if(recording.current){finishRecording.current();return;}
    const stream=recordType?viewer.current?.stream(RECORDING_FPS):null;
    if(!stream||!recordType){say("Este navegador no puede grabar el lienzo del recorrido.","error");return;}
    try{recording.current=startRecording(stream,recordType);setRecordClock("0:00");}
    catch{for(const track of stream.getTracks())track.stop();say("El navegador no pudo empezar la grabación.","error");}
  }
  // The clock on the button, and the five-minute limit.
  useEffect(()=>{
    if(recordClock===null)return;
    const timer=setInterval(()=>{
      const active=recording.current;
      if(!active)return;
      if(active.elapsed()>=RECORDING_LIMIT_MS)finishRecording.current();
      else setRecordClock(recordingClock(active.elapsed()));
    },500);
    return ()=>clearInterval(timer);
  },[recordClock!==null]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the page while recording keeps what was recorded.
  useEffect(()=>()=>finishRecording.current(),[]);
  function startWalk(){
    stopTour();setPrismaStep(null);setQuick(null);
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
  const readViewer=useCallback(()=>viewer.current,[]);
  // Renderizar, Comparar and Descargar act on the Editar selection, or on the piece chosen in the dock.
  const findElement=useCallback((id:string)=>model?.elements.find(item=>item.id===id),[model]);
  const optionPieces=useMemo(()=>{
    if(!model)return [];
    if(assistant)return ids.map(id=>model.elements.find(item=>item.id===id)).filter((item):item is NonNullable<typeof item>=>!!item);
    return chosen?[chosen]:[];
  },[model,assistant,ids,chosen]);
  const touring=walk!=="idle";
  const stripShown=ready && !plan && !touring && !!serverNotes && !!storedVersion;
  const presentReason=!stripShown?(touring?"No disponible durante el recorrido":sampleOpen?SAMPLE_VIEWS:"Disponible en una versión guardada de un modelo 3D")
    :viewCount?"Presentar las vistas guardadas a pantalla completa":"Guarda una vista para presentarla";
  const exportReason=touring?"No disponible durante el recorrido":!ready?"Abre un modelo para exportar sus vistas"
    :plan?"Las vistas se exportan desde un modelo 3D":!stripShown?(sampleOpen?SAMPLE_VIEWS:"Disponible en una versión guardada de un modelo 3D"):undefined;
  function present(){
    // Guides point at controls the presentation hides: they end here.
    if(guide!=="off")stopTour();
    setQuick(null);setPrismaStep(null);
    if(tools.current)tools.current.release(()=>strip.current?.present());else strip.current?.present();
  }
  // Keyboard shortcuts of the workspace (DU-12). The presentation, the walk and modal dialogs keep their own keys.
  useEffect(()=>{
    if(!ready || touring || presenting)return;
    function onKey(event:KeyboardEvent){
      if(event.defaultPrevented)return;
      const action=shortcutFor({key:event.key,ctrl:event.ctrlKey,meta:event.metaKey,alt:event.altKey,shift:event.shiftKey,repeat:event.repeat});
      if(!action || !shortcutAllowed(event.target,action))return;
      // Without saved views the arrows keep their usual job (panning the canvas, scrolling).
      if(action.kind==="view" && !strip.current)return;
      let note:string|undefined;
      if(action.kind==="help")setShortcutsOpen(true);
      else if(action.kind==="tool"){
        const reason=tools.current?tools.current.run(action.tool):"Las herramientas aparecen con el modelo abierto";
        note=reason?toolNotice(action.tool,reason):undefined;
      }
      else if(action.kind==="version")note=rail.current?rail.current.open(action.position):"Las versiones están en los archivos guardados de un proyecto";
      else if(action.kind==="home")viewer.current?.fit();
      else note=strip.current?.step(action.step);
      event.preventDefault();event.stopPropagation();
      if(note)say(note);
    }
    window.addEventListener("keydown",onKey,true);
    return ()=>window.removeEventListener("keydown",onKey,true);
  },[ready,touring,presenting,say]);
  return <NotesContext.Provider value={serverNotes}><main className="workspace" data-walk={touring?"on":undefined} data-guide={ready?guide:"off"} data-quick={ready && quick?quick:undefined} data-plan={plan || undefined} data-stored={serverNotes && storedVersion?"":undefined}>
    <ViewerHeader returnHref={returnHref} returnLabel={returnLabel} projectName={storedVersion || proposal?projectName:undefined}
      fileName={model?.name || "Visor de modelos"} pending={!model} meta={model?(plan?"Plano 2D":"Vista 3D")+" · "+model.schema:undefined}
      badge={proposal && showingInitial?{label:proposal.label,detail:proposal.description}:undefined}
      onFile={file=>void open(file)} input={input} openDisabled={touring || (!viewer.current && !!error)} inert={presenting}
      exportMenu={<ExportMenu disabledReason={exportReason} viewCount={viewCount} onNotice={say} stored={!!storedVersion && !proposal}
        context={()=>{const list=strip.current?.snapshot();return list && model?{views:list.views,project:projectName,file:model.name,version:revision?.label,stored:storedVersion}:null;}}
        camera={{pose:readPose,apply:next=>applyPose(next),capture:()=>viewer.current?.capture("png",EXPORT_MAX_SIDE)??null}}
        stage={()=>container.current?.closest<HTMLElement>(".stage")??null}/>}
      present={{ref:presentButton,disabled:!stripShown || !viewCount,title:presentReason,onClick:present}}
      help={{ref:helpButton,disabled:!ready || touring,onClick:()=>setGuide("welcome")}}
      onClose={model && !touring?closeModel:undefined}/>
    <div className={"workarea " + (panel?"":"collapsed")}>
      <aside id="explorer" hidden={!panel} inert={!!status || presenting} aria-busy={!!status}>{assistant && ready && viewer.current && model?
       <SelectionAssistant working={optionsWorking} viewer={viewer.current} scope={serverNotes?storedVersion:undefined} elements={model.elements} ids={ids} grouping={grouping} onGroup={()=>setGrouping(!grouping)} onPick={selectForDesign} onRemove={id=>{setIds(ids.filter(i=>i!==id));setColor(null);}} color={color} onColor={setColor} fold={()=>showExplorer(false)}
        onGuide={startPrismaTour} onFrame={()=>advancePrisma("frame","preview")} onExport={()=>advancePrisma("export","edit-package")} onMaskGuide={startMaskGuide}
        onMaskPrepared={()=>setPrismaStep(step=>step==="edit-package"||step==="edit-save"?"edit-import":step)}
        onMaskImported={()=>setPrismaStep(step=>step==="edit-import"||step==="edit-package"?"edit-save":step)}
        onMaskSaved={()=>setPrismaStep(step=>step==="edit-save"?"done":step)}/>:
       <Explorer scope={serverNotes ? storedVersion : undefined} tab={tab} changeTab={setTab} onNoteSaved={()=>{if(!paused)setGuide(step=>step==="note"?"review":step);}} key={(serverNotes?"server:":"local:")+(model?.versionId??model?.name)} version={model?.versionId ?? (serverNotes ? "server" : undefined)} elements={model?.elements || []} loading={!!status && !model} selected={chosen} drawing={model?.drawing} drawingName={model?.name} locate={(id,preview)=>{pick(id);if(preview && guide!=="select")setTab("reading");viewer.current?.locate(id);}}/>}<SidebarWidth/></aside>
      <section className="stage" data-plan={plan || undefined} aria-label={plan?"Mesa de planos":"Modelo 3D"}>
        {!touring && <div className="stagebar"><button className="explorer-toggle" aria-label={panel?"Ocultar explorador":"Mostrar explorador"} aria-expanded={panel} aria-controls="explorer" onClick={()=>showExplorer(!panel)}><SidebarSimpleIcon/></button><span>{plan?"Plano 2D":"Vista 3D"}</span>
          {model && <><small>{model.schema}</small><button className="close" aria-label="Cerrar modelo" onClick={closeModel}><XIcon/></button></>}
        </div>}
        <div className="view" style={{visibility:ready?"visible":"hidden"}} data-ready={ready || undefined} ref={container}/>
        {ready && !plan && walkScene && <SceneWalkBar scene={walkScene} onReset={resetScene}
          base={toolScope?optionsPath(toolScope.project,toolScope.version):undefined} offReason={sampleReason} signIn={sampleSignIn}
          capture={()=>viewer.current?.capture("jpeg")??null}/>}
        {status || settling ? <ModelPreparing phase={status || ENTRY_SETTLING_PHASE} stage={entered && engine?"model":"viewer"} detail={opening}>
            {engine && status && <button type="button" onClick={()=>{request.current?.abort();setStatus("");setHolding(false);}}>Cancelar</button>}
          </ModelPreparing>
          : !ready && <div className="feedback" role="status" data-kind={error?"error":"empty"}>
          {error ? <CubeIcon size={32}/> : <EmptyArt width={220}/>}<h2>{error?"No se pudo abrir":"Abrir un modelo"}</h2>
          {error ? <p>{error}</p> : <p>Sube un IFC, DWG, RVT, FBX u OBJ de tu equipo, o recorre el edificio de ejemplo.</p>}
          {failure && <StoredPreview failure={failure} stored={proposal?undefined:storedVersion}/>}
          <div>{viewer.current ? <><button onClick={()=>input.current?.click()}>Elegir archivo</button>
            <button onClick={()=>model?setError(""):open(null)}>{model?"Volver al modelo":"Explorar ReStage"}</button></> :
            <button onClick={()=>{setError("");setStatus("Iniciando visor…");setSession(s=>s+1);}}>Reintentar</button>}</div>
        </div>}
        {stripShown && storedVersion && <SceneStrip key={storedVersion.version} {...storedVersion}
          pose={readPose} apply={applyPose} capture={capturePicture} control={strip} onCount={setViewCount}
          deck={{title:projectName,file:model?.name??"",version:revision?.label,date:revision?.date}} explorer={{open:panel,toggle:()=>showExplorer(!panel)}}
          onPresentStart={presentStarted} onPresentEnd={presentEnded}/>}
        {ready && !touring && serverNotes && storedVersion && <VersionRail project={storedVersion.project} version={storedVersion.version} control={rail}
          compare={model?versions=><VersionCompare project={storedVersion.project} version={storedVersion.version} versions={versions} model={model}
            viewer={readViewer} selected={selected} locate={id=>{pick(id);viewer.current?.locate(id);}}/>:undefined}/>}
        <p className="visually-hidden" role="status">{notice?.tone==="info"?notice.text:""}</p>
        {notice && <p key={notice.at} className="workspace-toast" data-tone={notice.tone} role={notice.tone==="error"?"alert":undefined}
          aria-hidden={notice.tone==="error"?undefined:true}>{notice.text}</p>}
        {!plan && !touring && <div className="cube-host" hidden={!ready}><ViewCube flat={false} orient={view=>viewer.current?.orient(view)}/></div>}
        {touring && <p className="walk-hint" role="status" data-tone={walkError?"error":undefined}>{walkError||(walkLoading?<><Spinner size={12}/>{walkLoading}</>:null)||(walk==="mark"?"Elige un punto libre en el piso. Pulsa Intro para probar el centro.":<><span className="walk-keyboard">Arrastra para mirar · WASD o flechas para caminar</span><span className="walk-touch">Arrastra para mirar. Mantén pulsada una flecha para caminar.</span></>)}</p>}
        {/* The walk keeps the bottom bar (reference §1): RECORRIDO active, the version switch and a ghost «Salir». */}
        {touring && <div className="workspace-bars walk-bars">
          <span aria-hidden="true"/>
          <RovingToolbar label="Controles del recorrido" className="tool-bar walk-bar">
            <ModeButton icon={Footprints} label="Recorrido" aria-pressed={true} title="Salir del recorrido · Esc" onClick={stopWalk}/>
            {showingInitial && loadPrevious && walk==="active" && <><ToolSeparator/>
              <button type="button" data-tool="" className="tool-mode" aria-disabled={walkLoading?true:undefined} aria-pressed={walkOlder} title={walkLabels?"Ver «"+walkLabels.older+"» desde el mismo punto":"Ver la versión anterior desde el mismo punto"} onClick={()=>{if(!walkLoading)void compareWalk(true);}}>{walkLabels?.older??"Anterior"}</button>
              <button type="button" data-tool="" className="tool-mode" aria-disabled={walkLoading?true:undefined} aria-pressed={!walkOlder} title={walkLabels?"Volver a «"+walkLabels.newer+"»":"Volver a esta versión"} onClick={()=>{if(!walkLoading)void compareWalk(false);}}>{walkLabels?.newer??"Nueva"}</button>
            </>}
            {walk==="active" && recordType && <><ToolSeparator/>
              <button type="button" data-tool="" className="tool-mode walk-record" aria-pressed={recordClock!==null}
                aria-label={recordClock!==null?"Detener grabación":"Grabar recorrido"}
                title={recordClock!==null?"Detener y descargar el video (WebM)":"Grabar el recorrido en video (WebM, hasta 5 minutos)"} onClick={toggleRecording}>
                {recordClock!==null?<Square size={14} strokeWidth={2.4} aria-hidden="true"/>:<Circle size={14} strokeWidth={2.4} aria-hidden="true"/>}
                {recordClock!==null?<>Detener <span className="walk-record-clock">{recordClock}</span></>:"Grabar"}</button></>}
            <ToolSeparator/>
            <button type="button" data-tool="" className="walk-exit" title="Salir del recorrido · Esc" onClick={stopWalk}><X size={16} strokeWidth={2} aria-hidden="true"/>Salir</button>
          </RovingToolbar>
        </div>}
        {walk==="active" && <div className="walk-pad" aria-label="Dirección del recorrido">{([["forward","Adelante","↑"],["left","Izquierda","←"],["back","Atrás","↓"],["right","Derecha","→"]]).map(([direction,label,icon])=><button key={direction} data-direction={direction} aria-label={label}
          onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);viewer.current?.walkMove(direction,true);}}
          onPointerUp={()=>viewer.current?.walkMove(direction,false)}
          onLostPointerCapture={()=>viewer.current?.walkMove(direction,false)}>{icon}</button>)}</div>}
        {ready && !touring && model && <WorkspaceTools key={(serverNotes?"server:":"local:")+(model.versionId??model.name)} control={tools} viewer={readViewer} plan={plan}
          scope={toolScope} scopeReason={sampleReason} signIn={sampleSignIn} pieces={optionPieces} onWorking={setOptionsWorking}
          proposal={proposal && showingInitial?{renderReason:PROPOSAL_RENDER,compare:proposal.compare({elements:model.elements,viewer:readViewer,selected})}:undefined}
          edit={{on:assistant,grouping,sample:model.sample?SAMPLE_EDIT:undefined,nonIfc:model.sample || /^IFC/i.test(model.schema)?undefined:model.schema.split(" ")[0],changeLimit:changeLimitReason(openedBytes),reason:proposal && showingInitial?PROPOSAL_EDIT:prismaAvailable?undefined:"Editar necesita un modelo 3D (IFC, DWG 3D, FBX, OBJ o el ejemplo GLB); las propuestas de cambio solo funcionan con IFC",
            selection:ids,onSelection:next=>{setIds(next);setColor(null);},piece:findElement,onFocusPiece:setEditFocus,
            onEnter:enterEdit,onExit:exitEdit,onUngroup:()=>setGrouping(false)}}
          reviewOpen={reviewOpen} onCloseReview={()=>review.current?.close()}
          review={<DeliveryReview server={serverNotes && storedVersion?storedVersion:proposal && showingInitial?proposal.scope:undefined} control={review} onOpenChange={setReviewOpen} guided={guide==="review"&&!paused} onDownloaded={()=>{if(guide==="review"&&!paused){setGuide("done");rememberGuide();}}} key={(serverNotes?"server:":"local:")+(model.versionId??model.name)} model={model} locate={id=>{setPanel(true);pick(id);viewer.current?.locate(id);}}
            trigger={(toggle,anchor,open)=><ModeButton ref={anchor} icon={ListChecks} label="Revisar" aria-label="Revisar entrega" aria-haspopup="dialog" aria-expanded={open} aria-controls="tool-review" className="review-trigger" shortcut={TOOL_KEYS.review} onClick={toggle}/>}/>}
          walk={{reason:model.walk && prismaAvailable?undefined:model.sceneWalk && prismaAvailable?"Este modelo no tiene un piso propio: aplica una escena en Editar › Escena y recórrela sobre su suelo"
            :"Disponible en un modelo 3D con unidades verificables (IFC, DWG 3D o FBX)",
            sceneReason:model.sceneWalk && prismaAvailable?undefined:"Necesita un modelo 3D con unidades verificables (IFC, DWG 3D con unidad declarada o FBX); un OBJ no declara unidades",
            onStart:startWalk,onScene:showScene}}
          camera={<RovingToolbar label="Controles de la cámara" className="tools">
            {!plan && <><IconTool icon={Rotate3d} aria-label="Orbitar" aria-pressed={!pan} onClick={()=>{if(pan)togglePan();}}/>
            <IconTool icon={Hand} aria-label="Desplazar" aria-pressed={pan} onClick={()=>{if(!pan)togglePan();}}/><ToolSeparator/></>}
            <IconTool icon={Plus} aria-label="Acercar" onClick={()=>viewer.current?.zoom(1.25)}/>
            <IconTool icon={Minus} aria-label="Alejar" onClick={()=>viewer.current?.zoom(0.8)}/>
            <IconTool icon={SquareDashed} aria-label="Zoom ventana" title="Zoom ventana · arrastra un rectángulo, Esc para cancelar" aria-pressed={windowMode} onClick={()=>{setWindowMode(!windowMode);viewer.current?.windowZoom();}}/>
            <IconTool icon={Maximize} aria-label={plan?"Encuadrar plano":"Encuadrar modelo"} title="Extensión completa · doble clic central" onClick={()=>viewer.current?.extents()}/>
            <IconTool icon={House} aria-label="Restablecer cámara" title={plan?"Volver a la vista inicial del plano · Inicio":"Restablecer isométrica · Inicio"} onClick={()=>viewer.current?.fit()}/>
          </RovingToolbar>}/>}
      </section>
    </div>
    <dialog className="help-sheet" ref={helpDialog} aria-labelledby="help-title" onCancel={stopTour}>
      <h2 id="help-title">{guide==="done"?"Guía completada":"Empieza por aquí"}</h2>
      <p>{guide==="done"?"Abre el archivo .txt en tus descargas para leer tu observación junto a la referencia del modelo.":"El recorrido rápido te muestra lo esencial en tres pasos: elegir una pieza, editarla y recorrer el modelo. Las otras guías practican una revisión de entrega y la edición de piezas con Editar."}</p>
      {guide==="done"?<button onClick={stopTour}>Finalizar</button>:<><button className="help-primary" onClick={startQuickTour} disabled={!ready}>Recorrido rápido</button><button onClick={startTour} disabled={!ready}>Iniciar guía</button>{prismaAvailable && <button onClick={startPrismaTour}>Guía de Editar</button>}<button onClick={()=>{stopTour();setShortcutsOpen(true);}} aria-keyshortcuts="?" title="Atajos de teclado · ?">Atajos de teclado</button><button onClick={stopTour}>Ahora no</button></>}
      {model?.sample && <p><a href="/models/creditos.txt" target="_blank" rel="noreferrer">Créditos del modelo ReStage ↗</a></p>}
    </dialog>
    <ShortcutSheet open={shortcutsOpen} onClose={()=>setShortcutsOpen(false)} fallback={helpButton}/>
    {guide==="note" && !model?.versionId && <button className="guide-skip-note" onClick={()=>setGuide("review")}>Continuar sin nota local</button>}
    {ready && quick && guide==="off" && !prismaStep && <QuickTour step={quick} paused={quickPaused} onPause={()=>setQuickPaused(!quickPaused)}
      onBack={quick==="options"?()=>{setAssistant(false);setTab("reading");setQuick("select");}:undefined} onRestart={startQuickTour} onExit={()=>setQuick(null)}/>}
    {prismaAvailable && prismaStep && guide==="off" && <PrismaTour step={prismaStep} paused={prismaPaused} onPause={()=>setPrismaPaused(!prismaPaused)} onRestart={startPrismaTour} onExit={()=>setPrismaStep(null)}/>}
    {ready && (guide==="select"||guide==="note"||guide==="review") && <VisualTour phase={guide} selected={!!chosen} paused={paused} pause={()=>pauseTour(!paused)} restart={startTour} exit={stopTour} back={()=>{
      if(document.querySelector(".delivery-review[open],.review-popover:not([hidden])")){review.current?.close();return;}
      setPanel(true);setTab(guide==="review"?"properties":"reading");setGuide(guide==="review"?"note":"select");
    }}/>}
  </main></NotesContext.Provider>;
}
