import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { MODEL_ONLY, modelShown } from "./support/visor";

/**
 * Real manufacturer DWG files (BIMobject, Fritz Hansen and others) uploaded through the project's own
 * form, stored, downloaded byte for byte and drawn in the viewer. BIMOBJECT_DIR points at the folder;
 * the files are not in the repository (their licence allows use, not redistribution).
 */
const folder = process.env.BIMOBJECT_DIR;
// 2D plans must be drawn. 3D models are stored and kept, but the plan reader cannot draw them yet:
// ACIS solids need a geometry kernel, and libredwg-web drops polyface meshes (ACadSharp reads them;
// they arrive with the DWG engine, Fase H · H3). Until then the viewer must say why, not hang.
const DRAWINGS: { file: string; version: string; note: string; reason?: RegExp }[] = [
  { file: "Basket/Furniture_Other-Furniture_Fritz-Hansen_Basket 2D.dwg", version: "AC1027", note: "2D, AutoCAD 2013" },
  { file: "Essay™ Table CM21/2D_CM21 - Essay Table.DWG", version: "AC1032", note: "2D, AutoCAD 2018" },
  { file: "Hven Bar Stool Low/1067 Hven Bar Stool Low 2d.DWG", version: "AC1015", note: "2D, AutoCAD 2000" },
  { file: "Night Owl™ Table lamp/Lighting_Desk-Table_Fritz-Hansen_Night-OwlT 2D.dwg", version: "AC1024", note: "2D, AutoCAD 2010" },
  { file: "Basket/Furniture_Other-Furniture_Fritz-Hansen_Basket.dwg", version: "AC1027", note: "3D, sólidos ACIS", reason: /modelo 3D con 2 sólidos ACIS/ },
  { file: "PK60™ Table/3D_PK60.DWG", version: "AC1021", note: "3D, mallas", reason: /9 referencias a bloques sin geometría dibujable.*motor DWG/ },
];

async function account(page: import("@playwright/test").Page, name: string) {
  const registration = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  expect(registration.status()).toBe(201);
  const headers = { Authorization: "Bearer " + (await registration.json()).accessToken };
  const created = await page.request.post("/api/projects", { headers, data: { name } });
  expect(created.status()).toBe(201);
  return { headers, project: (await created.json()).id as string };
}

for (const drawing of DRAWINGS) test(`DWG de fabricante · ${basename(drawing.file)} (${drawing.note})`, async ({ page, baseURL }, info) => {
  const source = folder ? join(folder, drawing.file) : "";
  test.skip(!folder || !existsSync(source), "Indica BIMOBJECT_DIR con la carpeta BIMobject-add-nature");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(readFileSync(source).subarray(0, 6).toString()).toBe(drawing.version);
  const { headers, project } = await account(page, "DWG " + basename(drawing.file));
  const base = "/api/projects/" + project;
  try {
    // Upload through the project's form, as a person would.
    await page.goto("/proyectos/" + project + "/archivos");
    await page.getByLabel("Archivo IFC o DWG").setInputFiles(source);
    const uploading = page.waitForResponse(r => r.url().includes("/uploads?"), { timeout: 180_000 });
    await page.getByRole("button", { name: "Guardar versión" }).click();
    expect((await uploading).status()).toBe(201);
    // Stored byte for byte, with its format and size.
    const [file] = await (await page.request.get(base + "/files", { headers })).json();
    const [version] = await (await page.request.get(base + "/files/" + file.id + "/versions", { headers })).json();
    const sha = createHash("sha256").update(readFileSync(source)).digest("hex");
    expect(version).toMatchObject({ name: basename(source), format: "DWG", revision: 1, byteSize: statSync(source).size, sha256: sha });
    const original = await fetch(baseURL + base + "/versions/" + version.id + "/original", { headers });
    expect(createHash("sha256").update(Buffer.from(await original.arrayBuffer())).digest("hex")).toBe(sha);
    // Drawn in the viewer as a plan, with its layers listed and something actually on the canvas.
    await page.getByRole("link", { name: "Abrir versión 1 en el visor" }).click();
    if (drawing.reason) {
      await expect(page.getByText("No se pudo abrir")).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText(drawing.reason)).toBeVisible();
      await page.screenshot({ path: info.outputPath("visor.png") });
      return;
    }
    await expect(page.locator(".project")).toHaveText(basename(source), { timeout: 180_000 });
    await modelShown(page);
    await expect(page.locator(".stagebar")).toContainText("Plano 2D");
    await expect(page.locator("#explorer .level, #explorer .entry").first()).toBeVisible();
    const groups = await page.locator("#explorer .level").count();
    const view = page.locator(".stage > .view");
    const drawn = await view.screenshot({ style: MODEL_ONLY });
    const empty = await view.screenshot({ style: MODEL_ONLY + " .stage > .view canvas{visibility:hidden!important}" });
    expect(drawn.equals(empty), "el lienzo no dibuja nada").toBe(false);
    await info.attach("plano", { body: drawn, contentType: "image/png" });
    await page.screenshot({ path: info.outputPath("visor.png") });
    console.log(`${basename(source)}: ${drawing.version}, ${statSync(source).size} bytes, ${groups} grupos en el explorador`);
  } finally {
    await page.request.delete(base, { headers });
  }
});

test("Un ZIP con extensión .dwg se rechaza con un motivo claro", async ({ page }) => {
  const source = folder ? join(folder, "Stub Table/Furniture_Tables_Fritz-Hansen_Stub.dwg") : "";
  test.skip(!folder || !existsSync(source), "Indica BIMOBJECT_DIR con la carpeta BIMobject-add-nature");
  test.setTimeout(120_000);
  expect(readFileSync(source).subarray(0, 2).toString()).toBe("PK");
  const { headers, project } = await account(page, "DWG falso");
  try {
    await page.goto("/proyectos/" + project + "/archivos");
    await page.getByLabel("Archivo IFC o DWG").setInputFiles(source);
    let uploads = 0;
    page.on("request", request => { if (request.url().includes("/uploads")) uploads++; });
    await page.getByRole("button", { name: "Guardar versión" }).click();
    // The form names the real problem and sends nothing; the server would reject it anyway (VolumeStorage).
    await expect(page.getByRole("alert").filter({ hasText: "pero es un archivo ZIP" })).toContainText("tiene extensión .dwg, pero es un archivo ZIP. Descomprímelo y sube el DWG o el IFC que contiene.");
    expect(uploads).toBe(0);
    // Sent anyway (an old page, a script), the server refuses it and stores nothing.
    const direct = await page.request.post("/api/projects/" + project + "/uploads", { params: { name: "Stub.dwg" }, headers: { ...headers, "Content-Type": "application/octet-stream" }, data: readFileSync(source) });
    expect(direct.status()).toBe(400);
    const files = await (await page.request.get("/api/projects/" + project + "/files", { headers })).json();
    expect(files).toEqual([]);
  } finally {
    await page.request.delete("/api/projects/" + project, { headers });
  }
});
