import { expect, test, type Page } from "@playwright/test";

// First visit: neither the onboarding nor the viewer guide has been seen.
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 768 } });

const main = (page: Page) => page.locator("main");
const card = (page: Page) => page.getByRole("region", { name: "Recorrido rápido" });
// Prisma dejó de ser una sección (DU-16): su función vive en EDITAR, en la barra inferior del visor.
const editButton = (page: Page) =>
  page.getByRole("toolbar", { name: "Acciones del modelo" }).getByRole("button", { name: "Editar", exact: true });

async function ready(page: Page) {
  await expect(page.locator(".project")).toHaveText("ReStage", { timeout: 90_000 });
}

test("El recorrido rápido sigue lo que la persona hace sobre los controles reales", async ({ page }, info) => {
  await page.goto("/proyectos/restage/visor");
  await ready(page);
  const welcome = page.getByRole("dialog", { name: "Empieza por aquí" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Recorrido rápido" }).click();
  await expect(welcome).not.toBeVisible();

  // 1 de 3: el aviso describe un control real y avanza al elegir una pieza.
  await expect(main(page)).toHaveAttribute("data-quick", "select");
  await expect(card(page)).toContainText("1 de 3");
  let entry = page.locator(".entry").first();
  if (!(await entry.isVisible())) {
    const level = page.locator(".level").first();
    await expect(level).toHaveAttribute("aria-describedby", /quick-instruction/);
    await level.click();
    entry = page.locator(".entry").first();
  }
  await expect(entry).toHaveAttribute("aria-describedby", /quick-instruction/);
  await page.screenshot({ animations: "disabled", path: info.outputPath("paso-1.png") });
  await entry.click();

  // 2 de 3: señala EDITAR (antes Prisma) y avanza al abrirlo.
  await expect(main(page)).toHaveAttribute("data-quick", "options");
  const edit = editButton(page);
  await expect(edit).toHaveAttribute("aria-describedby", /quick-instruction/);
  await expect(edit).toHaveAttribute("aria-pressed", "false");
  await expect(card(page)).toContainText("2 de 3");
  await expect(card(page)).toContainText("Edita la pieza");
  await page.screenshot({ animations: "disabled", path: info.outputPath("paso-2.png") });

  // «Atrás» devuelve al primer paso sin perder la guía.
  await card(page).getByRole("button", { name: "Atrás" }).click();
  await expect(main(page)).toHaveAttribute("data-quick", "select");
  await page.locator(".entry").first().click();
  await expect(main(page)).toHaveAttribute("data-quick", "options");
  await edit.click();
  // EDITAR queda activo y su panel de selección ocupa el explorador.
  await expect(edit).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#explorer").getByRole("region", { name: "Selección", exact: true })).toBeVisible();

  // 3 de 3 si este archivo permite recorrerlo; si no, la guía salta al cierre.
  await expect(main(page)).toHaveAttribute("data-quick", /walk|done/);
  if ((await main(page).getAttribute("data-quick")) === "walk") {
    await expect(page.locator(".walk-trigger")).toHaveAttribute("aria-describedby", /quick-instruction/);
    await expect(card(page)).toContainText("3 de 3");
    await page.screenshot({ animations: "disabled", path: info.outputPath("paso-3.png") });
    await page.locator(".walk-trigger").click();
    await expect(main(page)).not.toHaveAttribute("data-quick", /.+/);
    await expect(main(page)).toHaveAttribute("data-walk", "on");
  } else {
    await expect(card(page)).toContainText("ya conoces lo esencial");
    await page.screenshot({ animations: "disabled", path: info.outputPath("cierre.png") });
    await card(page).getByRole("button", { name: "Finalizar" }).click();
    await expect(main(page)).not.toHaveAttribute("data-quick", /.+/);
  }

  // No vuelve a salir sola, y se puede repetir desde la ayuda.
  await page.reload();
  await ready(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(main(page)).not.toHaveAttribute("data-quick", /.+/);
  await page.getByRole("button", { name: "Guía de uso", exact: true }).click();
  await page.getByRole("button", { name: "Recorrido rápido" }).click();
  await expect(main(page)).toHaveAttribute("data-quick", "select");
});

test("Llegar desde la bienvenida arranca el recorrido sin diálogo; se pausa y se omite", async ({ page }) => {
  await page.goto("/proyectos/restage/visor?guia=rapida");
  await ready(page);
  await expect(main(page)).toHaveAttribute("data-quick", "select");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // En una primera visita el explorador arranca plegado: el primer aviso señala cómo abrirlo.
  await expect(page.locator("#explorer")).toBeHidden();
  const toggle = page.locator(".stagebar").getByRole("button", { name: "Mostrar explorador" });
  await expect(card(page)).toContainText("Abre el explorador");
  await expect(toggle).toHaveAttribute("aria-describedby", /quick-instruction/);
  await toggle.click();
  await expect(page.locator("#explorer")).toBeVisible();
  await expect(card(page)).toContainText("1 de 3");
  await expect(main(page)).toHaveAttribute("data-quick", "select");

  await card(page).getByRole("button", { name: "Pausar" }).click();
  await expect(card(page)).toContainText("Tutorial en pausa");
  // En pausa, elegir una pieza no hace avanzar la guía.
  const entry = page.locator(".entry").first();
  if (!(await entry.isVisible())) await page.locator(".level").first().click();
  await page.locator(".entry").first().click();
  await expect(main(page)).toHaveAttribute("data-quick", "select");
  await card(page).getByRole("button", { name: "Reanudar" }).click();
  await expect(card(page)).toContainText("1 de 3");

  await card(page).getByRole("button", { name: "Omitir" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(main(page)).not.toHaveAttribute("data-quick", /.+/);

  // Las otras dos guías siguen disponibles.
  await page.getByRole("button", { name: "Guía de uso", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Empieza por aquí" });
  await expect(help.getByRole("button", { name: "Iniciar guía" })).toBeVisible();
  // La guía de Prisma pasó a llamarse «Guía de Editar» (viewer-workspace.tsx, diálogo de ayuda).
  await expect(help.getByRole("button", { name: "Guía de Editar" })).toBeVisible();
});
