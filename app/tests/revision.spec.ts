import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import path from "node:path";
test("Área de trabajo hasta el borde inferior",async({page},info)=>{
  for(const [width,height] of [[1480,667]]){
    await page.setViewportSize({width,height});await page.goto("/proyectos/restage/visor");
    await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
    await expect(page.locator("footer")).toHaveCount(0);
    expect(await page.locator(".workarea").evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-innerHeight))).toBeLessThan(2);
    await page.screenshot({path:info.outputPath("visor-"+width+".png")});
  }
});
test("Revisión de piscina · cambios de texto y cota",async({page},info)=>{
  const original=process.env.TEST_DWG, revision=process.env.TEST_DWG_REVISION;
  test.skip(!original||!revision);
  await page.goto("/proyectos/restage/visor");await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
  await page.locator("header input").setInputFiles(revision!);
  await expect(page.locator(".project")).toHaveText(path.basename(revision!),{timeout:90000});
  await page.getByRole("button",{name:"Revisar entrega"}).click();
  await page.getByRole("button",{name:"Comparar versiones DWG"}).click();
  const previous=page.getByLabel("Versión anterior");
  await previous.setInputFiles(revision!);
  await expect(page.getByText(/^0 diferencias ·/)).toBeVisible({timeout:60000});
  await previous.setInputFiles(original!);
  await expect(page.getByRole("button",{name:"Localizar 2C81E"})).toBeVisible({timeout:60000});
  await expect(page.getByText(/Rebose → Rebose - revisar detalle R1/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Localizar 2BD4A"})).toBeVisible();
  await expect(page.getByText("2 diferencias · 0 identificadores sin correspondencia única")).toBeVisible();
  await page.screenshot({path:info.outputPath("comparacion.png")});
  await page.getByRole("button",{name:"Localizar 2BD4A"}).click();
  await expect(page.locator(".inspector")).toContainText("16,169499 m");
  await expect(page.locator(".note-marker")).toBeVisible();
  await page.getByText("Texto de origen",{exact:true}).click();
  await expect(page.locator(".inspector code")).toContainText("verificar R1");
  await page.getByText("Observaciones locales (0)").click();
  await page.getByLabel("Observación sobre la selección").fill("Revisar etiqueta en R1");
  await page.getByRole("button",{name:"Guardar observación"}).click();
  await page.getByRole("button",{name:"Revisar entrega"}).click();
  await page.getByRole("button",{name:"Preparar informe"}).click();
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Descargar informe"}).click();
  const text=await readFile((await (await download).path())!,"utf8");
  expect(text).toMatch(/Revisar etiqueta en R1 — [^\n]+2BD4A[^\n]+16\.16949[^\n]+verificar R1/);
});

test("Piloto de escritura AC1032 · compara la copia editada con el original",async({page},info)=>{
  const original=process.env.TEST_DWG,pilot=process.env.TEST_DWG_PILOT;
  test.skip(!original||!pilot);
  test.setTimeout(180_000);
  await page.goto("/proyectos/restage/visor");
  await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
  await page.locator("header input").setInputFiles(pilot!);
  await expect(page.locator(".project")).toHaveText(path.basename(pilot!),{timeout:90_000});
  await page.getByRole("button",{name:"Revisar entrega"}).click();
  await page.getByRole("button",{name:"Comparar versiones DWG"}).click();
  await page.getByLabel("Versión anterior").setInputFiles(original!);
  await expect(page.getByText("2 diferencias · 0 identificadores sin correspondencia única")).toBeVisible({timeout:60_000});
  await expect(page.getByText(/Rebose → Rebose \(PRUEBA\)/)).toBeVisible();
  await page.screenshot({path:info.outputPath("piloto-compartido.png")});
  await page.getByRole("button",{name:"Localizar 2BD4A"}).click();
  await expect(page.locator(".inspector")).toContainText("16,169499 m");
  await page.getByText("Texto de origen",{exact:true}).click();
  await expect(page.locator(".inspector code")).toContainText("<> (PRUEBA)");
});
