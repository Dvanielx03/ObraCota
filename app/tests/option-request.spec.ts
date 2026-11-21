import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ viewport: { width: 1366, height: 768 } });

test("La petición se arma con opciones cerradas y muestra su costo antes de enviar", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(180_000);

  const auth = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  expect(auth.ok()).toBeTruthy();
  const headers = { Authorization: "Bearer " + (await auth.json()).accessToken };
  const { id } = await (await page.request.post("/api/projects", { headers, data: { name: "Prueba de opciones cerradas" } })).json();

  // La prueba responde por el servidor: no se llama a ningún modelo de imagen ni se gasta presupuesto.
  let remaining = 700;
  const sent: { request: string; element: string }[] = [];
  await page.route("**/api/projects/*/versions/*/options?element=*", (route) =>
    route.fulfill({ json: { available: true, batches: [], budget: { reserve_cents: 100, remaining_cents: remaining } } }));
  await page.route("**/api/projects/*/versions/*/options", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { id: randomUUID() } });
  });

  try {
    await page.goto("/proyectos/" + id + "/archivos");
    await page.getByLabel("Archivo IFC o DWG").setInputFiles(ifc!);
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await page.getByRole("link", { name: "Abrir versión 1 en el visor" }).click();
    await expect(page.locator(".project")).toContainText("Duplex", { timeout: 120_000 });
    if (!(await page.locator("#explorer .entry").count())) await page.locator("#explorer .level").first().click();
    await page.locator("#explorer .entry").first().click();
    await page.getByRole("tab", { name: "Propiedades" }).click();
    await page.getByRole("button", { name: "Opciones visuales" }).click();

    const dialog = page.getByRole("dialog", { name: "Opciones visuales" });
    const send = dialog.getByRole("button", { name: "Enviar captura y generar tres opciones" });
    const preview = dialog.locator("[data-request-preview]");

    // Sin pedir nada no se puede enviar; lo que se conserva no es una petición por sí solo.
    await expect(send).toBeDisabled();
    await expect(preview).toHaveText("elige al menos una opción o escribe el cambio.");
    const keep = dialog.getByRole("group", { name: "Qué conservar" });
    await expect(keep.getByRole("button", { name: "Forma y medidas" })).toHaveAttribute("aria-pressed", "true");
    await expect(keep.getByRole("button", { name: "Entorno" })).toHaveAttribute("aria-pressed", "true");

    // El costo se ve antes de actuar.
    await expect(send).toContainText("reserva 1,00 USD");
    await expect(dialog.getByText("Cada envío reserva 1,00 USD del presupuesto mensual de IA. Quedan 7,00 USD.")).toBeVisible();

    // Ratón: un acabado.
    const finish = dialog.getByRole("radiogroup", { name: "Acabado o material" });
    await finish.getByRole("radio", { name: "Madera" }).click();
    await expect(preview).toHaveText("Acabado: madera. Conservar la forma y las medidas de la pieza y el resto del modelo y el entorno.");
    await expect(send).toBeEnabled();

    // Teclado: flechas dentro del grupo, espacio para elegir.
    const tone = dialog.getByRole("radiogroup", { name: "Tono" });
    await tone.getByRole("radio", { name: "Claro" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tone.getByRole("radio", { name: "Medio" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(tone.getByRole("radio", { name: "Oscuro" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(tone.getByRole("radio", { name: "Oscuro" })).toHaveAttribute("aria-checked", "true");

    await dialog.getByRole("radiogroup", { name: "Luz del día" }).getByRole("radio", { name: "Tarde" }).click();
    await keep.getByRole("button", { name: "Entorno" }).click();
    await dialog.getByLabel("Cambio solicitado").fill("  Sin manijas visibles.  ");
    const expected = "Acabado: madera en tono oscuro. Luz del día: tarde. Conservar la forma y las medidas de la pieza. Sin manijas visibles.";
    await expect(preview).toHaveText(expected);
    await dialog.locator(".option-request").scrollIntoViewIfNeeded();
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/opciones.png" : info.outputPath("opciones.png") });

    // Pulsar otra vez el acabado elegido lo quita; el tono queda solo.
    await finish.getByRole("radio", { name: "Madera" }).click();
    await expect(preview).toContainText("Tono: oscuro.");
    await finish.getByRole("radio", { name: "Madera" }).click();
    await expect(preview).toHaveText(expected);

    // Se envía exactamente el texto mostrado y el formulario vuelve a su estado inicial.
    await send.click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].request).toBe(expected);
    await expect(preview).toHaveText("elige al menos una opción o escribe el cambio.");
    await expect(finish.getByRole("radio", { name: "Madera" })).toHaveAttribute("aria-checked", "false");
    await expect(keep.getByRole("button", { name: "Entorno" })).toHaveAttribute("aria-pressed", "true");

    // Con el presupuesto agotado se avisa y no se puede enviar.
    remaining = 50;
    await dialog.getByRole("button", { name: "Cerrar opciones" }).click();
    await page.getByRole("button", { name: "Opciones visuales" }).click();
    await finish.getByRole("radio", { name: "Vidrio" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Se agotó el presupuesto mensual de IA");
    await expect(send).toBeDisabled();
    expect(sent.length).toBe(1);
  } finally {
    await page.request.delete("/api/projects/" + id, { headers }).catch(() => undefined);
  }
});
