import { notFound } from "next/navigation";
import { openProject } from "@/modules/project/application/open-project";
import { exampleCatalog } from "@/modules/project/infrastructure/example-catalog";
import { ProjectFiles } from "@/modules/model-file/ui/project-files";

export default function Page() {
  const project = openProject(exampleCatalog, "restage");
  if (!project) notFound();
  return <ProjectFiles sourceFile={project.sourceFile} schema={project.schema}/>;
}
