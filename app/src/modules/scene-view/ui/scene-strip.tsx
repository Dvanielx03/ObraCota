"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BookmarkSimpleIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
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
  const full = (views?.length ?? 0) >= VIEW_LIMIT;
  return <section className="scene-strip" aria-label="Vistas guardadas">
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
    <p className="scene-status" role="status">{message}</p>
  </section>;
}
