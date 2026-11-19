// Capturas de la portada en varios puntos de su recorrido, en escritorio y móvil.
// Uso: node scripts/capturas-portada.mjs [url] [carpeta] [puntos]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3002";
const carpeta = process.argv[3] ?? "test-results/capturas/portada";
const PUNTOS = (process.argv[4] ?? "0,0.25,0.5,0.75,1").split(",").map(Number);
mkdirSync(carpeta, { recursive: true });
const navegador = await chromium.launch({ channel: "msedge" });
for (const f of [{ n: "escritorio", o: { viewport: { width: 1440, height: 900 } } }, { n: "movil", o: { ...devices["Pixel 7"] } }]) {
  const pagina = await (await navegador.newContext(f.o)).newPage();
  pagina.on("pageerror", (e) => console.log("error de página:", e.message));
  await pagina.goto(url, { waitUntil: "load" });
  await pagina.waitForTimeout(6000);
  for (const p of PUNTOS) {
    const estado = await pagina.evaluate(async (avance) => {
      const pista = document.querySelector("[data-portada-pista]");
      window.scrollTo(0, (pista.offsetHeight - window.innerHeight) * avance);
      await new Promise((r) => setTimeout(r, 1800));
      const capa = document.querySelector("[data-clips]");
      const fotos = [...document.querySelectorAll("[data-foto]")].map((x) => getComputedStyle(x).opacity);
      return { video: getComputedStyle(capa).opacity, fotos, tiempos: [...capa.querySelectorAll("video")].map((v) => +v.currentTime.toFixed(2)), nitidez: +(document.querySelector("[data-foto]").naturalWidth / (document.querySelector("[data-foto]").getBoundingClientRect().width * devicePixelRatio)).toFixed(2) };
    }, p);
    await pagina.screenshot({ path: join(carpeta, `${f.n}-${String(Math.round(p * 100)).padStart(3, "0")}.jpg`), type: "jpeg", quality: 72 });
    console.log(f.n, p, JSON.stringify(estado));
  }
  await pagina.close();
}
await navegador.close();
