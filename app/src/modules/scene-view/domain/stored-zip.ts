/**
 * Minimal ZIP writer (PKWARE APPNOTE 6.3): every entry is *stored* (method 0, no compression),
 * which suits PNG files that are already compressed. No ZIP64: the archive must stay under 4 GiB
 * and 65,535 entries. Pure: no browser or Node API besides TextEncoder.
 */
export interface ZipEntry { name: string; data: Uint8Array }

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
/** 2.0: the version most readers expect; stored entries only need 1.0. */
const VERSION = 20;
/** General purpose bit 11: the name is UTF-8. */
const UTF8_NAME = 0x0800;
const MAX_SIZE = 0xffffffff;
const MAX_ENTRIES = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), as ZIP stores it. crc32("123456789") = 0xCBF43926. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date fields (local time, 2-second steps, years 1980–2107). */
export function dosDateTime(when: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, when.getFullYear()));
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/** Rejects names a reader could write outside its folder, or two entries with the same name. */
function checkNames(entries: readonly ZipEntry[]) {
  const seen = new Set<string>();
  for (const { name } of entries) {
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || /^[a-z]:/i.test(name))
      throw new RangeError("Nombre de archivo no válido en el ZIP: " + name);
    if (seen.has(name)) throw new RangeError("Nombre repetido en el ZIP: " + name);
    seen.add(name);
  }
}

/** Builds a ZIP archive whose entries are stored as they are, all dated `modified`. */
export function storedZip(entries: readonly ZipEntry[], modified: Date = new Date()): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new RangeError("Demasiados archivos para un ZIP sin ZIP64.");
  checkNames(entries);
  const encoder = new TextEncoder();
  const names = entries.map((entry) => encoder.encode(entry.name));
  const flags = entries.map((entry) => (/^[\x20-\x7e]*$/.test(entry.name) ? 0 : UTF8_NAME));
  const stamp = dosDateTime(modified);
  let size = 22;
  entries.forEach((entry, i) => { size += 30 + 46 + names[i].length * 2 + entry.data.length; });
  if (size > MAX_SIZE) throw new RangeError("El ZIP superaría 4 GB.");

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  const sums: number[] = [];
  let at = 0;
  entries.forEach((entry, i) => {
    const name = names[i], crc = crc32(entry.data), length = entry.data.length;
    offsets.push(at); sums.push(crc);
    view.setUint32(at, LOCAL_HEADER, true);
    view.setUint16(at + 4, VERSION, true);
    view.setUint16(at + 6, flags[i], true);
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, stamp.time, true);
    view.setUint16(at + 12, stamp.date, true);
    view.setUint32(at + 14, crc, true);
    view.setUint32(at + 18, length, true); // compressed size
    view.setUint32(at + 22, length, true); // uncompressed size
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true); // no extra field
    out.set(name, at + 30);
    out.set(entry.data, at + 30 + name.length);
    at += 30 + name.length + length;
  });

  const central = at;
  entries.forEach((entry, i) => {
    const name = names[i], length = entry.data.length;
    view.setUint32(at, CENTRAL_HEADER, true);
    view.setUint16(at + 4, VERSION, true); // made by: 2.0, MS-DOS attributes
    view.setUint16(at + 6, VERSION, true);
    view.setUint16(at + 8, flags[i], true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, stamp.time, true);
    view.setUint16(at + 14, stamp.date, true);
    view.setUint32(at + 16, sums[i], true);
    view.setUint32(at + 20, length, true);
    view.setUint32(at + 24, length, true);
    view.setUint16(at + 28, name.length, true);
    view.setUint16(at + 30, 0, true); // extra
    view.setUint16(at + 32, 0, true); // comment
    view.setUint16(at + 34, 0, true); // disk
    view.setUint16(at + 36, 0, true); // internal attributes
    view.setUint32(at + 38, 0, true); // external attributes
    view.setUint32(at + 42, offsets[i], true);
    out.set(name, at + 46);
    at += 46 + name.length;
  });

  view.setUint32(at, END_OF_CENTRAL, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - central, true);
  view.setUint32(at + 16, central, true);
  view.setUint16(at + 20, 0, true); // no comment
  return out;
}
