// Capturas del recorrido 3D en varios puntos del scroll, en escritorio y móvil.
// Uso: node scripts/capturas-recorrido.mjs [url] [carpeta]   (el sitio debe estar en marcha)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3002";
const carpeta = process.argv[3] ?? "test-results/capturas/recorrido";
const PUNTOS = (process.argv[4] ?? "0.01,0.2,0.4,0.545,0.635,0.74,0.83,0.9,0.95,1").split(",").map(Number);
const FORMATOS = [
  { nombre: "escritorio", opciones: { viewport: { width: 1440, height: 900 } } },
  { nombre: "movil", opciones: { ...devices["Pixel 7"] } },
];
mkdirSync(carpeta, { recursive: true });
const navegador = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const f of FORMATOS) {
  const pagina = await (await navegador.newContext(f.opciones)).newPage();
  pagina.on("pageerror", (e) => console.log("error de página:", e.message));
  await pagina.goto(url, { waitUntil: "load" });
  await pagina.locator("#recorrido").scrollIntoViewIfNeeded();
  await pagina.waitForSelector("#recorrido[data-carga='listo']", { timeout: 90_000 });
  for (const p of PUNTOS) {
    await pagina.evaluate((avance) => {
      const st = window.ScrollTrigger.getAll().find((t) => t.pin);
      // El tramo fijado empieza con la entrada por la «O»; el recorrido ocupa el resto.
    const parte = Number(document.querySelector("#recorrido").dataset.tramoEntrada ?? 0);
    window.scrollTo(0, st.start + (st.end - st.start) * (parte + (1 - parte) * avance));
    }, p);
    await pagina.waitForTimeout(1600);
    await pagina.screenshot({ path: join(carpeta, `${f.nombre}-${String(Math.round(p * 1000)).padStart(4, "0")}.png`) });
    console.log(f.nombre, p, await pagina.locator("#recorrido").getAttribute("data-fase"), await pagina.locator("[data-lienzo]").getAttribute("data-camara"));
  }
  await pagina.close();
}
await navegador.close();
