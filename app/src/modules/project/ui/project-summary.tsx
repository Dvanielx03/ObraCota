import Link from "next/link";
import type { Project } from "../domain/project";
import { PanelView } from "@/shared/ui/panel-view";

export function ProjectSummary({ project }: { project: Project }) {
  const base = "/proyectos/" + project.slug;
  return <PanelView title={project.name} trail="Resumen"><div className="panel-summary">
    <section><img className="panel-preview" src={project.preview} alt="Estructura del demostrador ReStage" width="1052" height="795"/>
      <div className="panel-caption-row"><span>Proyecto de ejemplo · {project.schema}</span><a href="/models/creditos.txt">Créditos del modelo</a></div>
      <Link className="panel-action" href={base + "/visor"}>Abrir visor →</Link></section>
    <div className="panel-facts">{[
      ["Archivos y versiones", project.sourceFile, "archivos"],
      ["Cambios de diseño", "Sin solicitudes registradas", "cambios"],
      ["Presupuesto", "Pendiente de cantidades y precios", "presupuesto"],
    ].map(([label, text, slug]) => <Link key={slug} href={base + "/" + slug}><h2>{label} ↗</h2><p>{text}</p></Link>)}</div>
  </div></PanelView>;
}
