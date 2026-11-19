// Convierte un modelo IFC en un GLB ligero para la web, agrupado por nivel, sistema
// constructivo y, si el archivo trae programación de obra (4D), por ventana de ejecución.
//
// Uso:  node scripts/ifc-a-glb.mjs <modelo.ifc> <carpeta-salida> <nombre>
//         [--perfil=scripts/perfiles/<edificio>.mjs] [--simplificar=0.6] [--sin-terreno]
// Sale: <carpeta>/<nombre>.glb  y  <carpeta>/<nombre>.json (niveles, sistemas, programa y fuente)
//
// El visor de la landing no lee IFC en el navegador: lee este GLB, que conserva la
// geometría real del archivo pero fusionada en pocas mallas.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, simplify, simplifyPrimitive, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const require = createRequire(import.meta.url);
const WebIFC = require("web-ifc");

const [, , rutaIfc, carpeta, nombre, ...opciones] = process.argv;
if (!rutaIfc || !carpeta || !nombre) {
  console.error("Uso: node scripts/ifc-a-glb.mjs <modelo.ifc> <carpeta-salida> <nombre> [--perfil=archivo.mjs] [--simplificar=0.6] [--sin-terreno]");
  process.exit(1);
}
const opcion = (clave, defecto) => {
  const o = opciones.find((x) => x.startsWith(`--${clave}`));
  if (!o) return defecto;
  return o.includes("=") ? o.split("=")[1] : true;
};
const RAZON = Number(opcion("simplificar", 1));
const SIN_TERRENO = Boolean(opcion("sin-terreno", false));
const RUTA_PERFIL = opcion("perfil", null);
const ANGULO_ARISTA = Math.cos((32 * Math.PI) / 180);

/** Perfil opcional del edificio: niveles por cota, sistemas por nombre y tareas generales. */
const perfil = RUTA_PERFIL ? (await import(pathToFileURL(resolve(String(RUTA_PERFIL))).href)).default : {};

/** Sistema constructivo de un elemento según su clase IFC (regla general). */
function grupoPorClase(tipo, predefinido) {
  if (/^IFC(FOOTING|PILE|DEEPFOUNDATION)/.test(tipo)) return "cimentacion";
  if (/^IFC(COLUMN|BEAM|MEMBER|REINFORCING|TENDON)/.test(tipo)) return "estructura";
  if (/^IFCSLAB/.test(tipo)) {
    if (predefinido === "ROOF") return "cubierta";
    if (predefinido === "BASESLAB") return "cimentacion";
    return "losas";
  }
  if (/^IFCROOF/.test(tipo)) return "cubierta";
  if (/^IFCWALL/.test(tipo)) return "muros";
  if (/^IFC(WINDOW|DOOR)/.test(tipo)) return "carpinteria";
  if (/^IFC(CURTAINWALL|PLATE|SHADINGDEVICE)/.test(tipo)) return "fachada";
  if (/^IFC(STAIR|RAMP|RAILING)/.test(tipo)) return "circulacion";
  if (/^IFC(FLOW|DISTRIBUTION|ENERGY|DUCT|PIPE|CABLE|SANITARY|LIGHT|ELECTRIC|AIRTERMINAL|VALVE|PUMP|TANK|FIRE)/.test(tipo))
    return "instalaciones";
  if (/^IFC(FURNI|SYSTEMFURN)/.test(tipo)) return "mobiliario";
  if (/^IFCCOVERING/.test(tipo)) return "acabados";
  if (/^IFC(SITE|GEOGRAPHIC|EARTHWORKS)/.test(tipo)) return "terreno";
  return "otros";
}

const valor = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);
const texto = (x) => String(valor(x) ?? "").trim();

console.time("total");
const api = new WebIFC.IfcAPI();
await api.Init();
const datos = readFileSync(rutaIfc);
const modelo = api.OpenModel(new Uint8Array(datos), { COORDINATE_TO_ORIGIN: true });
const esquema = api.GetModelSchema(modelo);

const idsDe = (tipo) => {
  const v = api.GetLineIDsWithType(modelo, tipo, true);
  const out = [];
  for (let i = 0; i < v.size(); i++) out.push(v.get(i));
  return out;
};
const linea = (id, plano = false) => {
  try {
    return api.GetLine(modelo, id, plano);
  } catch {
    return null;
  }
};

