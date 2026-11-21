export interface ModelVersion {
  id: string; fileId: string; revision: number; name: string; format: "IFC" | "DWG";
  byteSize: number; sha256: string; uploadedAt: string; uploadedBy: string; uploaderEmail: string;
}
export const MAX_ORIGINAL_BYTES = 256 * 1024 * 1024;
export interface VersionRepository {
  list(project: string, file: string): Promise<ModelVersion[]>;
  upload(project: string, file: File, fileId?: string): Promise<ModelVersion>;
  open(project: string, version: string, signal: AbortSignal): Promise<File>;
}
export interface VersionNotes {
  load(): Promise<Record<string, string>>;
  save(key: string, text: string, onlyIfAbsent?: boolean): Promise<void>;
}
