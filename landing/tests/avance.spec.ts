import { expect, test } from "@playwright/test";

const FECHAS = ["2024-08-26", "2025-05-05", "2025-05-09", "2025-05-16", "2025-06-03", "2025-06-04", "2025-08-08", "2025-08-25"];

test.describe("avance: carrusel de hitos", () => {
  test("recorre los ocho hitos del IFC y vuelve del último al primero", async ({ page }) => {
    await page.goto("/#avance");
    const avance = page.locator("#avance");
    const fecha = avance.locator("time");
    // En desarrollo el primer clic puede llegar antes de que la página responda: se reintenta.
    const pausar = avance.getByRole("button", { name: "Pausar el carrusel" });
    await expect(async () => {
      if (await pausar.isVisible()) await pausar.click({ timeout: 1_000 });
      await expect(avance.getByRole("button", { name: "Reanudar el carrusel" })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    await expect(avance.getByRole("listitem")).toHaveCount(FECHAS.length);
    for (const [i, dia] of FECHAS.entries()) {
      await avance.getByRole("button", { name: new RegExp(`^Hito ${i + 1}:`) }).click();
      await expect(fecha).toHaveAttribute("datetime", dia);
      const foto = avance.locator("[data-activa] img");
      await expect(foto).toHaveAttribute("alt", /.{20,}/);
      await expect.poll(() => foto.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
    // La imagen es una recreación y la página lo dice.
    await expect(avance.getByText(/Recreación con IA sobre el modelo terminado/)).toBeVisible();

    // Del último al primero: pasa por tinta y llega al hito 1.
    await avance.getByRole("button", { name: "Hito siguiente" }).click();
    await expect(avance.locator("[data-escena]")).toHaveAttribute("data-vuelta", "true");
    await expect(fecha).toHaveAttribute("datetime", FECHAS[0]);
    await expect(avance.locator("[data-escena]")).not.toHaveAttribute("data-vuelta", "true");

    // Teclado sobre el riel.
    const primero = avance.getByRole("button", { name: /^Hito 1:/ });
    await primero.focus();
    await primero.press("End");
    await expect(fecha).toHaveAttribute("datetime", FECHAS[7]);
    await expect(avance.getByRole("button", { name: /^Hito 8:/ })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(fecha).toHaveAttribute("datetime", FECHAS[6]);
  });

  test("avanza solo y se detiene con el botón de pausa", async ({ page }) => {
    await page.goto("/#avance");
    const avance = page.locator("#avance");
    const fecha = avance.locator("time");
    await expect(fecha).toHaveAttribute("datetime", FECHAS[0]);
    // El puntero fuera de la imagen: encima, el carrusel espera.
    await page.mouse.move(2, 2);
    await expect(fecha).toHaveAttribute("datetime", FECHAS[1], { timeout: 25_000 });
    await avance.getByRole("button", { name: "Pausar el carrusel" }).click();
    await page.mouse.move(2, 2);
    const quieta = await fecha.getAttribute("datetime");
    await page.waitForTimeout(7_500);
    await expect(fecha).toHaveAttribute("datetime", quieta!);
  });

  test("la imagen es la protagonista y nada se sale de la pantalla", async ({ page }, info) => {
    await page.goto("/#avance");
    const medidas = await page.evaluate(() => {
      const e = document.querySelector("#avance [data-escena]")!.getBoundingClientRect();
      return { parte: (e.width * e.height) / (window.innerWidth * window.innerHeight), desborde: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(medidas.parte).toBeGreaterThan(info.project.name === "movil" ? 0.4 : 0.22);
    expect(medidas.desborde).toBeLessThanOrEqual(0);
  });
});

test.describe("avance con movimiento reducido", () => {
  test.use({ reducedMotion: "reduce" });

  test("no avanza solo y se puede recorrer a mano", async ({ page }) => {
    await page.goto("/#avance");
    const avance = page.locator("#avance");
    const fecha = avance.locator("time");
    await expect(avance.getByRole("button", { name: "Pausar el carrusel" })).toBeHidden();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(7_500);
    await expect(fecha).toHaveAttribute("datetime", FECHAS[0]);
    await avance.getByRole("button", { name: "Hito anterior" }).click();
    await expect(fecha).toHaveAttribute("datetime", FECHAS[7]);
    await avance.getByRole("button", { name: "Hito siguiente" }).click();
    await expect(fecha).toHaveAttribute("datetime", FECHAS[0]);
  });
});
