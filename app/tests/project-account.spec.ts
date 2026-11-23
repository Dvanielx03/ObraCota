import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { OWNED_SUMMARY, UNTITLED, createUntitledProject } from "./support/panel-proyectos";

test("La cuenta conserva su proyecto y renueva la sesión", async ({ page }) => {
  const email = "panel-" + randomUUID() + "@example.test";
  const password = randomUUID();
  const project = "Revisión " + randomUUID().slice(0, 8);
  await page.goto("/proyectos");
  await page.getByRole("link", { name: "crea una cuenta" }).click();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  // Toda cuenta nueva pasa por la bienvenida; se omite para llegar al panel.
  await expect(page).toHaveURL(/\/bienvenida$/);
  await page.getByRole("button", { name: "Omitir por ahora" }).click();
  await expect(page.getByRole("heading", { name: "Mis proyectos" })).toBeVisible();
  // «Nuevo proyecto» crea «Proyecto sin título» y abre sus archivos (DU-07 = B); el nombre se cambia en
  // la barra del proyecto, donde se llega.
  await createUntitledProject(page);
  await page.getByRole("button", { name: "Renombrar proyecto" }).click();
  const field = page.getByRole("textbox", { name: "Nombre del proyecto" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(UNTITLED);
  await field.fill(project);
  const saved = page.waitForResponse(res => res.request().method() === "PUT" && /\/api\/projects\/[^/]+$/.test(new URL(res.url()).pathname) && res.ok());
  await field.press("Enter");
  await saved;
  await expect(page.getByRole("heading", { level: 1, name: project })).toBeVisible();
  await page.getByRole("link", { name: "Proyectos", exact: true }).click();
  await page.getByRole("link", { name: project }).click();
  await expect(page).toHaveURL(OWNED_SUMMARY);
  await expect(page.getByRole("heading", { level: 1, name: project })).toBeVisible();
  const projectUrl = page.url();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: project })).toBeVisible();
  await page.getByRole("link", { name: "Cuenta", exact: true }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Sesión de invitado" })).toBeVisible();
  await page.goto(projectUrl);
  // Sin sesión el proyecto no se muestra; la barra superior ofrece «Iniciar sesión».
  await expect(page.getByRole("heading", { name: "Inicia sesión para ver este proyecto" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: project })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Panel" }).getByRole("link", { name: "Iniciar sesión", exact: true }).click();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("link", { name: project })).toBeVisible();
  // Simulate expiry of the access token, keeping the real refresh cookie and backend.
  await page.route("**/api/projects/*", route => route.fulfill({ status: 401 }), { times: 1 });
  const renewed = page.waitForResponse(res => res.url().endsWith("/api/auth/refresh") && res.ok());
  await page.getByRole("link", { name: project }).click();
  await renewed;
  await expect(page.getByRole("heading", { level: 1, name: project })).toBeVisible();
});

test("La API limita cada proyecto a su propietario y revoca el acceso al salir", async ({ playwright, baseURL }) => {
  const options = { baseURL, extraHTTPHeaders: { "X-ObraCota-Client": "web" } };
  const owner = await playwright.request.newContext(options);
  const visitor = await playwright.request.newContext(options);
  async function register(client: APIRequestContext) {
    const response = await client.post("/api/auth/register", {
      data: { email: randomUUID() + "@example.test", password: randomUUID() },
    });
    expect(response.status()).toBe(201);
    return { Authorization: "Bearer " + (await response.json()).accessToken };
  }
  try {
    const headers = await register(owner);
    const other = await register(visitor);
    const created = await owner.post("/api/projects", { headers, data: { name: "Revisión de acceso" } });
    expect(created.status()).toBe(201);
    const path = "/api/projects/" + (await created.json()).id;
    expect((await visitor.get(path, { headers: other })).status()).toBe(404);
    expect((await visitor.delete(path, { headers: other })).status()).toBe(404);
    expect((await owner.put(path, { headers, data: { name: "Revisión completa" } })).status()).toBe(200);
    expect((await (await owner.get(path, { headers })).json()).name).toBe("Revisión completa");
    expect((await owner.delete(path, { headers })).status()).toBe(204);
    expect((await owner.get(path, { headers })).status()).toBe(404);
    expect((await owner.post("/api/auth/logout")).status()).toBe(204);
    expect((await owner.get("/api/projects", { headers })).status()).toBe(401);
  } finally {
    await Promise.all([owner.dispose(), visitor.dispose()]);
  }
});
