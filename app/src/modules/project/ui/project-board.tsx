"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Archive, FolderOpen, GalleryVerticalEnd } from "lucide-react";
import { useSession } from "@/core/auth/use-session";
import { PanelView } from "@/shared/ui/panel-view";
import { EmptyArt, LoadingStatus } from "@/shared/ui/loading";
import { archiveProject, createProject, listProjects, renameProject } from "../application/manage-projects";
import { UNTITLED_PROJECT, type OwnedProject } from "../domain/owned-project";
import type { Project } from "../domain/project";
import { projectHttpRepository } from "../infrastructure/project-http-repository";
import { ExampleCard, NewProjectCard, OwnedCard, ProjectSkeletons } from "./project-card";

type Tab = "active" | "archived";
const TAB_ORDER: readonly Tab[] = ["active", "archived"];

function Explore({ examples }: { examples: readonly Project[] }) {
  return <section className="panel-section" aria-labelledby="explore-title">
    <div className="panel-section-intro">
      <div><h2 id="explore-title">Para explorar</h2><p>Un edificio real publicado como dato abierto, listo para recorrer en el visor.</p></div>
    </div>
    <ul className="project-grid">{examples.map(project => <ExampleCard key={project.slug} project={project}/>)}</ul>
  </section>;
}

function Tabs({ tab, count, onChange }: { tab: Tab; count?: number; onChange(tab: Tab): void }) {
  const list = useRef<HTMLDivElement>(null);
  function arrows(event: KeyboardEvent<HTMLDivElement>) {
    const at = TAB_ORDER.indexOf(tab);
    const next = event.key === "ArrowRight" ? (at + 1) % TAB_ORDER.length
      : event.key === "ArrowLeft" ? (at + TAB_ORDER.length - 1) % TAB_ORDER.length
      : event.key === "Home" ? 0 : event.key === "End" ? TAB_ORDER.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(TAB_ORDER[next]);
    list.current?.querySelector<HTMLButtonElement>("[data-tab=" + TAB_ORDER[next] + "]")?.focus();
  }
  return <div className="panel-tabs" role="tablist" aria-label="Estado de los proyectos" ref={list} onKeyDown={arrows}>
    {TAB_ORDER.map(kind => <button key={kind} type="button" role="tab" id={"tab-" + kind} data-tab={kind}
      className="panel-tab" aria-selected={tab === kind} aria-controls="project-panel" tabIndex={tab === kind ? 0 : -1}
      onClick={() => onChange(kind)}>
      {kind === "active" ? <GalleryVerticalEnd size={14} aria-hidden="true"/> : <Archive size={14} aria-hidden="true"/>}
      {kind === "active" ? "Activos" + (count === undefined ? "" : " (" + count + ")") : "Archivados"}
    </button>)}
  </div>;
}

