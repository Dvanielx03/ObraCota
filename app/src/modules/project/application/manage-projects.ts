import { normalizeProjectName, type OwnedProjectRepository } from "../domain/owned-project";

export function listProjects(repository: OwnedProjectRepository) { return repository.list(); }
export function getProject(repository: OwnedProjectRepository, id: string) { return repository.get(id); }
export function createProject(repository: OwnedProjectRepository, value: string) {
  return repository.create(normalizeProjectName(value));
}
export function renameProject(repository: OwnedProjectRepository, id: string, value: string) {
  return repository.rename(id, normalizeProjectName(value));
}
export function archiveProject(repository: OwnedProjectRepository, id: string, archived: boolean) {
  return repository.setArchived(id, archived);
}
