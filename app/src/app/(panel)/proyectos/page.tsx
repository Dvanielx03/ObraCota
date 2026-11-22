import type { Metadata } from "next";
import { ProjectIndex } from "@/modules/project/ui/project-index";
import { exampleCatalog } from "@/modules/project/infrastructure/example-catalog";

export const metadata: Metadata = { title: "Proyectos · ObraCota" };

export default function Page() {
  return <ProjectIndex projects={exampleCatalog.list()}/>;
}