function Board({ examples, guides }: { examples: readonly Project[]; guides: ReactNode }) {
  const router = useRouter();
  const [rows, setRows] = useState<OwnedProject[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, reload] = useState(0);
  const [tab, setTab] = useState<Tab>("active");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [alert, setAlert] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => {
    let active = true;
    listProjects(projectHttpRepository)
      .then(items => { if (active) { setRows(items); setNow(Date.now()); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  // «Mi archivo» in the welcome lands here with ?nuevo=1: the project is created and its upload page opens directly.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || new URLSearchParams(window.location.search).get("nuevo") !== "1") return;
    started.current = true;
    void create();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function create() {
    setCreating(true); setAlert("");
    try {
      const project = await createProject(projectHttpRepository, UNTITLED_PROJECT);
      router.push("/proyectos/" + project.id + "/archivos");
    } catch { setAlert("No se pudo crear el proyecto. Inténtalo de nuevo."); setCreating(false); }
  }
  async function toggleArchived(project: OwnedProject) {
    setBusy(project.id); setAlert("");
    try {
      const saved = await archiveProject(projectHttpRepository, project.id, !project.archived);
      setRows(items => items?.map(item => item.id === saved.id ? saved : item));
      setNow(Date.now());
      // The card leaves this tab together with its menu button: keep the keyboard on the tab.
      requestAnimationFrame(() => document.getElementById("tab-" + tab)?.focus());
    } catch { setAlert("No se pudo " + (project.archived ? "restaurar" : "archivar") + " el proyecto."); }
    finally { setBusy(""); }
  }
  async function rename(project: OwnedProject, name: string) {
    setAlert("");
    setRows(items => items?.map(item => item.id === project.id ? { ...item, name } : item));
    try {
      const saved = await renameProject(projectHttpRepository, project.id, name);
      setRows(items => items?.map(item => item.id === saved.id ? saved : item));
      setNow(Date.now());
    } catch (error) {
      setRows(items => items?.map(item => item.id === project.id ? { ...item, name: project.name } : item));
      setAlert(error instanceof Error && error.message.startsWith("Escribe") ? error.message : "No se pudo cambiar el nombre del proyecto.");
    }
  }
  const shown = rows?.filter(row => row.archived === (tab === "archived")) ?? [];
  const activeCount = rows?.filter(row => !row.archived).length;
  const loading = rows === undefined && !failed;
  return <PanelView title="Proyectos" actions={<Tabs tab={tab} count={activeCount} onChange={setTab}/>}>
    <div id="project-panel" role="tabpanel" aria-labelledby={"tab-" + tab}>
      <h2 className="sr-only">Mis proyectos</h2>
      {alert && <p role="alert" className="panel-alert">{alert}</p>}
      {loading && <LoadingStatus hidden>Cargando proyectos…</LoadingStatus>}
      <ul className="project-grid" aria-busy={loading || undefined}>
        {tab === "active" && !failed && <NewProjectCard creating={creating} onCreate={() => void create()}/>}
        {failed ? <li className="project-state project-state-wide">
            <h3 role="alert">No se pudieron cargar tus proyectos.</h3>
            <button type="button" className="panel-button-outline" onClick={() => { setFailed(false); reload(attempt + 1); }}>Volver a intentar</button>
          </li>
          : loading ? <ProjectSkeletons count={tab === "active" ? 5 : 6}/>
          : shown.length ? shown.map(project => <OwnedCard key={project.id} project={project} now={now} busy={busy === project.id}
              onRename={name => void rename(project, name)} onArchive={() => void toggleArchived(project)}/>)
          : <li className={"project-state" + (tab === "archived" ? " project-state-wide" : " project-state-art")}>
              {tab === "active" ? <EmptyArt width={176}/> : <FolderOpen size={48} strokeWidth={1.5} aria-hidden="true"/>}
              {tab === "active"
                ? <><h3>Todavía no has creado proyectos.</h3><p>Pulsa «Nuevo proyecto» y sube tu primer IFC, DWG, RVT, FBX u OBJ.</p></>
                : <><h3>No hay proyectos archivados.</h3><p>Lo que archives se guarda aquí y se puede restaurar.</p></>}
            </li>}
      </ul>
      {tab === "active" && <Explore examples={examples}/>}
    </div>
    {guides}
  </PanelView>;
}

function Guest({ examples, guides, failed, retry }: { examples: readonly Project[]; guides: ReactNode; failed: boolean; retry(): void }) {
  return <PanelView title="Proyectos">
    <h2 className="sr-only">Mis proyectos</h2>
    <ul className="project-grid">
      {failed ? <li className="project-state project-state-wide">
          <h3 role="alert">No se pudo consultar tu cuenta.</h3>
          <button type="button" className="panel-button-outline" onClick={retry}>Volver a intentar</button>
        </li>
        : <li className="project-state project-state-wide">
          <FolderOpen size={48} strokeWidth={1.5} aria-hidden="true"/>
          <h3>Tus proyectos aparecerán aquí</h3>
          <p><Link href="/ingresar">Inicia sesión</Link> o <Link href="/registro">crea una cuenta</Link> para guardar tus propios proyectos.</p>
        </li>}
    </ul>
    <Explore examples={examples}/>
    {guides}
  </PanelView>;
}

export function ProjectBoard({ examples, guides }: { examples: readonly Project[]; guides?: ReactNode }) {
  const { session, failed, retry } = useSession();
  if (session) return <Board key={session.email} examples={examples} guides={guides}/>;
  if (session === null || failed) return <Guest examples={examples} guides={guides} failed={failed} retry={() => void retry()}/>;
  return <PanelView title="Proyectos">
    <LoadingStatus hidden>Cargando proyectos…</LoadingStatus>
    <ul className="project-grid" aria-busy="true"><ProjectSkeletons count={5}/></ul>
  </PanelView>;
}
