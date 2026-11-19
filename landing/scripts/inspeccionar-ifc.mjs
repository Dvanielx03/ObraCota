// Inventario de un IFC con geometría: niveles, clases, materiales, tareas y caja de cada elemento.
// Uso: node scripts/inspeccionar-ifc.mjs <modelo.ifc> <salida.json>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebIFC = require("web-ifc");
const [, , ruta, salida] = process.argv;
const api = new WebIFC.IfcAPI();
await api.Init();
const modelo = api.OpenModel(new Uint8Array(readFileSync(ruta)), { COORDINATE_TO_ORIGIN: true });
const v = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);
const ids = (t) => { const r = api.GetLineIDsWithType(modelo, t, true); const o = []; for (let i = 0; i < r.size(); i++) o.push(r.get(i)); return o; };
const linea = (id, plano = false) => { try { return api.GetLine(modelo, id, plano); } catch { return null; } };
const tipo = (id) => { try { return api.GetNameFromTypeCode(api.GetLineType(modelo, id)); } catch { return "?"; } };

const niveles = ids(WebIFC.IFCBUILDINGSTOREY).map((id) => { const l = linea(id); return { id, nombre: String(v(l.Name) ?? ""), elevacion: v(l.Elevation) }; });
const nivelDe = new Map();
for (const id of ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) { const r = linea(id); for (const e of r.RelatedElements ?? []) nivelDe.set(v(e), v(r.RelatingStructure)); }
const padreDe = new Map();
for (const id of ids(WebIFC.IFCRELAGGREGATES)) { const r = linea(id); for (const e of r.RelatedObjects ?? []) padreDe.set(v(e), v(r.RelatingObject)); }

const materialDe = new Map();
const nombreMaterial = (id) => {
  const l = linea(id); if (!l) return "";
  const t = tipo(id).toUpperCase();
  if (t === "IFCMATERIAL") return String(v(l.Name) ?? "");
  if (t === "IFCMATERIALLAYERSETUSAGE") return nombreMaterial(v(l.ForLayerSet));
  if (t === "IFCMATERIALLAYERSET") return (l.MaterialLayers ?? []).map((c) => nombreMaterial(v(c))).join("+");
  if (t === "IFCMATERIALLAYER") return nombreMaterial(v(l.Material));
  if (t === "IFCMATERIALCONSTITUENTSET") return (l.MaterialConstituents ?? []).map((c) => nombreMaterial(v(c))).join("+");
  if (t === "IFCMATERIALCONSTITUENT") return nombreMaterial(v(l.Material));
  if (t === "IFCMATERIALPROFILESETUSAGE") return nombreMaterial(v(l.ForProfileSet));
  if (t === "IFCMATERIALPROFILESET") return (l.MaterialProfiles ?? []).map((c) => nombreMaterial(v(c))).join("+");
  if (t === "IFCMATERIALPROFILE") return nombreMaterial(v(l.Material));
  if (t === "IFCMATERIALLIST") return (l.Materials ?? []).map((c) => nombreMaterial(v(c))).join("+");
  return t;
};
for (const id of ids(WebIFC.IFCRELASSOCIATESMATERIAL)) { const r = linea(id); const n = nombreMaterial(v(r.RelatingMaterial)); for (const e of r.RelatedObjects ?? []) materialDe.set(v(e), n); }

const tareas = new Map();
for (const id of ids(WebIFC.IFCTASK)) {
  const l = linea(id); const tt = l.TaskTime ? linea(v(l.TaskTime)) : null;
  const tiempo = {}; if (tt) for (const [k, x] of Object.entries(tt)) { const val = v(x); if (val !== null && val !== undefined && typeof val !== "object" && k !== "expressID" && k !== "type") tiempo[k] = val; }
  tareas.set(id, { id, nombre: String(v(l.Name) ?? ""), identificacion: v(l.Identification), descripcion: v(l.Description), predefinido: v(l.PredefinedType), hito: v(l.IsMilestone), tiempo, productos: 0 });
}
const tareaDe = new Map();
let relProd = 0;
for (const id of ids(WebIFC.IFCRELASSIGNSTOPRODUCT)) {
  const r = linea(id); relProd++;
  const prod = v(r.RelatingProduct);
  for (const o of r.RelatedObjects ?? []) { const t = tareas.get(v(o)); if (t) { t.productos++; if (!tareaDe.has(prod)) tareaDe.set(prod, []); tareaDe.get(prod).push(t.id); } }
}
const nidos = [];
for (const id of ids(WebIFC.IFCRELNESTS)) { const r = linea(id); if (tareas.has(v(r.RelatingObject))) nidos.push([v(r.RelatingObject), (r.RelatedObjects ?? []).map(v)]); }
const secuencias = ids(WebIFC.IFCRELSEQUENCE).map((id) => { const r = linea(id); return [v(r.RelatingProcess), v(r.RelatedProcess)]; });

const elementos = [];
api.StreamAllMeshes(modelo, (malla) => {
  const id = malla.expressID; const l = linea(id);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], tri = 0, alfa = 1; const colores = new Set();
  const geos = malla.geometries;
  for (let g = 0; g < geos.size(); g++) {
    const c = geos.get(g); const geo = api.GetGeometry(modelo, c.geometryExpressID);
    const vs = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize()); tri += geo.GetIndexDataSize() / 3; const m = c.flatTransformation;
    colores.add([c.color.x, c.color.y, c.color.z, c.color.w].map((n) => n.toFixed(2)).join(","));
    alfa = Math.min(alfa, c.color.w);
    for (let i = 0; i < vs.length; i += 6) { const x = vs[i], y = vs[i + 1], z = vs[i + 2];
      const p = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; } }
    geo.delete();
  }
  let a = id, nivel; for (let i = 0; i < 8 && a !== undefined; i++) { if (nivelDe.has(a)) { nivel = nivelDe.get(a); break; } a = padreDe.get(a); }
  let b = id, mat = materialDe.get(id); for (let i = 0; i < 4 && !mat && b !== undefined; i++) { b = padreDe.get(b); mat = materialDe.get(b); }
  let c2 = id, tar = tareaDe.get(id); for (let i = 0; i < 6 && !tar && c2 !== undefined; i++) { c2 = padreDe.get(c2); tar = tareaDe.get(c2); }
  elementos.push({ id, tipo: tipo(id), nombre: String(v(l?.Name) ?? ""), objeto: String(v(l?.ObjectType) ?? ""), pre: String(v(l?.PredefinedType) ?? ""), nivel, padre: padreDe.get(id), tipoPadre: padreDe.has(id) ? tipo(padreDe.get(id)) : "", material: mat ?? "", tareas: tar ?? [], tareaDirecta: tareaDe.has(id), min: min.map((n) => +n.toFixed(3)), max: max.map((n) => +n.toFixed(3)), tri, colores: [...colores].slice(0, 3), alfa });
});
const tiposTarea = {}; for (const [p] of tareaDe) { const t = tipo(p); tiposTarea[t] = (tiposTarea[t] ?? 0) + 1; }
writeFileSync(salida, JSON.stringify({ esquema: api.GetModelSchema(modelo), niveles, tareas: [...tareas.values()], nidos, secuencias, relProd, tiposConTarea: tiposTarea, elementos }));
console.log("elementos con geometría:", elementos.length, "triángulos:", elementos.reduce((s, e) => s + e.tri, 0));
