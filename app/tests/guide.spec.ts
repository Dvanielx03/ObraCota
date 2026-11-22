import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import path from "node:path";

test.use({storageState:{cookies:[],origins:[]}});

// La revisión de entrega vive en REVISAR (tecla V) de la barra inferior: un panel «Revisión de entrega»
// anclado sobre el botón, con los conceptos y «Preparar informe», y un diálogo modal «Informe de revisión»
// con «Descargar informe» (delivery-review.tsx). El panel conserva su contenido al cerrarse (keepMounted),
// así que su aviso «Paso 3 de 4» sigue en el DOM, pero dentro de un panel [hidden]: no se ve ni se anuncia.
// Por eso el paso 4 se busca en el informe y se comprueba que el paso 3 ya no es perceptible.

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
  await page.getByRole("toolbar",{name:"Acciones del modelo"}).getByRole("button",{name:"Revisar entrega"}).click();
  const panel=page.getByRole("dialog",{name:"Revisión de entrega"});
  await expect(panel.locator(".guide-tip")).toContainText("Paso 3 de 4");
  await panel.getByLabel("Conceptos que pide la entrega").fill("rebose");await panel.getByRole("button",{name:"Preparar informe"}).click();
  const report=page.getByRole("dialog",{name:"Informe de revisión"});
  await expect(report).toBeVisible();await expect(panel).toBeHidden();
  await expect(report.locator(".guide-tip")).toContainText("Paso 4 de 4");
  // Un solo aviso de la guía perceptible a la vez: el del paso 3 queda en el panel oculto.
  await expect(page.getByRole("status").filter({hasText:/Paso \d de 4/})).toHaveCount(1);
  await expect(page.getByRole("status").filter({hasText:"Paso 3 de 4"})).toHaveCount(0);
  const download=page.waitForEvent("download");await report.getByRole("button",{name:"Descargar informe"}).click();
  const contents=await readFile((await (await download).path())!,"utf8");
  expect(contents).toContain("Texto encontrado (6)");expect(contents).toContain("Contrastar la referencia de rebose.");
  await expect(report).toHaveCount(0);await expect(panel).toHaveCount(0);await expect(page.getByRole("dialog",{name:"Guía completada"})).toBeVisible();
  await page.getByRole("button",{name:"Finalizar"}).click();
  await page.reload();await expect(page.getByRole("dialog")).toHaveCount(0);await page.getByRole("button",{name:"Guía de uso"}).click();await page.getByRole("button",{name:"Iniciar guía"}).click();await expect(page.locator("main")).toHaveAttribute("data-guide","select");
});
for(const [width,height] of [[1366,768],[390,844]])test("Omitir y retomar · "+width,async({page})=>{
  test.skip(width<1000,"Solo escritorio (D-12)");
  await page.setViewportSize({width,height});await page.goto("/proyectos/restage/visor");
  await page.getByRole("button",{name:"Ahora no"}).click();await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);await page.getByRole("button",{name:"Guía de uso"}).click();await page.getByRole("button",{name:"Iniciar guía"}).click();await page.getByRole("button",{name:"Omitir"}).click();
  await expect(page.getByRole("button",{name:"Guía de uso"})).toBeVisible();
});
test("Primera visita automática, ayuda superpuesta y recuerdo al recargar",async({page})=>{
  await page.goto("/proyectos/restage/visor");
  const welcome=page.getByRole("dialog",{name:"Empieza por aquí"});
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
