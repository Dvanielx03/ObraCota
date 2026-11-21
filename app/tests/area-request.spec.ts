import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ viewport: { width: 1366, height: 768 } });

test("Un área marcada sobre la captura viaja como máscara alineada", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(180_000);

  const auth = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  expect(auth.ok()).toBeTruthy();
  const headers = { Authorization: "Bearer " + (await auth.json()).accessToken };
  const { id } = await (await page.request.post("/api/projects", { headers, data: { name: "Prueba del área marcada" } })).json();

  // La prueba responde por el servidor: no se llama a ningún modelo de imagen.
  const sent: { request: string; jpeg: string; mask?: string }[] = [];
  await page.route("**/api/projects/*/versions/*/options?element=*", (route) =>
    route.fulfill({ json: { available: true, batches: [], budget: { reserve_cents: 100, remaining_cents: 800 } } }));
  await page.route("**/api/projects/*/versions/*/options", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { id: randomUUID() } });
  });
  /** Size of an image and the brightness of two pixels, read in the browser. */
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
    await dialog.getByText("Captura que se enviará a Gemini").click();
    const capture = dialog.getByRole("img", { name: "Encuadre original del visor" });
    await expect(capture).toBeVisible();
    await expect(dialog.getByText("Sin área, se edita la pieza seleccionada.")).toBeVisible();

    // Ratón: arrastrar de la esquina superior izquierda a la inferior derecha de la zona.
    const box = (await dialog.locator(".area-stage").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7, { steps: 4 });
    await page.mouse.up();
    const marked = dialog.getByRole("group", { name: /^Área marcada: 50 % del ancho y 50 % del alto/ });
    await expect(marked).toBeVisible();
    await expect(dialog.getByText("Captura que se enviará a Gemini · con un área marcada")).toBeVisible();
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/area.png" : info.outputPath("area.png") });

    // Enviar: la máscara tiene el tamaño de la captura, blanca dentro del área y negra fuera.
    await dialog.getByRole("radiogroup", { name: "Acabado o material" }).getByRole("radio", { name: "Piedra" }).click();
    await dialog.getByRole("button", { name: "Enviar captura y generar tres opciones" }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].mask).toBeTruthy();
    const image = await inspect(sent[0].jpeg, []);
    const mask = await inspect(sent[0].mask!, [[0.5, 0.45], [0.1, 0.1], [0.9, 0.9], [0.3, 0.25], [0.7, 0.65]]);
    expect([mask.width, mask.height]).toEqual([image.width, image.height]);
    expect(mask.light[0]).toBeGreaterThan(230);
    expect(mask.light[1]).toBeLessThan(25);
    expect(mask.light[2]).toBeLessThan(25);
    expect(mask.light[3]).toBeGreaterThan(230);
    expect(mask.light[4]).toBeGreaterThan(230);

    // Tras enviar, el área se limpia. Teclado: añadirla con el botón, moverla, redimensionarla y quitarla.
    await expect(dialog.locator(".area-box")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Marcar un área" }).click();
    const added = dialog.getByRole("group", { name: /^Área marcada: 40 % del ancho y 40 % del alto/ });
    await expect(added).toBeFocused();
    const left = () => dialog.locator(".area-box").evaluate((el: HTMLElement) => parseFloat(el.style.left));
    const before = await left();
    await page.keyboard.press("ArrowRight");
    expect(await left()).toBeCloseTo(before + 2, 1);
    await page.keyboard.press("Shift+ArrowRight");
    await expect(dialog.getByRole("group", { name: /^Área marcada: 42 % del ancho y 40 % del alto/ })).toBeVisible();
    // No se sale de la captura por mucho que se empuje.
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
    const edge = await dialog.locator(".area-box").evaluate((el: HTMLElement) => parseFloat(el.style.left) + parseFloat(el.style.width));
    expect(edge).toBeLessThanOrEqual(100.01);
    await page.keyboard.press("Delete");
    await expect(dialog.locator(".area-box")).toHaveCount(0);

    // Sin área no se envía máscara: se edita la pieza seleccionada, como antes.
    await dialog.getByRole("radiogroup", { name: "Acabado o material" }).getByRole("radio", { name: "Acero" }).click();
    await dialog.getByRole("button", { name: "Enviar captura y generar tres opciones" }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].mask).toBeUndefined();
  } finally {
    await page.request.delete("/api/projects/" + id, { headers }).catch(() => undefined);
  }
});
