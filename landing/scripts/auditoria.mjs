// Auditoría visual: captura cada sección en varios tamaños y mide lo que se puede medir
// (alto de sección frente a la ventana, desbordes, resolución real de las imágenes).
// Uso: node scripts/auditoria.mjs [url] [carpeta]   (el sitio debe estar en marcha)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3002";
const carpeta = process.argv[3] ?? "test-results/auditoria";
const TAMANOS = [
  { nombre: "monitor-1920x1080", width: 1920, height: 1080, dpr: 1 },
  { nombre: "escritorio-1440x900", width: 1440, height: 900, dpr: 1 },
  { nombre: "portatil-1366x768", width: 1366, height: 768, dpr: 1 },
  { nombre: "portatil-bajo-1280x620", width: 1280, height: 620, dpr: 1.5 },
  { nombre: "movil-390x844", width: 390, height: 844, dpr: 3, movil: true },
];
mkdirSync(carpeta, { recursive: true });
const navegador = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const informe = {};
for (const t of TAMANOS) {
  const contexto = await navegador.newContext({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: t.dpr, isMobile: Boolean(t.movil), hasTouch: Boolean(t.movil) });
  const pagina = await contexto.newPage();
  await pagina.goto(url, { waitUntil: "load" });
  await pagina.waitForTimeout(2500);
  const secciones = await pagina.evaluate(() => [...document.querySelectorAll("main > section, main > div, footer")].map((s, i) => s.id || s.tagName.toLowerCase() + i));
  const datos = [];
  for (const [i, id] of secciones.entries()) {
    const medida = await pagina.evaluate(async (indice) => {
      const s = [...document.querySelectorAll("main > section, main > div, footer")][indice];
      const fijado = window.ScrollTrigger?.getAll().find((x) => x.pin && s.contains(x.pin));
      const y = s.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, y));
      await new Promise((r) => setTimeout(r, 1700));
      const r = s.getBoundingClientRect();
      const imagenes = [...s.querySelectorAll("img")].map((im) => ({
        src: (im.currentSrc || im.src).split("/").pop().slice(0, 60),
        natural: `${im.naturalWidth}x${im.naturalHeight}`,
        pintada: `${Math.round(im.getBoundingClientRect().width)}x${Math.round(im.getBoundingClientRect().height)}`,
        // Píxeles de imagen por píxel físico de pantalla: por debajo de 1 se ve blanda.
        nitidez: +(im.naturalWidth / (im.getBoundingClientRect().width * window.devicePixelRatio || 1)).toFixed(2),
      }));
      const pequenos = [...s.querySelectorAll("a, button, input, [role=button]")].filter((b) => {
        const c = b.getBoundingClientRect();
        return c.width > 0 && (c.width < 44 || c.height < 44) && getComputedStyle(b).visibility !== "hidden";
      }).length;
      return {
        alto: Math.round(r.height),
        ventanas: +(r.height / window.innerHeight).toFixed(2),
        fijado: fijado ? Math.round(fijado.end - fijado.start) : 0,
        desbordeX: document.documentElement.scrollWidth > window.innerWidth,
        imagenes,
        objetivosPequenos: pequenos,
      };
    }, i);
    datos.push({ id, ...medida });
    await pagina.screenshot({ path: join(carpeta, `${t.nombre}-${String(i).padStart(2, "0")}-${id}.jpg`), type: "jpeg", quality: 70 });
  }
  informe[t.nombre] = datos;
  await contexto.close();
  console.log(t.nombre, datos.map((d) => `${d.id}:${d.ventanas}`).join(" "));
}
writeFileSync(join(carpeta, "medidas.json"), JSON.stringify(informe, null, 1));
await navegador.close();
