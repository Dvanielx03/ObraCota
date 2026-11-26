import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { MODEL_ONLY, modelShown } from "./support/visor";

/**
 * Manufacturer meshes (FBX and OBJ from BIMobject packages, next to DWG files whose solids the viewer
 * cannot draw) uploaded through the project's form, stored byte for byte and opened in 3D, one
 * explorer element per mesh. BIMOBJECT_DIR points at the BIMobject-add-nature folder; the files are
 * not in the repository (their licence allows use, not redistribution).
 */
const folder = process.env.BIMOBJECT_DIR;
const MESHES: { file: string; format: "FBX" | "OBJ"; pieces: number; height: number; note: string; walk?: boolean; openMs?: number }[] = [
  // Z-up, millimetres, one model per piece: turned to Y up and scaled to metres. A rug is a floor: it can be walked.
  { file: "Rug Balance/Furniture_Other-Furniture_Fritz-Hansen_Rug-balance.fbx", format: "FBX", pieces: 3, height: 0.0105, note: "Z arriba, mm", walk: true },
  // 3ds Max export with a single rotated top node (the loader alone would lay the table on its side).
  // A table top is not a floor: no walk.
  { file: "PK60™ Table/PK60.FBX", format: "FBX", pieces: 10, height: 0.4393, note: "3ds Max, nodo raíz girado" },
  { file: "Grand Prix™ Chair 4130-NotUph/Furniture_Chairs-Stools-Benches_Fritz-Hansen_Grand-PrixT-4130-NotUph.fbx", format: "FBX", pieces: 17, height: 0.8375, note: "Z arriba, mm" },
  // Both embed a texture (an image inside the FBX): never requested, its blob URL revoked.
  { file: "Night Owl™ Table lamp/Lighting_Desk-Table-Lighting_Fritz-Hansen_Night-OwlT.fbx", format: "FBX", pieces: 2, height: 0.2365, note: "textura embebida" },
  { file: "Stub Table/Furniture_Tables_Fritz-Hansen_Stub.fbx", format: "FBX", pieces: 4, height: 0.4430, note: "textura embebida" },
  // 6.3 MB, 1255 pieces: the heaviest of the folder, parsed on the main thread within a time limit.
  { file: "Rug Dots/Furniture_Other-Furniture_Fritz-Hansen_Rug-Dots.fbx", format: "FBX", pieces: 1255, height: 0.011, note: "1255 piezas", walk: true, openMs: 30_000 },
  // OBJ declares no unit: drawn in its own (millimetres for this 3ds Max export, metres for pCon.planner).
  // The Essay OBJ names its .mtl (mtllib), which is never requested.
  { file: "Essay™ Table CM21/CM21 - Essay Table.obj", format: "OBJ", pieces: 9, height: 720, note: "3ds Max, sin unidad, mtllib" },
  { file: "Hven Bar Stool Low/1067 Hven Bar Stool Low.obj", format: "OBJ", pieces: 7, height: 0.8581, note: "pCon.planner, sin unidad" },
];
const FBX_SCHEMA = /^FBX 7\.\d · mm, convertido a metros( · sin piso para recorrer)?$/;
const schemaOf = (mesh: (typeof MESHES)[number]) => mesh.format === "OBJ" ? /^OBJ · sin unidades declaradas$/
  : mesh.walk ? /^FBX 7\.\d · mm, convertido a metros$/ : /^FBX 7\.\d · mm, convertido a metros · sin piso para recorrer$/;

async function account(page: import("@playwright/test").Page, name: string) {
  const registration = await page.request.post("/api/auth/register", { headers: { "X-ObraCota-Client": "web" }, data: { email: randomUUID() + "@example.test", password: randomUUID() } });
  expect(registration.status()).toBe(201);
  const headers = { Authorization: "Bearer " + (await registration.json()).accessToken };
  const created = await page.request.post("/api/projects", { headers, data: { name } });
  expect(created.status()).toBe(201);
  return { headers, project: (await created.json()).id as string };
}

