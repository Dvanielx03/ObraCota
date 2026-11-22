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
    // Coming from the panel, the preparing screen stays at least 5 s (entry-hold): the strip shows once the canvas is ready.
    await expect(page.locator(".view[data-ready]")).toBeVisible({ timeout: 120_000 });

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
    await expect(page.locator(".view[data-ready]")).toBeVisible({ timeout: 120_000 });
    await expect(renamed).toBeVisible();
    await expect(strip.getByRole("listitem")).toHaveCount(2);
    await renamed.click();
    await expect.poll(async () => difference(page, saved, await look())).toBeLessThan(0.5);

    // Deleting asks first in a modal dialog that names the view: cancelling keeps it and gives the focus back.
    const removeSecond = strip.getByRole("button", { name: "Eliminar Vista 2" });
    await removeSecond.click();
    const confirmSecond = page.getByRole("dialog", { name: "¿Eliminar «Vista 2»?" });
    await expect(confirmSecond).toBeVisible();
    await confirmSecond.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirmSecond).toHaveCount(0);
    await expect(strip.getByRole("button", { name: "Vista 2", exact: true })).toBeVisible();
    await expect(removeSecond).toBeFocused();

    await removeSecond.click();
    await confirmSecond.getByRole("button", { name: "Eliminar", exact: true }).click();
    await expect(strip.getByRole("status")).toHaveText("«Vista 2» eliminada.");
    await expect(strip.getByRole("listitem")).toHaveCount(1);
    await expect(strip.getByRole("button", { name: "Vista 2", exact: true })).toHaveCount(0);
    // The thumbnail is gone: the keyboard goes to «+» (promise of scene-strip.tsx:128-129).
    // Known app race: the focus runs in a requestAnimationFrame that can fire before React commits
    // setBusy(false) (line 73), while «+» is still disabled (line 197); the focus then stays on body.
    await expect(strip.getByRole("button", { name: "Guardar vista" })).toBeFocused();

    await strip.getByRole("button", { name: "Eliminar Fachada de acceso" }).click();
    await page.getByRole("dialog", { name: "¿Eliminar «Fachada de acceso»?" }).getByRole("button", { name: "Eliminar", exact: true }).click();
    await expect(strip.getByRole("status")).toHaveText("«Fachada de acceso» eliminada.");
    await expect(strip.getByText("Encuadra el modelo y guarda la vista para volver a ella.")).toBeVisible();

    // Both deletions reached the server: a fresh visit shows the empty strip.
    await page.reload();
    await expect(page.locator(".view[data-ready]")).toBeVisible({ timeout: 120_000 });
    await expect(strip.getByText("Encuadra el modelo y guarda la vista para volver a ella.")).toBeVisible();
  } finally {
    await page.request.delete("/api/projects/" + id, { headers }).catch(() => undefined);
  }
});

