import type { Project } from "../domain/project";
import { PanelView } from "@/shared/ui/panel-view";
import { GuideStrip } from "@/modules/guide/ui/guide-cards";
import { ProjectBoard } from "./project-board";

export function ProjectIndex({ projects }: { projects: readonly Project[] }) {
  return <PanelView title="Proyectos" project={false}><ProjectBoard examples={projects}/><GuideStrip/></PanelView>;
}
