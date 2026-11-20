"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { versionRepository } from "../infrastructure/version-http";
import type { ModelVersion } from "../domain/model-version";

export function FileHistory({ project, file }: {project: string; file: string}) {
  const [versions, setVersions] = useState<ModelVersion[]>();
  const [failed,setFailed] = useState(false);
  const [attempt,retry] = useState(0);
  useEffect(() => {
    let live = true;
    versionRepository.list(project,file).then(items => { if(live) setVersions(items); })
      .catch(() => { if(live) setFailed(true); });
    return () => { live=false; };
  },[project,file,attempt]);
  return <section className="file-history"><h2>Historial de versiones</h2>
    {failed ? <p role="alert">No se pudo leer el historial. <button onClick={() => { setFailed(false); retry(attempt+1); }}>Reintentar</button></p>
      : !versions ? <p role="status">Cargando historial…</p> : versions.map(v =>
        <article key={v.id}><h3>Versión {v.revision}</h3><p>{v.name}</p>
          <p>{v.format} · {new Intl.NumberFormat("es-CO").format(v.byteSize)} bytes<br/>
          {new Date(v.uploadedAt).toLocaleString("es-CO")} · {v.uploaderEmail}</p>
          <details><summary>Huella SHA-256</summary><code>{v.sha256}</code></details>
          <Link className="panel-action" href={`/proyectos/${project}/visor/${v.id}`}>Abrir versión {v.revision} en el visor</Link>
        </article>)}</section>;
}