test("Unidades y ejes de las mallas FBX y OBJ con el cargador del visor", () => {
  const sources = MESHES.map(mesh => folder ? join(folder, mesh.file) : "");
  test.skip(!folder || sources.some(source => !existsSync(source)), "Indica BIMOBJECT_DIR con la carpeta BIMobject-add-nature");
  // The viewer's mesh-source.ts runs in Node (type stripping) to measure each model as the canvas gets it.
  const output = execFileSync(process.execPath, [join(__dirname, "support", "mesh-bounds.mjs"), ...sources], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const measured: Record<string, { size: number[]; walk: boolean; schema: string; elements: number; ids: string[]; blobs: number; unrevoked: number }> = JSON.parse(output);
  const again: typeof measured = JSON.parse(execFileSync(process.execPath, [join(__dirname, "support", "mesh-bounds.mjs"), ...sources], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  for (const mesh of MESHES) {
    const result = measured[basename(mesh.file)];
    // Height is the Y axis: the model stands up, at its real size.
    expect(Math.abs(result.size[1] - mesh.height), mesh.file + " de " + result.size[1]).toBeLessThan(mesh.height * 0.002);
    expect(result.elements).toBe(mesh.pieces);
    // Only a model in metres with a floor at its base (the rugs) can be walked.
    expect(result.walk, mesh.file).toBe(!!mesh.walk);
    expect(result.schema).toMatch(schemaOf(mesh));
    expect(result.schema).toMatch(mesh.format === "FBX" ? FBX_SCHEMA : /^OBJ/);
    // Ids are unique and the same on every read; embedded images leave no blob URL behind.
    expect(new Set(result.ids).size).toBe(result.ids.length);
    expect(again[basename(mesh.file)].ids).toEqual(result.ids);
    expect(result.unrevoked, mesh.file + ": blobs sin revocar").toBe(0);
    if (mesh.note === "textura embebida") expect(result.blobs).toBeGreaterThan(0);
  }
});

test("Los ids de las piezas siguen a la pieza entre revisiones", () => {
  // mesh-ids.mjs runs meshIds of the viewer: the same piece keeps its id when another one is added before it.
  const ids: Record<"first" | "again" | "revised" | "unnamed", string[]> = JSON.parse(execFileSync(process.execPath, [join(__dirname, "support", "mesh-ids.mjs")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  expect(ids.again).toEqual(ids.first);
  expect(ids.revised.slice(1)).toEqual([ids.first[1], ids.first[0], ids.first[2], ids.first[3]]);
  expect(ids.revised[0]).not.toBe(ids.first[0]);
  // Repeated names get an occurrence count; meshes with no name anywhere fall back to their position.
  expect(ids.first[3]).toBe(ids.first[2] + "#1");
  expect(ids.unnamed).toEqual(["mesh:0", "mesh:1"]);
});

for (const mesh of MESHES) test(`Malla de fabricante · ${basename(mesh.file)} (${mesh.note})`, async ({ page, baseURL }, info) => {
  const source = folder ? join(folder, mesh.file) : "";
  test.skip(!folder || !existsSync(source), "Indica BIMOBJECT_DIR con la carpeta BIMobject-add-nature");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const { headers, project } = await account(page, mesh.format + " " + basename(mesh.file));
  const base = "/api/projects/" + project;
  // Everything the page asks for from here on: a mesh must never make it fetch a texture, an .mtl or
  // anything outside the app (the file names its images and materials, with relative or absolute paths).
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  try {
    // Long main-thread tasks while the model opens (the parse runs on the page).
    await page.addInitScript(() => {
      const w = window as unknown as { longest: number };
      w.longest = 0;
      try { new PerformanceObserver(list => { for (const entry of list.getEntries()) w.longest = Math.max(w.longest, entry.duration); }).observe({ type: "longtask", buffered: true }); } catch {}
    });
    // Upload through the project's form, as a person would.
    await page.goto("/proyectos/" + project + "/archivos");
    const picker = page.getByTestId("model-upload");
    expect(await picker.getAttribute("accept")).toBe(".ifc,.dwg,.dxf,.rvt,.fbx,.obj");
    await picker.setInputFiles(source);
    const uploading = page.waitForResponse(r => r.url().includes("/uploads?"), { timeout: 180_000 });
    await page.getByRole("button", { name: "Guardar versión" }).click();
    expect((await uploading).status()).toBe(201);
    // Stored byte for byte, with its format and size.
    const [file] = await (await page.request.get(base + "/files", { headers })).json();
    expect(file.format).toBe(mesh.format);
    const [version] = await (await page.request.get(base + "/files/" + file.id + "/versions", { headers })).json();
    const sha = createHash("sha256").update(readFileSync(source)).digest("hex");
    expect(version).toMatchObject({ name: basename(source), format: mesh.format, revision: 1, byteSize: statSync(source).size, sha256: sha });
    const original = await fetch(baseURL + base + "/versions/" + version.id + "/original", { headers });
    expect(createHash("sha256").update(Buffer.from(await original.arrayBuffer())).digest("hex")).toBe(sha);
    // Opened in 3D with the wait animation, its pieces listed and something actually on the canvas.
    await page.getByRole("link", { name: "Abrir versión 1 en el visor" }).click();
    const opening = Date.now();
    await expect(page.locator(".model-preparing")).toBeVisible();
    await expect(page.locator(".project")).toHaveText(basename(source), { timeout: mesh.openMs ?? 180_000 });
    await modelShown(page);
    const opened = Date.now() - opening;
    const longest = await page.evaluate(() => (window as unknown as { longest: number }).longest);
    await info.attach("tiempos", { body: JSON.stringify({ openMs: opened, longestTaskMs: Math.round(longest) }), contentType: "application/json" });
    // The heaviest file blocks the page once while it is parsed, but never for long.
    // Measured: about 0.8 s for Rug Dots (1255 pieces), 0.3 s for Grand Prix.
    if (mesh.openMs) expect(longest, "tarea larga del hilo principal").toBeLessThan(2_000);
    await expect(page.locator(".stagebar")).toContainText("Vista 3D");
    await expect(page.locator(".stagebar small")).toContainText(schemaOf(mesh));
    await expect(page.locator(".stage .feedback[data-kind=error]")).toHaveCount(0);
    await expect(page.locator(".project")).toHaveAttribute("title", new RegExp("Vista 3D · " + mesh.format));
    const view = page.locator(".stage > .view");
    const drawn = await view.screenshot({ style: MODEL_ONLY });
    const empty = await view.screenshot({ style: MODEL_ONLY + " .stage > .view canvas{visibility:hidden!important}" });
    expect(drawn.equals(empty), "el lienzo no dibuja nada").toBe(false);
    await info.attach("modelo", { body: drawn, contentType: "image/png" });
    await page.screenshot({ path: info.outputPath("modelo.png") });
    const counts = await page.locator("#explorer .level small").allTextContents();
    expect(counts.reduce((sum, count) => sum + Number(count), 0)).toBe(mesh.pieces);
    // A piece of the explorer is selectable and its properties name the mesh format.
    await page.locator("#explorer .level").first().click();
    await page.locator("#explorer .entry").first().click();
    await expect(page.locator(".inspector")).toContainText("Malla " + mesh.format);
    // The walk needs metres and a floor: a rug in an FBX has both; a lamp, a chair, a table or an OBJ do not.
    const walk = page.locator(".walk-trigger");
    if (mesh.walk) await expect(walk).not.toHaveAttribute("aria-disabled", "true");
    else await expect(walk).toHaveAttribute("aria-disabled", "true");
    if (mesh.walk) {
      await page.getByRole("button", { name: "Encuadrar modelo" }).click();
      await walk.click();
      await expect(page.locator(".walk-hint")).toContainText("Elige un punto libre en el piso");
      await page.locator(".stage > .view canvas").focus();
      await page.keyboard.press("Enter");
      // Walking: the pad of directions exists (shown on touch screens) and the hint gives the keys.
      await expect(page.locator(".walk-pad")).toHaveCount(1);
      await expect(page.locator(".walk-hint")).toContainText("WASD o flechas para caminar");
      await page.keyboard.down("w");await page.waitForTimeout(300);await page.keyboard.up("w");
      await expect(page.locator(".walk-hint")).not.toHaveAttribute("data-tone", "error");
      await page.keyboard.press("Escape");
      await expect(page.locator(".walk-trigger")).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath("visor.png") });
    const origin = new URL(baseURL!).origin;
    const outside = requests.filter(url => !/^(data|blob):/.test(url) && new URL(url).origin !== origin);
    expect(outside, "peticiones fuera de la app").toEqual([]);
    const assets = requests.filter(url => !/^(data|blob):/.test(url) && /\.(png|jpe?g|tga|bmp|tiff?|dds|psd|gif|mtl)(\?|$)/i.test(new URL(url).pathname)
      // /models/ holds the app's own pictures (the guide card shows /models/restage-vista.jpg), never a texture of the upload.
      && !/^\/(_next|loaders|icons?|images?|models)\//.test(new URL(url).pathname));
    expect(assets, "texturas o materiales pedidos").toEqual([]);
  } finally {
    await page.request.delete(base, { headers });
  }
});

test("Editar con una malla FBX: lo que hoy permite", async ({ page }, info) => {
  const source = folder ? join(folder, "Grand Prix™ Chair 4130-NotUph/Furniture_Chairs-Stools-Benches_Fritz-Hansen_Grand-PrixT-4130-NotUph.fbx") : "";
  test.skip(!folder || !existsSync(source), "Indica BIMOBJECT_DIR con la carpeta BIMobject-add-nature");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const { headers, project } = await account(page, "Editar FBX");
  const base = "/api/projects/" + project;
  try {
    await page.goto("/proyectos/" + project + "/archivos");
    await page.getByTestId("model-upload").setInputFiles(source);
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await page.getByRole("link", { name: "Abrir versión 1 en el visor" }).click();
    await expect(page.locator(".project")).toHaveText(basename(source), { timeout: 120_000 });
    await modelShown(page);
    // Editar is enabled with meshes: it works on the explorer's pieces (selection, search, colour trials,
    // the mask for an external edit) and never calls the design-change service, which only takes IFC.
    const changes: string[] = [];
    page.on("request", request => { if (/design-changes|model-changes/.test(request.url())) changes.push(request.method() + " " + request.url()); });
    await page.locator("#explorer .level").first().click();
    await page.locator("#explorer .entry").first().click();
    const edit = page.getByRole("button", { name: "Editar", exact: true });
    await expect(edit).not.toHaveAttribute("aria-disabled", "true");
    await edit.click();
    await expect(edit).toHaveAttribute("aria-pressed", "true");
    const selection = page.getByRole("region", { name: "Selección" });
    await expect(selection.getByRole("heading", { name: "Piezas (1)" })).toBeVisible();
    await selection.getByRole("textbox", { name: "Buscar pieza para la propuesta" }).fill("Pieza");
    await page.screenshot({ path: info.outputPath("editar.png") });
    await expect(page.locator(".stage .feedback[data-kind=error]")).toHaveCount(0);
    expect(changes).toEqual([]);
  } finally {
    await page.request.delete(base, { headers });
  }
});

test("Un FBX con extensión .obj se rechaza con un motivo claro", async ({ page }) => {
  const source = folder ? join(folder, "PK60™ Table/PK60.FBX") : "";
  test.skip(!folder || !existsSync(source), "Indica BIMOBJECT_DIR con la carpeta BIMobject-add-nature");
  const { headers, project } = await account(page, "OBJ falso");
  try {
    await page.goto("/proyectos/" + project + "/archivos");
    await page.getByTestId("model-upload").setInputFiles({ name: "PK60.obj", mimeType: "application/octet-stream", buffer: readFileSync(source) });
    let uploads = 0;
    page.on("request", request => { if (request.url().includes("/uploads")) uploads++; });
    await page.getByRole("button", { name: "Guardar versión" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "pero es un FBX" })).toContainText("«PK60.obj» tiene extensión .obj, pero es un FBX. Cámbiale la extensión a .fbx.");
    expect(uploads).toBe(0);
    const direct = await page.request.post("/api/projects/" + project + "/uploads", { params: { name: "PK60.obj" }, headers: { ...headers, "Content-Type": "application/octet-stream" }, data: readFileSync(source) });
    expect(direct.status()).toBe(400);
    expect(direct.headers().connection).toBe("close");
    expect(await (await page.request.get("/api/projects/" + project + "/files", { headers })).json()).toEqual([]);
  } finally {
    await page.request.delete("/api/projects/" + project, { headers });
  }
});
