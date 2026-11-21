import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ viewport: { width: 1366, height: 768 } });

/** Mean absolute difference per channel between two PNG screenshots of the same size. */
async function difference(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(async ([first, second]) => {
    const read = async (data: string) => {
      const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + data)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [x, y] = [await read(first), await read(second)];
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
    return sum / x.length;
  }, [a.toString("base64"), b.toString("base64")]);
}

test("Una vista guardada devuelve la cámara a su encuadre y se renombra y elimina", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(180_000);

  const auth = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  expect(auth.ok()).toBeTruthy();
  const headers = { Authorization: "Bearer " + (await auth.json()).accessToken };
  const { id } = await (await page.request.post("/api/projects", { headers, data: { name: "Prueba de vistas" } })).json();

  try {
    await page.goto("/proyectos/" + id + "/archivos");
    await page.getByLabel("Archivo IFC o DWG").setInputFiles(ifc!);
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await page.getByRole("link", { name: "Abrir versión 1 en el visor" }).click();
    await expect(page.locator(".project")).toContainText("Duplex", { timeout: 120_000 });

    const strip = page.getByRole("region", { name: "Vistas guardadas" });
    await expect(strip.getByText("Encuadra el modelo y guarda la vista para volver a ella.")).toBeVisible();

    // Una zona del lienzo sin controles encima sirve para saber qué se ve.
    const stage = (await page.locator("section.stage").boundingBox())!;
    const clip = { x: Math.round(stage.x + stage.width * 0.42), y: Math.round(stage.y + stage.height * 0.3), width: Math.round(stage.width * 0.36), height: Math.round(stage.height * 0.42) };
    const look = () => page.screenshot({ clip, animations: "disabled" });
    const centre = { x: clip.x + clip.width / 2, y: clip.y + clip.height / 2 };

    // Un encuadre propio: acercar y girar antes de guardar.
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -240);
    await page.mouse.down();
    await page.mouse.move(centre.x + 90, centre.y + 30, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const saved = await look();

    await strip.getByRole("button", { name: "Guardar vista" }).click();
    const first = strip.getByRole("button", { name: "Vista 1", exact: true });
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(strip.getByRole("status")).toHaveText("«Vista 1» guardada.");
    expect(await difference(page, saved, await look())).toBeLessThan(0.5);

    // Mover la cámara cambia lo que se ve; la vista lo devuelve.
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x - 160, centre.y - 70, { steps: 8 });
    await page.mouse.up();
    await page.mouse.wheel(0, 360);
    await page.waitForTimeout(400);
    expect(await difference(page, saved, await look())).toBeGreaterThan(3);
    await first.click();
    await expect.poll(async () => difference(page, saved, await look())).toBeLessThan(0.5);

    // Una segunda vista toma el siguiente nombre libre.
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, 240);
    await strip.getByRole("button", { name: "Guardar vista" }).click();
    await expect(strip.getByRole("button", { name: "Vista 2", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/vistas-1366.png" : info.outputPath("vistas.png") });

    // Renombrar con teclado: Escape cancela, Intro guarda y el foco vuelve a la vista.
    await strip.getByRole("button", { name: "Renombrar Vista 1" }).click();
    const input = strip.getByRole("textbox", { name: "Nombre de Vista 1" });
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await strip.getByRole("button", { name: "Renombrar Vista 1" }).click();
    await input.fill("Fachada de acceso");
    await page.keyboard.press("Enter");
    const renamed = strip.getByRole("button", { name: "Fachada de acceso", exact: true });
    await expect(renamed).toBeFocused();

    // Las vistas pertenecen a la versión: siguen ahí al volver a abrirla y aplican el mismo encuadre.
    await page.reload();
    await expect(page.locator(".project")).toContainText("Duplex", { timeout: 120_000 });
    await expect(renamed).toBeVisible();
    await expect(strip.getByRole("listitem")).toHaveCount(2);
    await renamed.click();
    await expect.poll(async () => difference(page, saved, await look())).toBeLessThan(0.5);

    await strip.getByRole("button", { name: "Eliminar Vista 2" }).click();
    await expect(strip.getByRole("status")).toHaveText("«Vista 2» eliminada.");
    await strip.getByRole("button", { name: "Eliminar Fachada de acceso" }).click();
    await expect(strip.getByText("Encuadra el modelo y guarda la vista para volver a ella.")).toBeVisible();
  } finally {
    await page.request.delete("/api/projects/" + id, { headers }).catch(() => undefined);
  }
});