// --- Fuente: aplicación de autoría declarada en el archivo (sin datos personales).
let aplicacion = "";
for (const id of idsDe(WebIFC.IFCAPPLICATION)) {
  const l = linea(id);
  aplicacion = texto(l?.ApplicationFullName) || texto(l?.ApplicationIdentifier);
  if (aplicacion) break;
}

// --- Niveles y relaciones espaciales declarados en el IFC.
const nivelesIfc = idsDe(WebIFC.IFCBUILDINGSTOREY).map((id) => {
  const l = linea(id);
  return { id, nombre: texto(l?.Name) || texto(l?.LongName) || `Nivel ${id}`, elevacion: Number(valor(l?.Elevation) ?? 0) };
});
const nivelDe = new Map(); // elemento -> id de nivel
for (const id of idsDe(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
  const rel = linea(id);
  const contenedor = valor(rel?.RelatingStructure);
  if (!nivelesIfc.some((n) => n.id === contenedor)) continue;
  for (const e of rel.RelatedElements ?? []) nivelDe.set(valor(e), contenedor);
}
const padreDe = new Map(); // parte -> conjunto que la agrega
for (const id of idsDe(WebIFC.IFCRELAGGREGATES)) {
  const rel = linea(id);
  const padre = valor(rel?.RelatingObject);
  for (const e of rel?.RelatedObjects ?? []) padreDe.set(valor(e), padre);
}

// --- Material declarado de cada elemento (solo el nombre), para que el perfil pueda validarlo.
const nombreMaterial = (id, fondo = 0) => {
  const l = fondo < 5 ? linea(id) : null;
  if (!l) return "";
  const lista = l.MaterialLayers ?? l.MaterialConstituents ?? l.MaterialProfiles ?? l.Materials;
  if (lista) return [...new Set(lista.map((x) => nombreMaterial(valor(x), fondo + 1)).filter(Boolean))].join("+");
  const siguiente = l.ForLayerSet ?? l.ForProfileSet ?? l.Material;
  if (siguiente) return nombreMaterial(valor(siguiente), fondo + 1);
  return texto(l.Name);
};
const materialDe = new Map();
for (const id of idsDe(WebIFC.IFCRELASSOCIATESMATERIAL)) {
  const rel = linea(id);
  const material = nombreMaterial(valor(rel?.RelatingMaterial));
  if (!material) continue;
  for (const e of rel.RelatedObjects ?? []) materialDe.set(valor(e), material);
}
const nombreNivel = new Map(nivelesIfc.map((n) => [n.id, n.nombre]));

// --- Programación de obra (4D), si el archivo la trae: tareas, fechas y elementos.
const fechaIso = (dt) => {
  const d = dt?.DateComponent;
  const anio = Number(valor(d?.YearComponent)), mes = Number(valor(d?.MonthComponent)), dia = Number(valor(d?.DayComponent));
  if (!anio || !mes || !dia) return null;
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
};
const tareas = new Map(); // id -> { codigo, nombre, inicio, fin, padre, elementos:Set }
for (const id of idsDe(WebIFC.IFCTASK)) {
  const l = linea(id);
  const tarea = { id, codigo: texto(l?.TaskId) || texto(l?.Identification), nombre: texto(l?.Name), inicio: null, fin: null, finReal: null, padre: null, elementos: new Set() };
  // IFC4: las fechas viven en IfcTaskTime. Se guarda cada una por separado, sin completar las que faltan.
  const tiempo = l?.TaskTime ? linea(valor(l.TaskTime)) : null;
  if (tiempo) {
    const dia = (x) => (/^\d{4}-\d{2}-\d{2}/.test(texto(x)) ? texto(x).slice(0, 10) : null);
    tarea.inicio = dia(tiempo.ScheduleStart) ?? dia(tiempo.ActualStart);
    tarea.fin = dia(tiempo.ScheduleFinish);
    tarea.finReal = dia(tiempo.ActualFinish);
  }
  tareas.set(id, tarea);
}
// IFC4: el vínculo entre tarea y elemento es IfcRelAssignsToProduct (el producto es el elemento).
for (const id of idsDe(WebIFC.IFCRELASSIGNSTOPRODUCT)) {
  const rel = linea(id);
  const producto = valor(rel?.RelatingProduct);
  for (const t of rel?.RelatedObjects ?? []) tareas.get(valor(t))?.elementos.add(producto);
}
for (const id of idsDe(WebIFC.IFCRELASSIGNSTASKS)) {
  const rel = linea(id);
  const control = linea(valor(rel?.TimeForTask), true);
  if (!control) continue;
  const inicio = fechaIso(control.ScheduleStart) ?? fechaIso(control.EarlyStart) ?? fechaIso(control.ActualStart);
  const fin = fechaIso(control.ScheduleFinish) ?? fechaIso(control.EarlyFinish) ?? fechaIso(control.ActualFinish);
  for (const t of rel.RelatedObjects ?? []) {
    const tarea = tareas.get(valor(t));
    if (tarea) Object.assign(tarea, { inicio, fin });
  }
}
for (const id of idsDe(WebIFC.IFCRELASSIGNSTOPROCESS)) {
  const rel = linea(id);
  const tarea = tareas.get(valor(rel?.RelatingProcess));
  if (!tarea) continue;
  for (const e of rel.RelatedObjects ?? []) tarea.elementos.add(valor(e));
}
for (const id of idsDe(WebIFC.IFCRELNESTS)) {
  const rel = linea(id);
  const padre = tareas.get(valor(rel?.RelatingObject));
  if (!padre) continue;
  for (const h of rel.RelatedObjects ?? []) {
    const hija = tareas.get(valor(h));
    if (hija) hija.padre = padre.id;
  }
}
const GENERALES = new Set(perfil.tareasGenerales ?? []);
const tareasDe = new Map(); // elemento -> tareas con fechas válidas
for (const t of tareas.values()) {
  if (!t.inicio || !t.fin) continue;
  if (t.fin < t.inicio) [t.inicio, t.fin] = [t.fin, t.inicio]; // algunas tareas vienen con las fechas cruzadas
  for (const e of t.elementos) {
    if (!tareasDe.has(e)) tareasDe.set(e, []);
    tareasDe.get(e).push(t);
  }
}
const hayPrograma = tareasDe.size > 0;

// --- Hitos: tareas que solo traen fecha real de terminación. No hay comienzo ni duración,
// así que cada conjunto se fecha con un único día y no se interpola nada.
const hitos = []; // { fecha, codigo, nombre, alias[], elementos:Set, padre }
const sinFecha = [];
if (!hayPrograma) {
  for (const t of tareas.values()) {
    if (!t.finReal) {
      if (t.nombre) sinFecha.push(t);
      continue;
    }
    if (!t.elementos.size) continue;
    // Dos tareas con la misma fecha y los mismos elementos son el mismo hito con dos nombres.
    const igual = hitos.find((h) => h.fecha === t.finReal && h.elementos.size === t.elementos.size && [...t.elementos].every((e) => h.elementos.has(e)));
    if (igual) igual.alias.push({ codigo: t.codigo, nombre: t.nombre });
    else hitos.push({ fecha: t.finReal, codigo: t.codigo, nombre: t.nombre, alias: [], elementos: new Set(t.elementos), padre: t.padre });
  }
  hitos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
}
const hayHitos = hitos.length > 0;
const hitoDe = new Map(); // elemento -> índice de su primer hito
hitos.forEach((h, i) => {
  for (const e of h.elementos) if (!hitoDe.has(e)) hitoDe.set(e, i);
});
/** Hito de un elemento o del conjunto que lo agrega. */
function hitoDeElemento(id) {
  let actual = id;
  for (let i = 0; i < 6 && actual !== undefined; i++) {
    if (hitoDe.has(actual)) return hitoDe.get(actual);
    actual = padreDe.get(actual);
  }
  return null;
}
/** Ventana de ejecución de un elemento: de su primera tarea a la última. */
function ventanaDe(id) {
  const todas = tareasDe.get(id);
  if (!todas?.length) return null;
  // Una tarea general (por ejemplo «acabados», que abarca todo el edificio) solo fija
  // la ventana de los elementos que no tienen ninguna otra tarea.
  const propias = todas.filter((t) => !GENERALES.has(t.codigo));
  const usar = propias.length ? propias : todas;
  let inicio = usar[0].inicio, fin = usar[0].fin;
  for (const t of usar) {
    if (t.inicio < inicio) inicio = t.inicio;
    if (t.fin > fin) fin = t.fin;
  }
  return { inicio, fin, general: !propias.length };
}

const tipoCache = new Map();
const tipoDe = (id) => {
  if (!tipoCache.has(id)) {
    let nombreTipo = "";
    try {
      nombreTipo = api.GetNameFromTypeCode(api.GetLineType(modelo, id)) ?? "";
    } catch {
      /* línea sin tipo */
    }
    tipoCache.set(id, String(nombreTipo).toUpperCase());
  }
  return tipoCache.get(id);
};

const HEREDAN = /^IFC(CURTAINWALL|STAIR|RAMP|ROOF|RAILING)/;
function clasificar(id, datosLinea, contexto) {
  const tipo = tipoDe(id);
  const nombreElemento = texto(datosLinea?.Name).replace(/_?\(#\d+\)$/, "").trim();
  const nombresTareas = (tareasDe.get(id) ?? []).filter((t) => !GENERALES.has(t.codigo)).map((t) => t.nombre);
  const propio = perfil.grupoDe?.(tipo, nombreElemento, nombresTareas, contexto);
  if (propio) return propio;
  // Las partes de un muro cortina, una escalera o una cubierta heredan su sistema.
  let actual = id;
  for (let i = 0; i < 6; i++) {
    const padre = padreDe.get(actual);
    if (padre === undefined) break;
    if (HEREDAN.test(tipoDe(padre))) return grupoPorClase(tipoDe(padre), "");
    actual = padre;
  }
  const predefinido = /^IFCSLAB/.test(tipo) ? texto(datosLinea?.PredefinedType) : "";
  return grupoPorClase(tipo, predefinido);
}
function nivelDeElemento(id) {
  let actual = id;
  for (let i = 0; i < 8; i++) {
    if (nivelDe.has(actual)) return nivelDe.get(actual);
    const padre = padreDe.get(actual);
    if (padre === undefined) return undefined;
    actual = padre;
  }
  return undefined;
}

function unir(trozos, Tipo) {
  const total = trozos.reduce((s, t) => s + t.length, 0);
  const out = new Tipo(total);
  let o = 0;
  for (const t of trozos) {
    out.set(t, o);
    o += t.length;
  }
  return out;
}

// --- Geometría: se acumula por elemento y luego se reparte en cubos.
const elementos = []; // { id, grupo, nivelId, vidrio, ventana, pos, idx, minY, maxY }
const excluidos = []; // objetos auxiliares que el perfil deja fuera
const destacados = new Map(); // clave -> caja y piezas señaladas por el perfil
let trianguloTotal = 0;
api.StreamAllMeshes(modelo, (malla) => {
  const id = malla.expressID;
  const datosLinea = linea(id);
  const nombreLimpio = texto(datosLinea?.Name).replace(/_?\(#\d+\)$/, "").trim();
  const hito = hayHitos ? hitoDeElemento(id) : null;
  let conMaterial = id;
  for (let i = 0; i < 4 && conMaterial !== undefined && !materialDe.has(conMaterial); i++) conMaterial = padreDe.get(conMaterial);
  const contexto = {
    id,
    nivel: nombreNivel.get(nivelDeElemento(id)) ?? "",
    material: materialDe.get(conMaterial) ?? "",
    predefinido: texto(datosLinea?.PredefinedType),
    hito: hito === null ? null : hitos[hito].codigo,
    conTarea: hito !== null || tareasDe.has(id),
  };
  if (perfil.excluir?.(tipoDe(id), nombreLimpio, contexto)) {
    excluidos.push(nombreLimpio);
    return;
  }
  const grupo = clasificar(id, datosLinea, contexto);
  if (SIN_TERRENO && grupo === "terreno") return;
  const piezas = { solido: { pos: [], idx: [], n: 0 }, vidrio: { pos: [], idx: [], n: 0 } };
  const geos = malla.geometries;
  for (let g = 0; g < geos.size(); g++) {
    const colocada = geos.get(g);
    const geo = api.GetGeometry(modelo, colocada.geometryExpressID);
    const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
    const ind = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
    const m = colocada.flatTransformation;
    const destino = colocada.color.w < 0.95 ? piezas.vidrio : piezas.solido;
    const p = new Float32Array((v.length / 6) * 3);
    for (let i = 0, j = 0; i < v.length; i += 6, j += 3) {
      const x = v[i], y = v[i + 1], z = v[i + 2];
      p[j] = m[0] * x + m[4] * y + m[8] * z + m[12];
      p[j + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      p[j + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    const desplazado = new Uint32Array(ind.length);
    for (let i = 0; i < ind.length; i++) desplazado[i] = ind[i] + destino.n;
    destino.pos.push(p);
    destino.idx.push(desplazado);
    destino.n += p.length / 3;
    geo.delete();
  }
  const ventana = hayPrograma ? ventanaDe(id) : null;
  for (const [clave, pieza] of Object.entries(piezas)) {
    if (!pieza.n) continue;
    const pos = unir(pieza.pos, Float32Array);
    const idx = unir(pieza.idx, Uint32Array);
    const cajaMin = [Infinity, Infinity, Infinity], cajaMax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (pos[i + k] < cajaMin[k]) cajaMin[k] = pos[i + k];
        if (pos[i + k] > cajaMax[k]) cajaMax[k] = pos[i + k];
      }
    }
    const minY = cajaMin[1], maxY = cajaMax[1];
    trianguloTotal += idx.length / 3;
    // Piezas que el perfil quiere poder señalar por separado (por ejemplo, una viga y su apoyo).
    const destacado = perfil.destacar?.(tipoDe(id), nombreLimpio, { ...contexto, min: cajaMin, max: cajaMax }) ?? null;
    if (destacado) {
      if (!destacados.has(destacado)) destacados.set(destacado, { clave: destacado, min: [...cajaMin], max: [...cajaMax], piezas: [] });
      const d = destacados.get(destacado);
      for (let k = 0; k < 3; k++) {
        d.min[k] = Math.min(d.min[k], cajaMin[k]);
        d.max[k] = Math.max(d.max[k], cajaMax[k]);
      }
      d.piezas.push({ guid: texto(datosLinea?.GlobalId), clase: tipoDe(id), nombre: nombreLimpio, material: contexto.material, nivel: contexto.nivel });
    }
    elementos.push({ id, grupo, nivelId: nivelDeElemento(id), vidrio: clave === "vidrio" && !perfil.sinVidrio, ventana, hito, destacado, pos, idx, minY, maxY });
  }
});

// --- Niveles: los del perfil (por cota de base) o los declarados en el IFC.
let niveles;
if (perfil.niveles?.length) {
  niveles = perfil.niveles.map((n, i) => ({ i, nombre: n.nombre, y: n.desde }));
  // Las piezas de un mismo conjunto (por ejemplo, una columna con sus tramos soldados)
  // comparten nivel: el de la base del conjunto. Así el despiece no separa lo que está unido.
  const baseConjunto = new Map();
  if (perfil.nivelPorConjunto) {
    for (const e of elementos) {
      const padre = padreDe.get(e.id);
      if (padre === undefined || tipoDe(padre) !== "IFCELEMENTASSEMBLY") continue;
      baseConjunto.set(padre, Math.min(baseConjunto.get(padre) ?? Infinity, e.minY));
    }
  }
  for (const e of elementos) {
    const base = baseConjunto.get(padreDe.get(e.id)) ?? e.minY;
    let i = 0;
    for (const n of niveles) if (n.y <= base + 1e-3) i = n.i;
    e.nivel = i;
  }
  // La cota que se guarda es la base real del nivel medida en la geometría.
  for (const n of niveles) {
    const bases = elementos.filter((e) => e.nivel === n.i).map((e) => e.minY).sort((a, b) => a - b);
    n.y = bases.length ? bases[Math.floor(bases.length * 0.05)] : n.y;
  }
} else {
  // Altura real de cada nivel medida en la geometría (independiente de las unidades del IFC).
  for (const n of nivelesIfc) {
    const propios = elementos.filter((e) => e.nivelId === n.id && (e.grupo === "losas" || e.grupo === "muros" || e.grupo === "estructura"));
    const base = propios.length ? propios : elementos.filter((e) => e.nivelId === n.id);
    const alturas = base.map((e) => e.minY).sort((a, b) => a - b);
    n.y = alturas.length ? alturas[Math.floor(alturas.length * 0.1)] : NaN;
  }
  niveles = nivelesIfc.filter((n) => Number.isFinite(n.y)).sort((a, b) => a.y - b.y || a.elevacion - b.elevacion);
  niveles.forEach((n, i) => (n.i = i));
  const indiceNivel = new Map(niveles.map((n) => [n.id, n.i]));
  // Elementos sin nivel declarado: van al nivel cuya base queda por debajo de su centro.
  for (const e of elementos) {
    let i = indiceNivel.get(e.nivelId);
    if (i === undefined) {
      const centro = (e.minY + e.maxY) / 2;
      i = 0;
      for (const n of niveles) if (n.y <= centro + 0.05) i = n.i;
    }
    e.nivel = i;
  }
}

// --- Cubos: nivel | sistema | vidrio | ventana de ejecución.
const compacta = (iso) => iso.slice(2).replaceAll("-", "");
const cubos = new Map();
const idsPorNivel = new Map();
const idsPorGrupo = new Map();
for (const e of elementos) {
  const sufijo =
    (e.ventana ? `_${compacta(e.ventana.inicio)}_${compacta(e.ventana.fin)}` : "") +
    (e.hito !== null && e.hito !== undefined ? `_h${e.hito}` : hayHitos ? "_hx" : "") +
    (e.destacado ? `_d-${e.destacado}` : "");
  const clave = `n${String(e.nivel).padStart(2, "0")}_${e.grupo}${e.vidrio ? "_vidrio" : ""}${sufijo}`;
  if (!cubos.has(clave))
    cubos.set(clave, { clave, nivel: e.nivel, grupo: e.grupo, vidrio: e.vidrio, inicio: e.ventana?.inicio ?? null, fin: e.ventana?.fin ?? null, general: Boolean(e.ventana?.general), hito: e.hito ?? null, destacado: e.destacado ?? null, pos: [], idx: [], n: 0, ids: new Set() });
  const c = cubos.get(clave);
  const desplazado = new Uint32Array(e.idx.length);
  for (let i = 0; i < e.idx.length; i++) desplazado[i] = e.idx[i] + c.n;
  c.pos.push(e.pos);
  c.idx.push(desplazado);
  c.n += e.pos.length / 3;
  c.ids.add(e.id);
  if (!idsPorNivel.has(e.nivel)) idsPorNivel.set(e.nivel, new Set());
  idsPorNivel.get(e.nivel).add(e.id);
  if (!idsPorGrupo.has(e.grupo)) idsPorGrupo.set(e.grupo, new Set());
  idsPorGrupo.get(e.grupo).add(e.id);
}
api.CloseModel(modelo);

// --- Documento glTF.
const doc = new Document();
doc.getRoot().getAsset().generator = "ObraCota · ifc-a-glb";
const bufer = doc.createBuffer();
const escena = doc.createScene("modelo");
const nodos = [];
for (const c of [...cubos.values()].sort((a, b) => a.clave.localeCompare(b.clave))) {
  const posicion = doc.createAccessor(`${c.clave}_p`).setType("VEC3").setArray(unir(c.pos, Float32Array)).setBuffer(bufer);
  const indices = doc.createAccessor(`${c.clave}_i`).setType("SCALAR").setArray(unir(c.idx, Uint32Array)).setBuffer(bufer);
  const primitiva = doc.createPrimitive().setAttribute("POSITION", posicion).setIndices(indices);
  const malla = doc.createMesh(c.clave).addPrimitive(primitiva);
  const nodo = doc.createNode(c.clave).setMesh(malla).setExtras({ nivel: c.nivel, grupo: c.grupo, vidrio: c.vidrio, elementos: c.ids.size, ...(c.hito !== null ? { hito: c.hito } : {}), ...(c.destacado ? { destacado: c.destacado } : {}) });
  escena.addChild(nodo);
  nodos.push({ c, nodo, malla });
}

await doc.transform(weld());

const SIN_ARISTAS = new Set(perfil.sinAristas ?? []);
// Aristas vivas: bordes libres y pliegues de más de 32°, para dibujar el modelo como lámina.
let aristaTotal = 0;
for (const { c, nodo, malla } of nodos) {
  const prim = malla.listPrimitives()[0];
  const pos = prim.getAttribute("POSITION").getArray();
  const idx = prim.getIndices().getArray();
  const caras = idx.length / 3;
  const normales = new Float32Array(caras * 3);
  for (let f = 0; f < caras; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, d = idx[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[d] - pos[a], vy = pos[d + 1] - pos[a + 1], vz = pos[d + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const largo = Math.hypot(nx, ny, nz) || 1;
    normales[f * 3] = nx / largo;
    normales[f * 3 + 1] = ny / largo;
    normales[f * 3 + 2] = nz / largo;
  }
  const bordes = new Map(); // clave -> [cara, veces, viva]
  const K = 2 ** 26;
  for (let f = 0; f < caras; f++) {
    for (let k = 0; k < 3; k++) {
      const p = idx[f * 3 + k], q = idx[f * 3 + ((k + 1) % 3)];
      if (p === q) continue;
      const clave = p < q ? p * K + q : q * K + p;
      const previo = bordes.get(clave);
      if (!previo) bordes.set(clave, [f, 1, false]);
      else {
        previo[1]++;
        const g = previo[0];
        const punto = normales[f * 3] * normales[g * 3] + normales[f * 3 + 1] * normales[g * 3 + 1] + normales[f * 3 + 2] * normales[g * 3 + 2];
        if (Math.abs(punto) < ANGULO_ARISTA || previo[1] > 2) previo[2] = true;
      }
    }
  }
  const lineas = [];
  for (const [clave, [, veces, viva]] of bordes) {
    if (veces === 1 || viva) lineas.push(Math.floor(clave / K), clave % K);
  }
  aristaTotal += lineas.length / 2;
  c.aristas = lineas.length / 2;
  c.triangulos = caras;
  if (lineas.length && !c.vidrio && !SIN_ARISTAS.has(c.grupo)) {
    // Copia propia de los vértices usados por las aristas: la malla puede simplificarse después.
    const usados = new Map();
    const lp = [];
    const li = new Uint32Array(lineas.length);
    lineas.forEach((v, i) => {
      if (!usados.has(v)) {
        usados.set(v, lp.length / 3);
        lp.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
      li[i] = usados.get(v);
    });
    const ap = doc.createAccessor(`${c.clave}_lp`).setType("VEC3").setArray(new Float32Array(lp)).setBuffer(bufer);
    const ai = doc.createAccessor(`${c.clave}_li`).setType("SCALAR").setArray(li).setBuffer(bufer);
    const lineasPrim = doc.createPrimitive().setMode(1).setAttribute("POSITION", ap).setIndices(ai);
    const mallaLineas = doc.createMesh(`${c.clave}__aristas`).addPrimitive(lineasPrim);
    nodo.addChild(doc.createNode(`${c.clave}__aristas`).setMesh(mallaLineas));
  }
}

if (RAZON < 1) {
  await MeshoptSimplifier.ready;
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: RAZON, error: 0.0005, lockBorder: true }));
}
// Simplificación por sistema: el perfil puede aligerar lo que nunca se ve de cerca.
if (perfil.simplificar) {
  await MeshoptSimplifier.ready;
  for (const { c, malla } of nodos) {
    const regla = perfil.simplificar[c.grupo];
    if (!regla || c.destacado) continue;
    for (const prim of malla.listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: regla.razon, error: regla.error ?? 0.001, lockBorder: false });
  }
}
await MeshoptEncoder.ready;
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await doc.transform(dedup(), prune(), quantize({ quantizePosition: 16 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));

mkdirSync(carpeta, { recursive: true });
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const glb = await io.writeBinary(doc);
writeFileSync(join(carpeta, `${nombre}.glb`), glb);

// --- Ficha del modelo para la interfaz.
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const e of elementos) {
  for (let i = 0; i < e.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (e.pos[i + k] < min[k]) min[k] = e.pos[i + k];
      if (e.pos[i + k] > max[k]) max[k] = e.pos[i + k];
    }
  }
}
const redondo = (n) => Math.round(n * 1000) / 1000;
const trianguloFinal = doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().filter((p) => p.getMode() === 4).reduce((t, p) => t + p.getIndices().getCount() / 3, 0), 0);

let programa = null;
if (hayPrograma) {
  // Todas las tareas con nombre y fechas: las que no mueven elementos (replanteos,
  // movimiento de tierras, andamios) también sirven para rotular la línea de tiempo.
  const conElementos = [...tareas.values()].filter((t) => t.nombre && t.inicio && t.fin);
  const todasFechas = [...tareas.values()].filter((t) => t.inicio && t.fin);
  programa = {
    inicio: todasFechas.reduce((m, t) => (t.inicio < m ? t.inicio : m), todasFechas[0].inicio),
    fin: todasFechas.reduce((m, t) => (t.fin > m ? t.fin : m), todasFechas[0].fin),
    tareasTotales: tareas.size,
    tareas: conElementos
      .map((t) => ({
        codigo: t.codigo,
        nombre: t.nombre,
        grupo: t.padre ? (tareas.get(t.padre)?.nombre ?? "") : "",
        inicio: t.inicio,
        fin: t.fin,
        elementos: t.elementos.size,
        general: GENERALES.has(t.codigo),
      }))
      .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fin.localeCompare(b.fin) || a.codigo.localeCompare(b.codigo)),
  };
}

const cuentaExcluidos = new Map();
for (const n of excluidos) cuentaExcluidos.set(n, (cuentaExcluidos.get(n) ?? 0) + 1);
const ficha = {
  fuente: { archivo: basename(rutaIfc), esquema, aplicacion, bytesIfc: datos.length, excluidos: [...cuentaExcluidos].map(([n, veces]) => (veces > 1 ? `${n} ×${veces}` : n)) },
  caja: { min: min.map(redondo), max: max.map(redondo) },
  niveles: niveles.map((n) => ({ i: n.i, nombre: n.nombre, y: redondo(n.y), elementos: idsPorNivel.get(n.i)?.size ?? 0 })),
  grupos: [...idsPorGrupo.entries()].map(([id, s]) => ({ id, elementos: s.size })).sort((a, b) => b.elementos - a.elementos),
  estructurales: perfil.estructurales ?? ["cimentacion", "estructura", "losas"],
  cubos: [...cubos.values()]
    .map((c) => ({ clave: c.clave, nivel: c.nivel, grupo: c.grupo, vidrio: c.vidrio, elementos: c.ids.size, ...(c.inicio ? { inicio: c.inicio, fin: c.fin, general: c.general } : {}), ...(c.hito !== null ? { hito: c.hito } : {}), ...(c.destacado ? { destacado: c.destacado } : {}) }))
    .sort((a, b) => a.clave.localeCompare(b.clave)),
  programa,
  hitos: hayHitos
    ? {
        // Cada hito es una fecha real de terminación; no hay comienzos ni duraciones en el archivo.
        lista: hitos.map((h, i) => ({
          i,
          codigo: h.codigo,
          nombre: h.nombre,
          alias: h.alias,
          fecha: h.fecha,
          grupo: h.padre ? (tareas.get(h.padre)?.nombre ?? "") : "",
          elementos: new Set(elementos.filter((e) => e.hito === i).map((e) => e.id)).size,
        })),
        sinFecha: sinFecha.map((t) => ({ codigo: t.codigo, nombre: t.nombre, elementos: t.elementos.size })),
        elementosSinHito: new Set(elementos.filter((e) => e.hito === null).map((e) => e.id)).size,
        tareasTotales: tareas.size,
      }
    : null,
  destacados: [...destacados.values()].map((d) => ({ ...d, min: d.min.map(redondo), max: d.max.map(redondo) })),
  totales: {
    elementos: new Set(elementos.map((e) => e.id)).size,
    triangulosIfc: trianguloTotal,
    triangulosGlb: Math.round(trianguloFinal),
    aristas: aristaTotal,
    bytesGlb: glb.byteLength,
  },
};
writeFileSync(join(carpeta, `${nombre}.json`), JSON.stringify(ficha, null, 1));
console.timeEnd("total");
console.log(
  JSON.stringify(
    {
      esquema,
      aplicacion,
      niveles: ficha.niveles,
      grupos: ficha.grupos,
      cubos: ficha.cubos.length,
      vidrio: ficha.cubos.filter((c) => c.vidrio).length,
      programa: programa && { inicio: programa.inicio, fin: programa.fin, tareas: programa.tareas.length, tareasTotales: programa.tareasTotales },
      hitos: ficha.hitos,
      destacados: ficha.destacados.map((d) => ({ clave: d.clave, piezas: d.piezas.length, min: d.min, max: d.max })),
      excluidos: ficha.fuente.excluidos,
      totales: ficha.totales,
    },
    null,
    1,
  ),
);
if (programa) for (const t of programa.tareas) console.log(`${t.inicio} ${t.fin} ${t.codigo.padEnd(8)} ${String(t.elementos).padStart(5)}  ${t.grupo ? t.grupo + " › " : ""}${t.nombre}${t.general ? "  [general]" : ""}`);
