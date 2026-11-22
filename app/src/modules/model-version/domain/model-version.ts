export interface ModelVersion {
  id: string; fileId: string; revision: number; name: string; format: "IFC" | "DWG";
  byteSize: number; sha256: string; uploadedAt: string; uploadedBy: string; uploaderEmail: string;
}
export const MAX_ORIGINAL_BYTES = 256 * 1024 * 1024;
export interface VersionRepository {
  list(project: string, file: string, signal?: AbortSignal): Promise<ModelVersion[]>;
  get(project: string, version: string, signal?: AbortSignal): Promise<ModelVersion>;
  upload(project: string, file: File, fileId?: string): Promise<ModelVersion>;
  open(project: string, version: string, signal: AbortSignal): Promise<File>;
}
export interface VersionNotes {
  load(): Promise<Record<string, string>>;
  save(key: string, text: string, onlyIfAbsent?: boolean): Promise<void>;
}

/** Revisions of one file from the first to the latest, as the version rail lists them. */
export function byRevision(versions: readonly ModelVersion[]): ModelVersion[] {
  return [...versions].sort((a, b) => a.revision - b.revision);
}

/** Short label of a revision on the rail: "v1", "v2"… */
export function revisionLabel(version: Pick<ModelVersion, "revision">): string {
  return "v" + version.revision;
}

const day = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" });

/** "Versión 3 · 20 nov 2026 · subida por ana@obra.co" (tooltip and accessible name of a rail card). */
export function revisionSummary(version: Pick<ModelVersion, "revision" | "uploadedAt" | "uploaderEmail">): string {
  const date = new Date(version.uploadedAt);
  const when = Number.isNaN(date.getTime()) ? "" : " · " + day.format(date).replace(/\./g, "");
  return "Versión " + version.revision + when + " · subida por " + version.uploaderEmail;
}
