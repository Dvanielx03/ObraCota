// ACIS bodies of a DWG, read with LibreDWG compiled to WebAssembly (@mlightcad/libredwg-web, GPL-3.0).
//
//   node extract.mjs <libredwg-web package dir> <file.dwg>
//
// Writes to stdout: a little-endian uint32 with the length of a UTF-8 JSON manifest, the manifest, and then
// the ACIS blocks one after another. The manifest says where each block starts (offset into that tail),
// the entity it belongs to (handle, DXF name, layer) and every placement of that entity in model space
// (column-major 4x4 matrices in drawing units: block inserts, rotation, scale, base point, OCS and MINSERT
// arrays). The WebAssembly sandbox keeps a malformed DWG inside the module's own memory.
//
// Only SAB (ACIS version 2) is copied. SAT text (version 1, DWG R2000-R2010) and entities that LibreDWG
// does not decode (the generic SURFACE class, for instance) are counted in `skipped`.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [packageDir, file] = process.argv.slice(2);
if (!packageDir || !file) {
  process.stderr.write("usage: node extract.mjs <libredwg-web dir> <file.dwg>\n");
  process.exit(2);
}
// LibreDWG prints decoding warnings with console.log/warn; stdout carries the binary answer. Redirected
// before the module loads, because Emscripten binds its printer when it is created.
console.log = console.info = console.warn = (...args) => process.stderr.write(args.join(" ") + "\n");
const { LibreDwg, Dwg_File_Type } = await import(pathToFileURL(path.join(packageDir, "dist", "libredwg-web.js")).href);
const lib = await LibreDwg.create(path.join(packageDir, "wasm"));

const ACIS = new Set(["3DSOLID", "BODY", "REGION"]);
const SURFACES = /SURFACE$/;
const MAX_DEPTH = 32;
const MAX_PLACEMENTS = 100000;
const hex = id => BigInt(id ?? 0).toString(16).toUpperCase();

const bytes = fs.readFileSync(file);
const head = bytes.subarray(0, 6).toString("latin1");
if (!/^AC10\d\d$/.test(head)) fail("NOT_DWG", "El archivo no tiene la cabecera de un DWG.");
const ptr = lib.dwg_read_data(bytes, Dwg_File_Type.DWG);
if (!ptr) fail("DWG_UNREADABLE", "LibreDWG no pudo leer el DWG.");
const db = lib.convert(ptr);

const layers = new Map(db.tables.LAYER.entries.map(l => [l.handle, l]));
const blocksByHandle = new Map(db.tables.BLOCK_RECORD.entries.map(b => [b.handle, b]));
const blocksByName = new Map(db.tables.BLOCK_RECORD.entries.map(b => [b.name, b]));
const modelSpace = db.tables.BLOCK_RECORD.entries.find(b => b.name.toUpperCase() === "*MODEL_SPACE");
const skipped = {};
const skip = (what, n = 1) => { skipped[what] = (skipped[what] ?? 0) + n; };

// --- 4x4 matrices, column-major like three.js -------------------------------------------------------
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}
const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const scaling = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const rotationZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
function normalize(v) { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
// AutoCAD's arbitrary axis algorithm: object coordinates to world coordinates.
function ocs(n) {
  if (!n || (n.x === 0 && n.y === 0 && n.z === 1)) return identity();
  const z = normalize([n.x, n.y, n.z]);
  const x = normalize(cross(Math.abs(z[0]) < 1 / 64 && Math.abs(z[1]) < 1 / 64 ? [0, 1, 0] : [0, 0, 1], z));
  const y = cross(z, x);
  return [...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1];
}
const point = p => [p?.x ?? 0, p?.y ?? 0, p?.z ?? 0];

// --- Where every block appears in model space --------------------------------------------------------
// Each INSERT inside block B (or model space) of block C adds placements of C: placements(B) x insert.
const insertsOf = new Map(); // block name -> [{owner block name, insert entity}]
function collect(entities, owner) {
  for (const e of entities ?? []) {
    if (e.type !== "INSERT" || !e.name) continue;
    if (!insertsOf.has(e.name)) insertsOf.set(e.name, []);
    insertsOf.get(e.name).push({ owner, insert: e });
  }
}
collect(db.entities, "*MODEL_SPACE");
for (const b of db.tables.BLOCK_RECORD.entries) if (!/^\*(MODEL|PAPER)_SPACE/i.test(b.name)) collect(b.entities, b.name);

function insertMatrices(e, block) {
  const out = [];
  const rows = Math.max(1, e.rowCount || 1), cols = Math.max(1, e.columnCount || 1);
  const base = point(block?.basePoint);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let m = multiply(ocs(e.extrusionDirection), translation(...point(e.insertionPoint)));
    m = multiply(m, rotationZ(e.rotation || 0));
    m = multiply(m, translation(c * (e.columnSpacing || 0), r * (e.rowSpacing || 0), 0));
    m = multiply(m, scaling(e.xScale || 1, e.yScale || 1, e.zScale || 1));
    out.push(multiply(m, translation(-base[0], -base[1], -base[2])));
  }
  return out;
}

