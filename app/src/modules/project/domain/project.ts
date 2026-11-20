export interface Project {
  slug: string;
  name: string;
  preview: string;
  sourceFile: string;
  schema: string;
}
export interface ProjectCatalog {
  list(): readonly Project[];
}
