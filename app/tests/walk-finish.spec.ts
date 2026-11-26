import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createProject } from "./support/opciones-visuales";
import { modelShown } from "./support/visor";
import { expectWalkable, walkButton } from "./walk-support";

const ifc = process.env.WALK_EDIT_IFC ?? resolve(__dirname,
  "../../docs/auditoria-manual/evidencia/recorrido-restage/ReStage-escena-conceptual-recorrible.ifc");
const table = "1_Pgkfrwn6ngk6arjKar_q";
const digest = (file: Buffer) => createHash("sha256").update(file).digest("hex");

async function look(page: Page, dx: number, dy: number) {
  const rect = (await page.locator(".view canvas").boundingBox())!;
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

async function enterStudy(page: Page) {
  await modelShown(page);
  await expect.poll(async () => (await page.locator(".view canvas").boundingBox())?.width ?? 0).toBeGreaterThan(1360);
  await page.getByRole("combobox", { name: "Cambiar orientación" }).selectOption("top");
  await walkButton(page).click();
  await page.locator(".view canvas").click({ position: { x: 755, y: 328 } });
  await expect(page.locator(".walk-hint")).toContainText("Arrastra para mirar");
  await look(page, -310, 10);
  await look(page, -310, 36);
}

async function centrePixel(page: Page) {
  const bytes = await page.locator(".view canvas").screenshot({ style: ".walk-crosshair{visibility:hidden!important}" });
  return page.evaluate(async encoded => {
    const picture = new Image();
    picture.src = "data:image/png;base64," + encoded;
    await picture.decode();
    const canvas = document.createElement("canvas");
    canvas.width = picture.width; canvas.height = picture.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(picture, 0, 0);
    return Array.from(context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data).slice(0, 3);
  }, bytes.toString("base64"));
}

test.use({ viewport: { width: 1366, height: 768 } });

test("Edita el acabado de la mesa ReStage desde Recorrido y reabre el IFC aprobado", async ({ page }, info) => {
  test.skip(!existsSync(ifc), "Falta el IFC conceptual de ReStage: " + ifc);
  test.setTimeout(360_000);
  // The saved starting point is measured with the explorer folded and the canvas already full width.
  await page.addInitScript(() => localStorage.setItem("obracota.explorer.v1", "closed"));
  const project = await createProject(page, "ReStage · acabado en recorrido");
  const api = `/api/projects/${project.id}`;
  try {
    const original = readFileSync(ifc);
    const uploaded = await page.request.post(api + "/uploads", {
      headers: { ...project.headers, "Content-Type": "application/octet-stream" }, params: { name: "ReStage-recorrido.ifc" }, data: original,
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const { id: base, fileId } = await uploaded.json();
    const history = async () => (await page.request.get(`${api}/files/${fileId}/versions`, { headers: project.headers })).json();
    await page.goto(`/proyectos/${project.id}/visor/${base}`);
    await expectWalkable(page, 120_000);
    const canvas = page.locator(".view canvas");
    await enterStudy(page);
    const toolbar = page.getByRole("toolbar", { name: "Controles del recorrido" });
    const edit = toolbar.getByRole("button", { name: "Editar acabado" });
    await edit.click();
    const panel = page.getByRole("complementary", { name: "Editar acabado en recorrido" });
    const pick = panel.getByRole("button", { name: "Seleccionar en la mira" });
    await pick.click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Verificar propuesta" })).toHaveCount(0);
    await look(page, 0, 110);
    await pick.click();
    await expect(panel).toContainText("Estudio · mesa de madera");
    await expect(panel.locator("code")).toHaveAttribute("title", table);
    await page.screenshot({ path: info.outputPath("01-mira.png") });
    await panel.getByRole("combobox", { name: "Material" }).selectOption("paint");
    await panel.getByRole("combobox", { name: "Tono" }).selectOption("dark");
    await expect(panel.getByText("Color de referencia.", { exact: false })).toBeVisible();
    await panel.getByRole("button", { name: "Verificar propuesta" }).click();
    const approve = panel.getByRole("button", { name: "Aprobar y aplicar" });
    await expect(approve).toBeEnabled({ timeout: 240_000 });
    const draftHref = await panel.getByRole("link", { name: "Ver ficha del cambio" }).getAttribute("href");
    const changeId = draftHref!.split("#")[1];
    const draft = await page.request.get(`${api}/model-changes/${changeId}`, { headers: project.headers });
    expect(draft.ok()).toBeTruthy();
    const verified = await draft.json();
    expect(verified.report).toMatchObject({ ok: true });
    expect(verified.recipe.operations).toEqual([expect.objectContaining({ op: "ifc.set_material", elements: [table], material: "Pintura · oscuro" })]);
    expect(await history()).toHaveLength(1);
    const proposedColor = await centrePixel(page);
    await page.screenshot({ path: info.outputPath("02-propuesta.png") });

    await panel.getByRole("button", { name: "Base", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Base", exact: true })).toHaveAttribute("aria-pressed", "true");
    const baseColor = await centrePixel(page);
    expect(baseColor.reduce((sum, value, i) => sum + Math.abs(value - proposedColor[i]), 0)).toBeGreaterThan(30);
    await page.screenshot({ path: info.outputPath("03-base.png") });
    const alignment = await page.evaluate(() => (performance.getEntriesByName("obracota:walk-switch").at(-1) as PerformanceMark)?.detail);
    expect(alignment).toBeDefined();
    expect(alignment.distance).toBeLessThan(0.02);
    expect(alignment.angle).toBeLessThan(0.01);
    expect(await history()).toHaveLength(1);

    const publishing = page.waitForResponse(response => response.url().endsWith(`/model-changes/${verified.id}/apply`));
    await approve.click();
    const published = await (await publishing).json();
    expect(published).toMatchObject({ status: "APPLIED", appliedVersion: expect.any(String) });
    await expect(page.getByRole("link", { name: "Abrir versión en el visor" })).toBeVisible({ timeout: 60_000 });
    expect(await centrePixel(page)).toEqual(proposedColor);
    const versions = await history();
    expect(versions).toHaveLength(2);
    const fetchIfc = async (version: string) => (await page.request.get(`${api}/versions/${version}/original`, { headers: project.headers })).body();
    const applied = await fetchIfc(published.appliedVersion);
    expect(digest(applied)).toBe(verified.preview.sha256);
    expect(digest(await fetchIfc(base))).toBe(digest(original));
    const step = applied.toString("utf8");
    const materialLine = step.match(/^(#\d+)=IFCMATERIAL\('Pintura (?:\\X2\\00B7\\X0\\|·) oscuro'/m);
    const tableLine = step.match(new RegExp(`^(#\\d+)=IFCFURNITURE\\('${table}'`, "m"));
    expect(materialLine).not.toBeNull();
    expect(tableLine).not.toBeNull();
    expect(step).toMatch(new RegExp(`=IFCRELASSOCIATESMATERIAL\\([^\\r\\n]*,\\(${tableLine![1]}\\),${materialLine![1]}\\);`));

    const beforeLooking = digest(await canvas.screenshot());
    await look(page, 150, -55);
    await expect.poll(async () => digest(await canvas.screenshot())).not.toBe(beforeLooking);
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Salir", exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/visor/${published.appliedVersion}`));
    await expectWalkable(page, 120_000);
    await page.reload();
    await expectWalkable(page, 120_000);
    await expect(page.locator(".walk-hint")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("04-revision-reabierta.png") });
    await page.getByRole("button", { name: "Mostrar explorador" }).click();
    await page.getByRole("searchbox", { name: "Buscar elemento" }).fill(table);
    await page.getByRole("button", { name: "Estudio · mesa de madera", exact: true }).click();
    await page.getByRole("tab", { name: "Propiedades" }).click();
    const properties = page.getByRole("tabpanel", { name: "Propiedades" });
    await expect(properties.locator(".guid")).toHaveText(table);
    await expect(properties.locator("dd").filter({ hasText: "Pintura · oscuro" }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("05-propiedades-reabiertas.png") });
  } finally { await project.remove(); }
});
