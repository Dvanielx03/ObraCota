import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { editBar, editButton } from "./support/editar-prisma";
import { createProject, openFirstVersion, pickFirstPiece, renderButton, renderPanel, sendButton } from "./support/opciones-visuales";

test.use({ viewport: { width: 1366, height: 768 } });

/**
 * El área ya no se marca sobre una captura dentro del diálogo de opciones (se quitó area-marker.tsx):
 * se marca como zona sobre el lienzo en EDITAR › Seleccionar y viaja con «Enviar edición»
 * (edit-marks-layer.tsx, workspace-tools.tsx `send("marks")`, area-mask.ts). La captura que se envía
 * es la del lienzo (ESPECIFICACION.md §5.2), así que las zonas, en fracciones del lienzo, caen en los
 * mismos píxeles de la máscara.
 */

/** Solo el render del modelo: la interfaz flotante se oculta para saber si la cámara ya se detuvo. */
const modelOnly = { style: ".viewer-header,.stagebar,.workspace-bars,.edit-dock,.cube-host,.edit-layer,.workspace-toast,.scene-strip,.version-rail,[data-visual-tour]{visibility:hidden!important}" };
async function cameraSettled(page: Page) {
  const canvas = page.locator(".view canvas");
  await expect.poll(async () => {
    const before = await canvas.screenshot(modelOnly);
    await page.waitForTimeout(300);
    return before.equals(await canvas.screenshot(modelOnly));
  }).toBe(true);
}

