import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { Matrix4, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";

// Planos XZ: aristas proyectadas entre la base y el corte, más intersecciones
// exactas con los triángulos a 1,20 m sobre la base de cada planta convertida.
const directorio = new URL("../public/modelos/", import.meta.url);
const ficha = JSON.parse(readFileSync(new URL("restage.json", directorio)));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.readBinary(readFileSync(new URL("restage.glb", directorio)));
const punto = new Vector3();
const coord = (p) => [p.z, -p.x].map(n => Number(n.toFixed(3))).join(",");
const sistemas = new Set(["acero", "hormigon", "madera", "fachada", "aislamiento"]);

const planos = [];
const caja = [Infinity, Infinity, -Infinity, -Infinity];
for (const [indice, nombre] of [[1, "baja"], [2, "alta"]]) {
  const base = ficha.niveles[indice].y;
  const corte = base + 1.2;
  const limites = [Infinity, Infinity, -Infinity, -Infinity];
  const proyeccion = new Set(), seccion = new Set();
  for (const nodo of doc.getRoot().listNodes()) {
    const malla = nodo.getMesh();
    if (!malla) continue;
    let padre = nodo;
    while (padre && !padre.getExtras().grupo) padre = padre.getParentNode();
    if (!sistemas.has(padre?.getExtras().grupo)) continue;
    const matriz = new Matrix4().fromArray(nodo.getWorldMatrix());
    for (const prim of malla.listPrimitives()) {
      const pos = prim.getAttribute("POSITION"), idx = prim.getIndices();
      const vertices = Array.from({length: pos.getCount()}, (_, i) =>
        punto.fromArray(pos.getElement(i, [])).applyMatrix4(matriz).clone());
      const lineas = prim.getMode() === 1;
      if (!lineas && prim.getMode() !== 4) continue;
      const paso = lineas ? 2 : 3;
      const contar = idx?.getCount() ?? vertices.length;
      for (let i = 0; i < contar; i += paso) {
        const v = Array.from({length: paso}, (_, j) => vertices[idx ? idx.getScalar(i+j) : i+j]);
        let puntos;
        if (lineas) {
          let [a,b] = v;
          if (a.y > b.y) [a,b] = [b,a];
          if (b.y < base - 0.03 || a.y > corte) continue;
          const dy = b.y-a.y;
          puntos = [a.y < base-0.03 ? a.clone().lerp(b,(base-0.03-a.y)/dy) : a,
            b.y > corte ? a.clone().lerp(b,(corte-a.y)/dy) : b];
        } else {
          puntos = [];
          for (let j=0;j<3;j++) {
            const a=v[j], b=v[(j+1)%3];
            if ((a.y<corte)!==(b.y<corte)) puntos.push(a.clone().lerp(b,(corte-a.y)/(b.y-a.y)));
          }
        }
        if (puntos.length !== 2) continue;
        const [p,q] = puntos;
        if (Math.hypot(p.x-q.x,p.z-q.z) < (lineas ? 0.025 : 0.001)) continue;
        for (const v of puntos) {
          limites[0] = Math.min(limites[0], v.z); limites[1] = Math.min(limites[1], -v.x);
          limites[2] = Math.max(limites[2], v.z); limites[3] = Math.max(limites[3], -v.x);
          caja[0] = Math.min(caja[0], v.z); caja[1] = Math.min(caja[1], -v.x);
          caja[2] = Math.max(caja[2], v.z); caja[3] = Math.max(caja[3], -v.x);
        }
        const [a,b] = puntos.map(coord).sort();
        (lineas ? proyeccion : seccion).add("M"+a+"L"+b);
      }
    }
  }
  if (!seccion.size || !proyeccion.size) throw Error("Falta geometría para la planta "+nombre);
  planos.push({ nombre, corte, proyeccion, seccion, limites });
}
// El mismo encuadre y escala permite comparar los niveles sin desplazar el edificio.
const margen = 1.35;
const vista = [caja[0]-margen, caja[1]-margen, caja[2]-caja[0]+2*margen, caja[3]-caja[1]+2*margen].join(" ");
for (const { nombre, corte, proyeccion, seccion, limites } of planos) {
  const credito = "Vista derivada por ObraCota del modelo ReStage de Chu Han Wu, Görkem Can Ertemli, Martin von Hilchen, Sigrid Brell-Cokcan y Marit Zöcklein. Fuente: https://zenodo.org/records/21470658. Licencia: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/.";
  // Una unidad del SVG equivale a un metro. Las cotas son la extensión
  // de la geometría representada en esta vista, no distancias entre ejes.
  const [x, y, derecha, abajo] = limites;
  const cotaX = y - 0.48, cotaY = x - 0.48;
  const metros = n => n.toLocaleString("es-CO", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const dimensiones = `<g fill="none" stroke="#52616c" stroke-width=".021">
    <path d="M${x} ${y-.15}V${cotaX-.15} M${derecha} ${y-.15}V${cotaX-.15} M${x} ${cotaX}H${derecha}
      M${x-.15} ${y}H${cotaY-.15} M${x-.15} ${abajo}H${cotaY-.15} M${cotaY} ${y}V${abajo}"/>
    </g><g font-family="Arial,sans-serif" font-size=".34" fill="#273744" text-anchor="middle">
    <text x="${(x+derecha)/2}" y="${cotaX-.12}">${metros(derecha-x)} m</text>
    <text transform="translate(${cotaY-.13} ${(y+abajo)/2}) rotate(-90)">${metros(abajo-y)} m</text></g>`;
  const escala = `<g transform="translate(${caja[0]} ${caja[3]+.65})" fill="#263745">
    <path d="M0 0H2 M0 -.1V.1 M1 -.1V.1 M2 -.1V.1" fill="none" stroke="currentColor" stroke-width=".035"/>
    <text x="2.2" y=".1" font-family="Arial,sans-serif" font-size=".32">2 m</text></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vista}"><title>ReStage · Planta ${nombre}</title><desc>Proyección de estructura y cerramientos. Corte horizontal a ${corte.toFixed(3)} m del modelo. ${credito}</desc><path d="${[...proyeccion].join("")}" fill="none" stroke="#647383" stroke-width=".014"/><path d="${[...seccion].join("")}" fill="none" stroke="#0a1522" stroke-width=".055" stroke-linecap="round"/>${dimensiones}${escala}</svg>`;
  writeFileSync(new URL("restage-planta-"+nombre+".svg", directorio), svg);
  console.log(nombre, proyeccion.size, seccion.size);
}
