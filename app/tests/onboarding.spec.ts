import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

// A new person: nothing stored, so the onboarding and the viewer guide are both pending.
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 768 } });

const stored = () => JSON.parse(localStorage.getItem("obracota.onboarding.v1") ?? "null");

test("Una cuenta nueva completa la bienvenida con el teclado y no la vuelve a ver", async ({ page }, info) => {
  await page.goto("/registro");
  await page.getByLabel("Correo electrónico").fill("bienvenida-" + randomUUID() + "@example.test");
  await page.getByLabel("Contraseña").fill(randomUUID());
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  // Paso 1: el foco está en la pregunta y el progreso lo dice con texto.
  await expect(page).toHaveURL(/\/bienvenida$/);
  const question = page.getByRole("heading", { level: 1 });
  await expect(question).toHaveText("¿Qué te describe mejor?");
  await expect(question).toBeFocused();
  const progress = page.getByRole("progressbar", { name: "Progreso de la bienvenida" });
  await expect(progress).toHaveAttribute("aria-valuetext", "Paso 1 de 3");
  await expect(page.getByRole("radio")).toHaveCount(5);
  await page.screenshot({ path: info.outputPath("paso-1.png") });

  // Tab entra al grupo, las flechas recorren y Enter elige y avanza.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Ingeniera o ingeniero constructor" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Arquitecta o arquitecto" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("End");
  await expect(page.getByRole("radio", { name: "Otro" })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");

  // Paso 2.
  await expect(question).toHaveText("¿Qué quieres revisar primero?");
  await expect(question).toBeFocused();
  await expect(progress).toHaveAttribute("aria-valuetext", "Paso 2 de 3");
  await page.screenshot({ path: info.outputPath("paso-2.png") });

  // «Atrás» conserva la respuesta anterior como opción marcada.
  await page.getByRole("button", { name: "Atrás" }).click();
  await expect(page.getByRole("radio", { name: "Ingeniera o ingeniero constructor" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");

  // Paso 3: la muestra abre el visor sin subir nada.
  await expect(question).toHaveText("¿Con qué empiezas?");
  await expect(progress).toHaveAttribute("aria-valuetext", "Paso 3 de 3");
  await page.screenshot({ path: info.outputPath("paso-3.png") });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: /Proyecto de muestra/ })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/proyectos\/restage\/visor\?guia=rapida$/);
  // La muestra abre con el recorrido rápido en marcha, sin diálogo intermedio.
  await expect(page.locator("main")).toHaveAttribute("data-quick", "select", { timeout: 60_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await page.evaluate(stored);
  expect(saved).toMatchObject({ role: "site-engineer", firstReview: "model", start: "sample", skipped: false });
  expect(Number.isNaN(Date.parse(saved.completedAt))).toBe(false);

  // Con la bienvenida hecha, volver a registrarse en este navegador lleva directo al panel.
  await page.goto("/registro");
  await page.getByLabel("Correo electrónico").fill("bienvenida-" + randomUUID() + "@example.test");
  await page.getByLabel("Contraseña").fill(randomUUID());
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Mis proyectos" })).toBeVisible();
});

test("Omitir la bienvenida lleva al panel y se puede repetir desde Cuenta", async ({ page }) => {
  await page.goto("/bienvenida");
  await page.getByRole("button", { name: "Omitir por ahora" }).click();
  await expect(page).toHaveURL(/\/proyectos$/);
  expect(await page.evaluate(stored)).toMatchObject({ role: null, start: null, skipped: true });

  await page.goto("/cuenta");
  await page.getByRole("link", { name: "Repetir la bienvenida" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("¿Qué te describe mejor?");

  // Elegir «Mi archivo» termina en la lista de proyectos, donde se crea y se sube.
  await page.getByRole("radio", { name: "Otro" }).click();
  await page.getByRole("radio", { name: /Plano/ }).click();
  await page.getByRole("radio", { name: /Mi archivo/ }).click();
  await expect(page).toHaveURL(/\/proyectos$/);
  expect(await page.evaluate(stored)).toMatchObject({ role: "other", firstReview: "drawing", start: "own", skipped: false });
});

test("Las opciones caben y no hay desplazamiento a 1366 × 768 ni a 1920 × 1080", async ({ page }) => {
  for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    await page.goto("/bienvenida");
    await expect(page.getByRole("radio")).toHaveCount(5);
    const fit = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      overflowY: document.documentElement.scrollHeight - window.innerHeight,
      smallest: Math.min(...[...document.querySelectorAll("[role=radio]")].map((b) => b.getBoundingClientRect().height)),
    }));
    expect(fit.overflowX).toBeLessThanOrEqual(0);
    expect(fit.overflowY).toBeLessThanOrEqual(0);
    expect(fit.smallest).toBeGreaterThanOrEqual(44);
  }
});
