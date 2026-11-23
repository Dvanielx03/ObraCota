import type { CameraPose } from "@/viewer/domain/viewer.port";
import type { ModelChange } from "@/modules/model-change/domain/model-change";
import type { ModelVersion } from "@/modules/model-version/domain/model-version";
import { INDEX_NAME, exportIndex, pictureName } from "../domain/view-export";
import { storedZip, type ZipEntry } from "../domain/stored-zip";
import { changeFileName, changeRecord, packageName, packageSummary, versionChanges, type PackagedChange } from "../domain/review-package";
import { shoot, type ExportPorts, type ExportResult } from "./export-views";

/** What the review package reads from the server besides the canvas. */
export interface PackagePorts extends ExportPorts {
  /** The stored version (revision, SHA-256) and its original, byte for byte. */
  version(): Promise<ModelVersion>;
  original(): Promise<File>;
  /** Design changes of the project; the package keeps the applied ones of this version. */
  changes(): Promise<ModelChange[]>;
}

/**
 * «Paquete de revisión (ZIP)» (R6/P-09): the original of the version, one PNG per saved view (or of the framing on
 * screen when there is none) with its index, and, when there are any, the design changes applied to the version
 * (recipe, report and cost in JSON) with RESUMEN.md in words. Named ObraCota-paquete-<proyecto>-v<n>.zip.
 */
export async function exportReviewPackage(
  views: readonly (CameraPose & { name: string })[],
  source: { project?: string; version: string },
  ports: PackagePorts,
  progress: (done: number, total: number) => void,
  signal?: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<ExportResult & { changes: number }> {
  const [version, original, changes] = await Promise.all([ports.version(), ports.original(), ports.changes()]);
  if (signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError");
  const onlyCurrent = views.length === 0;
  const taken = await shoot(views, onlyCurrent, ports, ports.picture, progress, signal);
  const exportedAt = now();
  const originalName = "original/" + original.name.replace(/[\\/:]/g, "_");
  const entries: ZipEntry[] = [{ name: originalName, data: new Uint8Array(await original.arrayBuffer()) }];
  const pictures = taken.map((shot, index) => ({ file: "vistas/" + pictureName(index, shot.name), name: shot.name }));
  taken.forEach((shot, index) => entries.push({ name: pictures[index].file, data: shot.picture }));
  entries.push({ name: "vistas/" + INDEX_NAME, data: new TextEncoder().encode(exportIndex(
    { project: source.project, file: version.name, version: "v" + version.revision, exportedAt, onlyCurrent },
    pictures.map((picture) => ({ ...picture, file: picture.file.slice("vistas/".length) })))) });
  const packaged: PackagedChange[] = versionChanges(changes, source.version)
    .map(({ change, relation }, index) => ({ change, relation, file: changeFileName(index, change) }));
  for (const { change, relation, file } of packaged) entries.push({ name: file, data: new TextEncoder().encode(changeRecord(change, relation)) });
  entries.push({ name: "RESUMEN.md", data: new TextEncoder().encode(packageSummary({
    project: source.project, file: version.name, revision: version.revision, sha256: version.sha256, uploadedAt: version.uploadedAt,
    original: originalName, pictures, onlyCurrent, changes: packaged, exportedAt,
  })) });
  return { name: packageName(source.project, version.revision), bytes: storedZip(entries, exportedAt), count: pictures.length, changes: packaged.length };
}
