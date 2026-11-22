"use client";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import { Check, PanelLeft, Pencil, Plus, Trash2 } from "lucide-react";
import type { CameraPose } from "@/viewer/domain/viewer.port";
import { VIEW_LIMIT, VIEW_NAME_LIMIT, cleanViewName, nextViewName, viewNumber, type SceneView } from "../domain/scene-view";
import { startSlide } from "../domain/presentation";
import { sceneViewHttpRepository } from "../infrastructure/scene-view-http-repository";
import { makeThumbnail, screenRoom } from "../infrastructure/thumbnail-canvas";
import { ViewPresentation, type Deck } from "./view-presentation";
import { EmptyArt, LoadingStatus, Skeleton, Spinner } from "@/shared/ui/loading";
import { useThemedCapture } from "./themed-capture";

/** What the workspace can ask of the strip: the presentation, ↑/↓ and the list for the export. */
export interface SceneStripHandle {
  present(): void;
  /** Applies the next (1) or previous (−1) saved view. Returns a note when there is no view to move to. */
  step(delta: 1 | -1): string | undefined;
  snapshot(): { views: SceneView[]; current: string };
}

type Tone = "info" | "error";
/** Camera move between saved views (↑/↓ and the presentation); the viewer skips it with reduced motion. */
const MOVE_MS = 450;

/**
 * Saved camera views of the open version, as a column of 3:2 thumbnails on the left of the canvas.
 * `pose` reads the camera, `apply` moves it and `capture` takes a picture of the canvas;
 * the strip never touches the viewer itself.
 */
