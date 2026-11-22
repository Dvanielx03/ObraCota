import type { Project } from "../domain/project";
import { GuideStrip } from "@/modules/guide/ui/guide-cards";
import { ProjectBoard } from "./project-board";

export function ProjectIndex({ projects }: { projects: readonly Project[] }) {
  return <ProjectBoard examples={projects} guides={<GuideStrip/>}/>;
}
