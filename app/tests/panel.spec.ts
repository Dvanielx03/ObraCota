import { expect, test } from "@playwright/test";

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

for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844]]) {
  test(`Landing, panel y visor a ${width} × ${height}`, async ({ page }, info) => {
    test.skip(width < 1000, "Solo escritorio (D-12)");
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
    await page.getByRole("link", { name: "Entrar al panel" }).click();
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
    await page.getByRole("link", { name: "Sitio de ObraCota" }).click();
    await expect(page).toHaveURL(new URL("/", landing).href);
  });
}

test("El recorrido público abre ReStage y recupera su sección de origen", async ({ page }) => {
  const landing = process.env.LANDING_URL || "http://localhost:3200";
  await page.goto(landing);
  const link = page.getByRole("link", { name: "Abrir ReStage en el visor" });
  await link.focus();
  await link.press("Enter");
  await expect(page.locator(".project")).toHaveText("ReStage");
  await page.getByRole("link", { name: "Volver al recorrido" }).click();
  await expect(page).toHaveURL(new URL("/#recorrido", landing).href);
});
