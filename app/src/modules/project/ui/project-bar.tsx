"use client";
import Link from "next/link";
import { useRef, useState, type ComponentType } from "react";
import { Box, ChevronRight, Files, GitCompareArrows, LayoutDashboard, MessageSquareText, Pencil, type LucideProps } from "lucide-react";
import { InlineName } from "./inline-name";
import { useProjectScope, type ProjectScopeValue } from "./project-scope";
import { documentTitle, useDocumentTitle } from "@/shared/ui/document-title";
import { useDisabledReason } from "@/shared/ui/disabled-reason";

type Section = { slug: string; label: string; icon: ComponentType<LucideProps> };
const SECTIONS: readonly Section[] = [
  { slug: "", label: "Resumen", icon: LayoutDashboard },
  { slug: "archivos", label: "Archivos y versiones", icon: Files },
  { slug: "visor", label: "Visor", icon: Box },
  { slug: "cambios", label: "Cambios de diseño", icon: GitCompareArrows },
  { slug: "asistente", label: "Asistente", icon: MessageSquareText },
];

/** Where the "Visor" tab goes: the example viewer, the newest stored version, or nowhere yet. */
function viewerTarget(scope: ProjectScopeValue): { href?: string; reason: string } {
  if (scope.kind === "example") return { href: scope.route.base + "/visor", reason: "Abrir el modelo de ejemplo en el visor" };
  if (scope.owned.status === "guest") return { reason: "Inicia sesión para abrir el visor" };
  if (scope.overview.status === "loading") return { reason: "Buscando la última versión…" };
  if (scope.overview.status === "error") return { reason: "No se pudo consultar la última versión" };
  const latest = scope.overview.latest;
  return latest
    ? { href: scope.route.base + "/visor/" + latest.id, reason: "Abrir la versión " + latest.revision + " (" + latest.name + ") en el visor" }
    : { reason: "Sube una versión en «Archivos y versiones» para abrirla en el visor" };
}

function ProjectName({ scope }: { scope: ProjectScopeValue }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  if (scope.kind === "example") return <><h1 title={scope.project.name}>{scope.project.name}</h1><span className="project-bar-badge">Ejemplo</span></>;
  const owned = scope.owned;
  if (owned.status !== "ready") {
    const text = owned.status === "missing" ? "Proyecto no encontrado" : owned.status === "guest" || owned.status === "error" ? "Proyecto" : "";
    return text ? <h1>{text}</h1>
      : <h1 aria-busy="true"><span className="sr-only">Cargando proyecto…</span><span className="project-bar-skeleton" aria-hidden="true"/></h1>;
  }
  const name = saving || owned.project.name;
  const back = () => requestAnimationFrame(() => button.current?.focus());
  async function save(value: string) {
    if (scope.kind !== "owned") return;
    setEditing(false); setSaving(value); setError(""); back();
    try { await scope.rename(value); }
    catch (e) { setError(e instanceof Error && e.message.startsWith("Escribe") ? e.message : "No se pudo cambiar el nombre del proyecto."); }
    finally { setSaving(""); }
  }
  return <>
    <h1 title={editing ? undefined : name}>{editing
      ? <InlineName className="project-bar-input" initial={name} onSave={value => void save(value)} onCancel={() => { setEditing(false); back(); }}/>
      : name}</h1>
    {!editing && <button ref={button} type="button" className="project-bar-rename" aria-label="Renombrar proyecto" title="Renombrar"
      aria-disabled={saving ? true : undefined} aria-busy={saving ? true : undefined}
      onClick={() => { if (saving) return; setError(""); setEditing(true); }}>
      <Pencil size={14} aria-hidden="true"/></button>}
    {error && <span role="alert" className="project-bar-error">{error}</span>}
  </>;
}

/**
 * Second band inside a project (DU-08 = B): "Proyectos ›" and the project name, renamable in place
 * when the project is owned, and the sections as tabs that keep today's routes.
 */
/** Name of the project in the tab title, once it is known. */
function scopeName(scope: ProjectScopeValue | null): string | null {
  if (!scope) return null;
  if (scope.kind === "example") return scope.project.name;
  return scope.owned.status === "ready" ? scope.owned.project.name : null;
}

export function ProjectBar() {
  const scope = useProjectScope();
  const name = scopeName(scope);
  const section = scope ? SECTIONS.find(item => item.slug === scope.route.section)?.label : undefined;
  useDocumentTitle(name ? documentTitle(name, section) : null);
  if (!scope) return null;
  const viewer = viewerTarget(scope);
  return <ProjectBarContent scope={scope} viewer={viewer}/>;
}

function ProjectBarContent({ scope, viewer }: { scope: ProjectScopeValue; viewer: ReturnType<typeof viewerTarget> }) {
  const viewerOff = useDisabledReason(viewer.href ? undefined : viewer.reason);
  return <div className="panel-head project-bar">
    <div className="panel-head-title">
      <Link className="panel-crumb" href="/proyectos">Proyectos</Link>
      <ChevronRight className="panel-crumb-sep" size={20} aria-hidden="true"/>
      <ProjectName scope={scope}/>
    </div>
    <nav className="panel-tabs project-sections" aria-label="Secciones del proyecto">
      {SECTIONS.map(({ slug, label, icon: Icon }) => {
        const content = <><Icon size={14} aria-hidden="true"/>{label}</>;
        if (slug === "visor") return viewer.href
          ? <Link key={slug} className="panel-tab" href={viewer.href} title={viewer.reason}>{content}</Link>
          : <span key={slug} className="panel-tab" role="link" aria-disabled="true" tabIndex={0} title={viewer.reason}
            aria-describedby={viewerOff.describedBy}>{content}</span>;
        const href = slug ? scope.route.base + "/" + slug : scope.route.base;
        return <Link key={slug} className="panel-tab" href={href} aria-current={scope.route.section === slug ? "page" : undefined}>{content}</Link>;
      })}
    </nav>
    {viewerOff.note}
  </div>;
}
