import { Box, Files, GitCompareArrows, MessageSquareText } from "lucide-react";
import type { Project } from "../domain/project";
import { PanelView } from "@/shared/ui/panel-view";
import { SummaryLinks } from "./summary-links";

/** Summary of the example project: its picture on the left, its sections on the right. */
export function ProjectSummary({ project }: { project: Project }) {
  const base = "/proyectos/" + project.slug;
  return <PanelView title="Resumen" lead="Proyecto de ejemplo para probar el visor sin subir nada.">
    <div className="summary-layout">
      <div>
        <figure className="project-card summary-cover">
          <div className="project-cover" data-tone="0">
            <img className="project-cover-image" data-loaded="true" src={project.preview} alt="Estructura del demostrador ReStage" width="1052" height="795"/>
            <span className="project-veil" aria-hidden="true"/>
          </div>
          <figcaption className="project-card-text"><h3>{project.name}</h3><p>Proyecto de ejemplo · {project.schema}</p></figcaption>
        </figure>
        <p className="summary-caption"><a href="/models/creditos.txt">Créditos del modelo</a></p>
      </div>
      <SummaryLinks entries={[
        { key: "visor", title: "Visor", icon: Box, href: base + "/visor", text: "Abrir el modelo de ejemplo en pantalla completa" },
        { key: "archivos", title: "Archivos y versiones", icon: Files, href: base + "/archivos", text: project.sourceFile },
        { key: "cambios", title: "Cambios de diseño", icon: GitCompareArrows, href: base + "/cambios", text: "Sin solicitudes registradas" },
        { key: "asistente", title: "Asistente", icon: MessageSquareText, href: base + "/asistente", text: "Consulta fichas en un proyecto propio" },
      ]}/>
    </div>
  </PanelView>;
}
