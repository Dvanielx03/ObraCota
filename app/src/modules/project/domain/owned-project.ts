export interface OwnedProject { id: string; name: string; archived: boolean; updatedAt?: string }
export interface OwnedProjectRepository {
  remove(id: string): Promise<void>;
  list(): Promise<OwnedProject[]>;
  create(name: string): Promise<OwnedProject>;
  get(id: string): Promise<OwnedProject>;
  rename(id: string, name: string): Promise<OwnedProject>;
  setArchived(id: string, archived: boolean): Promise<OwnedProject>;
}

/** Cover picture of a project card. Null when the project has none yet. */
export interface ProjectCoverSource {
  load(id: string, signal: AbortSignal): Promise<Blob | null>;
}

/** Name given to a project created with one click (DU-07 = B). */
export const UNTITLED_PROJECT = "Proyecto sin título";
export const MAX_PROJECT_NAME = 120;

/** Trimmed name, or an error message the interface can show as is. */
export function normalizeProjectName(value: string): string {
  const name = value.trim();
  if (!name || name.length > MAX_PROJECT_NAME) throw new Error("Escribe un nombre de hasta " + MAX_PROJECT_NAME + " caracteres.");
  return name;
}
