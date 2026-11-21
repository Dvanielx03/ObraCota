import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("La cuenta conserva su proyecto y renueva la sesión", async ({ page }) => {
  const email = "panel-" + randomUUID() + "@example.test";
  const password = randomUUID();
  const project = "Revisión " + randomUUID().slice(0, 8);
  await page.goto("/proyectos");
  await page.getByRole("link", { name: "crea una cuenta" }).click();
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Mis proyectos" })).toBeVisible();
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  await page.getByLabel("Nombre del proyecto").fill(project);
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await page.getByRole("link", { name: project }).click();
  await expect(page.getByRole("heading", { level: 1, name: project })).toBeVisible();
  const projectUrl = page.url();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: project })).toBeVisible();
  await page.getByRole("link", { name: "Cuenta", exact: true }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Sesión de invitado" })).toBeVisible();
  await page.goto(projectUrl);
  await page.getByRole("link", { name: "Iniciar sesión" }).click();
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
