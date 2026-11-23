import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { UNTITLED, cardMenu, chooseInCardMenu, createUntitledProject } from "./support/panel-proyectos";

test.use({ viewport: { width: 1366, height: 768 } });

test("Los proyectos se crean, se archivan y se restauran desde el tablero", async ({ page }, info) => {
  const first = "Torre " + randomUUID().slice(0, 8);
  const second = "Patio " + randomUUID().slice(0, 8);
  await page.goto("/registro");
  await page.getByLabel("Correo electrónico").fill("tablero-" + randomUUID() + "@example.test");
  await page.getByLabel("Contraseña").fill(randomUUID());
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  // Toda cuenta nueva pasa por la bienvenida; se omite para llegar al panel.
  await expect(page).toHaveURL(/\/bienvenida$/);
  await page.getByRole("button", { name: "Omitir por ahora" }).click();
  await expect(page.getByRole("heading", { name: "Mis proyectos" })).toBeVisible();

  const active = page.getByRole("tab", { name: /^Activos/ });
  const archived = page.getByRole("tab", { name: /^Archivados/ });
  const panel = page.getByRole("tabpanel");
  await expect(active).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Todavía no has creado proyectos.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir proyecto" })).toBeVisible();

  // «Nuevo proyecto» crea al instante «Proyecto sin título» y abre sus archivos (DU-07 = B). El nombre
  // se cambia en la tarjeta desde su menú «…»: el menú se cierra con Escape, el campo se cancela con
  // Escape y guarda con Intro.
  for (const name of [first, second]) {
    await createUntitledProject(page);
    await page.getByRole("link", { name: "Proyectos", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Mis proyectos" })).toBeVisible();
    const card = page.getByRole("link", { name: UNTITLED, exact: true });
    await expect(card).toBeVisible();
    const { trigger, menu } = cardMenu(page, UNTITLED);
    const field = page.getByRole("textbox", { name: "Nombre del proyecto" });
    if (name === first) {
      await trigger.click();
      await expect(menu.getByRole("menuitem")).toHaveText(["Cambiar nombre", "Archivar"]);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      await chooseInCardMenu(page, UNTITLED, "Cambiar nombre");
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(UNTITLED);
      await page.keyboard.press("Escape");
      await expect(field).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(card).toBeVisible();
    }
    await chooseInCardMenu(page, UNTITLED, "Cambiar nombre");
    await expect(field).toBeFocused();
    await field.fill(name);
    const saved = page.waitForResponse(res => res.request().method() === "PUT" && /\/api\/projects\/[^/]+$/.test(new URL(res.url()).pathname) && res.ok());
    await page.keyboard.press("Enter");
    await saved;
    await expect(field).toBeHidden();
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(card).toHaveCount(0);
  }
  await expect(active).toHaveText("Activos (2)");
  await expect(panel.getByText(/^Editado /).first()).toBeVisible();
  await page.screenshot({ animations: "disabled", fullPage: true, path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/proyectos-1366.png" : info.outputPath("proyectos.png") });

  // Archivar (menú «…») saca el proyecto de Activos y lo deja en Archivados, también tras recargar.
  // «Archivados» no lleva contador (solo Activos, ESPECIFICACION §3.1): se cuenta su tarjeta al abrirla.
  await chooseInCardMenu(page, first, "Archivar");
  await expect(page.getByRole("link", { name: first })).toHaveCount(0);
  await expect(active).toHaveText("Activos (1)");
  await expect(archived).toHaveText("Archivados");
  await page.reload();
  await expect(page.getByRole("link", { name: second })).toBeVisible();
  await expect(page.getByRole("link", { name: first })).toHaveCount(0);
  await expect(active).toHaveText("Activos (1)");

  // Las pestañas se recorren con las flechas.
  await active.focus();
  await page.keyboard.press("ArrowRight");
  await expect(archived).toHaveAttribute("aria-selected", "true");
  await expect(archived).toBeFocused();
  await expect(page.getByRole("link", { name: first })).toBeVisible();
  await expect(panel.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Abrir proyecto" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nuevo proyecto" })).toHaveCount(0);

  const restore = cardMenu(page, first);
  await restore.trigger.click();
  await expect(restore.menu.getByRole("menuitem")).toHaveText(["Cambiar nombre", "Restaurar"]);
  await restore.menu.getByRole("menuitem", { name: "Restaurar", exact: true }).click();
  await expect(page.getByText("No hay proyectos archivados.")).toBeVisible();
  // El foco no se pierde al desaparecer la tarjeta: vuelve a la pestaña.
  await expect(archived).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(active).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: first })).toBeVisible();
  await expect(page.getByRole("link", { name: second })).toBeVisible();
  await expect(active).toHaveText("Activos (2)");

  // La tarjeta abre el proyecto.
  await page.getByRole("link", { name: first }).click();
  await expect(page.getByRole("heading", { level: 1, name: first })).toBeVisible();
});

test("Las guías se leen paso a paso y la primera abre el recorrido en el visor", async ({ page }, info) => {
  await page.goto("/proyectos");
  await expect(page.getByRole("link", { name: "crea una cuenta" })).toBeVisible();
  // Cuatro guías bajo el tablero, en la misma rejilla que las tarjetas (ESPECIFICACION §3.4: «4 tarjetas
  // (hoy 3)»; guide-cards.tsx muestra guides.slice(0, 4)).
  const strip = page.getByRole("region", { name: "Aprende" });
  await expect(strip.getByRole("listitem")).toHaveCount(4);
  await expect(strip.getByRole("listitem").getByRole("heading")).toHaveText(["Empieza por aquí", "Pedir opciones visuales", "Marcar piezas y zonas", "Comparar una opción"]);
  await strip.getByRole("link", { name: "Ver todas las guías" }).click();

  await expect(page.getByRole("heading", { name: "Guías", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Panel" }).getByRole("link", { name: "Guías" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Empieza por aquí" })).toBeVisible();
  await expect(page.getByRole("list").filter({ hasText: "Marcar piezas y zonas" }).getByRole("listitem")).toHaveCount(6);
  await page.screenshot({ animations: "disabled", fullPage: true, path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/guias-1366.png" : info.outputPath("guias.png") });

  await page.getByRole("link", { name: "Marcar piezas y zonas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Marcar piezas y zonas" })).toBeVisible();
  await expect(page.locator(".guide-steps > li")).toHaveCount(5);
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
