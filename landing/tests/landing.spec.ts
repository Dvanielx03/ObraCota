import { expect, test, type Page } from "@playwright/test";

/** Reúne errores de consola y excepciones de la página durante una prueba. */
function vigilarErrores(page: Page) {
  const errores: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errores.push(m.text());
  });
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}

const esMovil = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

test.describe("Portada y navegación", () => {
  test("carga con su titular, sin errores y sin desbordes horizontales", async ({ page }) => {
    const errores = vigilarErrores(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/ObraCota/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Del terreno\s*a la obra/i);
    await expect(page.getByRole("link", { name: "Solicitar demostración" }).first()).toBeVisible();

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde).toBeLessThanOrEqual(0);
    expect(errores, errores.join("\n")).toEqual([]);
  });

  test("la portada reúne titular, frase y una sola acción, sin la tarjeta del caso ficticio", async ({ page }) => {
    await page.goto("/");
    const portada = page.locator("#inicio");
    await expect(portada.getByText("Coordina planos, modelos BIM y avance de obra en un solo proyecto.")).toBeVisible();
    await expect(portada.getByRole("link", { name: "Solicitar demostración" })).toHaveAttribute("href", "#contacto");
    await expect(portada.getByRole("link")).toHaveCount(1);
    await expect(portada.getByText("Aula 201")).toHaveCount(0);
  });

  test("el menú navega a cada sección y mantiene el indicador sincronizado", async ({ page }) => {
    await page.goto("/#inicio");
    const movil = esMovil(page);
    const nav = page.getByRole("navigation", { name: movil ? "Principal, móvil" : "Principal", exact: true });
    for (const [nombre, id] of [["Recorrido", "recorrido"], ["Expediente", "expediente"], ["Avance", "avance"], ["Contacto", "contacto"], ["Inicio", "inicio"]]) {
      if (movil) await page.getByRole("button", { name: "Menú" }).click();
      const enlace = nav.getByRole("link", { name: nombre, exact: true });
      if (movil) await enlace.tap();
      else await enlace.press("Enter");
      await expect(page).toHaveURL(new RegExp("#" + id + "$"));
      if (movil) await expect(nav).toBeHidden();
      await expect.poll(() => page.locator("#" + id).evaluate(el => {
        const top = el.getBoundingClientRect().top;
        const limite = document.documentElement.scrollHeight - innerHeight;
        const margen = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        const destino = Math.max(0, Math.min(limite, scrollY + top - margen));
        return Math.min(Math.abs(top), Math.abs(scrollY - destino));
      }), { message: nombre }).toBeLessThan(8);
      if (id === "inicio") {
        await expect(page.locator("#inicio li[aria-current=step]")).toHaveText(/03 Obra/);
        await expect(page.locator("#inicio [data-foto]").last()).toHaveCSS("opacity", "1");
        await expect(page.locator("#inicio [data-clips]")).toHaveCSS("opacity", "0");
      }
      await expect(page.locator("header nav").first().getByRole("link", { name: nombre, includeHidden: true, exact: true })).toHaveAttribute("aria-current", "location");
    }
  });
  for (const movimiento of ["no-preference", "reduce"] as const) {
    test(`dos destinos lejanos consecutivos llegan en el mismo cuadro con movimiento ${movimiento}`, async ({ page }) => {
      test.skip(esMovil(page), "El menú desplegable se prueba por separado");
      await page.emulateMedia({ reducedMotion: movimiento });
      await page.goto("/#inicio");
      const nav = page.getByRole("navigation", { name: "Principal", exact: true });
      await expect(nav).toHaveAttribute("data-medido", "true");
      for (const id of ["contacto", "expediente"]) {
        const distancia = await nav.locator(`a[href="#${id}"]`).evaluate(el => {
          const destino = document.querySelector(el.getAttribute("href")!)!;
          (el as HTMLAnchorElement).click();
          return destino.getBoundingClientRect().top;
        });
        expect(Math.abs(distancia)).toBeLessThan(350);
      }
      await expect(nav.locator('[aria-current="location"]')).toHaveAttribute("href", "#expediente");
      await expect(page).toHaveURL(/#expediente$/);
      await page.waitForTimeout(400);
      await expect(page.locator("#expediente")).toBeInViewport();
    });
  }

});

