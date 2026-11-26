import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { modelShown } from "./support/visor";

/**
 * A Revit RVT kept as a project original (layer 1 of RVT support): uploaded through the project's form,
 * stored byte for byte as format RVT and, in the viewer, explained instead of drawn: the Revit release
 * read from the file and the way to see it (an IFC export). RVT_FILE points at a real .rvt; it is not in
 * the repository.
 */
const source = process.env.RVT_FILE ?? "";

async function account(page: import("@playwright/test").Page, name: string) {
  const registration = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  expect(registration.status()).toBe(201);
  const headers = { Authorization: "Bearer " + (await registration.json()).accessToken };
  const created = await page.request.post("/api/projects", { headers, data: { name } });
  expect(created.status()).toBe(201);
  return { headers, project: (await created.json()).id as string };
}

test("Un RVT de Revit se guarda tal cual y el visor explica cómo verlo", async ({ page, baseURL }, info) => {
  test.skip(!source || !existsSync(source), "Indica RVT_FILE con la ruta de un .rvt");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const bytes = readFileSync(source);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("d0cf11e0a1b11ae1");
  const { headers, project } = await account(page, "RVT " + basename(source));
  const base = "/api/projects/" + project;
  try {
    await page.goto("/proyectos/" + project + "/archivos");
    await expect(page.getByText("Archivo IFC, DWG, DXF, RVT, FBX u OBJ")).toBeVisible();
    await page.getByTestId("model-upload").setInputFiles(source);
    const uploading = page.waitForResponse(r => r.url().includes("/uploads?"), { timeout: 180_000 });
    await page.getByRole("button", { name: "Guardar versión" }).click();
    expect((await uploading).status()).toBe(201);
    // Stored byte for byte, as RVT.
    const [file] = await (await page.request.get(base + "/files", { headers })).json();
    expect(file.format).toBe("RVT");
    const [version] = await (await page.request.get(base + "/files/" + file.id + "/versions", { headers })).json();
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(version).toMatchObject({ name: basename(source), format: "RVT", revision: 1, byteSize: statSync(source).size, sha256: sha });
    const original = await fetch(baseURL + base + "/versions/" + version.id + "/original", { headers });
    expect(createHash("sha256").update(Buffer.from(await original.arrayBuffer())).digest("hex")).toBe(sha);
    // The history keeps the original downloadable.
    await expect(page.getByRole("button", { name: "Descargar versión 1" })).toBeVisible();
    // The viewer does not crash: it tells what the file is and how to see it.
    await page.getByRole("link", { name: "Abrir versión 1 en el visor" }).click();
    await expect(page.getByRole("heading", { name: "Visualización del RVT" })).toBeVisible({ timeout: 120_000 });
    const card = page.locator(".stage .feedback[data-kind=error]");
    const reason = card.locator(":scope > p");
    await expect(reason).toContainText("Revit 2025");
    await expect(reason).toContainText("Exportar › IFC");
    const details = card.locator("figure.open-failure-preview");
    await expect(details).toContainText("Original de Revit 2025");
    const download = page.waitForEvent("download");
    await details.getByRole("button", { name: "Descargar RVT original" }).click();
    const artifact = await download;
    expect(artifact.suggestedFilename()).toBe(basename(source));
    const downloaded = readFileSync((await artifact.path())!);
    expect(downloaded.subarray(0, 8).toString("hex")).toBe("d0cf11e0a1b11ae1");
    expect(createHash("sha256").update(downloaded).digest("hex")).toBe(sha);
    await expect(details.getByRole("status").filter({ hasText: "huella SHA-256 comprobada" })).toBeVisible();
    // The personal path Revit records is never shown.
    await expect(page.locator("body")).not.toContainText("Last Save Path");
    await expect(page.locator("body")).not.toContainText(/[A-Z]:\\/);
    // Revit's stored picture appears only when it shows something (a blank preview is left out).
    const image = details.locator("img");
    if (await image.count()) {
      const size = await image.evaluate(async (img: HTMLImageElement) => { await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
      expect(size[0]).toBeGreaterThan(8);
    }
    await page.screenshot({ path: info.outputPath("rvt-original.png") });
    await page.getByRole("button", { name: "Explorar ReStage" }).click();
    await modelShown(page);
    await expect(page.getByRole("toolbar", { name: "Controles de la cámara" })).toBeVisible();
  } finally {
    await page.request.delete(base, { headers });
  }
});

test("Un .rvt que no es un archivo de Revit se rechaza con un motivo claro", async ({ page }) => {
  test.setTimeout(120_000);
  const { headers, project } = await account(page, "RVT falso");
  try {
    await page.goto("/proyectos/" + project + "/archivos");
    let uploads = 0;
    page.on("request", request => { if (request.url().includes("/uploads")) uploads++; });
    // A ZIP renamed .rvt: the form names the real problem and sends nothing.
    const zip = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(200, 1)]);
    await page.getByTestId("model-upload").setInputFiles({ name: "Modelo.rvt", mimeType: "application/octet-stream", buffer: zip });
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Modelo.rvt" })).toContainText("«Modelo.rvt» tiene extensión .rvt, pero es un archivo ZIP.");
    // Plain text renamed .rvt: not a valid RVT either.
    await page.getByTestId("model-upload").setInputFiles({ name: "Notas.rvt", mimeType: "text/plain", buffer: Buffer.from("Format: 2025\r\nBuild: 20240715\r\n") });
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Notas.rvt" })).toContainText("«Notas.rvt» no es un RVT válido");
    expect(uploads).toBe(0);
    // Sent anyway (an old page, a script), the server refuses it and stores nothing.
    const direct = await page.request.post(`/api/projects/${project}/uploads`, { params: { name: "Notas.rvt" }, headers: { ...headers, "Content-Type": "application/octet-stream" }, data: Buffer.from("Format: 2025\r\n") });
    expect(direct.status()).toBe(400);
    expect(await (await page.request.get(`/api/projects/${project}/files`, { headers })).json()).toEqual([]);
  } finally {
    await page.request.delete("/api/projects/" + project, { headers });
  }
});
