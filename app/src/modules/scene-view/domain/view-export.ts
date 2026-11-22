import type { CameraPose } from "@/viewer/domain/viewer.port";
import { PAGE_HEIGHT, PAGE_WIDTH, fitText, type PdfPage, type PdfText } from "./stored-pdf";

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

/** "Duplex_A_20110907.ifc" → "obracota-duplex-a-20110907-vistas.pdf" */
export function documentName(fileName: string): string {
  return archiveName(fileName).replace(/\.zip$/, ".pdf");
}

/** A picture of the PDF export: the JPEG, its size in pixels and the view it shows. */
export interface DocumentPicture { name: string; jpeg: Uint8Array; width: number; height: number }

const MARGIN = 40;

/**
 * Pages of the «Documento (PDF)» export, A4 landscape: a cover with the project, the file, the version, the date and
 * the list of views with their page, then one page per view with its name over the picture, fitted without distortion.
 */
export function documentPages(source: ExportSource, pictures: readonly DocumentPicture[]): PdfPage[] {
  const total = pictures.length + 1;
  const footer = (page: number): PdfText => ({ x: MARGIN, y: 22, size: 8, gray: true, text: "ObraCota · " + source.file + " · Página " + page + " de " + total });
  const width = PAGE_WIDTH - MARGIN * 2;
  const cover: PdfPage = { images: [], lines: [{ x1: MARGIN, y1: PAGE_HEIGHT - 132, x2: PAGE_WIDTH - MARGIN, y2: PAGE_HEIGHT - 132 }], texts: [
    { x: MARGIN, y: PAGE_HEIGHT - 64, size: 10, gray: true, text: "Vistas exportadas con ObraCota" },
    { x: MARGIN, y: PAGE_HEIGHT - 100, size: 26, bold: true, text: fitText(source.project ?? source.file, 26, width) },
    { x: MARGIN, y: PAGE_HEIGHT - 120, size: 11, gray: true, text: fitText([source.project ? source.file : undefined, source.version, exportDate(source.exportedAt)].filter(Boolean).join(" · "), 11, width) },
    { x: MARGIN, y: PAGE_HEIGHT - 162, size: 11, bold: true, text: "Contenido · " + (source.onlyCurrent ? "la vista que estaba en pantalla" : pictures.length === 1 ? "1 vista guardada" : pictures.length + " vistas guardadas") },
    footer(1),
  ] };
  // The list of views, two columns of up to 18 rows; more than that is summarised in a last line.
  const rows = 18, columns = 2, shown = Math.min(pictures.length, rows * columns);
  const column = width / columns;
  for (let index = 0; index < shown; index++) {
    const x = MARGIN + Math.floor(index / rows) * column, y = PAGE_HEIGHT - 190 - (index % rows) * 18;
    cover.texts.push({ x, y, size: 10, text: fitText(String(index + 1).padStart(2, "0") + "  " + pictures[index].name, 10, column - 60) },
      { x: x + column - 56, y, size: 10, gray: true, text: "pág. " + (index + 2) });
  }
  if (pictures.length > shown) cover.texts.push({ x: MARGIN, y: PAGE_HEIGHT - 190 - rows * 18, size: 10, gray: true, text: "y " + (pictures.length - shown) + " vistas más" });
  const top = PAGE_HEIGHT - 84, bottom = 40, box = { width, height: top - bottom };
  return [cover, ...pictures.map((picture, index): PdfPage => {
    const scale = Math.min(box.width / picture.width, box.height / picture.height);
    const w = picture.width * scale, h = picture.height * scale;
    return {
      texts: [
        { x: MARGIN, y: PAGE_HEIGHT - 50, size: 16, bold: true, text: fitText(String(index + 1).padStart(2, "0") + " · " + picture.name, 16, width) },
        { x: MARGIN, y: PAGE_HEIGHT - 68, size: 9, gray: true, text: fitText([source.project, source.file, source.version].filter(Boolean).join(" · "), 9, width) },
        footer(index + 2),
      ],
      images: [{ jpeg: picture.jpeg, pixelWidth: picture.width, pixelHeight: picture.height, x: MARGIN + (box.width - w) / 2, y: bottom + (box.height - h) / 2, width: w, height: h }],
    };
  })];
}