const memo = new Map();
// Placements of a block in model space, each with the layer an entity on layer "0" inherits.
function placements(name, depth = 0, stack = []) {
  if (/^\*MODEL_SPACE$/i.test(name)) return [{ matrix: identity(), layer: "0", visible: true }];
  if (memo.has(name)) return memo.get(name);
  if (depth >= MAX_DEPTH || stack.includes(name)) return [];
  const block = blocksByName.get(name);
  const out = [];
  for (const { owner, insert } of insertsOf.get(name) ?? []) {
    for (const parent of placements(owner, depth + 1, [...stack, name])) {
      const layer = insert.layer === "0" ? parent.layer : insert.layer || parent.layer;
      const visible = parent.visible && insert.isVisible !== false && layerVisible(layer);
      for (const m of insertMatrices(insert, block)) {
        out.push({ matrix: multiply(parent.matrix, m), layer, visible });
        if (out.length > MAX_PLACEMENTS) fail("MODEL_TOO_LARGE", "El DWG repite sus bloques demasiadas veces.");
      }
    }
  }
  memo.set(name, out);
  return out;
}
function layerVisible(name) {
  const l = [...layers.values()].find(x => x.name === name);
  return !(l?.off || l?.frozen);
}

// --- ACIS entities ---------------------------------------------------------------------------------
const chunks = [];
const bodies = [];
let offset = 0;
const total = lib.dwg_get_num_objects(ptr);
for (let i = 0; i < total; i++) {
  const object = lib.dwg_get_object(ptr, i);
  const fixed = lib.dwg_object_get_fixedtype(object);
  let name = lib.dwg_object_get_dxfname(object);
  if (fixed === 65534) { // UNKNOWN_ENT: name it after its class
    const cls = lib.dwg_get_class(ptr, lib.dwg_object_get_type(object) - 500);
    if (cls?.dxfname && (ACIS.has(cls.dxfname) || SURFACES.test(cls.dxfname))) skip(cls.dxfname + " sin decodificar");
    continue;
  }
  if (!ACIS.has(name) && !SURFACES.test(name)) continue;
  const entity = lib.dwg_object_to_entity(object), tio = lib.dwg_object_to_entity_tio(object);
  if (!entity || !tio) { skip(name + " sin decodificar"); continue; }
  const version = lib.dwg_dynapi_entity_data(tio, "version");
  const size = lib.dwg_dynapi_entity_data(tio, "sab_size") || 0;
  const data = lib.dwg_dynapi_entity_data(tio, "acis_data");
  if (lib.dwg_dynapi_entity_data(tio, "acis_empty")) { skip(name + " vacío"); continue; }
  if (version !== 2 || !size || !data) { skip(name + (version === 1 ? " en SAT de texto" : " sin datos ACIS")); continue; }
  const sab = Buffer.from(lib.wasmInstance.HEAPU8.subarray(data, data + size));
  const handle = hex(lib.dwg_object_entity_get_handle_object(entity).value);
  const owner = hex(lib.dwg_object_entity_get_ownerhandle_object(entity)?.absolute_ref);
  const layerRef = lib.dwg_object_entity_get_layer_object_ref(entity);
  const layer = layers.get(hex(layerRef?.handleref?.value))?.name ?? "0";
  const visible = !lib.dwg_object_entity_get_invisible(entity);
  // Old files leave the owner of model-space entities empty (0).
  const block = owner === "0" ? modelSpace : blocksByHandle.get(owner);
  if (!block) { skip(name + " sin bloque propietario"); continue; }
  if (/^\*PAPER_SPACE/i.test(block.name)) { skip(name + " en espacio papel"); continue; }
  const where = [];
  for (const p of placements(block.name)) {
    const finalLayer = layer === "0" ? p.layer : layer;
    if (!visible || !p.visible || !layerVisible(finalLayer)) continue;
    where.push({ matrix: p.matrix, layer: finalLayer });
  }
  if (!where.length) { skip(name + " oculto o sin insertar"); continue; }
  bodies.push({ handle, type: name, offset, size, placements: where });
  chunks.push(sab);
  offset += size;
}
const insunits = db.header.INSUNITS ?? 0;
const manifest = Buffer.from(JSON.stringify({ dwg: head, insunits, bodies, skipped }), "utf8");
const length = Buffer.alloc(4);
length.writeUInt32LE(manifest.length, 0);
lib.dwg_free(ptr);
process.stdout.write(Buffer.concat([length, manifest, ...chunks]));

function fail(code, detail) {
  process.stderr.write(JSON.stringify({ code, detail }) + "\n");
  process.exit(3);
}
