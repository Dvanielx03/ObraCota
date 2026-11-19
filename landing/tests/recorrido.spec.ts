import { expect, type Page, test } from "@playwright/test";

/** Punto del nudo protagonista en coordenadas del modelo (ver src/lib/modelo/fuente.ts). */
const NUDO = [18.81, 5.23, 53.05];

async function abrirRecorrido(page: Page) {
  await page.goto("/");
  await page.locator("#recorrido").scrollIntoViewIfNeeded();
  await expect(page.locator("#recorrido")).toHaveAttribute("data-carga", "listo", { timeout: 90_000 });
}

/** Lleva el scroll a un avance del tramo fijado (0 a 1). */
async function irA(page: Page, avance: number) {
  await page.evaluate((p) => {
    const st = (window as unknown as { ScrollTrigger: { getAll(): { pin?: Element; start: number; end: number }[] } }).ScrollTrigger.getAll().find((t) => t.pin);
    if (!st) throw new Error("No hay tramo fijado");
    // El tramo fijado empieza con la entrada por la «O»; el recorrido ocupa el resto.
    const parte = Number(document.querySelector<HTMLElement>("#recorrido")!.dataset.tramoEntrada ?? 0);
    window.scrollTo(0, st.start + (st.end - st.start) * (parte + (1 - parte) * p));
  }, avance);
}

async function distanciaAlNudo(page: Page) {
  const texto = await page.locator("[data-lienzo]").getAttribute("data-camara");
  const [x, y, z] = (texto ?? "0,0,0").split(",").map(Number);
  return Math.hypot(x - NUDO[0], y - NUDO[1], z - NUDO[2]);
}

test.describe("recorrido 3D de ReStage", () => {
  test("el scroll lleva de la vista completa al nudo y se puede desandar", async ({ page }) => {
    await abrirRecorrido(page);
    const seccion = page.locator("#recorrido");
    const lienzo = page.locator("[data-lienzo]");

    await irA(page, 0.02);
    await expect(seccion).toHaveAttribute("data-fase", "reconocer");
    await expect(page.getByRole("heading", { name: /El modelo,\s*pieza por pieza/ })).toBeVisible();
    await expect.poll(() => distanciaAlNudo(page)).toBeGreaterThan(12);
    await expect.poll(async () => Number(await lienzo.getAttribute("data-triangulos"))).toBeGreaterThan(100);

    await irA(page, 0.3);
    await expect(seccion).toHaveAttribute("data-fase", "separar");
    await expect.poll(() => lienzo.getAttribute("data-camara")).not.toBeNull();
    await page.waitForTimeout(1200);
    const camaraEnSeparar = await lienzo.getAttribute("data-camara");

    // A mitad del recorrido la cámara está junto a la viga y aparece su ficha.
    await irA(page, 0.635);
    await expect(seccion).toHaveAttribute("data-fase", "entrar");
    await expect.poll(() => distanciaAlNudo(page)).toBeLessThan(2.4);
    await expect(page.getByText("Viga HEB · acero S235JR").filter({ visible: true })).toBeVisible();
    await expect(page.getByText(/STL1-01-BEAM-HEB/).filter({ visible: true })).toBeVisible();
    await expect(page.getByText(/5 may 2025/).filter({ visible: true })).toBeVisible();

    await irA(page, 0.83);
    await expect(seccion).toHaveAttribute("data-fase", "estructura");
    await expect.poll(() => distanciaAlNudo(page)).toBeLessThan(2.4);
    await expect(page.getByText("Dos vigas, una columna").filter({ visible: true })).toBeVisible();

    // Al volver atrás se recupera exactamente el mismo encuadre.
    await irA(page, 0.3);
    await expect(seccion).toHaveAttribute("data-fase", "separar");
    await expect.poll(() => lienzo.getAttribute("data-camara")).toBe(camaraEnSeparar);
  });

  test("al final quedan los hitos reales y el control manual", async ({ page }) => {
    await abrirRecorrido(page);
    const seccion = page.locator("#recorrido");
    await irA(page, 1);
    await expect(seccion).toHaveAttribute("data-fase", "tiempo");
    await expect(seccion).toHaveAttribute("data-libre", "true");

    const linea = page.getByRole("slider").filter({ visible: true });
    await expect(linea).toBeEnabled();
    await expect(linea).toHaveAttribute("max", "8");
    const rotulo = page.locator("[data-rotulo-tiempo]").filter({ visible: true });
    const fecha = page.locator("[data-fecha-tiempo]").filter({ visible: true });
    await expect(rotulo).toHaveText("Muro de concreto impreso en 3D");
    await expect(fecha).toHaveText("25 ago 2025");

    await linea.fill("2");
    await expect(rotulo).toHaveText("Fase de construcción 3");
    await expect(fecha).toHaveText("5 may 2025");
    await expect(page.getByText(/ConstructionPhase_03/).filter({ visible: true })).toBeVisible();

    await linea.fill("0");
    await expect(rotulo).toHaveText("Antes del primer hito");

    await linea.fill("1");
    await expect(rotulo).toHaveText("Fase de construcción 1");
    await expect(fecha).toHaveText("26 ago 2024");

    // Reproducir avanza solo hasta el último hito.
    await page.getByRole("button", { name: "Reproducir la secuencia" }).filter({ visible: true }).click();
    await expect(fecha).toHaveText("25 ago 2025", { timeout: 20_000 });
  });

  test("muestra créditos, licencia, cambios y una salida de la sección", async ({ page }) => {
    await abrirRecorrido(page);
    const seccion = page.locator("#recorrido");
    await seccion.locator("summary").filter({ hasText: "ReStage · Créditos" }).click();
    await expect(seccion.getByText(/ReStage, demostrador construido en el campus Melaten/)).toBeAttached();
    await expect(seccion.getByText(/Sigrid Brell-Cokcan/)).toBeAttached();
    await expect(seccion.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
    await expect(seccion.getByRole("link", { name: "Ver el modelo en Zenodo" })).toHaveAttribute("href", "https://zenodo.org/records/21470658");
    await expect(seccion.getByText(/Cambios: convertido de IFC a GLB/)).toBeAttached();
    await expect(seccion.getByRole("link", { name: "Saltar el recorrido" })).toHaveAttribute("href", "#expediente");
  });
});

test.describe("recorrido con movimiento reducido", () => {
  test.use({ reducedMotion: "reduce" });

  test("las mismas vistas se eligen con botones, sin pantalla fijada", async ({ page }) => {
    await abrirRecorrido(page);
    const fijados = await page.evaluate(
      () => (window as unknown as { ScrollTrigger: { getAll(): { pin?: Element }[] } }).ScrollTrigger.getAll().filter((t) => t.pin).length,
    );
    expect(fijados).toBe(0);

    const seccion = page.locator("#recorrido");
    await page.getByRole("button", { name: /Entrar/ }).filter({ visible: true }).click();
    await expect(seccion).toHaveAttribute("data-fase", "entrar");
    await expect.poll(() => distanciaAlNudo(page)).toBeLessThan(2.4);
    await expect(page.getByText("Viga HEB · acero S235JR").filter({ visible: true })).toBeVisible();

    await page.getByRole("button", { name: /Reconstruir en el tiempo/ }).filter({ visible: true }).click();
    await expect(seccion).toHaveAttribute("data-libre", "true");
    await expect(page.getByRole("slider").filter({ visible: true })).toBeEnabled();
  });
});
