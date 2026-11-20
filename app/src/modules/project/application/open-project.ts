import type { ProjectCatalog } from "../domain/project";

export function openProject(catalog: ProjectCatalog, slug: string) {
  return catalog.list().find(project => project.slug === slug);
}
