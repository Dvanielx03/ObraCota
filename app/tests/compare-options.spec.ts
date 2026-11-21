import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";

test.use({ viewport: { width: 1366, height: 768 } });

/** Solid-colour PNG, so the test owns the images instead of calling an image model. */
function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

test("Una opción se compara con la vista del modelo con el ratón y con el teclado", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(180_000);

  const auth = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  expect(auth.ok()).toBeTruthy();
  const headers = { Authorization: "Bearer " + (await auth.json()).accessToken };
  const created = await page.request.post("/api/projects", { headers, data: { name: "Prueba del comparador" } });
  const { id } = await created.json();

  // Una terna lista, sin llamar a ningún modelo de imagen: la captura es gris y las opciones, de color.
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
    await expect(dialog.getByRole("img", { name: "Opción 2" })).toBeVisible();
    const open = dialog.getByRole("button", { name: "Comparar opción 2" });
    await open.click();
    await expect(open).toHaveAttribute("aria-pressed", "true");

    const comparison = dialog.getByRole("region", { name: "Comparar la opción 2 con la vista del modelo" });
    await expect(comparison.getByRole("img", { name: "Vista del modelo" })).toBeVisible();
    await expect(comparison.getByRole("img", { name: "Opción 2 · Generado con IA" })).toBeVisible();
    const divider = comparison.getByRole("slider", { name: "Posición del divisor" });
    await expect(divider).toHaveValue("50");
    await expect(divider).toHaveAttribute("aria-valuetext", "50 % de la vista del modelo");

    // El color bajo un punto dice qué imagen se ve ahí: gris es el modelo, verde es la opción.
    const stage = comparison.locator(".compare-stage");
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
    expect(near(await colourAt(0.2), colours[0])).toBe(true);
    expect(near(await colourAt(0.8), colours[2])).toBe(true);
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/comparador.png" : info.outputPath("comparador.png") });

    // Teclado: flechas, Inicio y Fin.
    await divider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(divider).toHaveValue("51");
    await page.keyboard.press("End");
    await expect(divider).toHaveValue("100");
    expect(near(await colourAt(0.8), colours[0])).toBe(true);
    await page.keyboard.press("Home");
    await expect(divider).toHaveValue("0");
    expect(near(await colourAt(0.2), colours[2])).toBe(true);

    // Ratón: pulsar a tres cuartos del ancho lleva ahí el divisor.
    const box = (await stage.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.6);
    expect(Math.abs(Number(await divider.inputValue()) - 75)).toBeLessThanOrEqual(2);

    // Cambiar de opción reutiliza el comparador; cerrarlo lo quita.
    await dialog.getByRole("button", { name: "Comparar opción 3" }).click();
    await expect(dialog.getByRole("region", { name: "Comparar la opción 3 con la vista del modelo" })).toBeVisible();
    await expect(open).toHaveAttribute("aria-pressed", "false");
    await dialog.getByRole("button", { name: "Cerrar comparación" }).click();
    await expect(dialog.locator(".compare")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Elegir opción 2" })).toBeEnabled();
  } finally {
    await page.request.delete("/api/projects/" + id, { headers }).catch(() => undefined);
  }
});
