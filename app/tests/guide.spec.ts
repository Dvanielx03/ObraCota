import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import path from "node:path";

test.use({storageState:{cookies:[],origins:[]}});

test("Primera revisión guiada sobre el plano de la piscina",async({page},info)=>{
  const drawing=process.env.TEST_DWG;
  test.skip(!drawing || path.basename(drawing).toLowerCase()!=="dwg_piscina_030824.dwg");
  await page.goto("/proyectos/restage/visor");await page.getByRole("button",{name:"Iniciar guía"}).click();
  await page.locator("input[type=file]").setInputFiles(path.resolve(drawing!));
  await expect(page.locator(".project")).toHaveText(path.basename(drawing!),{timeout:90000});
  await expect(page.locator("main")).toHaveAttribute("data-guide","select");
  await expect(page.getByRole("searchbox")).toHaveAttribute("aria-describedby","tour-instruction");
  await page.getByRole("searchbox").fill("rebose");
  await expect(page.locator(".entry").first()).toHaveAttribute("aria-describedby","tour-instruction");
  await page.screenshot({animations:"disabled",path:info.outputPath("tutorial-piscina.png")});
  await page.locator(".entry").first().click();
  await expect(page.locator("main")).toHaveAttribute("data-guide","note");
  await page.locator(".review-notes summary").click();
  await page.getByLabel("Observación sobre la selección").fill("Contrastar la referencia de rebose.");
  await page.getByRole("button",{name:"Guardar observación"}).click();
  await expect(page.locator("main")).toHaveAttribute("data-guide","review");
  await page.getByRole("button",{name:"Revisar entrega"}).click();
  await page.getByLabel("Conceptos que pide la entrega").fill("rebose");await page.getByRole("button",{name:"Preparar informe"}).click();
  await expect(page.locator(".guide-tip")).toContainText("4 de 4");
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"Descargar informe"}).click();
  const contents=await readFile((await (await download).path())!,"utf8");
  expect(contents).toContain("Texto encontrado (6)");expect(contents).toContain("Contrastar la referencia de rebose.");
  await expect(page.getByRole("dialog",{name:"Revisión de entrega"})).toHaveCount(0);await expect(page.getByRole("dialog",{name:"Guía completada"})).toBeVisible();
  await page.getByRole("button",{name:"Finalizar"}).click();
  await page.reload();await expect(page.getByRole("dialog")).toHaveCount(0);await page.getByRole("button",{name:"Guía de uso"}).click();await page.getByRole("button",{name:"Iniciar guía"}).click();await expect(page.locator("main")).toHaveAttribute("data-guide","select");
});
test("Omitir y retomar en móvil",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto("/proyectos/restage/visor");
  await page.getByRole("button",{name:"Ahora no"}).click();await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);await page.getByRole("button",{name:"Guía de uso"}).click();await page.getByRole("button",{name:"Iniciar guía"}).click();await page.getByRole("button",{name:"Omitir"}).click();
  await expect(page.getByRole("button",{name:"Guía de uso"})).toBeVisible();
});
test("Primera visita automática, ayuda superpuesta y recuerdo al recargar",async({page})=>{
  await page.goto("/proyectos/restage/visor");
  const welcome=page.getByRole("dialog",{name:"Tu primera revisión"});
  await expect(welcome).toBeVisible();
  await page.reload();
  const help=page.getByRole("button",{name:"Guía de uso",exact:true});
  await expect(help).toBeEnabled();await expect(welcome).not.toBeVisible();
  const canvas=page.locator("canvas");
  const original=await canvas.boundingBox();
  await help.click();await expect(welcome).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(original);
  await page.keyboard.press("Escape");
  await expect(welcome).not.toBeVisible();await expect(help).toBeFocused();
});