test("Un área marcada sobre la captura viaja como máscara alineada", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(180_000);

  const project = await createProject(page, "Prueba del área marcada");

  // La prueba responde por el servidor: no se llama a ningún modelo de imagen.
  const sent: { element: string; request: string; jpeg: string; mask?: string }[] = [];
  await page.route("**/api/projects/*/versions/*/options?element=*", (route) =>
    route.fulfill({ json: { available: true, batches: [], budget: { reserve_cents: 100, remaining_cents: 800 } } }));
  await page.route("**/api/projects/*/versions/*/options", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { id: randomUUID() } });
  });
  /** Size of an image and the brightness of some pixels, read in the browser. */
  const inspect = (base64: string, points: [number, number][]) =>
    page.evaluate(async ({ base64, points }) => {
      const bitmap = await createImageBitmap(await (await fetch("data:image/jpeg;base64," + base64)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height,
        light: points.map(([fx, fy]) => context.getImageData(Math.round(fx * bitmap.width), Math.round(fy * bitmap.height), 1, 1).data[0]) };
    }, { base64, points });

  try {
    await openFirstVersion(page, project.id, ifc!, "Duplex");
    // Como antes, el área se marca con una pieza elegida: la petición va a su GlobalId.
    const piece = await pickFirstPiece(page);
    await page.getByRole("tab", { name: "Propiedades" }).click();
    const guid = (await page.locator("#pane-properties .guid").innerText()).trim();
    expect(guid).toMatch(/^[0-9A-Za-z_$]{22}$/);
    await editButton(page).click();
    await expect(editButton(page)).toHaveAttribute("aria-pressed", "true");
    // Al entrar en Editar la pieza elegida pasa a la selección.
    await expect(page.getByRole("region", { name: "Selección", exact: true }).getByRole("listitem")).toHaveCount(1);
    const select = editBar(page).getByRole("button", { name: "Seleccionar" });
    await expect(select).toHaveAttribute("aria-pressed", "true");
    const pill = page.locator(".edit-dock .edit-pill");
    await expect(pill).toHaveText("Haz clic en una pieza o arrastra para seleccionar una zona.");
    const layer = page.locator(".edit-layer");
    const marks = layer.locator("[data-edit-mark]");
    await expect(marks).toHaveCount(0);
    // Una zona solo vale para el encuadre en que se dibuja: se espera a que la cámara se detenga.
    await cameraSettled(page);

    // Ratón: arrastrar de la esquina superior izquierda a la inferior derecha de la zona.
    const box = (await page.locator(".view").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7, { steps: 4 });
    await page.mouse.up();
    const marked = layer.getByRole("button", { name: "Marca 1, zona de 50 % del ancho y 50 % del alto del lienzo: sin descripción" });
    await expect(marked).toBeVisible();
    await expect(layer.locator(".edit-zone")).toHaveCount(1);
    // El campo de la marca se abre con el foco; sin nota no se envía nada.
    const field = layer.getByRole("group", { name: "Cambio de la marca 1" });
    const note = field.getByRole("textbox", { name: "Describe el cambio de la marca 1" });
    await expect(note).toBeFocused();
    const sendEdit = field.getByRole("button", { name: "Enviar edición" });
    await expect(sendEdit).toHaveAttribute("aria-disabled", "true");
    await note.fill("Revestimiento en piedra");
    await expect(sendEdit).not.toHaveAttribute("aria-disabled", /.*/);
    await expect(marks).toHaveAccessibleName("Marca 1, zona de 50 % del ancho y 50 % del alto del lienzo: Revestimiento en piedra");
    // El costo se ve antes de enviar.
    await expect(pill).toHaveText("Reserva 1,00 USD · quedan 8,00 USD");
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/area.png" : info.outputPath("area.png") });

    // Enviar: la máscara tiene el tamaño de la captura, blanca dentro del área y negra fuera.
    await sendEdit.click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].element).toBe(guid);
    expect(sent[0].request).toBe("Marca 1 · Zona marcada: Revestimiento en piedra.");
    expect(sent[0].mask).toBeTruthy();
    const image = await inspect(sent[0].jpeg, []);
    const mask = await inspect(sent[0].mask!, [[0.5, 0.45], [0.1, 0.1], [0.9, 0.9], [0.3, 0.25], [0.7, 0.65]]);
    expect([mask.width, mask.height]).toEqual([image.width, image.height]);
    expect(mask.width / mask.height).toBeCloseTo(box.width / box.height, 1);
    expect(mask.light[0]).toBeGreaterThan(230);
    expect(mask.light[1]).toBeLessThan(25);
    expect(mask.light[2]).toBeLessThan(25);
    expect(mask.light[3]).toBeGreaterThan(230);
    expect(mask.light[4]).toBeGreaterThan(230);

    // Tras enviar, el área se limpia y RENDERIZAR se abre sobre la pieza, donde aparecerá el resultado.
    await expect(marks).toHaveCount(0);
    await expect(layer.locator(".edit-zone")).toHaveCount(0);
    await expect(renderPanel(page)).toBeVisible();
    const subject = renderPanel(page).getByRole("radiogroup", { name: "Sobre qué pedir opciones" });
    await expect(subject.getByRole("radio", { name: piece, exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(renderPanel(page)).toBeHidden();
    await expect(editButton(page)).toHaveAttribute("aria-pressed", "true");

    // Teclado: añadirla con el botón, moverla, redimensionarla y quitarla. «Añadir marca en el centro»
    // pone un punto si hay una pieza en el centro y una zona si no: se desplaza el modelo con el botón
    // central para dejar libre el centro del lienzo.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(box.x + box.width * 0.02, box.y + box.height * 0.5, { steps: 12 });
    await page.mouse.up({ button: "middle" });
    await cameraSettled(page);
    await select.focus();
    await page.keyboard.press("Tab");
    const addCenter = page.getByRole("button", { name: "Añadir marca en el centro" });
    await expect(addCenter).toBeFocused();
    await page.keyboard.press("Enter");
    const added = layer.getByRole("button", { name: /^Marca 1, zona de 24 % del ancho y 24 % del alto del lienzo/ });
    await expect(added).toBeVisible();
    await expect(layer.getByRole("textbox", { name: "Describe el cambio de la marca 1" })).toBeFocused();
    // Escape cierra el campo y devuelve el foco a la marca.
    await page.keyboard.press("Escape");
    await expect(added).toBeFocused();
    const zone = layer.locator(".edit-zone");
    const left = async () => (await zone.boundingBox())!.x;
    const before = await left();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => Math.abs((await left()) - before - box.width * 0.02)).toBeLessThan(1.5);
    await page.keyboard.press("Shift+ArrowRight");
    await expect(layer.getByRole("button", { name: /^Marca 1, zona de 26 % del ancho y 24 % del alto del lienzo/ })).toBeFocused();
    // No se sale del lienzo por mucho que se empuje.
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
    const edge = (await zone.boundingBox())!;
    expect(edge.x + edge.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    expect(edge.x + edge.width).toBeGreaterThan(box.x + box.width - 2);
    await page.keyboard.press("Delete");
    await expect(marks).toHaveCount(0);
    await expect(zone).toHaveCount(0);
    await expect(select).toBeFocused();
    expect(sent.length).toBe(1);

    // Sin área no se envía máscara: fuera de Editar, RENDERIZAR edita la pieza seleccionada, como antes.
    await editButton(page).click();
    await expect(editButton(page)).toHaveAttribute("aria-pressed", "false");
    await renderButton(page).click();
    const render = renderPanel(page);
    await expect(subject.getByRole("radio", { name: piece, exact: true })).toHaveAttribute("aria-checked", "true");
    await render.getByRole("radiogroup", { name: "Acabado o material" }).getByRole("radio", { name: "Acero" }).click();
    await sendButton(render).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].mask).toBeUndefined();
    expect(sent[1].element).toBe(guid);
    expect(sent[1].request).toContain("Acabado: acero.");
  } finally {
    await project.remove();
  }
});
