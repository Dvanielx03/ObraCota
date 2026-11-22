/**
 * A small PDF 1.4 writer for the «Documento (PDF)» export: pages with text in the standard Helvetica fonts and
 * JPEG pictures, nothing else. Written by hand like `stored-zip.ts`, so the app takes no PDF library for a
 * document of a cover and one picture per view. Text uses WinAnsiEncoding, which covers Spanish (á, ñ, ¿, «, ·);
 * a character outside it is written as «?».
 */

/** A4 landscape, in points. */
export const PAGE_WIDTH = 842;
export const PAGE_HEIGHT = 595;

export interface PdfText { x: number; y: number; size: number; text: string; bold?: boolean; gray?: boolean }
/** A baseline JPEG and the box it fills on the page (points, origin at the bottom left). */
export interface PdfImage { jpeg: Uint8Array; pixelWidth: number; pixelHeight: number; x: number; y: number; width: number; height: number }
export interface PdfPage { texts: PdfText[]; images: PdfImage[]; lines?: { x1: number; y1: number; x2: number; y2: number }[] }

const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Bytes of `text` in WinAnsiEncoding, as a PDF literal string with `(`, `)` and `\` escaped. */
export function pdfString(text: string): number[] {
  const out = [0x28];
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    const byte = code < 0x80 ? code : code >= 0xa0 && code <= 0xff ? code : WIN_ANSI[code] ?? 0x3f;
    if (byte < 0x20) { out.push(0x20); continue; }
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c);
    out.push(byte);
  }
  out.push(0x29);
  return out;
}

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0) & 0xff);
const number = (value: number) => (Math.round(value * 100) / 100).toString();

/** Average width of a Helvetica character as a share of the font size: enough to cut a line before it overflows. */
const AVERAGE_WIDTH = 0.52;

/** `text` cut with «…» so it fits in `width` points at `size`. */
export function fitText(text: string, size: number, width: number): string {
  const room = Math.max(1, Math.floor(width / (size * AVERAGE_WIDTH)));
  return text.length <= room ? text : text.slice(0, Math.max(0, room - 1)).trimEnd() + "…";
}

/**
 * The bytes of a PDF with these pages. `title` goes to the document information. Every object offset of the
 * cross-reference table is exact, so readers open it without repairing it.
 */
export function storedPdf(pages: readonly PdfPage[], title: string, created = new Date()): Uint8Array {
  if (!pages.length) throw new Error("Un PDF necesita al menos una página.");
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (bytes: number[] | Uint8Array) => { chunks.push(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)); length += bytes.length; };
  const object = (id: number, body: (number[] | Uint8Array)[]) => {
    offsets[id] = length;
    push(ascii(id + " 0 obj\n"));
    for (const part of body) push(part);
    push(ascii("\nendobj\n"));
  };
  push(ascii("%PDF-1.4\n"));
  push([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

  // 1 catalog, 2 page tree, 3 and 4 fonts, 5 info; then per page: page, content and its images.
  const ids = { catalog: 1, tree: 2, regular: 3, bold: 4, info: 5 };
  let next = 6;
  const layout = pages.map((page) => {
    const pageId = next++, content = next++;
    const images = page.images.map(() => next++);
    return { pageId, content, images };
  });

  object(ids.catalog, [ascii("<< /Type /Catalog /Pages 2 0 R >>")]);
  object(ids.tree, [ascii("<< /Type /Pages /Kids [" + layout.map((item) => item.pageId + " 0 R").join(" ") + "] /Count " + pages.length + " >>")]);
  object(ids.regular, [ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")]);
  object(ids.bold, [ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")]);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = "D:" + created.getFullYear() + pad(created.getMonth() + 1) + pad(created.getDate()) + pad(created.getHours()) + pad(created.getMinutes()) + pad(created.getSeconds());
  object(ids.info, [ascii("<< /Title "), pdfString(title), ascii(" /Producer (ObraCota) /CreationDate (" + stamp + ") >>")]);

  pages.forEach((page, index) => {
    const { pageId, content, images } = layout[index];
    const xobjects = images.map((id, at) => "/Im" + (at + 1) + " " + id + " 0 R").join(" ");
    object(pageId, [ascii("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_WIDTH + " " + PAGE_HEIGHT + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>"
      + (xobjects ? " /XObject << " + xobjects + " >>" : "") + " >> /Contents " + content + " 0 R >>")]);
    const stream: number[] = [];
    page.images.forEach((image, at) => {
      stream.push(...ascii("q " + number(image.width) + " 0 0 " + number(image.height) + " " + number(image.x) + " " + number(image.y) + " cm /Im" + (at + 1) + " Do Q\n"));
    });
    for (const line of page.lines ?? [])
      stream.push(...ascii("0.8 G 0.75 w " + number(line.x1) + " " + number(line.y1) + " m " + number(line.x2) + " " + number(line.y2) + " l S\n"));
    for (const text of page.texts) {
      stream.push(...ascii("BT " + (text.gray ? "0.42 g " : "0.07 g ") + "/" + (text.bold ? "F2" : "F1") + " " + number(text.size) + " Tf " + number(text.x) + " " + number(text.y) + " Td "));
      stream.push(...pdfString(text.text));
      stream.push(...ascii(" Tj ET\n"));
    }
    object(content, [ascii("<< /Length " + stream.length + " >>\nstream\n"), stream, ascii("\nendstream")]);
    page.images.forEach((image, at) => {
      object(images[at], [ascii("<< /Type /XObject /Subtype /Image /Width " + image.pixelWidth + " /Height " + image.pixelHeight
        + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + image.jpeg.length + " >>\nstream\n"), image.jpeg, ascii("\nendstream")]);
    });
  });

  const start = length;
  const count = next;
  const table = ["xref", "0 " + count, "0000000000 65535 f "];
  for (let id = 1; id < count; id++) table.push(String(offsets[id]).padStart(10, "0") + " 00000 n ");
  push(ascii(table.join("\n") + "\n"));
  push(ascii("trailer\n<< /Size " + count + " /Root 1 0 R /Info 5 0 R >>\nstartxref\n" + start + "\n%%EOF\n"));

  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}
