"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArchiveIcon, ArrowCounterClockwiseIcon, PlusIcon } from "@phosphor-icons/react";
import { useSession } from "@/core/auth/use-session";
import { archiveProject, createProject, listProjects } from "../application/manage-projects";
import type { OwnedProject } from "../domain/owned-project";
import type { Project } from "../domain/project";
import { editedLabel, initials } from "../domain/project-card";
import { projectHttpRepository } from "../infrastructure/project-http-repository";

type Tab = "active" | "archived";
const TABS: [Tab, string][] = [["active", "Activos"], ["archived", "Archivados"]];

function ExampleCard({ project }: { project: Project }) {
  return <li className="project-card">
    <img className="project-thumb" src={project.preview} alt="" width="320" height="200"/>
    <div className="project-card-body"><h3>{project.name}</h3><p>Proyecto de ejemplo · {project.schema}</p></div>
    <Link className="project-card-open" href={"/proyectos/" + project.slug}>Abrir proyecto →</Link>
  </li>;
}

function OwnedCard({ project, now, busy, toggle }: { project: OwnedProject; now: number; busy: boolean; toggle(): void }) {
  const Icon = project.archived ? ArrowCounterClockwiseIcon : ArchiveIcon;
  return <li className="project-card" data-archived={project.archived || undefined}>
    <div className="project-thumb project-initials" aria-hidden="true">{initials(project.name)}</div>
    <div className="project-card-body">
      <h3><Link className="project-card-link" href={"/proyectos/" + project.id}>{project.name}</Link></h3>
      <p>{editedLabel(project.updatedAt, now) || "Proyecto propio"}</p>
    </div>
    <button className="project-card-action" disabled={busy} onClick={toggle}
      aria-label={(project.archived ? "Restaurar " : "Archivar ") + project.name}>
      <Icon size={18} aria-hidden="true"/>{project.archived ? "Restaurar" : "Archivar"}
    </button>
  </li>;
}

function Board({ examples }: { examples: readonly Project[] }) {
  const [rows, setRows] = useState<OwnedProject[]>();
  const [version, reload] = useState(0);
  const [tab, setTab] = useState<Tab>("active");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [now, setNow] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    listProjects(projectHttpRepository).then(items => { if (active) { setRows(items); setNow(Date.now()); } })
      .catch(() => { if (active) setError("No se pudieron consultar tus proyectos."); });
    return () => { active = false; };
  }, [version]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create"); setFormError("");
    try {
      const project = await createProject(projectHttpRepository, name);
      setRows(items => [project, ...(items || [])]); setNow(Date.now()); setName(""); setTab("active");
      dialog.current?.close();
    } catch (e) { setFormError(e instanceof Error ? e.message : "No se pudo guardar el proyecto."); }
    finally { setBusy(""); }
  }
  async function toggle(project: OwnedProject) {
    setBusy(project.id); setError("");
    try {
      const saved = await archiveProject(projectHttpRepository, project.id, !project.archived);
      setRows(items => items?.map(item => item.id === saved.id ? saved : item));
      // The card leaves this tab, so its button disappears: keep the keyboard on the tab.
      tabs.current?.querySelector<HTMLButtonElement>("[aria-selected=true]")?.focus();
    } catch { setError("No se pudo " + (project.archived ? "restaurar" : "archivar") + " el proyecto."); }
    finally { setBusy(""); }
  }
  function arrows(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next: Tab = tab === "active" ? "archived" : "active";
    setTab(next);
    tabs.current?.querySelector<HTMLButtonElement>("[data-tab=" + next + "]")?.focus();
  }
  const count = (kind: Tab) => rows?.filter(row => row.archived === (kind === "archived")).length ?? 0;
  const shown = rows?.filter(row => row.archived === (tab === "archived")) ?? [];
  return <section className="project-board">
    <div className="project-toolbar">
      <div className="project-tabs" role="tablist" aria-label="Estado de los proyectos" ref={tabs} onKeyDown={arrows}>
        {TABS.map(([kind, label]) => <button key={kind} role="tab" id={"tab-" + kind} data-tab={kind} aria-selected={tab === kind}
          aria-controls="project-panel" tabIndex={tab === kind ? 0 : -1} onClick={() => setTab(kind)}>
          {label}<span>{rows ? count(kind) : "–"}</span></button>)}
      </div>
      <button className="project-new" onClick={() => { setFormError(""); dialog.current?.showModal(); }}>
        <PlusIcon size={18} weight="bold" aria-hidden="true"/>Nuevo proyecto</button>
    </div>
    <div id="project-panel" role="tabpanel" aria-labelledby={"tab-" + tab}>
      <h2 className="project-heading">Mis proyectos</h2>
      {error && <p role="alert">{error}</p>}
      {rows === undefined
        ? (error ? <button className="panel-action" onClick={() => { setError(""); reload(version + 1); }}>Reintentar</button> : <p role="status">Cargando proyectos…</p>)
        : shown.length ? <ul className="project-grid">{shown.map(project =>
            <OwnedCard key={project.id} project={project} now={now} busy={busy === project.id} toggle={() => toggle(project)}/>)}</ul>
        : <p className="project-empty">{tab === "active" ? "Todavía no has creado proyectos." : "No hay proyectos archivados."}</p>}
      {tab === "active" && <><h2 className="project-heading">Para explorar</h2>
        <ul className="project-grid">{examples.map(project => <ExampleCard key={project.slug} project={project}/>)}</ul></>}
    </div>
    <dialog className="project-dialog" ref={dialog} aria-labelledby="new-project-title">
      <form className="account-form" onSubmit={submit}>
        <h2 id="new-project-title">Nuevo proyecto</h2>
        <label>Nombre del proyecto<input value={name} maxLength={120} required autoFocus onChange={event => setName(event.target.value)}/></label>
        {formError && <p role="alert">{formError}</p>}
        <div className="project-dialog-actions">
          <button type="button" onClick={() => dialog.current?.close()}>Cancelar</button>
          <button className="project-new" disabled={busy === "create"}>{busy === "create" ? "Guardando…" : "Crear proyecto"}</button>
        </div>
      </form>
    </dialog>
  </section>;
}

export function ProjectBoard({ examples }: { examples: readonly Project[] }) {
  const { session, failed, retry } = useSession();
  if (session) return <Board key={session.email} examples={examples}/>;
  return <section className="project-board">
    {session === undefined
      ? (failed ? <p role="alert">No se pudo consultar tu cuenta. <button onClick={retry}>Reintentar</button></p> : <p role="status">Consultando sesión…</p>)
      : <p className="panel-note"><Link href="/ingresar">Inicia sesión</Link> o <Link href="/registro">crea una cuenta</Link> para guardar tus propios proyectos.</p>}
    <h2 className="project-heading">Para explorar</h2>
    <ul className="project-grid">{examples.map(project => <ExampleCard key={project.slug} project={project}/>)}</ul>
  </section>;
}