test.describe("Expediente y avance", () => {
  test("los planos de ReStage cambian de nivel y se amplían con su fuente", async ({ page }) => {
    await page.goto("/#expediente");
    const seccion = page.locator("#expediente");
    for (const [nivel, cota] of [["Planta baja", "+1,517 m"], ["Planta alta", "+3,947 m"]]) {
      const opcion = seccion.getByRole("button", { name: nivel, exact: true });
      await opcion.click();
      await expect(opcion).toHaveAttribute("aria-pressed", "true");
      await expect(seccion.locator("figcaption")).toContainText(cota);
      const dibujo = seccion.getByRole("img", { name: new RegExp(nivel) });
      await expect(dibujo).toBeVisible();
      await expect.poll(() => dibujo.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const abrir = seccion.getByRole("button", { name: "Ampliar plano" });
      await abrir.click();
      const dialogo = page.getByRole("dialog", { name: "ReStage · " + nivel });
      await expect(dialogo.getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(abrir).toBeFocused();
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(seccion.locator("[data-corte]")).toHaveCSS("clip-path", "none");
  });
});

test.describe("Formulario de demostración", () => {
  test("valida, explica cada error y confirma sin enviar datos", async ({ page }) => {
    const salidas: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") salidas.push(`${r.method()} ${r.url()}`);
    });
    await page.goto("/#contacto");
    const formulario = page.locator("#contacto form");

    // En desarrollo el primer clic puede llegar antes de que la página responda: se reintenta.
    await expect(async () => {
      await formulario.getByRole("button", { name: "Enviar solicitud" }).click({ timeout: 2_000 });
      await expect(formulario.getByText("Escribe tu nombre para saber a quién responder.")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(formulario.getByText("Escribe un correo para poder contactarte.")).toBeVisible();
    await expect(formulario.getByText("Marca la casilla para aceptar el tratamiento de tus datos.")).toBeVisible();
    await expect(formulario.getByLabel("Tu nombre")).toBeFocused();

    await formulario.getByLabel("Tu nombre").fill("Laura Rincón");
    await formulario.getByLabel("Correo").fill("laura@estudio");
    await formulario.getByRole("button", { name: "Enviar solicitud" }).click();
    await expect(formulario.getByText(/no parece completo/)).toBeVisible();

    await formulario.getByLabel("Correo").fill("laura@estudio.example");
    await formulario.getByLabel("Empresa o estudio").fill("Estudio de prueba");
    await formulario.getByRole("checkbox").click();
    await formulario.getByRole("button", { name: "Enviar solicitud" }).click();

    const confirmacion = page.locator("#contacto [data-estado='confirmado']");
    await expect(confirmacion).toBeVisible();
    await expect(confirmacion).toContainText("Solicitud validada, Laura Rincón");
    await expect(confirmacion).toContainText("todavía no los envía");
    expect(salidas, salidas.join("\n")).toEqual([]);

    await confirmacion.getByRole("button", { name: "Preparar otra solicitud" }).click();
    await expect(page.locator("#contacto form")).toBeVisible();
  });
});

test.describe("Páginas de apoyo y accesibilidad", () => {
  test("la página de privacidad dice qué hace y qué falta", async ({ page }) => {
    await page.goto("/privacidad");
    await expect(page.getByRole("heading", { level: 1, name: "Privacidad" })).toBeVisible();
    await expect(page.getByText(/No envía esos datos a ningún servidor/)).toBeVisible();
  });

  test("una dirección inexistente muestra el 404 propio", async ({ page }) => {
    const respuesta = await page.goto("/no-existe");
    expect(respuesta?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Lámina\s*no encontrada/i);
    await page.getByRole("link", { name: "Volver al inicio" }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("con movimiento reducido la frase se lee completa", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const frase = page.locator("#recorrido p").filter({ hasText: "Un detalle cambia en el plano. ObraCota muestra" }).filter({ visible: true });
    await frase.scrollIntoViewIfNeeded();
    await expect(frase).toBeVisible();
    await expect(frase).toHaveCSS("opacity", "1");
  });

  test("el enlace para saltar al contenido es el primer foco", async ({ page }) => {
    test.skip(esMovil(page), "El foco con teclado se prueba en escritorio");
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  });
});
