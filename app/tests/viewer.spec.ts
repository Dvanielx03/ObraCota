import {expect,test} from "@playwright/test";
import path from "node:path";

for (const [width,height] of [[1480,667],[1366,768],[390,844],[844,390]]) {
  test("Modelo e inspector a "+width+" × "+height,async ({page},info)=>{
    await page.setViewportSize({width,height});
    await page.goto("/proyectos/restage/visor");
    const canvas = page.locator("canvas");
    await page.getByRole("tab",{name:"Propiedades"}).click();await expect(page.getByText("GlobalId",{exact:true})).toBeVisible();
    await expect(canvas).toBeVisible();
    const rect = await canvas.boundingBox();
    expect(rect!.width).toBeGreaterThan(220);
    expect(rect!.height).toBeGreaterThan(120);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    async function verifyToolbar(){
      const view=(await canvas.boundingBox())!,stage=(await page.locator(".stage").boundingBox())!,tools=(await page.locator(".tools").boundingBox())!;
      expect(Math.abs(view.y+view.height-stage.y-stage.height)).toBeLessThan(1);
      expect(Math.abs(tools.x+tools.width/2-view.x-view.width/2)).toBeLessThan(1);
      expect(tools.y+tools.height).toBeLessThan(view.y+view.height);
      expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName,{x:view.x+5,y:view.y+view.height-5})).toBe("CANVAS");
    }
    await verifyToolbar();
    await page.screenshot({path:info.outputPath("visor.png")});
    const initial = await canvas.screenshot();
    await page.getByRole("button",{name:"Acercar",exact:true}).click();
    expect((await canvas.screenshot()).equals(initial)).toBe(false);
    await page.getByRole("button",{name:"Encuadrar modelo"}).click();
    await page.getByRole("button",{name:"Desplazar",exact:true}).click();
    await expect(page.getByRole("button",{name:"Desplazar",exact:true})).toHaveAttribute("aria-pressed","true");
    await page.getByRole("tab",{name:"Lectura"}).click();await page.getByRole("searchbox").fill("STL1-00-BEAM-HEB");
    await page.locator(".entry").first().click();await page.getByRole("tab",{name:"Propiedades"}).click();
    await expect(page.locator(".inspector")).toContainText("STL1-00-BEAM-HEB");
    await page.getByRole("button",{name:"Ocultar explorador"}).click();
    await expect(page.locator("aside")).toBeHidden();
    await verifyToolbar();
  });
}
test("Selección en el lienzo y órbita con el ratón",async({page})=>{
  await page.setViewportSize({width:1480,height:667});
  await page.goto("/proyectos/restage/visor");await page.getByRole("tab",{name:"Propiedades"}).click();await expect(page.getByText("GlobalId",{exact:true})).toBeVisible();
  const canvas = page.locator("canvas"), rect = (await canvas.boundingBox())!;
  const x = rect.x + rect.width*0.58, y = rect.y + rect.height*0.50;
  await page.mouse.click(x,y);
  await expect(page.locator(".entry[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator(".inspector strong")).not.toHaveText("STL1-01-BEAM-HEB");
  const before = await canvas.screenshot();
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+85,y+10,{steps:8});await page.mouse.up();
  expect((await canvas.screenshot()).equals(before)).toBe(false);
});
test("Archivo inválido, recuperación y nueva sesión",async({page})=>{
  await page.goto("/proyectos/restage/visor");await page.getByRole("tab",{name:"Propiedades"}).click();await expect(page.getByText("GlobalId",{exact:true})).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({name:"plano.ifc",mimeType:"text/plain",buffer:Buffer.from("contenido ilegible")});
  await expect(page.getByText(/cabecera IFC STEP válida/)).toBeVisible();
  await page.getByRole("button",{name:"Volver al modelo"}).click();
  await page.getByRole("button",{name:"Cerrar modelo"}).click();
  await expect(page.getByRole("heading",{name:"Abrir un modelo"})).toBeVisible();
  await page.getByRole("button",{name:"Explorar ReStage"}).click();
  await page.getByRole("tab",{name:"Propiedades"}).click();await expect(page.getByText("GlobalId",{exact:true})).toBeVisible();
});
test("Importación local con geometría IFC",async({page})=>{
  test.skip(!process.env.TEST_IFC,"Indicar TEST_IFC para probar un archivo de intercambio real.");
  const file = path.resolve(process.env.TEST_IFC!);
  await page.goto("/proyectos/restage/visor");await page.getByRole("tab",{name:"Propiedades"}).click();await expect(page.getByText("GlobalId",{exact:true})).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(file);
  await expect(page.locator(".project")).toHaveText(path.basename(file),{timeout:90000});
  await page.locator(".level").first().click();await page.locator(".entry").first().click();await page.getByRole("tab",{name:"Propiedades"}).click();
  await expect(page.locator(".inspector")).toContainText("GlobalId");
});
