"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Archive, ArchiveRestore, Box, Clock, Ellipsis, Layers, Pencil, Plus } from "lucide-react";
import { Spinner } from "@/shared/ui/loading";
import type { OwnedProject } from "../domain/owned-project";
import type { Project } from "../domain/project";
import { editedLabel } from "../domain/project-card";
import { CardMenu } from "./card-menu";
import { InlineName } from "./inline-name";
import { ProjectCover, useProjectCover } from "./project-cover";
import { fileCatalog } from "@/modules/model-file/infrastructure/file-catalog";
import { versionRepository } from "@/modules/model-version/infrastructure/version-http";
import { projectOverview } from "../application/project-overview";
import { versionCountLabel } from "../domain/project-card";

/** Number of stored versions of a project, for the card's count tag; undefined while unknown or on failure. */
function useVersionCount(id: string): number | undefined {
  const [count, setCount] = useState<{ id: string; value: number }>();
  useEffect(() => {
    let active = true;
    projectOverview(fileCatalog, versionRepository, id)
      .then(overview => { if (active) setCount({ id, value: overview.versions }); })
      .catch(() => { /* Without the count the card simply shows no tag. */ });
    return () => { active = false; };
  }, [id]);
  return count?.id === id ? count.value : undefined;
}

/** Owned project: picture or own gradient, name and date on a veil, and the "…" menu. */
export function OwnedCard({ project, now, busy, onRename, onArchive }: {
  project: OwnedProject; now: number; busy: boolean;
  onRename(name: string): void; onArchive(): void;
}) {
  const cover = useProjectCover(project.id);
  const versions = useVersionCount(project.id);
  const [menu, setMenu] = useState(false);
  // Opened with the keyboard, the menu focuses its first option; opened with the pointer, nothing is highlighted.
  const [keyboard, setKeyboard] = useState(false);
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const edited = editedLabel(project.updatedAt, now);
  const back = () => requestAnimationFrame(() => trigger.current?.focus());
  return <li className="project-item">
    <div className="project-card" data-active={menu || editing || undefined} data-archived={project.archived || undefined}>
      <ProjectCover id={project.id} name={project.name} image={cover}/>
      <Link className="project-card-link" href={"/proyectos/" + project.id} aria-label={project.name}
        tabIndex={editing ? -1 : undefined}/>
      <div className="project-card-text">
        {editing
          ? <InlineName className="project-card-input" initial={project.name}
              onSave={name => { setEditing(false); onRename(name); back(); }}
              onCancel={() => { setEditing(false); back(); }}/>
          : <h3 title={project.name}>{project.name}</h3>}
        {edited && <p><Clock size={11} strokeWidth={2.25} aria-hidden="true"/>{edited}</p>}
      </div>
      <button ref={trigger} type="button" className="project-card-menu" aria-label={"Opciones del proyecto " + project.name}
        aria-haspopup="menu" aria-expanded={menu} aria-controls={menu ? menuId : undefined} disabled={busy}
        aria-busy={busy || undefined} onClick={event => { setKeyboard(event.detail === 0); setMenu(open => !open); }}>
        <Ellipsis size={14} aria-hidden="true"/>
      </button>
      {/* The reference's count tag («N escenas»): here the stored versions of the project. */}
      {!!versions && <span className="project-card-tag"><Layers size={10} strokeWidth={2.25} aria-hidden="true"/>{versionCountLabel(versions)}</span>}
    </div>
    {menu && <CardMenu id={menuId} label={"Opciones de " + project.name} trigger={trigger} focusFirst={keyboard}
      onClose={restore => { setMenu(false); if (restore) trigger.current?.focus(); }}
      items={[
        { label: "Cambiar nombre", icon: <Pencil size={15} aria-hidden="true"/>, run: () => { setMenu(false); setEditing(true); } },
        project.archived
          ? { label: "Restaurar", icon: <ArchiveRestore size={15} aria-hidden="true"/>, run: () => { setMenu(false); onArchive(); } }
          : { label: "Archivar", icon: <Archive size={15} aria-hidden="true"/>, run: () => { setMenu(false); onArchive(); } },
      ]}/>}
  </li>;
}

/** The example project in "Para explorar": same card, real picture and an "Ejemplo" tag. */
export function ExampleCard({ project }: { project: Project }) {
  return <li className="project-item">
    <div className="project-card">
      <div className="project-cover" data-tone="0">
        <img className="project-cover-image" data-loaded="true" src={project.preview} alt="" loading="lazy" decoding="async"/>
        <span className="project-veil" aria-hidden="true"/>
      </div>
      <Link className="project-card-link" href={"/proyectos/" + project.slug} aria-label={"Abrir proyecto " + project.name}/>
      <div className="project-card-text">
        <h3>{project.name}</h3>
        <p><Box size={11} strokeWidth={2.25} aria-hidden="true"/>Proyecto de ejemplo · {project.schema}</p>
      </div>
      <span className="project-card-tag"><Layers size={10} strokeWidth={2.25} aria-hidden="true"/>Ejemplo</span>
    </div>
  </li>;
}

/** Dashed "new project" card (DU-07 = B): creates the project at once. */
export function NewProjectCard({ creating, onCreate }: { creating: boolean; onCreate(): void }) {
  return <li className="project-item">
    <button type="button" className="project-new-card" disabled={creating} aria-busy={creating || undefined} onClick={onCreate}>
      <span className="project-new-icon">{creating
        ? <Spinner size={16} strokeWidth={2.5}/>
        : <Plus size={16} strokeWidth={2.5} aria-hidden="true"/>}</span>
      <span className="project-new-label">{creating ? "Creando…" : "Nuevo proyecto"}</span>
    </button>
  </li>;
}

/** Placeholder cards while the list loads; the grid carries aria-busy and a hidden status. */
export function ProjectSkeletons({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <li key={index} className="project-item" aria-hidden="true">
    <div className="project-skeleton"><span/><span/></div>
  </li>)}</>;
}
