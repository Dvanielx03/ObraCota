"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { versionRepository } from "../infrastructure/version-http";
import type { ModelVersion } from "../domain/model-version";
import { LoadingStatus, Skeleton, SkeletonLines, Spinner } from "@/shared/ui/loading";

/** Placeholder for one version while the history loads: title, two lines and the open button. */
function VersionSkeleton() {
  return <article className="file-history-skeleton" aria-hidden="true">
    <Skeleton shape="line" width="38%" height={14}/><SkeletonLines count={2}/><Skeleton width={210} height={36}/>
  </article>;
}

/**
 * Revisions of one file, newest first. `pending` names an original being uploaded into this file:
 * it shows as a provisional row with a turning icon until the list reloads.
 */
export function FileHistory({ project, file, pending }: {project: string; file: string; pending?: string}) {
  const [versions, setVersions] = useState<ModelVersion[]>();
  const [failed,setFailed] = useState(false);
  const [attempt,retry] = useState(0);
  useEffect(() => {
    let live = true;
    versionRepository.list(project,file).then(items => { if(live) setVersions(items); })
      .catch(() => { if(live) setFailed(true); });
    return () => { live=false; };
  },[project,file,attempt]);
  const next = versions ? Math.max(0, ...versions.map(v => v.revision)) + 1 : undefined;
  return <section className="file-history" aria-busy={(!versions && !failed) || !!pending || undefined}><h2>Historial de versiones</h2>
    {pending && next && <article className="file-history-pending" aria-hidden="true">
      <h3><Spinner size={14}/>Versión {next}</h3><p>{pending} · subiendo…</p></article>}
    {failed ? <p role="alert">No se pudo leer el historial. <button onClick={() => { setFailed(false); retry(attempt+1); }}>Reintentar</button></p>
      : !versions ? <><LoadingStatus hidden>Cargando historial…</LoadingStatus><VersionSkeleton/><VersionSkeleton/></> : versions.map(v =>
        <article key={v.id}><h3>Versión {v.revision}</h3><p>{v.name}</p>
          <p>{v.format} · {new Intl.NumberFormat("es-CO").format(v.byteSize)} bytes<br/>
          {new Date(v.uploadedAt).toLocaleString("es-CO")} · {v.uploaderEmail}</p>
          <details><summary>Huella SHA-256</summary><code>{v.sha256}</code></details>
          <Link className="panel-action" href={`/proyectos/${project}/visor/${v.id}`}>Abrir versión {v.revision} en el visor</Link>
          {v.format.toUpperCase()==="IFC" && <p><Link href={`/proyectos/${project}/visor/${v.id}?panel=asistente`}>Abrir en Editar</Link></p>}
        </article>)}</section>;
}