test("Las vistas se presentan a pantalla completa y se recorren con el teclado", async ({ page }, info) => {
  const ifc = process.env.DUPLEX_IFC;
  test.skip(!ifc, "Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(180_000);

  const auth = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  expect(auth.ok()).toBeTruthy();
  const headers = { Authorization: "Bearer " + (await auth.json()).accessToken };
  const { id } = await (await page.request.post("/api/projects", { headers, data: { name: "Prueba de presentación" } })).json();

  try {
    await page.goto("/proyectos/" + id + "/archivos");
    await page.getByLabel("Archivo IFC o DWG").setInputFiles(ifc!);
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await page.getByRole("link", { name: "Abrir versión 1 en el visor" }).click();
    await expect(page.locator(".project")).toContainText("Duplex", { timeout: 120_000 });
    await expect(page.locator(".view[data-ready]")).toBeVisible({ timeout: 120_000 });

    const strip = page.getByRole("region", { name: "Vistas guardadas" });
    // «Presentar» lives in the viewer header (viewer-header.tsx) and drives the presentation of the strip.
    const present = page.locator(".viewer-header").getByRole("button", { name: "Presentar", exact: true });
    await expect(present).toBeDisabled();
    await expect(present).toHaveAttribute("title", "Guarda una vista para presentarla");

    const stage = (await page.locator("section.stage").boundingBox())!;
    const centre = { x: stage.x + stage.width * 0.6, y: stage.y + stage.height * 0.5 };
    const orbit = async (dx: number, dy: number) => {
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    };
    const save = strip.getByRole("button", { name: "Guardar vista" });
    await save.click();
    await expect(strip.getByRole("button", { name: "Vista 1", exact: true })).toBeVisible();
    await orbit(180, 40);
    await save.click();
    await expect(strip.getByRole("button", { name: "Vista 2", exact: true })).toBeVisible();

    // Un tercer encuadre, sin guardar: es al que se debe volver al salir.
    await orbit(-90, -80);
    const clip = { x: Math.round(stage.x + stage.width * 0.42), y: Math.round(stage.y + stage.height * 0.3), width: Math.round(stage.width * 0.36), height: Math.round(stage.height * 0.42) };
    const before = await page.screenshot({ clip, animations: "disabled" });

    await expect(present).toBeEnabled();
    await expect(present).toHaveAttribute("title", "Presentar las vistas guardadas a pantalla completa");
    await present.click();
    // The deck is a cover plus one slide per view, and it starts on the view applied last (Vista 2).
    const deck = page.getByRole("dialog", { name: "Presentación de Prueba de presentación" });
    const label = deck.getByRole("status");
    await expect(label).toHaveText("Diapositiva 3 de 3: Vista 2");
    await expect(deck.getByRole("heading", { name: "Vista 2" })).toBeVisible();
    await expect(page.locator("section.stage")).toHaveAttribute("data-presenting", "");
    await expect(strip).toBeHidden();
    await expect(page.getByRole("toolbar", { name: "Acciones del modelo" })).toBeHidden();

    // La pantalla completa cambia el tamaño del lienzo: se compara todo el escenario entre vistas.
    // Only the 3D canvas is compared (the caption, dots and counter over it change and fade on their own),
    // once the 450 ms camera move between slides is over.
    const whole = () => page.locator("section.stage .view canvas").first().screenshot({ animations: "disabled", style: ".presentation{visibility:hidden!important}" });
    const still = async () => {
      let previous = await whole();
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(150);
        const next = await whole();
        if (await difference(page, previous, next) < 0.05) return next;
        previous = next;
      }
      return previous;
    };
    await page.keyboard.press("ArrowLeft");
    await expect(label).toHaveText("Diapositiva 2 de 3: Vista 1");
    await expect(deck.locator(".presentation-counter")).toHaveText("02 / 03");
    const one = await still();
    await page.keyboard.press("ArrowRight");
    await expect(label).toHaveText("Diapositiva 3 de 3: Vista 2");
    await expect.poll(async () => difference(page, one, await whole())).toBeGreaterThan(1);
    await page.screenshot({ animations: "disabled", path: process.env.EVIDENCE_DIR ? process.env.EVIDENCE_DIR + "/presentacion-1366.png" : info.outputPath("presentacion.png") });
    // The deck stops at the last view (no wrap to the cover): going back from there lands on Vista 1.
    await page.keyboard.press("ArrowRight");
    await expect(label).toHaveText("Diapositiva 3 de 3: Vista 2");
    await page.keyboard.press("ArrowLeft");
    await expect(label).toHaveText("Diapositiva 2 de 3: Vista 1");
    await expect.poll(async () => difference(page, one, await whole())).toBeLessThan(0.5);

    // With the pointer: Inicio shows the cover, a click on it advances and the dots jump to a slide.
    await page.keyboard.press("Home");
    await expect(label).toHaveText("Portada: Prueba de presentación");
    await expect(deck.getByRole("heading", { name: "Prueba de presentación" })).toBeVisible();
    await deck.locator(".presentation-cover").click();
    await expect(label).toHaveText("Diapositiva 2 de 3: Vista 1");
    const dots = deck.getByRole("navigation", { name: "Diapositivas" });
    const lastDot = dots.getByRole("button", { name: "Vista 02: Vista 2" });
    await lastDot.click();
    await expect(label).toHaveText("Diapositiva 3 de 3: Vista 2");
    await expect(lastDot).toHaveAttribute("aria-current", "step");
    await expect(dots.getByRole("button", { name: "Vista 01: Vista 1" })).not.toHaveAttribute("aria-current", "step");

    // Escape sale, devuelve los controles, el foco y el encuadre que había.
    await page.keyboard.press("Escape");
    await expect(deck).toHaveCount(0);
    await expect(page.locator("section.stage")).not.toHaveAttribute("data-presenting", "");
    await expect(strip).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Acciones del modelo" })).toBeVisible();
    await expect(present).toBeFocused();
    await expect.poll(async () => difference(page, before, await page.screenshot({ clip, animations: "disabled" }))).toBeLessThan(0.5);

    // También se sale con el botón.
    await present.click();
    await expect(label).toHaveText("Diapositiva 3 de 3: Vista 2");
    await deck.getByRole("button", { name: "Salir de la presentación (Esc)" }).click();
    await expect(deck).toHaveCount(0);
    await expect(strip).toBeVisible();
    await expect(present).toBeFocused();
  } finally {
    await page.request.delete("/api/projects/" + id, { headers }).catch(() => undefined);
  }
});
