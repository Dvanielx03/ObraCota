import { expect, test } from "@playwright/test";

for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844]]) {
  test(`Landing, panel y visor a ${width} × ${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const landing = process.env.LANDING_URL || "http://localhost:3200";
    async function capture(name: string) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(name + ".png"), animations: "disabled" });
    }
    async function navigate(label: string) {
      if (width < 720) await page.getByRole("button", { name: "Menú" }).click();
      await page.getByRole("navigation", { name: "Panel" }).getByRole("link", { name: label, exact: true }).click();
    }
    await page.goto(landing);
    await capture("landing");
    if (width < 1024) await page.getByRole("button", { name: "Menú" }).click();
    await page.getByRole("link", { name: "Entrar al panel" }).click();
    await expect(page.getByRole("heading", { name: "Proyectos", exact: true })).toBeVisible();
    await capture("proyectos");
    await navigate("Cuenta");
    await expect(page.getByRole("heading", { name: "Sesión de invitado" })).toBeVisible();
    await capture("cuenta");
    await navigate("Proyectos");
    await page.getByRole("link", { name: "Abrir proyecto" }).click();
    await expect(page.getByRole("heading", { name: "ReStage" })).toBeVisible();
    await capture("resumen");
    for (const [view, file, evidence] of [
      ["Archivos y versiones", "archivos", "Restage_IP_ALL_MULTI_001.ifc"],
      ["Asistente", "asistente", "Iniciar sesión para usar el asistente"],
      ["Presupuesto", "presupuesto", "Pendiente de estimación"],
      ["Cambios de diseño", "cambios", "Sin cambios registrados"],
    ]) {
      await navigate(view);
      await expect(page.getByRole("heading", { name: view, exact: true })).toBeVisible();
      await expect(page.getByText(evidence, { exact: false }).first()).toBeVisible();
      await capture(file);
    }
    await page.getByRole("link", { name: "Seleccionar en el visor" }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator(".project")).toHaveText("ReStage");
    await expect(page.getByRole("button", { name: "Revisar entrega" })).toBeEnabled();
    await capture("visor");
    await page.getByRole("link", { name: "Volver al panel" }).click();
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
