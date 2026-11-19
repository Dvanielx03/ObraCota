// Explora un IFC antes de convertirlo: caja, alturas de losas y nombres por clase.
// Uso: node scripts/explorar-ifc.mjs <modelo.ifc>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebIFC = require("web-ifc");
const valor = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);

const api = new WebIFC.IfcAPI();
await api.Init();
const modelo = api.OpenModel(new Uint8Array(readFileSync(process.argv[2])), { COORDINATE_TO_ORIGIN: true });

const filas = [];
let triangulos = 0;
api.StreamAllMeshes(modelo, (malla) => {
  const id = malla.expressID;
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, tri = 0;
  for (let g = 0; g < malla.geometries.size(); g++) {
    const c = malla.geometries.get(g);
    const geo = api.GetGeometry(modelo, c.geometryExpressID);
    const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
    tri += geo.GetIndexDataSize() / 3;
    const m = c.flatTransformation;
    for (let i = 0; i < v.length; i += 6) {
      const x = m[0] * v[i] + m[4] * v[i + 1] + m[8] * v[i + 2] + m[12];
      const y = m[1] * v[i] + m[5] * v[i + 1] + m[9] * v[i + 2] + m[13];
      const z = m[2] * v[i] + m[6] * v[i + 1] + m[10] * v[i + 2] + m[14];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    geo.delete();
  }
  triangulos += tri;
  const linea = api.GetLine(modelo, id);
  const tipo = api.GetNameFromTypeCode(api.GetLineType(modelo, id));
  const nombre = String(valor(linea.Name) ?? "").replace(/_\(#\d+\)$/, "").trim() || "(sin nombre)";
  filas.push({ id, tipo, nombre, minY, maxY, minX, maxX, minZ, maxZ, tri });
});

const r = (n) => Math.round(n * 100) / 100;
const caja = filas.reduce(
  (c, f) => ({ minX: Math.min(c.minX, f.minX), maxX: Math.max(c.maxX, f.maxX), minY: Math.min(c.minY, f.minY), maxY: Math.max(c.maxY, f.maxY), minZ: Math.min(c.minZ, f.minZ), maxZ: Math.max(c.maxZ, f.maxZ) }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
);
console.log("elementos con geometría", filas.length, "| triángulos", triangulos);
console.log("caja", Object.fromEntries(Object.entries(caja).map(([k, v]) => [k, r(v)])));

const porNombre = new Map();
for (const f of filas) {
  const k = `${f.tipo} · ${f.nombre}`;
  const a = porNombre.get(k) ?? { n: 0, tri: 0, minY: Infinity, maxY: -Infinity, bases: [] };
  a.n++;
  a.tri += f.tri;
  a.minY = Math.min(a.minY, f.minY);
  a.maxY = Math.max(a.maxY, f.maxY);
  a.bases.push(f.minY);
  porNombre.set(k, a);
}
console.log("--- clase · nombre : n, triángulos, rango Y, bases frecuentes");
for (const [k, a] of [...porNombre.entries()].sort((x, y) => y[1].n - x[1].n)) {
  const cuenta = new Map();
  for (const b of a.bases) cuenta.set(r(Math.round(b * 10) / 10), (cuenta.get(r(Math.round(b * 10) / 10)) ?? 0) + 1);
  const top = [...cuenta.entries()].sort((x, y) => y[1] - x[1]).slice(0, 7).sort((x, y) => x[0] - y[0]).map(([y, n]) => `${y}×${n}`).join(" ");
  console.log(`${String(a.n).padStart(5)} ${String(a.tri).padStart(7)}  [${r(a.minY)} … ${r(a.maxY)}]  ${k}  | ${top}`);
}
api.CloseModel(modelo);
