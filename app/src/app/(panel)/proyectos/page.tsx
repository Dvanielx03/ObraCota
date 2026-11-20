import { ProjectIndex } from "@/modules/project/ui/project-index";
import { exampleCatalog } from "@/modules/project/infrastructure/example-catalog";

export default function Page() {
  return <ProjectIndex projects={exampleCatalog.list()}/>;
}
