// DWG to DXF and back-reading of a DXF, with LibreDWG compiled to WebAssembly (@mlightcad/libredwg-web, GPL-3.0),
// the same reader the viewer uses.
//
//   node dxf.mjs <libredwg-web package dir> convert <file.dwg> <out.dxf>
//   node dxf.mjs <libredwg-web package dir> read <file.dxf>
//
// `convert` writes the DXF that LibreDWG makes of the DWG (dwg_write_dxf). `read` opens a DXF the way the viewer
// will (dwg_read_data with the DXF file type) and writes to stdout a JSON summary: the version, $INSUNITS, how
// many model space entities of each type it decoded and the TEXT, MTEXT and DIMENSION texts by handle. The
// engine uses it to prove that the revision it wrote opens in the viewer and says what was changed.
//
// Errors: exit code 3 and a JSON {code, detail} line on stderr.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [packageDir, command, file, out] = process.argv.slice(2);
if (!packageDir || !command || !file) {
  process.stderr.write("usage: node dxf.mjs <libredwg-web dir> convert|read <file> [out]\n");
  process.exit(2);
}
// LibreDWG prints decoding warnings with console.log/warn; stdout carries the answer.
console.log = console.info = console.warn = (...args) => process.stderr.write(args.join(" ") + "\n");
const { LibreDwg, Dwg_File_Type } = await import(pathToFileURL(path.join(packageDir, "dist", "libredwg-web.js")).href);
const lib = await LibreDwg.create(path.join(packageDir, "wasm"));

function fail(code, detail) {
  process.stderr.write(JSON.stringify({ code, detail }) + "\n");
  process.exit(3);
}

const bytes = fs.readFileSync(file);
if (command === "convert") {
  const head = bytes.subarray(0, 6).toString("latin1");
  if (!/^AC10\d\d$/.test(head)) fail("NOT_DWG", "El archivo no tiene la cabecera de un DWG.");
  let dxf = null;
  try { dxf = lib.dwg_write_dxf(bytes); } catch { dxf = null; }
  if (!dxf || !dxf.length) fail("DXF_CONVERSION_FAILED", "LibreDWG no pudo convertir el DWG a DXF.");
  fs.writeFileSync(out, dxf);
  process.stdout.write(JSON.stringify({ dwg: head, bytes: dxf.length }));
} else if (command === "read") {
  let ptr;
  try { ptr = lib.dwg_read_data(bytes, Dwg_File_Type.DXF); } catch { ptr = 0; }
  if (!ptr) fail("DXF_UNREADABLE", "LibreDWG no pudo leer el DXF.");
  let db;
  try { db = lib.convert(ptr); } catch { fail("DXF_UNREADABLE", "LibreDWG no pudo convertir el DXF leído."); }
  const types = {};
  const texts = [];
  for (const e of db.entities ?? []) {
    types[e.type] = (types[e.type] ?? 0) + 1;
    if (e.type === "TEXT" || e.type === "MTEXT" || e.type === "DIMENSION")
      texts.push({ handle: String(e.handle ?? ""), type: e.type, layer: e.layer ?? "", text: e.text ?? "" });
  }
  lib.dwg_free(ptr);
  process.stdout.write(JSON.stringify({ insunits: db.header?.INSUNITS ?? 0, types, texts }));
} else {
  fail("USAGE", "Orden desconocida.");
}
