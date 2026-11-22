import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createProject, openFirstVersion, pickFirstPiece, renderButton, renderPanel, sendButton } from "./support/opciones-visuales";

test.use({ viewport: { width: 1366, height: 768 } });

test("La petición se arma con opciones cerradas y muestra su costo antes de enviar", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(180_000);

  const project = await createProject(page, "Prueba de opciones cerradas");

  // La prueba responde por el servidor: no se llama a ningún modelo de imagen ni se gasta presupuesto.
  let remaining = 700;
  const sent: { request: string; element: string; mask?: string }[] = [];
  await page.route("**/api/projects/*/versions/*/options?element=*", (route) =>
    route.fulfill({ json: { available: true, batches: [], budget: { reserve_cents: 100, remaining_cents: remaining } } }));
  await page.route("**/api/projects/*/versions/*/options", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { id: randomUUID() } });
  });

  try {
    await openFirstVersion(page, project.id, ifc!, "Duplex");
    const piece = await pickFirstPiece(page);

    // Las opciones visuales viven en el panel de RENDERIZAR, sobre la pieza elegida (DU-04, DU-16).
    await renderButton(page).click();
    const dialog = renderPanel(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radiogroup", { name: "Sobre qué pedir opciones" }).getByRole("radio", { name: piece, exact: true }))
      .toHaveAttribute("aria-checked", "true");
    const send = sendButton(dialog);
    const preview = dialog.locator("[data-request-preview]");

    // Playwright da por visible un recorte de 1 × 1 px (.visually-hidden): la línea tiene que leerse
    // entera, a lo ancho del pie y debajo del botón principal.
    async function expectBudgetLine(text: string) {
      const line = dialog.getByText(text, { exact: true });
      await expect(line).toBeVisible();
      const [box, button] = [await line.boundingBox(), await send.boundingBox()];
      expect(box!.height, "la línea del saldo ocupa al menos una línea de texto").toBeGreaterThanOrEqual(12);
      expect(box!.width, "la línea del saldo no está recortada").toBeGreaterThan(button!.width / 2);
      expect(box!.y, "la línea del saldo va bajo el botón principal").toBeGreaterThanOrEqual(button!.y + button!.height);
    }

    // Lo que se enviará se ve con el botón del ojo, dentro de la caja de texto.
    const peek = dialog.getByRole("button", { name: "Ver la petición que se enviará" });
    await expect(preview).toBeHidden();
    await peek.click();
    await expect(peek).toHaveAttribute("aria-expanded", "true");
    await expect(preview).toBeVisible();

    // Sin pedir nada no se puede enviar; lo que se conserva no es una petición por sí solo.
    // Las opciones cerradas se llaman «fichas» en la interfaz (visual-options.tsx:124 y :126), como en
    // Vibe3D (03-herramientas.md §1.3): «opción» queda para las tres imágenes generadas (Opción 1 · 2 · 3).
    await expect(send).toBeDisabled();
    await expect(preview).toHaveText("Elige al menos una ficha o escribe el cambio.");
    const keep = dialog.getByRole("group", { name: "Qué conservar" });
    await expect(keep.getByRole("button", { name: "Forma y medidas" })).toHaveAttribute("aria-pressed", "true");
    await expect(keep.getByRole("button", { name: "Entorno" })).toHaveAttribute("aria-pressed", "true");

    // El costo se ve antes de actuar: la ficha de costo dentro del botón y, en una línea bajo él, la
    // reserva y el saldo mensual (ESPECIFICACION.md §5.1 «Botón principal», IMPLEMENTACION-espacio-2.md
    // §3.3 «Botón», F4-04 en docs/handoffs/HISTORY.md y la guía de guides.ts:35).
    await expect(send.locator(".main-cost")).toBeVisible();
    await expect(send.locator(".main-cost")).toHaveText("1,00 USD");
    await expectBudgetLine("Cada envío reserva 1,00 USD del presupuesto mensual de IA. Quedan 7,00 USD.");

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
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/opciones.png" : info.outputPath("opciones.png") });

    // Pulsar otra vez el acabado elegido lo quita; el tono queda solo.
    await finish.getByRole("radio", { name: "Madera" }).click();
    await expect(preview).toContainText("Tono: oscuro.");
    await finish.getByRole("radio", { name: "Madera" }).click();
    await expect(preview).toHaveText(expected);

    // Se envía exactamente el texto mostrado, sobre la pieza elegida y sin máscara, y el formulario vuelve a su estado inicial.
    await send.click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].request).toBe(expected);
    expect(sent[0].element).not.toBe("vista");
    expect(sent[0].mask).toBeUndefined();
    await expect(dialog.getByRole("status").filter({ hasText: "Petición enviada" })).toBeVisible();
    await expect(preview).toHaveText("Elige al menos una ficha o escribe el cambio.");
    await expect(finish.getByRole("radio", { name: "Madera" })).toHaveAttribute("aria-checked", "false");
    await expect(keep.getByRole("button", { name: "Entorno" })).toHaveAttribute("aria-pressed", "true");

    // Con el presupuesto agotado se avisa y no se puede enviar. El panel no tiene X: Escape lo cierra
    // y devuelve el foco a RENDERIZAR; al abrirlo otra vez se lee de nuevo el saldo.
    remaining = 50;
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(renderButton(page)).toBeFocused();
    await renderButton(page).click();
    await expect(dialog).toBeVisible();
    await expectBudgetLine("Cada envío reserva 1,00 USD del presupuesto mensual de IA. Quedan 0,50 USD.");
    await finish.getByRole("radio", { name: "Vidrio" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Se agotó el presupuesto mensual de IA");
    await expect(send).toBeDisabled();
    expect(sent.length).toBe(1);
  } finally {
    await project.remove();
  }
});
