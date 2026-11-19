// Capturas de la sección de Contacto en portátil, monitor y móvil.
// Uso: node scripts/capturas-contacto.mjs <url> <carpeta-de-salida>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const [, , url = "http://localhost:3002", salida = "../docs/direccion-creativa/contacto/implementacion"] = process.argv;
mkdirSync(salida, { recursive: true });

const PANTALLAS = [
  { nombre: "portatil", width: 1366, height: 768 },
  { nombre: "monitor", width: 1920, height: 1080 },
  { nombre: "movil", width: 390, height: 844, isMobile: true, hasTouch: true },
];

const navegador = await chromium.launch({ channel: "msedge" });
for (const { nombre, width, height, ...resto } of PANTALLAS) {
  const pagina = await navegador.newPage({ viewport: { width, height }, ...resto });
  await pagina.goto(url + "/#contacto", { waitUntil: "load" });
  await pagina.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await pagina.waitForFunction(() => Math.abs(document.querySelector("#contacto").getBoundingClientRect().top) < 160);
  await pagina.waitForFunction(() => {
    return document.querySelector("#contacto figure")?.dataset.revelado === "true";
  });
  // El barrido de inicio a final dura 1,8 s.
  await pagina.waitForTimeout(2400);
  const medidas = await pagina.evaluate(() => {
    const c = (s) => document.querySelector(s).getBoundingClientRect();
    return { seccion: Math.round(c("#contacto").height), ventana: innerHeight, boton: Math.round(c("#contacto button[type=submit]").bottom), foto: [Math.round(c("#contacto figure").width), Math.round(c("#contacto figure").height), Math.round(c("#contacto .on-bone").right), Math.round(c("#contacto .on-bone").height)], desborde: document.documentElement.scrollWidth - innerWidth };
  });
  console.log(nombre, JSON.stringify(medidas));
  await pagina.screenshot({ path: join(salida, `${nombre}-1-reposo.png`) });
  await pagina.locator("#contacto").screenshot({ path: join(salida, `${nombre}-2-seccion.png`) });
  await pagina.locator("#contacto button[type=submit]").click();
  await pagina.waitForTimeout(500);
  await pagina.locator("#contacto").screenshot({ path: join(salida, `${nombre}-3-errores.png`) });
  await pagina.close();
}
await navegador.close();
