"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/core/auth/use-session";
import { PanelView } from "@/shared/ui/panel-view";
import { BusyButton, EmptyArt, LoaderArt, LoadingStatus, Skeleton, SkeletonLines } from "@/shared/ui/loading";
import { fileCatalog } from "../infrastructure/file-catalog";
import type { ProjectFile } from "../domain/project-file";
import { listProjectFiles } from "../application/list-project-files";
import { FileHistory } from "@/modules/model-version/ui/file-history";
import { storeVersion } from "@/modules/model-version/application/store-version";
import { HEADER_BYTES, MODEL_ACCEPT, MODEL_UPLOAD_TEST_ID, headerProblem } from "../domain/file-header";
import { versionRepository } from "@/modules/model-version/infrastructure/version-http";

/** "2,3 MB" for the upload card. */
function sizeLabel(bytes: number) {
  return bytes >= 1048576 ? (bytes / 1048576).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " MB"
    : Math.max(1, Math.round(bytes / 1024)).toLocaleString("es-CO") + " KB";
}

/** The two columns of the page while the file list loads. */
function LibrarySkeleton() {
  return <div className="panel-columns" aria-hidden="true">
    <section className="library-skeleton"><Skeleton shape="line" width="44%" height={16}/>
      <div className="library-skeleton-rows"><Skeleton height={38}/><Skeleton height={38}/></div>
      <SkeletonLines count={2}/><Skeleton width={150} height={36}/></section>
    <section className="library-skeleton"><Skeleton shape="line" width="52%" height={16}/><SkeletonLines count={3}/><Skeleton width={190} height={36}/></section>
  </div>;
}

function Library({project}:{project:string}) {
  const [files,setFiles] = useState<ProjectFile[]>();
  const [selected,select] = useState("");
  const [target,setTarget] = useState("");
  // The original on its way: its name and size, for the upload card and the provisional version.
  const [uploading,setUploading] = useState<{name:string;size:number}|null>(null);
  const [error,setError] = useState("");
  const [generation,reload] = useState(0);
  const [status,setStatus] = useState("");
  const busy = !!uploading;
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
    setStatus(""); setError("");
    const problem=headerProblem(file.name,await file.slice(0,HEADER_BYTES).text(),file.size<HEADER_BYTES);
    if (problem) { setError(problem); return; }
    setUploading({name:file.name,size:file.size});
    try {
      const version=await storeVersion(versionRepository,project,file,target || undefined);
      select(version.fileId); reload(v=>v+1); form.reset(); setTarget("");
      setStatus("Versión " + version.revision + " guardada.");
    } catch(e) { setError(e instanceof Error?e.message:"No se pudo guardar el archivo."); }
    finally { setUploading(null); }
  }
  // The history of the open file gets a provisional row when the upload goes to that file.
  const selectedFile = files?.find(f=>f.id===selected);
  const pending = uploading && selectedFile && (target ? target===selected : selectedFile.name===uploading.name) ? uploading.name : undefined;
  return <><Link href={"/proyectos/"+project}>Volver al proyecto</Link>
    {error && <p role="alert">{error} {!files && <button onClick={()=>{setError("");reload(v=>v+1);}}>Reintentar</button>}</p>}
    {files ? <div className="panel-columns"><section>
      <h2>Archivos del proyecto</h2>{files.length ? <ul className="file-list">{files.map(f=>
        <li key={f.id}><button aria-pressed={selected===f.id} onClick={()=>select(f.id)}>{f.name}</button></li>)}</ul>
        : <div className="library-empty"><EmptyArt width={168}/><p>Todavía no hay entregas.</p></div>}
      <form className="account-form upload-form" onSubmit={upload}>
        {files.length>0 && <label>Guardar en<select disabled={busy} value={target} onChange={e=>setTarget(e.target.value)}>
          <option value="">Agrupar por nombre de archivo</option>{files.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
        <label>Archivo IFC, DWG, FBX u OBJ<input type="file" name="original" accept={MODEL_ACCEPT} disabled={busy} required data-testid={MODEL_UPLOAD_TEST_ID}/></label>
        <p>Hasta 256 MiB. Cada entrega conserva su original. Si el DWG de un fabricante solo trae sólidos ACIS, sube su FBX u OBJ para verlo en 3D.</p>
        <BusyButton className="panel-action" busy={busy} busyLabel="Subiendo original…" spinnerSize={14}>Guardar versión</BusyButton>
      </form>
      <div className="upload-status" role="status">
        {uploading ? <div className="upload-card"><LoaderArt name="upload" size={64} maxLoopMs={5000} className="loader-art-small"/>
            <div><p className="upload-card-title">Subiendo {uploading.name}</p>
              <p>{sizeLabel(uploading.size)} · Se guarda el original tal cual y se calcula su huella SHA-256.</p></div></div>
          : status && <div className="upload-card" data-done=""><LoaderArt key={status} name="done" size={64} className="loader-art-small"/>
            <div><p className="upload-card-title">{status}</p><p>Ábrela en el visor desde el historial de versiones.</p></div></div>}
      </div>
    </section>{selected && <FileHistory key={selected+generation} file={selected} project={project} pending={pending}/>}</div>
      : !error && <><LoadingStatus hidden>Cargando archivos…</LoadingStatus><LibrarySkeleton/></>}</>;
}
export function FileLibrary({project}:{project:string}) {
  const {session,failed,retry}=useSession();
  return <PanelView title="Archivos y versiones" project={false}>{session ? <Library key={session.email+project} project={project}/>
    : session===null ? <Link href="/ingresar">Iniciar sesión</Link> : failed ? <button onClick={retry}>Reintentar conexión</button>
    : <><LoadingStatus hidden>Consultando sesión…</LoadingStatus><LibrarySkeleton/></>}</PanelView>;
}
