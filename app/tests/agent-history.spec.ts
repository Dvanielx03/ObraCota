import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { editButton, selectionPanel } from "./support/editar-prisma";
import { createProject, renderButton } from "./support/opciones-visuales";

test("Editar y la tarjeta muestran el historial persistido de la misma versión", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const project = await createProject(page, "Historial de propuesta IFC");
  const root = "/api/projects/" + project.id;
  try {
    const availability = await (await page.request.get(root + "/agent-runs", { headers: project.headers })).json();
    expect(availability.provider).toBe("fake");
    const uploaded = await page.request.post(root + "/uploads", {
      headers: { ...project.headers, "Content-Type": "application/octet-stream" },
      params: { name: "Duplex_A.ifc" }, data: readFileSync(ifc!),
    });
    expect(uploaded.status()).toBe(201);
    const version = (await uploaded.json()).id;
    await page.goto(`/proyectos/${project.id}/visor/${version}`);
    await expect(renderButton(page)).toBeVisible({ timeout: 120_000 });
    await editButton(page).click();
    const history = selectionPanel(page).locator("details").filter({ hasText: "Historial del agente" });
    await history.locator("summary").press("Enter");
    await expect(history).toContainText("Aún no hay ejecuciones registradas para esta versión.");

    const unavailable = await page.request.post(root + "/agent-runs", {
      headers: project.headers,
      data: { version, notes: [{ globalId: "1hOSvn6df7F8_7GcBWlS8Z", name: "Puerta", text: "Rediseña la cubierta y añade una habitación" }] },
    });
    expect(unavailable.status()).toBe(200);
    expect(await unavailable.json()).toMatchObject({ status: "NO_CHANGE", change: null, steps: [] });
    await history.getByRole("button", { name: "Actualizar historial" }).click();
    const declined = history.getByRole("listitem").filter({ hasText: "Sin cambio" });
    await expect(declined).toContainText("no produjo un borrador");
    await expect(declined.getByRole("link", { name: "Abrir cambio" })).toHaveCount(0);

    const ran = await page.request.post(root + "/agent-runs", {
      headers: project.headers, timeout: 225_000,
      data: { version, notes: [{ globalId: "1hOSvn6df7F8_7GcBWlS8Z", name: "Puerta", text: "Cambiar FireRating a EI 60" }] },
    });
    expect(ran.status()).toBe(200);
    const run = await ran.json();
    expect(run.status, run.message).toBe("READY");
    await history.getByRole("button", { name: "Actualizar historial" }).click();
    await expect(history).toContainText("Listo para revisión");
    const accepted = history.getByRole("listitem").filter({ hasText: "Listo para revisión" });
    await expect(accepted.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
    await expect(history).toContainText(run.message);
    await expect(accepted).toHaveCSS("display", "grid");
    await expect(history.getByRole("link", { name: "Abrir cambio" })).toHaveCSS("white-space", "nowrap");
    await page.screenshot({ path: info.outputPath("historial-en-editar.png") });
    await history.getByRole("link", { name: "Abrir cambio" }).click();
    const card = page.locator(`article[id="${run.change}"]`);
    await expect(card).toContainText("Propuesta por el agente");
    await expect(card).not.toContainText(/generad[oa] con IA/i);
    await card.getByText("Pasos del agente").click();
    await expect(card.getByText("Listo para revisión", { exact: true })).toBeVisible();
    await expect(card).toContainText("Agente de prueba · sin IA");
    await expect(card.getByText("Verificar la vista previa", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Aprobar y aplicar cambio" })).toBeEnabled();
    await page.screenshot({ path: info.outputPath("historial-en-tarjeta.png") });
  } finally {
    await project.remove();
  }
});
