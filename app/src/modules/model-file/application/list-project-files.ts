import type { FileCatalog } from "../domain/project-file";
export function listProjectFiles(repository: FileCatalog, project: string) { return repository.list(project); }
