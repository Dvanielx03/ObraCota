import {expect,test} from "@playwright/test";
import path from "node:path";
import {MODEL_ONLY,modelShown} from "./support/visor";

for (const [width,height] of [[1480,667],[1366,768]]) {
  test("Modelo e inspector a "+width+" × "+height,async ({page},info)=>{
    await page.setViewportSize({width,height});
    await page.goto("/proyectos/restage/visor");
    const canvas = page.locator("canvas");
    // Only the model render: the floating header, bars and cube would change a capture on their own.
    const modelImage = ()=>canvas.screenshot({style:MODEL_ONLY});
    await page.getByRole("tab",{name:"Propiedades"}).click();await expect(page.getByText("GlobalId",{exact:true})).toBeVisible();
    await modelShown(page);
    await expect(canvas).toBeVisible();
    const rect = await canvas.boundingBox();
    expect(rect!.width).toBeGreaterThan(220);
    expect(rect!.height).toBeGreaterThan(120);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    /** Checks the bottom bars over the canvas and returns how far the tool bar sits from the canvas centre. */
    async function verifyToolbar(){
      const view=(await canvas.boundingBox())!,stage=(await page.locator(".stage").boundingBox())!;
      const bar=(await page.getByRole("toolbar",{name:"Acciones del modelo"}).boundingBox())!;
      const camera=(await page.getByRole("toolbar",{name:"Controles de la cámara"}).boundingBox())!;
      const bottom=view.y+view.height;
      expect(Math.abs(bottom-stage.y-stage.height)).toBeLessThan(1);
      // Both groups float 24 px above the bottom of the canvas (reference: bottom 24px, ESPECIFICACION §4.6).
      expect(Math.abs(bottom-24-bar.y-bar.height)).toBeLessThan(1);
      expect(Math.abs(bottom-24-camera.y-camera.height)).toBeLessThan(1);
      // DU-03 = C: the camera group sits on its own 16 px from the right edge of the canvas; the tool bar is
      // centred on the canvas and only moves left as far as it must to stay 16 px clear of the camera group.
      expect(Math.abs(view.x+view.width-16-camera.x-camera.width)).toBeLessThan(1);
      const centred=view.x+view.width/2-bar.width/2;
      expect(Math.abs(bar.x-Math.min(centred,camera.x-16-bar.width))).toBeLessThan(1);
      expect(bar.x).toBeGreaterThan(view.x+16-1);
      expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName,{x:view.x+5,y:view.y+view.height-5})).toBe("CANVAS");
      return bar.x+bar.width/2-view.x-view.width/2;
    }
    await verifyToolbar();
    await page.screenshot({path:info.outputPath("visor.png")});
    const initial = await modelImage();
    await page.getByRole("button",{name:"Acercar",exact:true}).click();
    expect((await modelImage()).equals(initial)).toBe(false);
    await page.getByRole("button",{name:"Encuadrar modelo"}).click();
    await page.getByRole("button",{name:"Desplazar",exact:true}).click();
    await expect(page.getByRole("button",{name:"Desplazar",exact:true})).toHaveAttribute("aria-pressed","true");
    await page.getByRole("tab",{name:"Lectura"}).click();await page.getByRole("searchbox").fill("STL1-00-BEAM-HEB");
    await page.locator(".entry").first().click();await page.getByRole("tab",{name:"Propiedades"}).click();
    await expect(page.locator(".inspector")).toContainText("STL1-00-BEAM-HEB");
    await page.getByRole("button",{name:"Ocultar explorador"}).click();
    await expect(page.locator("aside")).toBeHidden();
    // With the whole width free there is room beside the camera group: the bar is exactly centred.
    expect(Math.abs(await verifyToolbar())).toBeLessThan(1);
  });
}
test("Selección en el lienzo y órbita con el ratón",async({page})=>{
  await page.setViewportSize({width:1480,height:667});
  await page.goto("/proyectos/restage/visor");await page.getByRole("tab",{name:"Propiedades"}).click();await expect(page.getByText("GlobalId",{exact:true})).toBeVisible();
  // The sample opens with its featured beam selected; a click on the canvas must replace it.
  await expect(page.locator(".inspector strong")).toHaveText("STL1-01-BEAM-HEB");
  await modelShown(page);
  const canvas = page.locator("canvas"), rect = (await canvas.boundingBox())!;
  const x = rect.x + rect.width*0.58, y = rect.y + rect.height*0.50;
  await page.mouse.click(x,y);
  await expect(page.locator(".entry[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator(".inspector strong")).not.toHaveText("STL1-01-BEAM-HEB");
  const before = await canvas.screenshot({style:MODEL_ONLY});
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+85,y+10,{steps:8});await page.mouse.up();
  expect((await canvas.screenshot({style:MODEL_ONLY})).equals(before)).toBe(false);
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
