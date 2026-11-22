import type { CameraPose } from "@/viewer/domain/viewer.port";
import { INDEX_NAME, archiveName, documentName, documentPages, exportIndex, exportShots, pictureName, type DocumentPicture, type ExportSource } from "../domain/view-export";
import { storedZip, type ZipEntry } from "../domain/stored-zip";
import { storedPdf } from "../domain/stored-pdf";

/** What the export needs from the viewer and the browser. */
export interface ExportPorts {
  /** Camera on screen now, or null when it cannot be read. */
  pose(): CameraPose | null;
  /** Jumps to a pose (no transition). */
  apply(pose: CameraPose): void;
  /** PNG bytes of what the canvas shows now. */
  picture(): Promise<Uint8Array>;
  /** Lets the page paint (progress text) before the next picture. */
  settle(): Promise<void>;
}

export interface ExportResult { name: string; bytes: Uint8Array; count: number }

/**
 * Applies each saved view (or keeps the framing on screen) and takes its picture with `take`, then gives the camera
 * back the framing it had. `progress(done, total)` is called before each picture, starting at 1.
 */
async function shoot<T>(
  views: readonly (CameraPose & { name: string })[],
  onlyCurrent: boolean,
  ports: Omit<ExportPorts, "picture">,
  take: () => Promise<T>,
  progress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ name: string; picture: T }[]> {
  const before = ports.pose();
  const shots = exportShots(views, onlyCurrent, before);
  if (!shots.length) throw new Error("No hay vistas guardadas que exportar.");
  const taken: { name: string; picture: T }[] = [];
  try {
    for (const [index, shot] of shots.entries()) {
      if (signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError");
      progress(index + 1, shots.length);
      await ports.settle();
      // Apply and take the picture in one go, so an orbit in between cannot slip into it.
      if (shot.pose) ports.apply(shot.pose);
      taken.push({ name: shot.name, picture: await take() });
    }
  } finally {
    if (before) ports.apply(before);
  }
  return taken;
}

/**
 * Takes one PNG per saved view (or of the framing on screen), then gives the camera back the framing
 * it had and packs the pictures with an index into a stored ZIP. `progress(done, total)` is called
 * before each picture, starting at 1.
 */
export async function exportViews(
  views: readonly (CameraPose & { name: string })[],
  source: Omit<ExportSource, "exportedAt">,
  ports: ExportPorts,
  progress: (done: number, total: number) => void,
  signal?: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<ExportResult> {
  const taken = await shoot(views, source.onlyCurrent, ports, ports.picture, progress, signal);
  const entries: ZipEntry[] = taken.map((shot, index) => ({ name: pictureName(index, shot.name), data: shot.picture }));
  const pictures = taken.map((shot, index) => ({ file: entries[index].name, name: shot.name }));
  const exportedAt = now();
  entries.push({ name: INDEX_NAME, data: new TextEncoder().encode(exportIndex({ ...source, exportedAt }, pictures)) });
  return { name: archiveName(source.file), bytes: storedZip(entries, exportedAt), count: pictures.length };
}

/** What the PDF export needs from the viewer: like {@link ExportPorts}, with JPEG pictures and their size. */
export interface DocumentPorts extends Omit<ExportPorts, "picture"> {
  picture(): Promise<Omit<DocumentPicture, "name">>;
}

/**
 * «Documento (PDF)»: the same pictures as the ZIP, in JPEG, laid out as a cover with the list of views and one page
 * per view (A4 landscape).
 */
export async function exportViewsDocument(
  views: readonly (CameraPose & { name: string })[],
  source: Omit<ExportSource, "exportedAt">,
  ports: DocumentPorts,
  progress: (done: number, total: number) => void,
  signal?: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<ExportResult> {
  const taken = await shoot(views, source.onlyCurrent, ports, ports.picture, progress, signal);
  const exportedAt = now();
  const pictures = taken.map((shot) => ({ ...shot.picture, name: shot.name }));
  const pages = documentPages({ ...source, exportedAt }, pictures);
  const title = "Vistas · " + (source.project ? source.project + " · " : "") + source.file;
  return { name: documentName(source.file), bytes: storedPdf(pages, title, exportedAt), count: pictures.length };
}
