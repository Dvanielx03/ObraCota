"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/core/auth/use-session";
import { HttpError } from "@/core/http/http-client";
import { PanelView } from "@/shared/ui/panel-view";
import type { OwnedProject } from "../domain/owned-project";
import { getProject } from "../application/manage-projects";
import { projectHttpRepository } from "../infrastructure/project-http-repository";

function Detail({ id }: { id: string }) {
  const [project, setProject] = useState<OwnedProject>();
  const [error, setError] = useState("");
  const [version, reload] = useState(0);
  useEffect(() => {
    let active = true;
    getProject(projectHttpRepository, id).then(row => { if (active) setProject(row); })
      .catch(e => { if (active) setError(e instanceof HttpError && e.status === 404 ? "Proyecto no encontrado." : "No se pudo abrir el proyecto."); });
    return () => { active = false; };
  }, [id, version]);
  return <PanelView project={false} title={project?.name || "Proyecto"}>
    {error ? <p role="alert">{error} <button onClick={() => { setError(""); reload(version + 1); }}>Reintentar</button></p>
      : project ? <section><h2>Archivos del proyecto</h2><p>Todavía no hay archivos. La carga de entregas se habilitará con el control de versiones.</p></section>
      : <p role="status">Cargando proyecto…</p>}
    <Link className="panel-action" href="/proyectos">Volver a proyectos</Link></PanelView>;
}
export function OwnedSummary({ id }: { id: string }) {
  const { session, failed, retry } = useSession();
  if (session) return <Detail key={session.email + id} id={id}/>;
  return <PanelView title="Proyecto" project={false}>{session === null ? <Link href="/ingresar">Iniciar sesión</Link>
    : failed ? <button onClick={retry}>Reintentar conexión</button> : <p role="status">Consultando sesión…</p>}</PanelView>;
}