export function SceneStrip({ project, version, pose, apply, capture, control, deck, explorer, onCount, onPresentStart, onPresentEnd }: {
  project: string; version: string; pose: () => CameraPose | null; apply: (pose: CameraPose, duration?: number) => void;
  capture?: () => string | null; control?: Ref<SceneStripHandle>;
  /** The explorer dock of the workspace: its toggle heads the strip, above «+». */
  explorer?: { open: boolean; toggle: () => void };
  /** Cover of the presentation. */
  deck?: Deck;
  onCount?: (count: number) => void; onPresentStart?: () => void; onPresentEnd?: () => void;
}) {
  const repository = useMemo(() => sceneViewHttpRepository(project, version), [project, version]);
  const [views, setViews] = useState<SceneView[]>();
  const [current, setCurrent] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // A view being saved shows as a provisional thumbnail with a turning icon at the end of the list.
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: Tone }>({ text: "", tone: "info" });
  // Thumbnails taken in this session are shown straight from memory; older ones come from the server.
  const [local, setLocal] = useState<Record<string, string>>({});
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const say = (text: string, tone: Tone = "info") => setMessage({ text, tone });
  // After renaming, the keyboard goes back to the view once its button is on screen again.
  const [refocus, setRefocus] = useState("");
  useEffect(() => {
    if (!refocus || editing) return;
    list.current?.querySelector<HTMLButtonElement>("[data-view='" + refocus + "']")?.focus();
    setRefocus("");
  }, [refocus, editing, views]);
  // After deleting, the keyboard goes to "+" once it is enabled again: focusing a disabled button does nothing.
  const [focusAdd, setFocusAdd] = useState(false);
  useEffect(() => {
    if (!focusAdd || busy || addButton.current?.disabled) return;
    addButton.current?.focus();
    setFocusAdd(false);
  }, [focusAdd, busy]);
  useEffect(() => {
    let active = true;
    setViews(undefined); setCurrent(""); setEditing(""); say("");
    repository.list().then(rows => { if (active) setViews(rows); })
      .catch(() => { if (active) { setViews([]); say("No se pudieron cargar las vistas.", "error"); } });
    return () => { active = false; };
  }, [repository]);
  useEffect(() => { onCount?.(views?.length ?? 0); }, [views, onCount]);
  useEffect(() => () => onCount?.(0), [onCount]);
  async function run(task: () => Promise<void>, failure: string) {
    setBusy(true); say("");
    try { await task(); } catch (e) {
      if (e instanceof Error && e.message.startsWith("Escribe")) say(e.message, "error"); else say(failure, "error");
    } finally { setBusy(false); }
  }
  function save() {
    const camera = pose();
    if (!camera) { say("La cámara no está disponible ahora.", "error"); return; }
    // The picture is taken right away, with the same camera that is being saved.
    let picture: string | null = null;
    try { picture = capture?.() ?? null; } catch { picture = null; }
    const stage = root.current?.closest<HTMLElement>(".stage");
    const room = stage ? screenRoom(stage) : undefined;
    setSaving(true);
    requestAnimationFrame(() => list.current?.lastElementChild?.scrollIntoView({ block: "nearest" }));
    void run(async () => {
      say("Guardando la vista…");
      const thumbnail = picture ? await makeThumbnail(picture, room).catch(() => undefined) : undefined;
      const view = await repository.save(nextViewName(views || []), camera, thumbnail);
      if (thumbnail) setLocal(map => ({ ...map, [view.id]: thumbnail }));
      setViews(rows => [...(rows || []), view]); setCurrent(view.id);
      say("«" + view.name + "» guardada.");
    }, "No se pudo guardar la vista.").finally(() => setSaving(false));
  }
  function startRename(view: SceneView) { setDraft(view.name); setEditing(view.id); say(""); }
  function rename(event: FormEvent<HTMLFormElement>, view: SceneView) {
    event.preventDefault();
    void run(async () => {
      const name = cleanViewName(draft);
      if (name !== view.name) {
        const saved = await repository.rename(view.id, name);
        setViews(rows => rows?.map(row => row.id === saved.id ? saved : row));
      }
      setEditing(""); setRefocus(view.id);
    }, "No se pudo cambiar el nombre.");
  }
  // Deleting asks first, in a small modal dialog that names the view.
  const confirm = useRef<HTMLDialogElement>(null);
  const [doomed, setDoomed] = useState<SceneView>();
  const deleteTrigger = useRef<HTMLElement | null>(null);
  function askRemove(view: SceneView, trigger: HTMLElement) {
    deleteTrigger.current = trigger; setDoomed(view);
  }
  useEffect(() => { if (doomed && !confirm.current?.open) confirm.current?.showModal(); }, [doomed]);
  function closeConfirm(removing: boolean) {
    confirm.current?.close();
    setDoomed(undefined);
    if (!removing) requestAnimationFrame(() => deleteTrigger.current?.focus());
  }
  function remove(view: SceneView) {
    closeConfirm(true);
    void run(async () => {
      await repository.remove(view.id);
      setViews(rows => rows?.filter(row => row.id !== view.id));
      setLocal(map => { const next = { ...map }; delete next[view.id]; return next; });
      if (current === view.id) setCurrent("");
      say("«" + view.name + "» eliminada.");
    }, "No se pudo eliminar la vista.")
      // The thumbnail is gone: once the strip is usable again, the keyboard goes to "+".
      .then(() => setFocusAdd(true));
  }
  // Presentation (V-08): the stage becomes a full-screen dialog and the saved views become slides.
  // On leaving, the camera and the active thumbnail go back to what they were, so both agree.
  const [deckStart, setDeckStart] = useState<number | null>(null);
  const root = useRef<HTMLElement>(null);
  const before = useRef<{ pose: CameraPose | null; current: string }>({ pose: null, current: "" });
  const presenting = deckStart !== null && !!views?.length;
  const present = useCallback(() => {
    if (!views?.length || deckStart !== null) return;
    before.current = { pose: pose(), current };
    setDeckStart(startSlide(views, current)); say("");
    onPresentStart?.();
    root.current?.closest<HTMLElement>(".stage")?.requestFullscreen?.().catch(() => undefined);
  }, [views, current, pose, deckStart, onPresentStart]);
  const presentApply = useCallback((view: SceneView, animate: boolean) => apply(view, animate ? MOVE_MS : 0), [apply]);
  useEffect(() => {
    if (!presenting) return;
    const stage = root.current?.closest<HTMLElement>(".stage");
    stage?.setAttribute("data-presenting", "");
    // Leaving full screen from the browser (its own Esc) ends the presentation too.
    let entered = !!document.fullscreenElement;
    const change = () => { if (document.fullscreenElement) entered = true; else if (entered) setDeckStart(null); };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, [presenting]);
  useEffect(() => {
    if (presenting) return;
    const stage = root.current?.closest<HTMLElement>(".stage");
    if (!stage?.hasAttribute("data-presenting")) return;
    stage.removeAttribute("data-presenting");
    const { pose: previous, current: was } = before.current;
    const restore = () => { if (previous) apply(previous); };
    restore(); setCurrent(was);
    // The canvas gets its size back once full screen (or the fixed layer) is over: frame it again then.
    const again = () => requestAnimationFrame(() => requestAnimationFrame(restore));
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined).then(again);
    else again();
    onPresentEnd?.();
  }, [presenting, apply, onPresentEnd]);
  // A strip that goes away mid-presentation (model closed) leaves the stage as it was.
  useEffect(() => {
    const stage = root.current?.closest<HTMLElement>(".stage");
    return () => {
      if (!stage?.hasAttribute("data-presenting")) return;
      stage.removeAttribute("data-presenting");
      if (document.fullscreenElement === stage) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  // ↑/↓ in the workspace: the next or previous saved view, with the same short camera move.
  const step = useCallback((delta: 1 | -1): string | undefined => {
    if (!views) return "Las vistas guardadas aún se están cargando";
    if (!views.length) return "Guarda una vista para cambiar de vista con ↑ y ↓";
    const at = views.findIndex(view => view.id === current);
    const next = at < 0 ? (delta > 0 ? 0 : views.length - 1) : at + delta;
    if (next < 0 || next >= views.length) { say(delta > 0 ? "Ya estás en la última vista." : "Ya estás en la primera vista."); return undefined; }
    const view = views[next];
    apply(view, MOVE_MS); setCurrent(view.id);
    say("Vista " + viewNumber(next) + ": " + view.name + ".");
    list.current?.querySelector<HTMLElement>("[data-view='" + view.id + "']")?.scrollIntoView({ block: "nearest" });
    return undefined;
  }, [views, current, apply]);
  useImperativeHandle(control, () => ({ present, step, snapshot: () => ({ views: views ?? [], current }) }), [present, step, views, current]);
  const full = (views?.length ?? 0) >= VIEW_LIMIT;
  return <><section ref={root} className="scene-strip" aria-label="Vistas guardadas" hidden={presenting} aria-busy={views === undefined || busy}>
    {explorer && <button type="button" className="scene-explorer explorer-toggle" aria-label={explorer.open ? "Ocultar explorador" : "Mostrar explorador"}
      aria-expanded={explorer.open} aria-controls="explorer" title={explorer.open ? "Ocultar el explorador de piezas" : "Mostrar el explorador de piezas"} onClick={explorer.toggle}>
      <PanelLeft size={16} strokeWidth={2} aria-hidden="true"/></button>}
    <button ref={addButton} type="button" className="scene-add" aria-label="Guardar vista" disabled={busy || !views || full}
      title={full ? "Esta versión ya tiene " + VIEW_LIMIT + " vistas." : "Guardar la vista actual"} onClick={save}>
      <Plus size={16} strokeWidth={2} aria-hidden="true"/></button>
    {views === undefined ? <>
        <LoadingStatus hidden>Cargando vistas…</LoadingStatus>
        <div className="scene-skeleton" aria-hidden="true"><Skeleton shape="thumb"/><Skeleton shape="thumb"/><Skeleton shape="thumb"/></div>
      </>
      : !views.length && !saving ? <div className="scene-empty-state"><EmptyArt width={84}/><p className="scene-empty">Encuadra el modelo y guarda la vista para volver a ella.</p></div>
      : <ul ref={list}>{views.map((view, index) => <li key={view.id} data-current={current === view.id || undefined} data-editing={editing === view.id || undefined}>
        <div className="scene-thumb">
          <button type="button" className="scene-apply" data-view={view.id} aria-pressed={current === view.id} title={view.name}
            onClick={() => { apply(view); setCurrent(view.id); say(""); }}
            onDoubleClick={() => { if (!busy) startRename(view); }}>
            <ViewPicture view={view} number={viewNumber(index)} local={local[view.id]} load={repository.thumbnail}/>
            <span className="visually-hidden">{view.name}</span>
          </button>
          {editing !== view.id && <>
            <button type="button" className="scene-badge scene-delete" aria-label={"Eliminar " + view.name} title="Eliminar vista" disabled={busy}
              onClick={event => askRemove(view, event.currentTarget)}><Trash2 size={11} strokeWidth={2} aria-hidden="true"/></button>
            <button type="button" className="scene-badge scene-rename" aria-label={"Renombrar " + view.name} title="Renombrar vista · doble clic" disabled={busy}
              onClick={() => startRename(view)}><Pencil size={11} strokeWidth={2} aria-hidden="true"/></button>
          </>}
        </div>
        {editing === view.id && <form className="scene-rename-form" onSubmit={event => rename(event, view)}>
          <input aria-label={"Nombre de " + view.name} value={draft} maxLength={VIEW_NAME_LIMIT} required autoFocus
            onFocus={event => event.currentTarget.select()}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setEditing(""); setRefocus(view.id); } }}/>
          <button disabled={busy} aria-label="Guardar nombre" title="Guardar nombre"><Check size={14} strokeWidth={2.4} aria-hidden="true"/></button>
        </form>}
      </li>)}
        {saving && <li className="scene-pending" aria-hidden="true"><div className="scene-thumb"><Skeleton shape="thumb"/><Spinner size={16}/></div></li>}
      </ul>}
    <p className="scene-status" role="status" data-tone={message.tone}>{message.text}</p>
  </section>
  <dialog ref={confirm} className="scene-confirm" aria-labelledby="scene-confirm-title" aria-describedby="scene-confirm-text"
    onCancel={event => { event.preventDefault(); closeConfirm(false); }}>
    {doomed && <>
      <h2 id="scene-confirm-title">¿Eliminar «{doomed.name}»?</h2>
      <p id="scene-confirm-text">La vista y su miniatura se borran de esta versión. No se puede deshacer.</p>
      <div className="scene-confirm-actions">
        <button type="button" onClick={() => closeConfirm(false)}>Cancelar</button>
        <button type="button" className="scene-confirm-danger" onClick={() => remove(doomed)}>Eliminar</button>
      </div>
    </>}
  </dialog>
  {presenting && <ViewPresentation views={views!} deck={deck ?? { file: "" }} start={deckStart!} apply={presentApply} onExit={() => setDeckStart(null)}/>}</>;
}

/**
 * Picture of one view: the JPEG preview when there is one (fading in once loaded),
 * otherwise its number on a neutral background.
 */
function ViewPicture({ view, number, local, load }: {
  view: SceneView; number: string; local?: string; load: (id: string, signal?: AbortSignal) => Promise<Blob>;
}) {
  const [remote, setRemote] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (local || !view.hasThumbnail) return;
    const controller = new AbortController();
    let url: string | undefined;
    load(view.id, controller.signal)
      .then(blob => { if (controller.signal.aborted) return; url = URL.createObjectURL(blob); setRemote(url); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [view.id, view.hasThumbnail, local, load]);
  // On a dark canvas the light capture background follows the theme (see useThemedCapture).
  const source = useThemedCapture(local ?? remote);
  if (!source || failed) return <span className="scene-fallback" aria-hidden="true">{view.hasThumbnail && !failed ? "" : number}</span>;
  return <>
    <img src={source} alt="" draggable={false} data-loaded={loaded || undefined} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}/>
    <span className="scene-number" aria-hidden="true">{number}</span>
  </>;
}
