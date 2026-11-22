import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { png } from "./support/png";
import { actions, comparePanel, createProject, downloadPanel, openFirstVersion, pickFirstPiece, renderButton, renderPanel, unfoldBatches } from "./support/opciones-visuales";

test.use({ viewport: { width: 1366, height: 768 } });

/** Colour of one pixel of a PNG file, given as fractions of its size. */
async function pixel(page: Page, file: Buffer, x: number, y: number) {
  return page.evaluate(async ({ data, x, y }) => {
    const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + data)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const point = context.getImageData(Math.floor(bitmap.width * x), Math.floor(bitmap.height * y), 1, 1).data;
    return { size: [bitmap.width, bitmap.height], colour: [point[0], point[1], point[2]] };
  }, { data: file.toString("base64"), x, y });
}

test("Una opción se descarga como PNG con brillo, calidez y nitidez ajustados", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(180_000);

  const project = await createProject(page, "Prueba de descarga");

  // Una terna lista, sin llamar a ningún modelo de imagen.
  const colours: [number, number, number][] = [[120, 126, 134], [176, 122, 62], [58, 110, 92], [196, 188, 170]];
  await page.route("**/api/projects/*/versions/*/options?element=*", (route) =>
    route.fulfill({
      json: {
        available: true,
        batches: [{
          id: "terna-1", request: "Puerta en roble natural", state: "READY", selected: null,
          options: [1, 2, 3].map((slot) => ({ slot, description: "Acabado de prueba " + slot })), runs: [],
        }],
      },
    }));
  await page.route("**/api/projects/*/versions/*/options/terna-1/images/*", (route) => {
    const slot = Number(new URL(route.request().url()).pathname.split("/").pop());
    return route.fulfill({ contentType: "image/png", body: png(480, 300, colours[slot]) });
  });

  try {
    await openFirstVersion(page, project.id, ifc!, "Duplex");
    await pickFirstPiece(page);

    // Las tandas de la pieza están en RENDERIZAR, plegadas tras «Ver».
    await renderButton(page).click();
    const render = renderPanel(page);
    await unfoldBatches(render);
    await expect(render.getByRole("img", { name: "Opción 2", exact: true })).toBeVisible();

    // «Descargar opción 2» abre el panel Descargar apuntando a esa opción (un panel a la vez).
    await render.getByRole("button", { name: "Descargar opción 2" }).click();
    const dialog = downloadPanel(page);
    await expect(dialog).toBeVisible();
    await expect(render).toBeHidden();
    const downloadTool = actions(page).getByRole("button", { name: "Descargar", exact: true });
    await expect(downloadTool).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.getByRole("radiogroup", { name: "Opción" }).getByRole("radio", { name: "Opción 2" })).toHaveAttribute("aria-checked", "true");

    // La vista previa con los ajustes y el primer plano están plegados en «Vista previa y primer plano».
    const panel = dialog.getByRole("region", { name: "Descargar la opción 2" });
    const adjusted = panel.getByRole("img", { name: "Opción 2 con los ajustes aplicados · Generado con IA" });
    await expect(adjusted).toBeHidden();
    await panel.getByText("Vista previa y primer plano").click();
    await expect(adjusted).toBeVisible();
    const brightness = panel.getByRole("slider", { name: "Brillo" });
    const warmth = panel.getByRole("slider", { name: "Calidez" });
    const sharpness = panel.getByRole("slider", { name: "Nitidez" });
    // «Restablecer» va en la cabecera del panel y «Descargar imagen» en su pie, fuera de la región.
    const reset = dialog.getByRole("button", { name: "Restablecer", exact: true });
    await expect(brightness).toHaveValue("0");
    await expect(reset).toBeDisabled();

    const save = async () => {
      const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Descargar imagen" }).click()]);
      return { name: download.suggestedFilename(), file: await readFile(await download.path()) };
    };
    const near = (a: number[], b: number[], slack = 2) => a.every((v, i) => Math.abs(v - b[i]) <= slack);

    // Sin ajustes: mismo tamaño y color que la opción, PNG con el nombre de la pieza y la marca en la esquina.
    const plain = await save();
    expect(plain.name).toMatch(/^obracota-[a-z0-9-]+-opcion-2\.png$/);
    expect(plain.name).not.toMatch(/^obracota-(vista|pieza)-/);
    expect([...plain.file.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const centre = await pixel(page, plain.file, 0.5, 0.4);
    expect(centre.size).toEqual([480, 300]);
    expect(near(centre.colour, colours[2])).toBe(true);
    const corner = await pixel(page, plain.file, 0.985, 0.92);
    expect(near(corner.colour, colours[2], 12)).toBe(false);

    // Brillo con teclado: el valor se ve y los píxeles del archivo suben en los tres canales.
    await brightness.focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
    await expect(brightness).toHaveValue("20");
    await expect(panel.locator("label", { hasText: "Brillo" }).locator("b")).toHaveText("+20");
    await expect(reset).toBeEnabled();
    const brighter = (await pixel(page, (await save()).file, 0.5, 0.4)).colour;
    expect(brighter.every((v, i) => v > colours[2][i] + 15)).toBe(true);

    // Calidez: sube el rojo y baja el azul.
    await warmth.fill("30");
    const warmer = (await pixel(page, (await save()).file, 0.5, 0.4)).colour;
    expect(warmer[0]).toBeGreaterThan(brighter[0] + 10);
    expect(warmer[2]).toBeLessThan(brighter[2] - 10);
    await sharpness.fill("60");
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/descarga-1366.png" : info.outputPath("descarga.png") });

    // Restablecer devuelve los controles y el archivo a como llegó la opción.
    await reset.click();
    await expect(brightness).toHaveValue("0");
    await expect(warmth).toHaveValue("0");
    await expect(sharpness).toHaveValue("0");
    await expect(reset).toBeDisabled();
    expect(near((await pixel(page, (await save()).file, 0.5, 0.4)).colour, colours[2])).toBe(true);

    // Primer plano: es un recorte de los mismos píxeles, con su propio nombre de archivo.
    const zoom = panel.getByRole("slider", { name: "Acercar" });
    const horizontal = panel.getByRole("slider", { name: "Horizontal" });
    await expect(horizontal).toBeDisabled();
    await zoom.fill("200");
    await expect(horizontal).toBeEnabled();
    await horizontal.fill("100");
    const close = await save();
    expect(close.name).toMatch(/-opcion-2-primer-plano\.png$/);
    const cropped = await pixel(page, close.file, 0.5, 0.4);
    expect(cropped.size).toEqual([240, 150]);
    expect(near(cropped.colour, colours[2])).toBe(true);
    expect(near((await pixel(page, close.file, 0.97, 0.9)).colour, colours[2], 12)).toBe(false);
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/primer-plano-1366.png" : info.outputPath("primer-plano.png") });
    await reset.click();
    await expect(zoom).toHaveValue("100");
    expect((await pixel(page, (await save()).file, 0.5, 0.4)).size).toEqual([480, 300]);

    // Descargar y comparar no se pisan: abrir Comparar cierra Descargar, y descargar otra opción
    // desde las tandas cierra Comparar. La X del panel lo quita y devuelve el foco a Descargar.
    await actions(page).getByRole("button", { name: "Comparar", exact: true }).click();
    await expect(comparePanel(page)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".option-download")).toHaveCount(0);
    await renderButton(page).click();
    await expect(comparePanel(page)).toBeHidden();
    await render.getByRole("button", { name: "Descargar opción 1" }).click();
    await expect(dialog.getByRole("region", { name: "Descargar la opción 1" })).toBeVisible();
    await expect(page.locator(".compare")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cerrar descarga" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".option-download")).toHaveCount(0);
    await expect(downloadTool).toBeFocused();
  } finally {
    await project.remove();
  }
});
