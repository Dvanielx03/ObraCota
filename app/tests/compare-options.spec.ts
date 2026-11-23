import { expect, test } from "@playwright/test";
import { png } from "./support/png";
import { actions, comparePanel, createProject, openFirstVersion, pickFirstPiece, renderButton, renderPanel, unfoldBatches } from "./support/opciones-visuales";

test.use({ viewport: { width: 1366, height: 768 } });

test("Una opción se compara con la vista del modelo con el ratón y con el teclado", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(180_000);
  // Los colores se leen en píxeles de la pantalla: sin la animación de entrada del panel.
  await page.emulateMedia({ reducedMotion: "reduce" });

  const project = await createProject(page, "Prueba del comparador");

  // Una terna lista, sin llamar a ningún modelo de imagen: la captura es gris y las opciones, de color.
  const colours: [number, number, number][] = [[120, 126, 134], [176, 122, 62], [58, 110, 92], [196, 188, 170]];
  await page.route("**/api/projects/*/versions/*/options?element=*", (route) =>
    route.fulfill({
      json: {
        available: true,
        batches: [{
          id: "terna-1", request: "Puerta en roble natural en la ciudad", state: "READY", selected: null,
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

    // «Comparar opción 2» abre el panel Comparar apuntando a esa opción; Renderizar se cierra (un panel a la vez).
    await render.getByRole("button", { name: "Comparar opción 2" }).click();
    const dialog = comparePanel(page);
    await expect(dialog).toBeVisible();
    await expect(render).toBeHidden();
    const compareTool = actions(page).getByRole("button", { name: "Comparar", exact: true });
    await expect(compareTool).toHaveAttribute("aria-expanded", "true");
    const options = dialog.getByRole("radiogroup", { name: "Opción" });
    await expect(options.getByRole("radio", { name: "Opción 2" })).toHaveAttribute("aria-checked", "true");

    const comparison = dialog.getByRole("region", { name: "Comparar la opción 2 con la vista del modelo" });
    await expect(comparison.getByRole("img", { name: "Vista del modelo" })).toBeVisible();
    await expect(comparison.getByRole("img", { name: "Opción 2 · Generado con IA" })).toBeVisible();
    const divider = comparison.getByRole("slider", { name: "Posición del divisor" });
    await expect(divider).toHaveValue("50");
    await expect(divider).toHaveAttribute("aria-valuetext", "50 % de la vista del modelo");

    // El color bajo un punto dice qué imagen se ve ahí: gris es el modelo, verde es la opción.
    // (La región cambia de nombre con la opción; el escenario se busca en el panel.)
    const stage = dialog.locator(".compare-stage");
    const colourAt = async (fraction: number) => {
      const box = (await stage.boundingBox())!;
      const shot = await page.screenshot({ clip: { x: Math.round(box.x + box.width * fraction), y: Math.round(box.y + box.height * 0.3), width: 1, height: 1 } });
      return page.evaluate(async (data) => {
        const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + data)).blob());
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      }, shot.toString("base64"));
    };
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 6);
    const expectColour = (fraction: number, colour: number[]) => expect.poll(async () => near(await colourAt(fraction), colour)).toBe(true);
    await expectColour(0.2, colours[0]);
    await expectColour(0.8, colours[2]);
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/comparador.png" : info.outputPath("comparador.png") });

    // Teclado: flechas, Inicio y Fin.
    await divider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(divider).toHaveValue("51");
    await page.keyboard.press("End");
    await expect(divider).toHaveValue("100");
    await expectColour(0.8, colours[0]);
    await page.keyboard.press("Home");
    await expect(divider).toHaveValue("0");
    await expectColour(0.2, colours[2]);

    // Ratón: pulsar a tres cuartos del ancho lleva ahí el divisor.
    const box = (await stage.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.6);
    expect(Math.abs(Number(await divider.inputValue()) - 75)).toBeLessThanOrEqual(2);

    // Cambiar de opción reutiliza el comparador; cerrarlo lo quita y devuelve el foco a Comparar.
    await options.getByRole("radio", { name: "Opción 3" }).click();
    await expect(dialog.getByRole("region", { name: "Comparar la opción 3 con la vista del modelo" })).toBeVisible();
    await expect(options.getByRole("radio", { name: "Opción 2" })).toHaveAttribute("aria-checked", "false");
    await expect(dialog.locator(".compare")).toHaveCount(1);
    await expectColour(0.8, colours[3]);
    await dialog.getByRole("button", { name: "Cerrar comparación" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".compare")).toHaveCount(0);
    await expect(compareTool).toBeFocused();
    await expect(compareTool).toHaveAttribute("aria-expanded", "false");

    // Comparar no elige: la opción 2 sigue por elegir en las tandas de RENDERIZAR.
    await renderButton(page).click();
    await expect(render.getByRole("button", { name: "Elegir opción 2" })).toBeEnabled();
    const walk = render.getByRole("button", { name: "Recorrer esta escena en 3D · opción 2" });
    await expect(walk).toHaveText("Recorrer esta escena en 3D");
    await walk.click();
    await expect(page.locator(".stage")).toHaveAttribute("data-environment", "afternoon clear - city -");
    await expect(page.locator("main")).toHaveAttribute("data-walk", "on");
  } finally {
    await project.remove();
  }
});
