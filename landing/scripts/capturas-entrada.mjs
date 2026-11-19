// Capturas cuadro a cuadro de la entrada al recorrido (la «O» de PLANO), en escritorio y móvil.
// Uso: node scripts/capturas-entrada.mjs [url] [carpeta] [cuadros]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3002";
const carpeta = process.argv[3] ?? "test-results/capturas/entrada";
const CUADROS = Number(process.argv[4] ?? 11);
mkdirSync(carpeta, { recursive: true });
const navegador = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const f of [{ n: "escritorio", o: { viewport: { width: 1440, height: 900 } } }, { n: "movil", o: { ...devices["Pixel 7"] } }]) {
  const pagina = await (await navegador.newContext(f.o)).newPage();
  pagina.on("pageerror", (e) => console.log("error de página:", e.message));
  await pagina.goto(url, { waitUntil: "load" });
  await pagina.locator("#recorrido").scrollIntoViewIfNeeded();
  await pagina.waitForSelector("#recorrido[data-carga='listo']", { timeout: 90_000 });
  for (let k = 0; k <= CUADROS; k++) {
    const q = k / CUADROS;
    const estado = await pagina.evaluate(async (avance) => {
      const seccion = document.querySelector("#recorrido");
      const st = window.ScrollTrigger.getAll().find((t) => t.pin);
      const parte = Number(seccion.dataset.tramoEntrada);
      window.scrollTo(0, st.start + (st.end - st.start) * parte * avance);
      await new Promise((r) => setTimeout(r, 1300));
      const capa = document.querySelector("[data-entrada]");
      return { caja: capa.querySelector("svg").getAttribute("viewBox").split(" ").map((n) => Math.round(Number(n))).join(" "), capa: getComputedStyle(capa).visibility, papel: Number(getComputedStyle(seccion.querySelector(".bg-bone")).opacity).toFixed(2), fase: seccion.dataset.fase };
    }, q);
    await pagina.screenshot({ path: join(carpeta, `${f.n}-${String(k).padStart(2, "0")}.jpg`), type: "jpeg", quality: 70 });
    console.log(f.n, q.toFixed(2), JSON.stringify(estado));
  }
  await pagina.close();
}
await navegador.close();
