/**
 * What ObraCota can read of a Revit RVT without Revit: the version that saved it and the small picture
 * Revit keeps for its file dialog. An RVT is an OLE compound file (the container of old Office files);
 * the geometry inside is Autodesk's own format and is not read here.
 *
 * The file is not parsed as a whole: some RVT carry a DIFAT whose last link is not END_OF_CHAIN, which
 * strict OLE readers reject. The version is UTF-16LE text of the BasicFileInfo stream, found by search.
 * The picture is a PNG; when its bytes cross a sector boundary, the sectors that follow are taken from
 * the FAT chain. The «Last Save Path» of BasicFileInfo (a personal path) is never read.
 */
export const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const END = 0xfffffffa; // Sector numbers from here up are markers (end of chain, free, FAT, DIFAT).

export interface RevitInfo {
  /** "2025": the Revit release that saved the file, when BasicFileInfo says so. */
  release?: string;
  /** "20240715_1515(x64)": its build. */
  build?: string;
  /** The PNG Revit stored with the file, whole (IHDR to IEND), or undefined when it cannot be put together. */
  preview?: Uint8Array;
}

export function isOle(bytes: Uint8Array) {
  return bytes.length >= OLE_SIGNATURE.length && OLE_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

function utf16(text: string) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) out[i * 2] = text.charCodeAt(i);
  return out;
}

function find(bytes: Uint8Array, pattern: ArrayLike<number>, from = 0) {
  const first = pattern[0];
  for (let i = bytes.indexOf(first, from); i >= 0 && i <= bytes.length - pattern.length; i = bytes.indexOf(first, i + 1)) {
    let j = 1;
    while (j < pattern.length && bytes[i + j] === pattern[j]) j++;
    if (j === pattern.length) return i;
  }
  return -1;
}

/** The UTF-16LE value after `label` up to the end of its line, at most `max` characters. */
function field(bytes: Uint8Array, label: string, max = 48) {
  const at = find(bytes, utf16(label));
  if (at < 0) return undefined;
  let text = "";
  for (let i = at + label.length * 2; i + 1 < bytes.length && text.length < max; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (code === 0x0d || code === 0x0a || code === 0) break;
    text += String.fromCharCode(code);
  }
  return text.trim() || undefined;
}

/** The FAT of the compound file, or null when its header does not describe one. */
function allocationTable(bytes: Uint8Array): Uint32Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 512) return null;
  const shift = view.getUint16(30, true);
  if (shift !== 9 && shift !== 12) return null;
  const size = 1 << shift, perSector = size / 4;
  const count = view.getUint32(44, true);
  const sectors: number[] = [];
  for (let i = 0; i < 109 && sectors.length < count; i++) sectors.push(view.getUint32(76 + i * 4, true));
  // DIFAT sectors: the last link may be anything but END_OF_CHAIN; the FAT count says when to stop.
  let next = view.getUint32(68, true), hops = view.getUint32(72, true);
  while (sectors.length < count && next < END && hops-- > 0) {
    const offset = (next + 1) * size;
    if (offset + size > bytes.length) return null;
    for (let i = 0; i < perSector - 1 && sectors.length < count; i++) sectors.push(view.getUint32(offset + i * 4, true));
    next = view.getUint32(offset + (perSector - 1) * 4, true);
  }
  if (sectors.length < count) return null;
  const fat = new Uint32Array(count * perSector);
  sectors.forEach((sector, n) => {
    const offset = (sector + 1) * size;
    if (sector >= END || offset + size > bytes.length) return;
    for (let i = 0; i < perSector; i++) fat[n * perSector + i] = view.getUint32(offset + i * 4, true);
  });
  return fat;
}

/** Length of the PNG at the start of `data` (signature to IEND included), or -1 when it is not whole. */
function pngLength(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8, first = true;
  while (at + 12 <= data.length) {
    const length = view.getUint32(at), type = String.fromCharCode(...data.subarray(at + 4, at + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || (first && type !== "IHDR") || at + 12 + length > data.length) return -1;
    at += 12 + length; first = false;
    if (type === "IEND") return at;
  }
  return -1;
}

/** The PNG starting at `start`, read straight or following the FAT chain of its sector. */
function pngAt(bytes: Uint8Array, start: number, fat: Uint32Array | null, size: number) {
  const straight = pngLength(bytes.subarray(start, start + (1 << 22)));
  if (straight > 0) return bytes.slice(start, start + straight);
  if (!fat) return undefined;
  const parts: Uint8Array[] = [];
  let sector = Math.floor(start / size) - 1, total = 0;
  parts.push(bytes.subarray(start, (sector + 2) * size)); total += parts[0].length;
  for (let hops = 0; hops < 4096 && total < (1 << 22); hops++) {
    sector = fat[sector];
    if (sector === undefined || sector >= END || (sector + 2) * size > bytes.length) break;
    parts.push(bytes.subarray((sector + 1) * size, (sector + 2) * size)); total += size;
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.length; }
    const length = pngLength(joined);
    if (length > 0) return joined.slice(0, length);
  }
  return undefined;
}

export function readRevit(bytes: Uint8Array): RevitInfo {
  if (!isOle(bytes)) throw new Error("La cabecera no corresponde a un archivo de Revit (contenedor OLE).");
  const format = field(bytes, "Format: ", 16);
  // Revit 2019 and later write «Format: 2025»; older releases name the product in «Autodesk Revit 2018».
  const release = /^\d{4}$/.test(format ?? "") ? format : /^(\d{4})/.exec(field(bytes, "Autodesk Revit ", 8) ?? "")?.[1];
  const build = field(bytes, "Build: ", 40);
  let preview: Uint8Array | undefined;
  const size = bytes.length >= 32 ? 1 << new DataView(bytes.buffer, bytes.byteOffset).getUint16(30, true) : 512;
  let fat: Uint32Array | null | undefined;
  for (let at = find(bytes, PNG_SIGNATURE); at >= 0 && !preview; at = find(bytes, PNG_SIGNATURE, at + 1)) {
    if (fat === undefined) fat = allocationTable(bytes);
    preview = pngAt(bytes, at, fat, size);
  }
  return { release, build: build && /^[\w.()\- ]+$/.test(build) ? build : undefined, preview };
}

/** The reason the viewer gives for an RVT: what it is and how to see it in ObraCota. */
export function revitReason(info: RevitInfo, stored: boolean) {
  const what = "Archivo de Revit" + (info.release ? " " + info.release : "");
  return stored
    ? what + " guardado como original. Para ver la geometría, convierte a IFC si Autodesk está disponible o usa Archivo › Exportar › IFC en Revit y sube el IFC a este proyecto."
    : what + " abierto desde tu equipo. Para ver la geometría, usa Archivo › Exportar › IFC en Revit y abre ese IFC aquí. También puedes guardar el RVT en un proyecto para usar la conversión con Autodesk cuando esté configurada.";
}
