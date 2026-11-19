// Capturas de revisión visual por sección, en escritorio y móvil.
// Uso: node scripts/capturas.mjs [url-base] [carpeta]
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3100";
const salida = process.argv[3] ?? "test-results/capturas";
mkdirSync(salida, { recursive: true });

const tamanos = {
  escritorio: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  movil: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};
// Avances del recorrido fijado: una captura por vista del modelo.
const RECORRIDO = [0.03, 0.4, 0.62, 0.8, 0.86, 0.93, 1];

const navegador = await chromium.launch({
  channel: "msedge",
  args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
for (const [nombre, opciones] of Object.entries(tamanos)) {
  const pagina = await navegador.newPage({ ...opciones, deviceScaleFactor: 1 });
  const errores = [];
  pagina.on("console", (m) => m.type() === "error" && errores.push(m.text()));
  pagina.on("pageerror", (e) => errores.push(String(e)));
  await pagina.goto(base, { waitUntil: "load" });
  await pagina.waitForTimeout(1500);
  await pagina.screenshot({ path: `${salida}/${nombre}-1-inicio.png` });

  const irA = async (selector, bloque = "start") => {
    await pagina.evaluate(
      ([s, b]) => document.querySelector(s)?.scrollIntoView({ behavior: "instant", block: b }),
      [selector, bloque],
    );
    await pagina.waitForTimeout(1400);
  };

  await irA("[data-frase]", "center");
  await pagina.screenshot({ path: `${salida}/${nombre}-2-frase.png` });

  await irA("#recorrido");
  await pagina.screenshot({ path: `${salida}/${nombre}-3-recorrido-intro.png` });
  const tramo = await pagina.evaluate(() => {
    const st = window.ScrollTrigger?.getAll?.().find((t) => t.pin);
    return st ? { inicio: st.start, fin: st.end } : null;
  });
  if (tramo) {
    await pagina.waitForFunction(
      () => ["listo", "error"].includes(document.querySelector("#recorrido")?.dataset.carga ?? ""),
      null,
      { timeout: 60_000 },
    ).catch(() => {});
    for (const [i, avance] of RECORRIDO.entries()) {
      await pagina.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), tramo.inicio + (tramo.fin - tramo.inicio) * avance);
      await pagina.waitForTimeout(1800);
      await pagina.screenshot({ path: `${salida}/${nombre}-3-recorrido-${i + 1}.png` });
    }
  }

  for (const [i, id] of ["expediente", "avance", "contacto"].entries()) {
    await irA(`#${id}`);
    await pagina.screenshot({ path: `${salida}/${nombre}-${4 + i}-${id}.png` });
  }
  await pagina.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await pagina.waitForTimeout(800);
  await pagina.screenshot({ path: `${salida}/${nombre}-7-pie.png` });
  console.log(nombre, errores.length ? `errores: ${errores.join(" | ")}` : "sin errores de consola");
  await pagina.close();
}
await navegador.close();
