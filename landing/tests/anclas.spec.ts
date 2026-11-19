import { expect, test } from "@playwright/test";

// Al entrar con un ancla en la URL, la página crece después de cargar (la portada y el
// recorrido añaden su tramo de scroll). El destino tiene que seguir quedando arriba.
for (const ancla of ["recorrido", "expediente", "avance"]) {
  test(`entrar con #${ancla} deja la sección arriba de la pantalla`, async ({ page }) => {
    await page.goto(`/#${ancla}`);
    const arriba = () => page.locator(`#${ancla}`).evaluate((el) => Math.round(el.getBoundingClientRect().top));
    await expect.poll(arriba, { timeout: 8000 }).toBeLessThan(160);
    await expect.poll(arriba).toBeGreaterThan(-40);
    // Y el scroll sigue respondiendo después de la corrección.
    const antes = await page.evaluate(() => window.scrollY);
    // (con la rueda: un gesto real es lo que da por terminada la corrección)
    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, -400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(antes - 100);
  });
}
