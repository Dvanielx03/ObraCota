"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteProject } from "../application/manage-projects";
import { projectHttpRepository } from "../infrastructure/project-http-repository";
import { useRef, useState } from "react";
import { Box, Clock, Files, GitCompareArrows, LogIn, MessageSquareText, SearchX } from "lucide-react";
import { EmptyState, PanelView } from "@/shared/ui/panel-view";
import { LoadingStatus } from "@/shared/ui/loading";
import { editedLabel } from "../domain/project-card";
import { ProjectCover, useProjectCover } from "./project-cover";
import { useProjectScope, type OverviewStatus } from "./project-scope";
import { SummaryLinks, type SummaryEntry } from "./summary-links";

function entries(base: string, overview: OverviewStatus): SummaryEntry[] {
  const ready = overview.status === "ready" ? overview : undefined;
  const latest = ready?.latest;
  const files = ready ? (ready.files === 1 ? "1 archivo" : ready.files + " archivos") : "";
  return [
    { key: "archivos", title: "Archivos y versiones", icon: Files, href: base + "/archivos",
      text: !ready ? "Originales IFC, DWG, RVT, FBX u OBJ y su historial" : latest ? files + " · última versión " + latest.revision : "Sube tu primer IFC, DWG, RVT, FBX u OBJ" },
    { key: "visor", title: "Visor", icon: Box, href: latest ? base + "/visor/" + latest.id : undefined,
      text: latest ? "Abrir la versión " + latest.revision + " · " + latest.name : "",
      reason: overview.status === "loading" ? "Buscando la última versión…" : "Sube una versión para abrirla en el visor" },
    { key: "cambios", title: "Cambios de diseño", icon: GitCompareArrows, href: base + "/cambios", text: "Propuestas sobre piezas IFC y planos DWG, con su revisión" },
    { key: "asistente", title: "Asistente", icon: MessageSquareText, href: base + "/asistente", text: "Preguntas sobre las fichas vinculadas" },
  ];
}

/** Summary of an owned project: cover on the left, its sections on the right. */
export function OwnedSummary({ id }: { id: string }) {
  const scope = useProjectScope();
  const project = scope?.kind === "owned" && scope.owned.status === "ready" ? scope.owned.project : undefined;
  const overview = scope?.kind === "owned" ? scope.overview : undefined;
  const latest = overview?.status === "ready" ? overview.latest : undefined;
  const cover = useProjectCover(project?.id, latest?.id);
  const [now] = useState(() => Date.now());
  if (!scope || scope.kind !== "owned") return null;
  const status = scope.owned.status;
  if (status === "guest") return <PanelView title="Resumen">
    <EmptyState heading="Inicia sesión para ver este proyecto" icon={<LogIn size={40} strokeWidth={1.5} aria-hidden="true"/>}>
      Los proyectos guardados solo se abren con la cuenta que los creó. <Link href="/ingresar">Entrar con tu cuenta</Link>
    </EmptyState></PanelView>;
  if (status === "missing") return <PanelView title="Resumen">
    <EmptyState heading="No encontramos este proyecto" icon={<SearchX size={40} strokeWidth={1.5} aria-hidden="true"/>}>
      Puede que se haya borrado o que pertenezca a otra cuenta. <Link href="/proyectos">Volver a proyectos</Link>
    </EmptyState></PanelView>;
  if (status === "error") return <PanelView title="Resumen">
    <div className="panel-empty"><h2 role="alert">No se pudo abrir el proyecto.</h2>
      <button type="button" className="panel-button-outline" onClick={scope.retry}>Volver a intentar</button></div></PanelView>;
  if (!project) return <PanelView title="Resumen"><LoadingStatus hidden>Cargando proyecto…</LoadingStatus>
    <div className="summary-layout" aria-hidden="true"><div className="project-skeleton"><span/><span/></div><div/></div></PanelView>;
  const edited = editedLabel(project.updatedAt, now);
  return <PanelView title="Resumen" lead="Lo último del proyecto y el acceso a cada sección.">
    <div className="summary-layout">
      <figure className="project-card summary-cover">
        <ProjectCover id={id} name={project.name} image={cover} imageAlt={latest ? "Vista guardada de la versión " + latest.revision : ""}/>
        <figcaption className="project-card-text">
          <h3>{latest ? "Versión " + latest.revision + " · " + latest.name : overview?.status === "loading" ? "Consultando versiones…" : "Sin versiones todavía"}</h3>
          {edited && <p><Clock size={11} strokeWidth={2.25} aria-hidden="true"/>{edited}</p>}
        </figcaption>
      </figure>
      <SummaryLinks entries={entries(scope.route.base, overview ?? { status: "loading" })}/>
    </div>
    <ProjectDeletion id={project.id} name={project.name}/>
  </PanelView>;
}

function ProjectDeletion({ id, name }: { id: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await deleteProject(projectHttpRepository, id);
      dialog.current?.close();
      router.replace("/proyectos");
    } catch {
      setError("No se pudo eliminar el proyecto. Inténtalo de nuevo.");
      setBusy(false);
    }
  }

  return <section className="project-deletion">
    <button type="button" className="panel-button-outline project-delete-trigger" onClick={() => {
      setError("");
      dialog.current?.showModal();
    }}>Eliminar proyecto</button>
    <dialog ref={dialog} className="project-delete-dialog" aria-labelledby="project-delete-title" aria-describedby="project-delete-description"
      onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="project-delete-title">Eliminar proyecto</h2>
      <p id="project-delete-description">Se eliminará «{name}». Esta acción no se puede deshacer.</p>
      {error && <p role="alert">{error}</p>}
      <div className="project-delete-actions">
        <button type="button" className="panel-button-outline" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>Cancelar</button>
        <button type="button" className="panel-button-outline project-delete-confirm" disabled={busy}
          onClick={() => void confirm()}>{busy ? "Eliminando…" : "Eliminar proyecto"}</button>
      </div>
    </dialog>
  </section>;
}
