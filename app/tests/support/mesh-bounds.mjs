// Reads FBX/OBJ files with the viewer's own loader (src/viewer/infrastructure/mesh-source.ts, run by
// Node's type stripping) and prints, per file, the size of the model in scene units (metres for an FBX
// with a declared unit), whether it can be walked, its header line and its element count.
// Usage: node tests/support/mesh-bounds.mjs <file>... — fbx-obj.spec.ts runs it to check units and axes.
import * as T from "three";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

console.warn = () => {};
// FBX files with embedded images make the loader build an <img> for each (pointed at a blank data URL by
// mesh-source.ts). Node has no DOM: an image that never loads is all the loader needs.
globalThis.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }) };
const created = [], revoked = [];
const { createObjectURL, revokeObjectURL } = URL;
URL.createObjectURL = object => { const url = createObjectURL.call(URL, object); created.push(url); return url; };
URL.revokeObjectURL = url => { revoked.push(url); return revokeObjectURL.call(URL, url); };
const { readMesh } = await import(new URL("../../src/viewer/infrastructure/mesh-source.ts", import.meta.url).href);
const result = {};
for (const path of process.argv.slice(2)) {
  const before = created.length;
  const model = await readMesh(new File([readFileSync(path)], basename(path)), new AbortController().signal, () => {});
  model.root.updateMatrixWorld(true);
  const size = new T.Box3().setFromObject(model.root).getSize(new T.Vector3());
  const blobs = created.slice(before);
  result[basename(path)] = { size: size.toArray(), walk: model.walk, schema: model.schema, elements: model.elements.length,
    levels: [...new Set(model.elements.map(e => e.level))], ids: model.elements.map(e => e.id),
    blobs: blobs.length, unrevoked: blobs.filter(url => !revoked.includes(url)).length };
}
process.stdout.write(JSON.stringify(result));
