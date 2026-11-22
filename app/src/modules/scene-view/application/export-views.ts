import type { CameraPose } from "@/viewer/domain/viewer.port";
import { INDEX_NAME, archiveName, exportIndex, exportShots, pictureName, type ExportSource } from "../domain/view-export";
import { storedZip, type ZipEntry } from "../domain/stored-zip";

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
  const before = ports.pose();
  const shots = exportShots(views, source.onlyCurrent, before);
  if (!shots.length) throw new Error("No hay vistas guardadas que exportar.");
  const entries: ZipEntry[] = [];
  const pictures: { file: string; name: string }[] = [];
  try {
    for (const [index, shot] of shots.entries()) {
      if (signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError");
      progress(index + 1, shots.length);
      await ports.settle();
      // Apply and take the picture in one go, so an orbit in between cannot slip into it.
      if (shot.pose) ports.apply(shot.pose);
      const data = await ports.picture();
      const file = pictureName(index, shot.name);
      entries.push({ name: file, data });
      pictures.push({ file, name: shot.name });
    }
  } finally {
    if (before) ports.apply(before);
  }
  const exportedAt = now();
  entries.push({ name: INDEX_NAME, data: new TextEncoder().encode(exportIndex({ ...source, exportedAt }, pictures)) });
  return { name: archiveName(source.file), bytes: storedZip(entries, exportedAt), count: pictures.length };
}
