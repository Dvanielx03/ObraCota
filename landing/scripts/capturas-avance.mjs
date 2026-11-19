// Capturas del carrusel de Avance en portátil, monitor y móvil.
// Uso: node scripts/capturas-avance.mjs <url> <carpeta-de-salida>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const [, , url = "http://localhost:3002", salida = "../docs/direccion-creativa/avance/implementacion"] = process.argv;
mkdirSync(salida, { recursive: true });

const PANTALLAS = [
  { nombre: "portatil", width: 1366, height: 768 },
  { nombre: "monitor", width: 1920, height: 1080 },
  { nombre: "movil", width: 390, height: 844, isMobile: true, hasTouch: true },
];

const navegador = await chromium.launch({ channel: "msedge" });
for (const { nombre, width, height, ...resto } of PANTALLAS) {
  const pagina = await navegador.newPage({ viewport: { width, height }, ...resto });
  // El ancla del menú lleva a la sección (el scroll suave la deja bajo la cabecera).
  await pagina.goto(url + "/#avance", { waitUntil: "load" });
  await pagina.waitForFunction(() => Math.abs(document.querySelector("#avance").getBoundingClientRect().top) < 140);
  const avance = pagina.locator("#avance");
  const cargada = () =>
    pagina.waitForFunction(() => {
      const img = document.querySelector("#avance [data-activa] img");
      return img && img.complete && img.naturalWidth > 0;
    });
  await cargada();
  await pagina.waitForTimeout(900);
  const medidas = await pagina.evaluate(() => {
    const c = (s) => document.querySelector(s).getBoundingClientRect();
    const e = c("#avance [data-escena]");
    return { escena: [Math.round(e.width), Math.round(e.height)], parte: Math.round((e.width * e.height * 100) / (innerWidth * innerHeight)), seccion: Math.round(c("#avance").height), ventana: innerHeight, desborde: document.documentElement.scrollWidth - innerWidth };
  });
  console.log(nombre, JSON.stringify(medidas));
  await pagina.screenshot({ path: join(salida, `${nombre}-1-hito1.png`) });

  // En pausa: el paso al hito 2 muestra la apertura a medias; luego salta al hito 6.
  await avance.getByRole("button", { name: "Pausar el carrusel" }).click();
  await avance.getByRole("button", { name: "Hito siguiente" }).click();
  await pagina.waitForTimeout(230);
  await pagina.screenshot({ path: join(salida, `${nombre}-2-apertura.png`) });
  await avance.getByRole("button", { name: /^Hito 6:/ }).click();
  await cargada();
  await pagina.waitForTimeout(1400);
  await pagina.screenshot({ path: join(salida, `${nombre}-3-hito6.png`) });

  // De la última a la primera.
  await avance.getByRole("button", { name: /^Hito 8:/ }).click();
  await cargada();
  await pagina.waitForTimeout(1400);
  await pagina.screenshot({ path: join(salida, `${nombre}-4-hito8.png`) });
  await avance.getByRole("button", { name: "Hito siguiente" }).click();
  await pagina.waitForTimeout(620);
  await pagina.screenshot({ path: join(salida, `${nombre}-5-vuelta.png`) });
  await pagina.waitForTimeout(1500);
  await pagina.screenshot({ path: join(salida, `${nombre}-6-de-nuevo-hito1.png`) });
  await pagina.close();
}
await navegador.close();
