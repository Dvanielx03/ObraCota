import { expect, test, type Locator, type Page } from "@playwright/test";
import { modelShown } from "./support/visor";

// ObraCota symbol «Cota de nivel» (roadmap R5): one mark in the panel and the three viewers, its level bar
// in --brand-mark (own accent, P-03) while the interface keeps --brand, and the favicon served by the app.

const THEMES = { light: { mark: "rgb(4, 120, 87)", ink: "rgb(23, 30, 43)" }, dark: { mark: "rgb(52, 211, 153)", ink: "rgb(241, 242, 243)" } } as const;

/** Fill of each bar of the first brand symbol inside `scope`, top to bottom. */
function barFills(scope: Locator) {
  return scope.locator("svg.brand-symbol").first().locator("path").evaluateAll(paths => paths.map(path => getComputedStyle(path).fill));
}

async function useTheme(page: Page, theme: keyof typeof THEMES) {
  await page.addInitScript(value => { try { localStorage.setItem("obracota.theme.v1", value); } catch { /* blocked: system */ } }, theme);
  await page.emulateMedia({ colorScheme: theme });
}

test("El favicon, el icono de Apple y el color de la barra del navegador se sirven", async ({ page, request }) => {
  const icon = await request.get("/icon.svg");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  const svg = await icon.text();
  // Variante de 16 px: tres barras, la central en el acento propio, con su par para tema oscuro.
  expect(svg.match(/<path/g)).toHaveLength(3);
  expect(svg).toContain("#047857");
  expect(svg).toContain("#34D399");
  const apple = await request.get("/apple-icon.png");
  expect(apple.status()).toBe(200);
  expect(apple.headers()["content-type"]).toContain("image/png");
  const png = await apple.body();
  expect(png.readUInt32BE(16)).toBe(180);
  expect(png.readUInt32BE(20)).toBe(180);

  await page.goto("/proyectos");
  await expect(page.locator('head link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute("href", /\/icon\.svg/);
  await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveAttribute("href", /\/apple-icon\.png/);
  await expect(page.locator('head meta[name="theme-color"]')).toHaveCount(2);
});

for (const theme of ["light", "dark"] as const) {
  const name = theme === "light" ? "claro" : "oscuro";

  test(`Marca del panel en ${name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await useTheme(page, theme);
    await page.goto("/proyectos");
    await expect(page.getByRole("heading", { name: "Proyectos", exact: true })).toBeVisible();
    const brand = page.getByRole("banner").getByRole("link", { name: "ObraCota", exact: true });
    await expect(brand).toBeVisible();
    expect(await barFills(brand)).toEqual([THEMES[theme].ink, THEMES[theme].mark, THEMES[theme].ink]);
    // El símbolo se dibuja a 24 px, donde cada borde cae en un píxel entero.
    const box = (await brand.locator("svg.brand-symbol").boundingBox())!;
    expect([box.width, box.height]).toEqual([24, 24]);
    // La interfaz sigue en --brand; solo el logo usa el acento propio.
    const accents = await page.evaluate(() => { const style = getComputedStyle(document.documentElement);
      return [style.getPropertyValue("--brand").trim(), style.getPropertyValue("--brand-mark").trim()].map(value => value.toUpperCase()); });
    expect(accents).toEqual(theme === "light" ? ["#0D9674", "#047857"] : ["#79D2C9", "#34D399"]);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath(`panel-${name}.png`), animations: "disabled" });
  });

  test(`Marca del visor en ${name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await useTheme(page, theme);
    await page.goto("/proyectos/restage/visor");
    const back = page.locator(".viewer-header").getByRole("link", { name: "Volver al panel", exact: true });
    await expect(back).toBeVisible();
    expect(await barFills(back)).toEqual([THEMES[theme].ink, THEMES[theme].mark, THEMES[theme].ink]);
    // Sin la flecha de texto anterior: el enlace es solo el isotipo.
    expect(await back.innerText()).toBe("");
    await modelShown(page);
    await page.screenshot({ path: info.outputPath(`visor-${name}.png`), animations: "disabled" });
  });
}
