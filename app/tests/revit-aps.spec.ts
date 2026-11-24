import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { modelShown } from "./support/visor";

/**
 * Layer 2 of RVT support: a stored RVT converted to IFC by Autodesk Model Derivative and opened in the viewer.
 * It calls Autodesk for real (APS credentials in the backend), so it runs only with APS_E2E=1 and RVT_FILE set.
 */
const source = process.env.RVT_FILE ?? "";

test("Un RVT guardado se convierte a IFC con Autodesk y se abre en el visor", async ({ page }, info) => {
  test.skip(process.env.APS_E2E !== "1" || !source || !existsSync(source), "Indica APS_E2E=1 y RVT_FILE (llama a Autodesk de verdad)");
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const registration = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  expect(registration.status()).toBe(201);
  const headers = { Authorization: "Bearer " + (await registration.json()).accessToken };
  const created = await page.request.post("/api/projects", { headers, data: { name: "APS " + basename(source) } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).id as string;
  try {
    const available = await page.request.get(`/api/projects/${project}/revit-translation/availability`, { headers });
    expect(await available.json(), "Configura APS_CLIENT_ID y APS_CLIENT_SECRET en el backend").toEqual({ available: true });
    await page.goto("/proyectos/" + project + "/archivos");
    await page.getByTestId("model-upload").setInputFiles(source);
    const uploading = page.waitForResponse(r => r.url().includes("/uploads?"), { timeout: 180_000 });
    await page.getByRole("button", { name: "Guardar versión" }).click();
    expect((await uploading).status()).toBe(201);
    await page.getByRole("link", { name: "Abrir versión 1 en el visor" }).click();
    await expect(page.getByRole("heading", { name: "Visualización del RVT" })).toBeVisible({ timeout: 120_000 });
    const card = page.locator(".stage .feedback[data-kind=error]");
    await expect(card).toContainText("el RVT original no cambia");
    await card.getByRole("button", { name: "Convertir a IFC con Autodesk" }).click();
    const open = card.getByRole("link", { name: "Abrir el IFC convertido" });
    await expect(open.or(card.getByRole("alert"))).toBeVisible({ timeout: 600_000 });
    await expect(card.getByRole("alert")).toHaveCount(0);
    await info.attach("convertido", { body: await page.screenshot(), contentType: "image/png" });
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/proyectos/${project}/visor/[0-9a-f-]{36}$`));
    await modelShown(page);
    const ifcVersion = new URL(page.url()).pathname.split("/").at(-1)!;
    const ifc = await page.request.get(`/api/projects/${project}/versions/${ifcVersion}/original`, { headers });
    expect(ifc.status()).toBe(200);
    const content = await ifc.body();
    expect(content.subarray(0, 4096).toString("utf8")).toMatch(/ISO-10303-21;[\s\S]+FILE_SCHEMA\(\('IFC/i);
    expect(content.subarray(-256).toString("utf8")).toMatch(/END-ISO-10303-21;\s*$/);
    const files = await (await page.request.get(`/api/projects/${project}/files`, { headers })).json();
    expect(files.map((file: { format: string }) => file.format).sort()).toEqual(["IFC", "RVT"]);
    const originalFile = files.find((file: { format: string }) => file.format === "RVT");
    const [originalVersion] = await (await page.request.get(`/api/projects/${project}/files/${originalFile.id}/versions`, { headers })).json();
    const original = await page.request.get(`/api/projects/${project}/versions/${originalVersion.id}/original`, { headers });
    expect(original.status()).toBe(200);
    const sha256 = (file: Buffer) => createHash("sha256").update(file).digest("hex");
    expect(sha256(await original.body())).toBe(sha256(readFileSync(source)));
    await info.attach("visor", { body: await page.screenshot(), contentType: "image/png" });
  } finally {
    await page.request.delete("/api/projects/" + project, { headers });
  }
});
