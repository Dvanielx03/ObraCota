"use client";
import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, DraftingCompass } from "lucide-react";
import { byRevision, revisionLabel, revisionSummary, type ModelVersion } from "../domain/model-version";
import { versionRepository } from "../infrastructure/version-http";
import { LoadingStatus, Skeleton } from "@/shared/ui/loading";

/** Keys 1–9 of the workspace (DU-12) open the n-th revision of the rail. */
export interface VersionRailHandle {
  /** Opens the revision at `position` (1-based); returns a note when there is nothing to open. */
  open(position: number): string | undefined;
}

const versionHref = (project: string, id: string) => "/proyectos/" + encodeURIComponent(project) + "/visor/" + encodeURIComponent(id);

/**
 * Right-hand rail with every revision of the file that is open (v1, v2…). The open one is marked;
 * the others are links that open that revision in the viewer.
 */
export function VersionRail({ project, version, control }: { project: string; version: string; control?: Ref<VersionRailHandle> }) {
  const [versions, setVersions] = useState<ModelVersion[]>();
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    setVersions(undefined); setFailed(false);
    versionRepository.get(project, version, controller.signal)
      .then(open => versionRepository.list(project, open.fileId, controller.signal))
      .then(rows => { if (!controller.signal.aborted) setVersions(byRevision(rows)); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [project, version]);
  useImperativeHandle(control, () => ({
    open(position) {
      if (!versions) return failed ? "No se pudieron leer las versiones de este archivo" : "Las versiones aún se están cargando";
      const item = versions[position - 1];
      if (!item) return versions.length === 1 ? "Este archivo solo tiene la versión 1" : "Este archivo tiene " + versions.length + " versiones";
      if (item.id === version) return "La " + revisionLabel(item) + " ya está abierta";
      router.push(versionHref(project, item.id));
      return undefined;
    },
  }), [versions, failed, version, project, router]);
  // Without the list there is nothing to switch to; the viewer works the same.
  if (failed) return null;
  return <nav className="version-rail" aria-label="Versiones del archivo" aria-busy={!versions}>
    {versions === undefined
      ? <><LoadingStatus hidden>Cargando versiones…</LoadingStatus>
        <div className="version-skeleton" aria-hidden="true"><Skeleton/><Skeleton/><Skeleton/></div></>
      : <ol>{versions.map((item, index) => {
          const open = item.id === version;
          const Icon = item.format === "DWG" ? DraftingCompass : Box;
          const summary = revisionSummary(item);
          const key = index < 9 ? String(index + 1) : undefined;
          const hint = key ? "\nTecla " + key : "";
          return <li key={item.id}>
            <Link className="version-card" href={versionHref(project, item.id)} aria-keyshortcuts={key}
              aria-current={open ? "page" : undefined} aria-label={open ? summary + " (abierta)" : "Abrir " + summary.charAt(0).toLowerCase() + summary.slice(1)}
              title={(open ? summary + "\nEs la versión abierta." : summary + "\nLas vistas guardadas son de cada versión.") + hint}>
              <Icon size={12} strokeWidth={2.2} aria-hidden="true"/><span>{revisionLabel(item)}</span>
            </Link>
          </li>;
        })}</ol>}
  </nav>;
}
