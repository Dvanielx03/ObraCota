"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/core/auth/use-session";
import { createProject, listProjects } from "../application/manage-projects";
import type { OwnedProject } from "../domain/owned-project";
import { projectHttpRepository } from "../infrastructure/project-http-repository";

function ProjectList() {
  const [rows, setRows] = useState<OwnedProject[]>();
  const [version, reload] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    listProjects(projectHttpRepository).then(items => { if (active) setRows(items); })
      .catch(() => { if (active) setError("No se pudieron consultar tus proyectos."); });
    return () => { active = false; };
  }, [version]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const project = await createProject(projectHttpRepository, name);
      setRows(items => [project, ...(items || [])]); setName("");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el proyecto."); }
    finally { setBusy(false); }
  }
  return <section className="owned-projects"><h2>Mis proyectos</h2>
    {error && <p role="alert">{error}</p>}
    {rows === undefined ? (error ? <button onClick={() => { setError(""); reload(version + 1); }}>Reintentar</button> : <p role="status">Cargando proyectos…</p>)
      : <>{rows.length ? <ul>{rows.map(project =>
        <li key={project.id}><Link href={"/proyectos/" + project.id}>{project.name}</Link></li>)}</ul>
        : <p>Todavía no has creado proyectos.</p>}
        <form className="account-form" onSubmit={submit}>
          <label>Nombre del proyecto<input value={name} maxLength={120} required onChange={event => setName(event.target.value)}/></label>
          <button className="panel-action" disabled={busy}>{busy ? "Guardando…" : "Crear proyecto"}</button>
        </form></>}
  </section>;
}

export function OwnedProjects() {
  const { session, failed, retry } = useSession();
  if (session) return <ProjectList key={session.email}/>;
  if (session === undefined) return failed ? <p role="alert">No se pudo consultar tu cuenta. <button onClick={retry}>Reintentar</button></p> : <p role="status">Consultando sesión…</p>;
  return <p className="panel-note"><Link href="/ingresar">Inicia sesión</Link> o <Link href="/registro">crea una cuenta</Link> para guardar tus propios proyectos.</p>;
}
