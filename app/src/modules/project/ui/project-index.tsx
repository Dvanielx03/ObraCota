import Link from "next/link";
import type { Project } from "../domain/project";
import { PanelView } from "@/shared/ui/panel-view";

export function ProjectIndex({ projects }: { projects: readonly Project[] }) {
  return <PanelView title="Proyectos" project={false}><h2 className="panel-caption">Disponibles para explorar</h2>
    {projects.map(project => <div key={project.slug} className="project-row">
      <img src={project.preview} alt="" width="120" height="80"/>
      <div><h2>{project.name}</h2><p>Proyecto de ejemplo</p></div>
      <Link className="panel-action" href={"/proyectos/" + project.slug}>Abrir proyecto →</Link>
    </div>)}
    <p className="panel-note">Podrás guardar tus propias obras cuando estén disponibles las cuentas de proyecto.</p></PanelView>;
}
