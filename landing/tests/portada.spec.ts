import { expect, type Page, test } from "@playwright/test";

/** Lleva el scroll a un avance del recorrido de la portada (0 a 1). */
async function irA(page: Page, avance: number) {
  await page.evaluate((p) => {
    const pista = document.querySelector<HTMLElement>("[data-portada-pista]");
    if (!pista) throw new Error("No hay pista de portada");
    window.scrollTo(0, (pista.offsetHeight - window.innerHeight) * p);
  }, avance);
}
const opacidad = (page: Page, indice: number) =>
  page.locator("[data-foto]").nth(indice).evaluate((el) => Number(getComputedStyle(el).opacity));

test.describe("portada: del terreno a la obra", () => {
  test("el scroll pasa del terreno a la estructura y al edificio terminado", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Del terreno\s*a la obra/ })).toBeVisible();
    await expect(page.getByAltText(/Terreno al atardecer con tres franjas de cimentación/)).toBeVisible();
    await expect(page.locator("#inicio").getByText(/Recreación con IA/i)).toHaveCount(0);

    // En reposo solo se ve el terreno.
    expect(await opacidad(page, 1)).toBeLessThan(0.05);
    expect(await opacidad(page, 2)).toBeLessThan(0.05);
    const etapa = page.locator("#inicio [aria-current='step']");
    await expect(etapa).toHaveText("01 Terreno");

    await irA(page, 0.5);
    await expect(etapa).toHaveText("02 Estructura");
    await expect.poll(() => opacidad(page, 1)).toBeGreaterThan(0.95);
    await expect.poll(() => opacidad(page, 2)).toBeLessThan(0.1);

    await irA(page, 1);
    await expect.poll(() => opacidad(page, 2)).toBeGreaterThan(0.95);
    await expect(etapa).toHaveText("03 Obra");
    // El titular sigue en pantalla durante todo el recorrido.
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();

    // Al volver arriba se recupera el terreno.
    await irA(page, 0);
    await expect.poll(() => opacidad(page, 1)).toBeLessThan(0.05);
  });

  test("la foto llega con resolución suficiente para la pantalla", async ({ page }) => {
    await page.goto("/");
    const foto = page.locator("[data-foto]").first();
    await expect.poll(() => foto.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    // Píxeles reales del archivo servido frente a los que pinta la pantalla. Con `srcset`,
    // `naturalWidth` viene corregido por densidad, así que se vuelve a cargar el archivo suelto.
    const nitidez = await foto.evaluate(async (el: HTMLImageElement) => {
      const suelta = new Image();
      suelta.src = el.currentSrc;
      await suelta.decode();
      const caja = el.getBoundingClientRect();
      const anchoPintado = Math.max(caja.width, (caja.height * suelta.naturalWidth) / suelta.naturalHeight);
      return suelta.naturalWidth / (anchoPintado * window.devicePixelRatio);
    });
    expect(nitidez).toBeGreaterThan(0.95);
  });

  test("el vídeo sigue al scroll cuando está disponible", async ({ page }) => {
    await page.goto("/");
    const primero = page.locator("[data-clips] video").first();
    // El clip se pide tras cargar la página; si el equipo de prueba no lo descarga, no aplica.
    const listo = await expect
      .poll(() => primero.evaluate((v: HTMLVideoElement) => v.readyState >= 2), { timeout: 20_000 })
      .toBe(true)
      .then(() => true, () => false);
    test.skip(!listo, "El clip no se descargó en este entorno");
    await irA(page, 0.25);
    await expect.poll(() => primero.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.5);
    await irA(page, 0.1);
    await expect.poll(() => primero.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(1.5);
  });
});

test.describe("portada con movimiento reducido", () => {
  test.use({ reducedMotion: "reduce" });

  test("muestra el edificio terminado, sin recorrido ni vídeo", async ({ page }) => {
    await page.goto("/");
    const alto = await page.locator("[data-portada-pista]").evaluate((el) => el.getBoundingClientRect().height / window.innerHeight);
    expect(alto).toBeLessThan(1.6);
    expect(await opacidad(page, 2)).toBeGreaterThan(0.95);
    await expect(page.locator("#inicio [aria-current='step']")).toHaveText("03 Obra");
    await page.waitForTimeout(1500);
    expect(await page.locator("[data-clips] video").first().evaluate((v: HTMLVideoElement) => v.currentSrc)).toBe("");
  });
});

// La regla de la rejilla: el texto vive en su zona y nunca entra en la del edificio.
for (const pantalla of [
  { nombre: "monitor", width: 1920, height: 1080 },
  { nombre: "portátil", width: 1366, height: 768 },
  { nombre: "portátil bajo", width: 1280, height: 620 },
  { nombre: "teléfono apaisado", width: 844, height: 390 },
]) {
  test(`en ${pantalla.nombre} el texto no invade la zona del edificio y todo cabe`, async ({ page }, info) => {
    test.skip(info.project.name !== "escritorio", "Se mide con tamaños propios");
    await page.setViewportSize({ width: pantalla.width, height: pantalla.height });
    await page.goto("/");
    const medidas = await page.evaluate(() => {
      const caja = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const textos = ["#inicio h1", "#inicio h1 + p", "#inicio a[href='#contacto']"].map(caja);
      return { derecha: Math.max(...textos.map((c) => c.right)) / window.innerWidth, pie: caja("#inicio ol").bottom, alto: window.innerHeight };
    });
    // Columnas 1 a 5 de 12: el texto termina antes de la mitad.
    expect(medidas.derecha).toBeLessThan(0.46);
    expect(medidas.pie).toBeLessThanOrEqual(medidas.alto);
  });
}

test("en un teléfono vertical la foto queda arriba y el texto debajo, sin pisarse", async ({ page }, info) => {
  test.skip(info.project.name !== "movil", "Solo aplica en vertical");
  await page.goto("/");
  const medidas = await page.evaluate(() => {
    const caja = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    return { foto: caja("[data-portada-fondo]").bottom, titular: caja("#inicio h1").top, pie: caja("#inicio ol").bottom, alto: window.innerHeight };
  });
  expect(medidas.titular).toBeGreaterThanOrEqual(medidas.foto - 2);
  expect(medidas.pie).toBeLessThanOrEqual(medidas.alto);
});
