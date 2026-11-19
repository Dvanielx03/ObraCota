// Capturas de cada sección para el README del repositorio.
// Uso: node scripts/capturas-readme.mjs <url> <carpeta-de-salida>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const [, , url = "http://localhost:3002", salida = "../docs/capturas"] = process.argv;
mkdirSync(salida, { recursive: true });

const navegador = await chromium.launch({ channel: "msedge", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const pagina = await contexto.newPage();
// El distintivo de desarrollo de Next no forma parte de la página.
const limpiar = () => pagina.addStyleTag({ content: "nextjs-portal{display:none!important}" });
const foto = (nombre) => pagina.screenshot({ path: join(salida, `${nombre}.jpg`), type: "jpeg", quality: 86 });
const rueda = async (pasos) => {
  for (let i = 0; i < pasos; i++) {
    await pagina.mouse.wheel(0, 100);
    await pagina.waitForTimeout(90);
  }
  await pagina.waitForTimeout(1600);
};
const enAncla = (id) => pagina.waitForFunction((s) => Math.abs(document.querySelector(s).getBoundingClientRect().top) < 160, `#${id}`);

await pagina.goto(url, { waitUntil: "load" });
await limpiar();
await pagina.mouse.move(700, 450);
await pagina.waitForTimeout(2500);
await foto("01-portada-terreno");
await rueda(13);
await foto("02-portada-obra");

await pagina.goto(`${url}/#recorrido`, { waitUntil: "load" });
await limpiar();
await enAncla("recorrido");
await pagina.waitForFunction(() => Number(document.querySelector("[data-triangulos]")?.getAttribute("data-triangulos") ?? 0) > 0, null, { timeout: 60_000 }).catch(() => {});
await pagina.mouse.move(700, 450);
await rueda(26);
await foto("03-recorrido-3d");
await rueda(22);
await foto("04-recorrido-detalle");

await pagina.goto(`${url}/#expediente`, { waitUntil: "load" });
await limpiar();
await enAncla("expediente");
await pagina.waitForTimeout(2200);
await foto("05-expediente");

await pagina.goto(`${url}/#avance`, { waitUntil: "load" });
await limpiar();
await enAncla("avance");
await pagina.locator("#avance").getByRole("button", { name: "Pausar el carrusel" }).click();
await pagina.locator("#avance").getByRole("button", { name: /^Hito 6:/ }).click();
await pagina.waitForFunction(() => {
  const img = document.querySelector("#avance [data-activa] img");
  return img && img.complete && img.naturalWidth > 0;
});
await pagina.mouse.move(700, 120);
await pagina.waitForTimeout(1800);
await foto("06-avance");

await pagina.goto(`${url}/#contacto`, { waitUntil: "load" });
await limpiar();
await enAncla("contacto");
await pagina.waitForTimeout(2200);
await foto("07-contacto");

const movil = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const telefono = await movil.newPage();
await telefono.goto(url, { waitUntil: "load" });
await telefono.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await telefono.waitForTimeout(2500);
await telefono.screenshot({ path: join(salida, "08-movil-portada.jpg"), type: "jpeg", quality: 84 });
await navegador.close();
