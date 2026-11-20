"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/core/auth/use-session";
import { PanelView } from "@/shared/ui/panel-view";
import { fileCatalog } from "../infrastructure/file-catalog";
import type { ProjectFile } from "../domain/project-file";
import { listProjectFiles } from "../application/list-project-files";
import { FileHistory } from "@/modules/model-version/ui/file-history";
import { storeVersion } from "@/modules/model-version/application/store-version";
import { versionRepository } from "@/modules/model-version/infrastructure/version-http";

function Library({project}:{project:string}) {
  const [files,setFiles] = useState<ProjectFile[]>();
  const [selected,select] = useState("");
  const [target,setTarget] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [generation,reload] = useState(0);
  const [status,setStatus] = useState("");
  useEffect(() => {
    let live = true;
    listProjectFiles(fileCatalog,project).then(rows => {
      if (!live) return;
      setFiles(rows); select(current => rows.some(f=>f.id===current)?current:rows[0]?.id || "");
    }).catch(e => { if(live) setError(e.message); });
    return () => { live=false; };
  },[project,generation]);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=event.currentTarget;
    const file=new FormData(form).get("original");
    if (!(file instanceof File)) return;
    setBusy(true); setStatus(""); setError("");
    try {
      const version=await storeVersion(versionRepository,project,file,target || undefined);
      select(version.fileId); reload(v=>v+1); form.reset(); setTarget("");
      setStatus("Versión " + version.revision + " guardada.");
    } catch(e) { setError(e instanceof Error?e.message:"No se pudo guardar el archivo."); }
    finally { setBusy(false); }
  }
  return <><Link href={"/proyectos/"+project}>Volver al proyecto</Link>
    {error && <p role="alert">{error} {!files && <button onClick={()=>{setError("");reload(v=>v+1);}}>Reintentar</button>}</p>}
    {files ? <div className="panel-columns"><section>
      <h2>Archivos del proyecto</h2>{files.length ? <ul className="file-list">{files.map(f=>
        <li key={f.id}><button aria-pressed={selected===f.id} onClick={()=>select(f.id)}>{f.name}</button></li>)}</ul> : <p>Todavía no hay entregas.</p>}
      <form className="account-form upload-form" onSubmit={upload}>
        {files.length>0 && <label>Guardar en<select disabled={busy} value={target} onChange={e=>setTarget(e.target.value)}>
          <option value="">Agrupar por nombre de archivo</option>{files.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
        <label>Archivo IFC o DWG<input type="file" name="original" accept=".ifc,.dwg" disabled={busy} required/></label>
        <p>Hasta 256 MiB. Cada entrega conserva su original.</p>
        <button className="panel-action" disabled={busy}>{busy?"Subiendo original…":"Guardar versión"}</button>
      </form><p role="status">{status}</p>
    </section>{selected && <FileHistory key={selected+generation} file={selected} project={project}/>}</div>
      : !error && <p role="status">Cargando archivos…</p>}</>;
}
export function FileLibrary({project}:{project:string}) {
  const {session,failed,retry}=useSession();
  return <PanelView title="Archivos y versiones" project={false}>{session ? <Library key={session.email+project} project={project}/>
    : session===null ? <Link href="/ingresar">Iniciar sesión</Link> : failed ? <button onClick={retry}>Reintentar conexión</button> : <p>Consultando sesión…</p>}</PanelView>;
}
