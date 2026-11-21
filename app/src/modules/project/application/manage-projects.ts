import type { OwnedProjectRepository } from "../domain/owned-project";

export function listProjects(repository: OwnedProjectRepository) { return repository.list(); }
export function getProject(repository: OwnedProjectRepository, id: string) { return repository.get(id); }
export function createProject(repository: OwnedProjectRepository, value: string) {
  const name = value.trim();
  if (!name || name.length > 120) throw new Error("Escribe un nombre de hasta 120 caracteres.");
  return repository.create(name);
}
export function archiveProject(repository: OwnedProjectRepository, id: string, archived: boolean) {
  return repository.setArchived(id, archived);
}
