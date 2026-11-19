import { expect, type Page, test } from "@playwright/test";

async function abrir(page: Page) {
  await page.goto("/");
  await page.locator("#recorrido").scrollIntoViewIfNeeded();
  await expect(page.locator("#recorrido")).toHaveAttribute("data-carga", "listo", { timeout: 90_000 });
}

/** Lleva el scroll a un avance de la entrada (0 = frase quieta, 1 = dentro del modelo). */
async function irA(page: Page, avance: number) {
  await page.evaluate((q) => {
    const seccion = document.querySelector<HTMLElement>("#recorrido")!;
    const st = (window as unknown as { ScrollTrigger: { getAll(): { pin?: Element; start: number; end: number }[] } }).ScrollTrigger.getAll().find((t) => t.pin);
    if (!st) throw new Error("No hay tramo fijado");
    window.scrollTo(0, st.start + (st.end - st.start) * Number(seccion.dataset.tramoEntrada) * q);
  }, avance);
}

/** Ancho del encuadre del rótulo frente al de la pantalla: 1 = sin zoom; cerca de 0 = muy dentro. */
const encuadre = (page: Page) =>
  page.locator("[data-entrada] svg").evaluate((svg) => Number(svg.getAttribute("viewBox")!.split(" ")[2]) / window.innerWidth);
const papel = (page: Page) => page.locator("#recorrido .bg-bone").first().evaluate((el) => Number(getComputedStyle(el).opacity));

test.describe("entrada al recorrido por la O de PLANO", () => {
  test("el scroll acerca la cámara, cruza la letra y deja al visitante en el modelo", async ({ page }) => {
    await abrir(page);
    const capa = page.locator("[data-entrada]");
    const escenario = page.locator("#recorrido [data-dentro]");

    // En reposo: la frase completa, con el gran PLANO, y la interfaz del recorrido oculta.
    await irA(page, 0);
    await expect(capa).toBeVisible();
    await expect(capa.getByText("Un detalle cambia en el plano. ObraCota muestra qué lámina lo respalda y cuánto se ejecutó a la fecha.")).toBeAttached();
    await expect(capa.getByText("Un detalle cambia en el", { exact: true })).toBeVisible();
    await expect.poll(() => encuadre(page)).toBeGreaterThan(0.98);
    await expect(escenario).toHaveAttribute("data-dentro", "false");
    await expect.poll(() => papel(page)).toBeLessThan(0.05);

    // Al acercarse: dentro del hueco se enciende el papel con el plano.
    await irA(page, 0.33);
    await expect.poll(() => encuadre(page)).toBeLessThan(0.7);
    await expect.poll(() => papel(page)).toBeGreaterThan(0.95);

    // Antes de que el hueco llene la pantalla, el papel ya se apagó: no hay fogonazo claro.
    await irA(page, 0.76);
    await expect.poll(() => encuadre(page)).toBeLessThan(0.15);
    await expect.poll(() => papel(page)).toBeLessThan(0.02);
    await expect(capa.getByText("Un detalle cambia en el", { exact: true })).toHaveCSS("opacity", "0");

    // Al final: la capa desaparece, el plano se rellena y empieza el recorrido.
    await irA(page, 1);
    await expect(capa).toBeHidden();
    await expect(escenario).toHaveAttribute("data-dentro", "true");
    await expect.poll(() => papel(page)).toBeLessThan(0.05);
    await expect(page.getByRole("heading", { name: /El modelo,\s*pieza por pieza/ })).toBeVisible();
    await expect(page.locator("#recorrido")).toHaveAttribute("data-fase", "reconocer");

    // Al volver atrás se desanda la entrada.
    await irA(page, 0);
    await expect(capa).toBeVisible();
    await expect.poll(() => encuadre(page)).toBeGreaterThan(0.98);
  });

  test("el hueco de la letra llega a cubrir la pantalla antes de retirar la capa", async ({ page }) => {
    await abrir(page);
    // Justo antes de retirarse, lo que se ve tiene que caber dentro del hueco de la letra.
    // Se compara el encuadre del SVG con el hueco, dejando fuera un 10 % por el trazo curvo.
    await irA(page, 0.965);
    await page.waitForTimeout(1200);
    const cubre = await page.locator("[data-entrada] svg").evaluate((svg) => {
      const [x, y, w, h] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      const hueco = svg.querySelector("mask rect:nth-of-type(2)")!;
      const n = (a: string) => Number(hueco.getAttribute(a));
      const mx = n("width") * 0.1, my = n("height") * 0.1;
      return x >= n("x") + mx && y >= n("y") + my && x + w <= n("x") + n("width") - mx && y + h <= n("y") + n("height") - my;
    });
    expect(cubre).toBe(true);
  });
});

test.describe("entrada con movimiento reducido", () => {
  test.use({ reducedMotion: "reduce" });

  test("no hay zoom: la frase se lee de una pieza y el recorrido sigue debajo", async ({ page }) => {
    await page.goto("/");
    const seccion = page.locator("#recorrido");
    await seccion.scrollIntoViewIfNeeded();
    await expect(seccion.locator("[data-entrada]")).toBeHidden();
    await expect(seccion.locator("p").filter({ hasText: "Un detalle cambia en el plano. ObraCota muestra" }).filter({ visible: true })).toBeVisible();
  });
});
