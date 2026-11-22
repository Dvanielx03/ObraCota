import type { CameraPose } from "@/viewer/domain/viewer.port";

/** Name of the text file that lists what an export contains. */
export const INDEX_NAME = "indice.txt";
/** Longest side of an exported picture, in px. */
export const EXPORT_MAX_SIDE = 2048;
/** Name of a picture of the framing on screen when it is not a saved view. */
export const CURRENT_FRAMING = "Encuadre actual";

/** What the index says about where the pictures come from. */
export interface ExportSource {
  project?: string;
  file: string;
  /** "v2" */
  version?: string;
  exportedAt: Date;
  /** Only the framing on screen, or every saved view. */
  onlyCurrent: boolean;
}

export interface ExportedPicture { file: string; name: string }

/** ASCII, lowercase, dash-separated version of a name, safe as a file name everywhere. */
export function slug(text: string, fallback = "vista"): string {
  const value = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 48).replace(/-+$/, "");
  return value || fallback;
}

/** "Duplex_A_20110907.ifc" → "obracota-duplex-a-20110907-vistas.zip" */
export function archiveName(fileName: string): string {
  return "obracota-" + slug(fileName.replace(/\.[^./\\]+$/, ""), "modelo") + "-vistas.zip";
}

/** "01-fachada-norte.png": the number keeps the order of the strip. */
export function pictureName(index: number, name: string): string {
  return String(index + 1).padStart(2, "0") + "-" + slug(name) + ".png";
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** "21 nov 2026, 14:32" in local time, written by hand so every browser gives the same text. */
export function exportDate(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return when.getDate() + " " + MONTHS[when.getMonth()] + " " + when.getFullYear() + ", " + pad(when.getHours()) + ":" + pad(when.getMinutes());
}

/** Plain-text index of the archive (CRLF, so Notepad shows it as written). */
export function exportIndex(source: ExportSource, pictures: readonly ExportedPicture[]): string {
  const lines = ["Vistas exportadas con ObraCota", ""];
  if (source.project) lines.push("Proyecto: " + source.project);
  lines.push("Archivo: " + source.file);
  if (source.version) lines.push("Versión: " + source.version);
  lines.push("Fecha de exportación: " + exportDate(source.exportedAt));
  lines.push("Contenido: " + (source.onlyCurrent ? "solo la vista que estaba en pantalla" : "todas las vistas guardadas de la versión"));
  lines.push("", "Imágenes (" + pictures.length + "):");
  const width = Math.max(0, ...pictures.map((picture) => picture.file.length));
  for (const picture of pictures) lines.push(picture.file.padEnd(width + 3) + picture.name);
  return lines.join("\r\n") + "\r\n";
}

/**
 * Whether two camera poses show the same framing: positions and targets closer than a thousandth of
 * the visible height, and the same height within 0.1 %.
 */
export function samePose(a: CameraPose, b: CameraPose): boolean {
  if (!(a.span > 0) || !(b.span > 0) || Math.abs(a.span / b.span - 1) > 1e-3) return false;
  const limit = Math.max(a.span, b.span) * 1e-3;
  const near = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= limit;
  return near(a.position, b.position) && near(a.target, b.target);
}

/** One picture to take: a saved view to apply first, or the framing on screen (`pose` null). */
export interface ExportShot { name: string; pose: CameraPose | null }

/**
 * Pictures of an export, in the order of the strip. "Only the current view" keeps the framing on
 * screen and names it after the saved view it matches, if any.
 */
export function exportShots(views: readonly (CameraPose & { name: string })[], onlyCurrent: boolean, screen: CameraPose | null): ExportShot[] {
  if (!onlyCurrent) return views.map((view) => ({ name: view.name, pose: view }));
  const match = screen ? views.find((view) => samePose(view, screen)) : undefined;
  return [{ name: match?.name ?? CURRENT_FRAMING, pose: null }];
}
