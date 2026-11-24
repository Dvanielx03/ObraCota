import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { editBar, editButton } from "./support/editar-prisma";
import { MODEL_ONLY, modelShown } from "./support/visor";

test.use({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });

const visor = "/proyectos/restage/visor";
const rvt = process.env.RVT_FILE ?? "";
const ifc = process.env.DUPLEX_IFC ?? "";

function canvas(page: Page) {
  return page.locator(".view canvas");
}

function cameraMode(page: Page, name: string) {
  return page.getByRole("toolbar", { name: "Controles de la cámara" }).getByRole("button", { name, exact: true });
}

async function dragCanvas(page: Page) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("El lienzo no está visible");
  await page.mouse.move(box.x + box.width * .68, box.y + box.height * .34);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .78, box.y + box.height * .40, { steps: 5 });
  await page.mouse.up();
}

async function expectPan(page: Page) {
  const style = MODEL_ONLY + ".edit-layer,.edit-dock{visibility:hidden!important}";
  const initial = await canvas(page).screenshot({ style });
  await dragCanvas(page);
  await expect.poll(async () => initial.equals(await canvas(page).screenshot({ style }))).toBe(false);
}

async function orangeSurface(page: Page) {
  const image = await canvas(page).screenshot({ style: MODEL_ONLY + ".edit-layer,.edit-dock{visibility:hidden!important}" });
  const surface = await page.evaluate(async data => {
    const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + data)).blob());
    const { width, height } = bitmap;
    const context = new OffscreenCanvas(width, height).getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, width, height).data;
    let count = 0;
    let longest = 0;
    let point = { x: .5, y: .5 };
    for (let y = 0; y < height; y++) {
      let run = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const orange = pixels[i] >= 250 && Math.abs(pixels[i + 1] - 105) <= 3 && pixels[i + 2] <= 3;
        if (!orange) {
          run = 0;
          continue;
        }
        count++;
        run++;
        if (run > longest && y > height * .12 && y < height * .78) {
          longest = run;
          point = { x: (x - run / 2) / width, y: y / height };
        }
      }
    }
    return { count, point };
  }, image.toString("base64"));
  return surface;
}

test("Desplazar y Orbitar ceden el arrastre de Editar a la cámara", async ({ page }) => {
  await page.goto(visor);
  await modelShown(page);
  await editButton(page).click();
  const selecting = editBar(page).getByRole("button", { name: "Seleccionar" });
  await expect(selecting).toHaveAttribute("aria-pressed", "true");

  await cameraMode(page, "Desplazar").click();
  await expect(selecting).toHaveAttribute("aria-pressed", "false");
  await expectPan(page);
  await expect(page.locator(".edit-zone")).toHaveCount(0);

  await selecting.click();
  await cameraMode(page, "Orbitar").click();
  await expect(selecting).toHaveAttribute("aria-pressed", "false");
  const cube = page.locator(".stage");
  const readRotation = () => cube.evaluate((stage) => stage.style.getPropertyValue("--cube-pose"));
  const original = await readRotation();
  await dragCanvas(page);
  await expect.poll(readRotation).not.toBe(original);

  await editButton(page).click();
  await expect(canvas(page)).not.toHaveAttribute("data-marking", "");
  await cameraMode(page, "Zoom ventana").click();
  await expect(cameraMode(page, "Zoom ventana")).toHaveAttribute("aria-pressed", "true");
  await cameraMode(page, "Desplazar").click();
  await expect(cameraMode(page, "Zoom ventana")).toHaveAttribute("aria-pressed", "false");
  await expectPan(page);
});

test("ReStage recupera selección y cámara tras un RVT y al sustituir el modelo por un IFC", async ({ page }, info) => {
  test.skip(!existsSync(rvt) || !existsSync(ifc), "Indica RVT_FILE y DUPLEX_IFC con los archivos reales.");
  await page.goto(visor);
  await modelShown(page);
  await editButton(page).click();
  await expect(canvas(page)).toHaveAttribute("data-marking", "");
  await page.locator("header input").setInputFiles(rvt);
  await expect(page.getByText("Revit 2025", { exact: false }).first()).toBeVisible();
  const back = page.getByRole("button", { name: /Volver al modelo|Explorar ReStage/ });
  await back.click();
  await modelShown(page);
  await expect(editButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(canvas(page)).not.toHaveAttribute("data-marking", "");

  await page.getByRole("button", { name: "Cubierta · base", exact: true }).click();
  const roof = await orangeSurface(page);
  expect(roof.count).toBeGreaterThan(100);
  await page.screenshot({ path: info.outputPath("cubierta-seleccionada.png") });
  await editButton(page).click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * roof.point.x, box.y + box.height * roof.point.y);
  await expect(page.getByRole("textbox", { name: "Describe el cambio de la marca 1" })).toBeVisible();
  const marked = await orangeSurface(page);
  expect(marked.count).toBeGreaterThan(100);
  await page.screenshot({ path: info.outputPath("cubierta-marcada-en-editar.png") });
  await page.locator("header input").setInputFiles(ifc);
  await expect(page.locator(".project")).toHaveText(/Duplex/);
  await modelShown(page);
  await expect(editButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(canvas(page)).not.toHaveAttribute("data-marking", "");
  await cameraMode(page, "Desplazar").click();
  await expectPan(page);
});
