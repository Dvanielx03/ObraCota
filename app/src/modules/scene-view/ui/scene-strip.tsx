"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BookmarkSimpleIcon, CaretLeftIcon, CaretRightIcon, PencilSimpleIcon, PlayIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import type { CameraPose } from "@/viewer/domain/viewer.port";
import { VIEW_LIMIT, VIEW_NAME_LIMIT, cleanViewName, nextViewName, type SceneView } from "../domain/scene-view";
import { sceneViewHttpRepository } from "../infrastructure/scene-view-http-repository";

/**
 * Saved camera views of the open version, as a strip on the left of the canvas.
 * `pose` reads the camera and `apply` moves it; the strip never touches the viewer itself.
 */
export function SceneStrip({ project, version, pose, apply }: {
  project: string; version: string; pose: () => CameraPose | null; apply: (pose: CameraPose) => void;
}) {
  const repository = useMemo(() => sceneViewHttpRepository(project, version), [project, version]);
  const [views, setViews] = useState<SceneView[]>();
  const [current, setCurrent] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const list = useRef<HTMLUListElement>(null);
  // After renaming, the keyboard goes back to the view once its button is on screen again.
  const [refocus, setRefocus] = useState("");
  useEffect(() => {
    if (!refocus || editing) return;
    list.current?.querySelector<HTMLButtonElement>("[data-view='" + refocus + "']")?.focus();
    setRefocus("");
  }, [refocus, editing, views]);
  useEffect(() => {
    let active = true;
    setViews(undefined); setCurrent(""); setEditing(""); setMessage("");
    repository.list().then(rows => { if (active) setViews(rows); })
      .catch(() => { if (active) { setViews([]); setMessage("No se pudieron cargar las vistas."); } });
    return () => { active = false; };
  }, [repository]);
  async function run(task: () => Promise<void>, failure: string) {
    setBusy(true); setMessage("");
    try { await task(); } catch (e) { setMessage(e instanceof Error && e.message.startsWith("Escribe") ? e.message : failure); }
    finally { setBusy(false); }
  }
  function save() {
    const camera = pose();
    if (!camera) { setMessage("La cámara no está disponible ahora."); return; }
    void run(async () => {
      const view = await repository.save(nextViewName(views || []), camera);
      setViews(rows => [...(rows || []), view]); setCurrent(view.id);
      setMessage("«" + view.name + "» guardada.");
    }, "No se pudo guardar la vista.");
  }
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
  function remove(view: SceneView) {
    void run(async () => {
      await repository.remove(view.id);
      setViews(rows => rows?.filter(row => row.id !== view.id));
      if (current === view.id) setCurrent("");
      setMessage("«" + view.name + "» eliminada.");
    }, "No se pudo eliminar la vista.");
  }
  // Presentation: the stage goes full screen and the saved views become slides.
  const [slide, setSlide] = useState(-1);
  const root = useRef<HTMLElement>(null);
  const before = useRef<CameraPose | null>(null);
  const presentButton = useRef<HTMLButtonElement>(null);
  const presenting = slide >= 0 && !!views?.length;
  const shown = presenting ? views![Math.min(slide, views!.length - 1)] : undefined;
  function present() {
    if (!views?.length) return;
    before.current = pose();
    const start = Math.max(0, views.findIndex(view => view.id === current));
    setSlide(start); setMessage("");
    root.current?.closest<HTMLElement>(".stage")?.requestFullscreen?.().catch(() => undefined);
  }
  useEffect(() => {
    if (!shown) return;
    const stage = root.current?.closest<HTMLElement>(".stage");
    stage?.setAttribute("data-presenting", "");
    let frame = 0;
    // The canvas changes size when entering or leaving full screen: frame the view again once it has.
    const frameView = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => apply(shown)); };
    apply(shown); setCurrent(shown.id);
    const stop = () => setSlide(-1);
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); stop(); }
      else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSlide(index => (index + (event.key === "ArrowRight" ? 1 : -1) + views!.length) % views!.length);
      }
    };
    const screen = () => { if (document.fullscreenElement) frameView(); else if (entered) stop(); };
    let entered = !!document.fullscreenElement;
    const mark = () => { if (document.fullscreenElement) entered = true; screen(); };
    document.addEventListener("keydown", keys);
    document.addEventListener("fullscreenchange", mark);
    window.addEventListener("resize", frameView);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keys);
      document.removeEventListener("fullscreenchange", mark);
      window.removeEventListener("resize", frameView);
    };
  }, [shown, apply, views]);
  useEffect(() => {
    if (presenting) return;
    const stage = root.current?.closest<HTMLElement>(".stage");
    if (!stage?.hasAttribute("data-presenting")) return;
    stage.removeAttribute("data-presenting");
    const previous = before.current;
    const restore = () => { if (previous) apply(previous); };
    restore(); setCurrent("");
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined).then(() => requestAnimationFrame(restore));
    presentButton.current?.focus();
  }, [presenting, apply]);
  const full = (views?.length ?? 0) >= VIEW_LIMIT;
  const step = (delta: number) => setSlide(index => (index + delta + views!.length) % views!.length);
  return <><section ref={root} className="scene-strip" aria-label="Vistas guardadas" hidden={presenting}>
    <header><h2><BookmarkSimpleIcon aria-hidden="true"/>Vistas</h2>
      <button className="scene-save" disabled={busy || !views || full} onClick={save}
        title={full ? "Esta versión ya tiene " + VIEW_LIMIT + " vistas." : undefined}>
        <PlusIcon weight="bold" aria-hidden="true"/>Guardar vista</button></header>
    {views === undefined ? <p role="status">Cargando vistas…</p>
      : !views.length ? <p>Encuadra el modelo y guarda la vista para volver a ella.</p>
      : <ul ref={list}>{views.map((view, index) => <li key={view.id} data-current={current === view.id || undefined}>
        {editing === view.id
          ? <form onSubmit={event => rename(event, view)}>
              <input aria-label={"Nombre de " + view.name} value={draft} maxLength={VIEW_NAME_LIMIT} required autoFocus
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setEditing(""); } }}/>
              <button disabled={busy}>Guardar</button>
            </form>
          : <><button className="scene-apply" data-view={view.id} aria-pressed={current === view.id}
                onClick={() => { apply(view); setCurrent(view.id); setMessage(""); }}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{view.name}</button>
              <button className="scene-icon" aria-label={"Renombrar " + view.name} disabled={busy}
                onClick={() => { setDraft(view.name); setEditing(view.id); }}><PencilSimpleIcon aria-hidden="true"/></button>
              <button className="scene-icon" aria-label={"Eliminar " + view.name} disabled={busy} onClick={() => remove(view)}><TrashIcon aria-hidden="true"/></button></>}
      </li>)}</ul>}
    <button ref={presentButton} className="scene-present-open" disabled={!views?.length || busy} onClick={present}>
      <PlayIcon weight="fill" aria-hidden="true"/>Presentar</button>
    <p className="scene-status" role="status">{message}</p>
  </section>
  {shown && <div className="scene-present" role="group" aria-label="Presentación de vistas">
    <button aria-label="Vista anterior" disabled={views!.length < 2} onClick={() => step(-1)}><CaretLeftIcon aria-hidden="true"/></button>
    <p role="status"><b>{shown.name}</b><span>{views!.indexOf(shown) + 1} de {views!.length}</span></p>
    <button aria-label="Vista siguiente" disabled={views!.length < 2} onClick={() => step(1)}><CaretRightIcon aria-hidden="true"/></button>
    <button className="scene-present-close" onClick={() => setSlide(-1)}><XIcon aria-hidden="true"/>Salir</button>
  </div>}</>;
}
