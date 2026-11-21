import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ viewport: { width: 1366, height: 768 } });

test("Los proyectos se crean, se archivan y se restauran desde el tablero", async ({ page }, info) => {
  const first = "Torre " + randomUUID().slice(0, 8);
  const second = "Patio " + randomUUID().slice(0, 8);
  await page.goto("/registro");
  await page.getByLabel("Correo electrónico").fill("tablero-" + randomUUID() + "@example.test");
  await page.getByLabel("Contraseña").fill(randomUUID());
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Mis proyectos" })).toBeVisible();

  const active = page.getByRole("tab", { name: /^Activos/ });
  const archived = page.getByRole("tab", { name: /^Archivados/ });
  await expect(active).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Todavía no has creado proyectos.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir proyecto" })).toBeVisible();

  // El diálogo se abre, se cancela con Escape y crea con Intro.
  const create = page.getByRole("button", { name: "Nuevo proyecto" });
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Nuevo proyecto" });
  await expect(dialog.getByLabel("Nombre del proyecto")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  for (const name of [first, second]) {
    await create.click();
    await dialog.getByLabel("Nombre del proyecto").fill(name);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("link", { name })).toBeVisible();
  }
  await expect(active).toContainText("2");
  await expect(page.getByRole("tabpanel").getByText(/^Editado /).first()).toBeVisible();
  await page.screenshot({ animations: "disabled", fullPage: true, path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/proyectos-1366.png" : info.outputPath("proyectos.png") });

  // Archivar saca el proyecto de Activos y lo deja en Archivados, también tras recargar.
  await page.getByRole("button", { name: "Archivar " + first }).click();
  await expect(page.getByRole("link", { name: first })).toHaveCount(0);
  await expect(active).toContainText("1");
  await expect(archived).toContainText("1");
  await page.reload();
  await expect(page.getByRole("link", { name: second })).toBeVisible();
  await expect(page.getByRole("link", { name: first })).toHaveCount(0);

  // Las pestañas se recorren con las flechas.
  await page.getByRole("tab", { name: /^Activos/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(archived).toHaveAttribute("aria-selected", "true");
  await expect(archived).toBeFocused();
  await expect(page.getByRole("link", { name: first })).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir proyecto" })).toHaveCount(0);

  await page.getByRole("button", { name: "Restaurar " + first }).click();
  await expect(page.getByText("No hay proyectos archivados.")).toBeVisible();
  // El foco no se pierde al desaparecer la tarjeta: vuelve a la pestaña.
  await expect(archived).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("link", { name: first })).toBeVisible();
  await expect(page.getByRole("link", { name: second })).toBeVisible();

  // La tarjeta abre el proyecto.
  await page.getByRole("link", { name: first }).click();
  await expect(page.getByRole("heading", { level: 1, name: first })).toBeVisible();
});

test("Las guías se leen paso a paso y la primera abre el recorrido en el visor", async ({ page }, info) => {
  await page.goto("/proyectos");
  await expect(page.getByRole("link", { name: "crea una cuenta" })).toBeVisible();
  const strip = page.getByRole("region", { name: "Aprende" });
  await expect(strip.getByRole("listitem")).toHaveCount(3);
  await strip.getByRole("link", { name: "Ver todas las guías" }).click();

  await expect(page.getByRole("heading", { name: "Guías", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Panel" }).getByRole("link", { name: "Guías" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Empieza por aquí" })).toBeVisible();
  await expect(page.getByRole("list").filter({ hasText: "Marcar un área" }).getByRole("listitem")).toHaveCount(6);
  await page.screenshot({ animations: "disabled", fullPage: true, path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/guias-1366.png" : info.outputPath("guias.png") });

  await page.getByRole("link", { name: "Marcar un área" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Marcar un área" })).toBeVisible();
  await expect(page.locator(".guide-steps > li")).toHaveCount(3);
  await expect(page.getByRole("navigation", { name: "Panel" }).getByRole("link", { name: "Guías" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: /^Siguiente: Comparar una opción/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Comparar una opción" })).toBeVisible();

  const missing = await page.request.get("/guias/no-existe");
  expect(missing.status()).toBe(404);

  await page.goto("/guias");
  await page.getByRole("link", { name: "Hacer el recorrido rápido" }).click();
  await expect(page).toHaveURL(/\/proyectos\/restage\/visor\?guia=rapida$/);
  await expect(page.locator("main")).toHaveAttribute("data-quick", "select", { timeout: 60_000 });
});
