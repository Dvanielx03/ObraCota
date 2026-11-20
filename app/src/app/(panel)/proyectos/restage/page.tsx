import { openProject } from "@/modules/project/application/open-project";
import { exampleCatalog } from "@/modules/project/infrastructure/example-catalog";
import { ProjectSummary } from "@/modules/project/ui/project-summary";
import { notFound } from "next/navigation";

export default function Page() {
  const project = openProject(exampleCatalog, "restage");
  if (!project) notFound();
  return <ProjectSummary project={project}/>;
}
