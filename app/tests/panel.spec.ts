import { expect, test, type Page } from "@playwright/test";

/**
 * Activates a landing link for real (click or keyboard) and checks it navigates to its href. The landing
 * links to the app it was built for, which may be another origin than the app under test (the dev server,
 * for instance): that navigation is answered with a stub, and the same path is then opened on baseURL.
 */
async function follow(page: Page, baseURL: string | undefined, activate: () => Promise<void>, href: URL) {
  const app = new URL(baseURL || href.origin);
  const elsewhere = href.origin !== app.origin;
  if (elsewhere) await page.route(href.origin + "/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));
  await activate();
  await page.waitForURL(href.href);
  if (!elsewhere) return;
  await page.unroute(href.origin + "/**");
  await page.goto(new URL(href.pathname + href.search, app).href);
}

// «Entrar al panel» goes from the landing to the app it was built for, which may not be VIEWER_URL (the
// config's storage only marks that origin). Mark the guides as seen on whatever origin the links open,
// so the welcome dialog never covers the panel under test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      for (const [name, value] of [["obracota.guide.v1", "seen"], ["obracota.onboarding.v1", "seen"], ["obracota.explorer.v1", "open"]])
        if (!localStorage.getItem(name)) localStorage.setItem(name, value);
    } catch { /* Storage blocked: the page shows its guide as for a first visit. */ }
  });
});

for (const [width, height] of [[1366, 768], [1920, 1080]]) {
  test(`Landing, panel y visor a ${width} × ${height}`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width, height });
    const landing = process.env.LANDING_URL || "http://localhost:3200";
    async function capture(name: string) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(name + ".png"), animations: "disabled" });
    }
    // Barra superior de 52 px (DU-08 = B): la marca lleva a Proyectos; «Guías» y la cuenta van en «Panel».
    const brand = page.getByRole("banner").getByRole("link", { name: "ObraCota", exact: true });
    const top = page.getByRole("navigation", { name: "Panel" });
    // Dentro de un proyecto, sus secciones son pestañas de la barra del proyecto.
    const sections = page.getByRole("navigation", { name: "Secciones del proyecto" });
    await page.goto(landing);
    await capture("landing");
    const enterLink = page.getByRole("link", { name: "Entrar al panel" });
    const enter = new URL((await enterLink.getAttribute("href"))!, landing);
    // The app's root redirects to /proyectos.
    expect(["/", "/proyectos"]).toContain(enter.pathname);
    await follow(page, baseURL, () => enterLink.click(), enter);
    await expect(page.getByRole("heading", { name: "Proyectos", exact: true })).toBeVisible();
    await expect(brand).toHaveAttribute("aria-current", "page");
    await expect(top.getByRole("link", { name: "Guías", exact: true })).toHaveAttribute("href", "/guias");
    await capture("proyectos");

    // Un invitado ve «Iniciar sesión» donde una cuenta ve su avatar «Cuenta» (account-control.tsx); la
    // página de la cuenta sigue mostrando el estado de invitado.
    await expect(top.getByRole("link", { name: "Cuenta", exact: true })).toHaveCount(0);
    await top.getByRole("link", { name: "Iniciar sesión", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Iniciar sesión" })).toBeVisible();
    await page.goto(new URL("/cuenta", page.url()).href);
    await expect(page.getByRole("heading", { name: "Sesión de invitado" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Entrar con tu cuenta" })).toHaveAttribute("href", "/ingresar");
    await capture("cuenta");

    await brand.click();
    await expect(page.getByRole("heading", { name: "Proyectos", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Abrir proyecto" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "ReStage" })).toBeVisible();
    await expect(sections.getByRole("link", { name: "Resumen", exact: true })).toHaveAttribute("aria-current", "page");
    await capture("resumen");
    for (const [view, file, evidence] of [
      ["Archivos y versiones", "archivos", "Restage_IP_ALL_MULTI_001.ifc"],
      ["Asistente", "asistente", "Iniciar sesión para usar el asistente"],
      ["Presupuesto", "presupuesto", "Pendiente de estimación"],
      ["Cambios de diseño", "cambios", "Sin cambios registrados"],
    ]) {
      const tab = sections.getByRole("link", { name: view, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { name: view, exact: true })).toBeVisible();
      await expect(page.getByText(evidence, { exact: false }).first()).toBeVisible();
      await capture(file);
    }
    await page.getByRole("link", { name: "Seleccionar en el visor" }).click();
    // Desde el panel la pantalla de carga dura al menos 5 s (entry-hold.ts); luego el lienzo queda listo.
    await expect(page.locator(".view[data-ready]")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".view canvas")).toBeVisible();
    await expect(page.locator(".project")).toHaveText("ReStage");
    // REVISAR vive en la barra inferior de herramientas.
    await expect(page.getByRole("toolbar", { name: "Acciones del modelo" }).getByRole("button", { name: "Revisar entrega" })).toBeEnabled();
    await capture("visor");
    await page.getByRole("link", { name: "Volver al panel" }).click();
    await expect(page).toHaveURL(/\/proyectos\/restage\/cambios$/);
    await expect(page.getByRole("heading", { name: "Cambios de diseño" })).toBeVisible();
    // NEXT_PUBLIC_SITE_URL of the app has to be LANDING_URL (app/README.md).
    const site = page.getByRole("link", { name: "Sitio de ObraCota" });
    await expect(site).toBeVisible();
    expect(new URL((await site.getAttribute("href"))!).href).toBe(new URL("/", landing).href);
    await site.click();
    await expect(page).toHaveURL(new URL("/", landing).href);
  });
}

test("El recorrido público abre ReStage y recupera su sección de origen", async ({ page, baseURL }) => {
  const landing = process.env.LANDING_URL || "http://localhost:3200";
  await page.goto(landing);
  const link = page.getByRole("link", { name: "Abrir ReStage en el visor" });
  const target = new URL((await link.getAttribute("href"))!, landing);
  expect(target.pathname + target.search).toBe("/proyectos/restage/visor?desde=recorrido");
  // Keyboard activation: the only check that this link works without a pointer.
  await follow(page, baseURL, async () => { await link.focus(); await expect(link).toBeFocused(); await link.press("Enter"); }, target);
  await expect(page.locator(".project")).toHaveText("ReStage");
  await page.getByRole("link", { name: "Volver al recorrido" }).click();
  await expect(page).toHaveURL(new URL("/#recorrido", landing).href);
});
