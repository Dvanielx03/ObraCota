import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

// «Continuar con Google» (Google Identity Services). Without GOOGLE_CLIENT_ID the button stays hidden and the email
// form works as before. The live sign-in needs a real Google account, so that part is skipped.
const CLIENT = { "X-ObraCota-Client": "web" };

async function clientId(request: import("@playwright/test").APIRequestContext) {
  const response = await request.get("/api/auth/google/config", { headers: CLIENT });
  expect(response.ok()).toBeTruthy();
  return String((await response.json()).clientId ?? "");
}

test("Sin client id de Google el botón no aparece y el ingreso con correo sigue igual", async ({ page, request }) => {
  test.skip(!!await clientId(request), "Este servidor tiene GOOGLE_CLIENT_ID: el botón debe aparecer");
  const email = "google-off-" + randomUUID() + "@example.test";
  const password = randomUUID();
  const created = await request.post("/api/auth/register", { headers: CLIENT, data: { email, password } });
  expect(created.status()).toBe(201);
  // The sign-in endpoint answers 503 while Google is off.
  const off = await request.post("/api/auth/google", { headers: CLIENT, data: { credential: "a.b.c" } });
  expect(off.status()).toBe(503);

  for (const path of ["/registro", "/ingresar"]) {
    const config = page.waitForResponse(res => new URL(res.url()).pathname === "/api/auth/google/config");
    await page.goto(path);
    await config;
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    await expect(page.getByTestId("google-button")).toHaveCount(0);
    await expect(page.getByText("o con tu correo")).toHaveCount(0);
  }
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Mis proyectos" })).toBeVisible();
});

test("Con un client id el botón aparece sobre el formulario y un rechazo se explica en español", async ({ page }) => {
  // A stand-in for GIS: the page gets a client id and a script that draws a button and returns a fake credential.
  // The backend has no client id, so it answers 503, which the page must explain.
  await page.route("**/api/auth/google/config", route => route.fulfill({ json: { clientId: "prueba.apps.googleusercontent.com" } }));
  await page.route("https://accounts.google.com/gsi/client", route => route.fulfill({ contentType: "text/javascript", body: `
    window.google = { accounts: { id: {
      initialize(options) { window.__gis = options; },
      renderButton(parent, options) {
        window.__gisButton = options;
        const button = document.createElement("button");
        button.type = "button"; button.textContent = "Continuar con Google (" + options.locale + ")";
        button.onclick = () => window.__gis.callback({ credential: "credencial.de.prueba" });
        parent.appendChild(button);
      },
    } } };` }));
  await page.goto("/ingresar");
  const google = page.getByRole("button", { name: "Continuar con Google (es)" });
  await expect(google).toBeVisible();
  await expect(page.getByText("o con tu correo")).toBeVisible();
  const box = await google.boundingBox(), field = await page.getByLabel("Correo electrónico").boundingBox();
  expect(box!.y).toBeLessThan(field!.y);
  // The official button, dark and full width on the light theme (Google's white outline on the dark one).
  const options = await page.evaluate(() => (window as unknown as { __gisButton: Record<string, unknown> }).__gisButton);
  expect(options).toMatchObject({ theme: "filled_black", size: "large", shape: "pill", text: "continue_with", locale: "es" });
  expect(Number(options.width)).toBeGreaterThanOrEqual(300);
  const sent = page.waitForRequest(req => new URL(req.url()).pathname === "/api/auth/google" && req.method() === "POST");
  await google.click();
  expect((await sent).postDataJSON()).toEqual({ credential: "credencial.de.prueba" });
  // 503 without GOOGLE_CLIENT_ID in the backend; 401 when it has one (the fake credential fails the signature).
  await expect(page.locator("form").getByRole("alert")).toHaveText(/no está disponible ahora|Google no confirmó tu cuenta/);
});

test("Con GOOGLE_CLIENT_ID en el servidor, /ingresar prepara el botón oficial de Google", async ({ page, request }) => {
  test.skip(!await clientId(request), "Este servidor no tiene GOOGLE_CLIENT_ID");
  await page.goto("/ingresar");
  const host = page.getByTestId("google-button");
  await expect(host).toHaveCount(1);
  await expect(page.locator(".auth-google")).toHaveAttribute("data-state", /ready|failed/);
  await expect(page.getByText("o con tu correo")).toBeVisible();
});

test("Pantalla dividida: imagen a la derecha en escritorio y franja corta en el móvil", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ingresar");
  // Boxes are read from the frame: the picture inside it settles from a slight zoom on load.
  const picture = page.locator(".auth-visual");
  await expect(picture.locator("img")).toBeVisible();
  const form = await page.getByLabel("Correo electrónico").boundingBox(), image = await picture.boundingBox();
  expect(image!.x).toBeGreaterThan(form!.x + form!.width);
  expect(image!.height).toBeGreaterThan(800);
  await expect(page.getByRole("link", { name: "Volver al sitio" })).toHaveAttribute("href", /^https?:\/\//);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(picture).toBeVisible();
  const band = await picture.boundingBox(), field = await page.getByLabel("Correo electrónico").boundingBox();
  expect(band!.height).toBeLessThanOrEqual(220);
  expect(band!.y + band!.height).toBeLessThan(field!.y);
  expect(band!.x).toBeGreaterThanOrEqual(15);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Las pestañas cambian entre iniciar sesión y crear cuenta sin salir de la pantalla", async ({ page }) => {
  await page.goto("/ingresar?desde=asistente");
  const login = page.getByRole("tab", { name: "Iniciar sesión" }), signup = page.getByRole("tab", { name: "Crear cuenta" });
  await expect(login).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Contraseña")).toHaveAttribute("autocomplete", "current-password");
  await signup.click();
  await expect(signup).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/registro\?desde=asistente$/);
  await expect(page).toHaveTitle("Crear cuenta · ObraCota");
  await expect(page.getByLabel("Contraseña")).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByText("Usa al menos 10 caracteres.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear cuenta" })).toBeVisible();
  // Arrow keys move between the tabs, as in any tab list.
  await signup.press("ArrowLeft");
  await expect(login).toHaveAttribute("aria-selected", "true");
  await expect(login).toBeFocused();
  await expect(page).toHaveURL(/\/ingresar\?desde=asistente$/);
  // /registro opens on its own tab.
  await page.goto("/registro");
  await expect(page.getByRole("tab", { name: "Crear cuenta" })).toHaveAttribute("aria-selected", "true");
});

test("Un error de acceso se explica en español dentro del formulario", async ({ page }) => {
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico").fill("nadie-" + randomUUID() + "@example.test");
  await page.getByLabel("Contraseña").fill(randomUUID());
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/ingresar$/);
});

test("Ingreso real con Google", async ({ request }) => {
  test.skip(true, "Necesita una cuenta de Google real y GOOGLE_CLIENT_ID; se prueba a mano en el navegador");
  expect(await clientId(request)).not.toBe("");
});
