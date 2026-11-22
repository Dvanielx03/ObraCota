import {expect,test} from "@playwright/test";
import {MODEL_ONLY,modelShown} from "./support/visor";
for(const [width,height] of [[1480,667]]){
  test("Panel contextual "+width,async({page},info)=>{
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.setViewportSize({width,height});await page.goto("/proyectos/restage/visor");
    await expect(page.locator(".project")).toHaveText("ReStage");
    const tab=(name:string)=>page.getByRole("tab",{name});
    const canvas=page.locator("canvas"),grip=page.getByRole("separator",{name:"Ancho del panel"});
    const area=async()=>(await canvas.boundingBox())!;
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    const search=page.getByRole("searchbox");await search.fill("STL1");
    await page.locator(".entry").first().click();
    await expect(tab("Lectura")).toHaveAttribute("aria-selected","true");
    await tab("Propiedades").click();
    await page.locator(".review-notes summary").click();const draft=page.getByLabel("Observación sobre la selección");await draft.fill("Pendiente de coordinación");
    await modelShown(page);
    await page.getByRole("button",{name:"Acercar",exact:true}).click();
    // Only the model render: the floating header (theme icon included), bars and cube stay out of the capture.
    const modelImage=()=>canvas.screenshot({style:MODEL_ONLY});
    const initial=await area(),framing=await modelImage();
    await tab("Propiedades").press("ArrowLeft");await expect(search).toHaveValue("STL1");
    expect(await area()).toEqual(initial);
    await tab("Lectura").press("End");await expect(draft).toHaveValue("Pendiente de coordinación");
    await page.getByRole("button",{name:"Ocultar explorador"}).click();await expect(page.getByRole("tabpanel")).toHaveCount(0);
    expect(width>720?(await area()).width:(await area()).height).toBeGreaterThan(width>720?initial.width:initial.height);
    await page.getByRole("button",{name:"Mostrar explorador"}).click();await expect(draft).toHaveValue("Pendiente de coordinación");
    expect((await modelImage()).equals(framing)).toBe(true);
    if(width>720){
      const r=(await grip.boundingBox())!;await page.mouse.move(r.x+r.width/2,r.y+20);await page.mouse.down();
      await page.mouse.move(r.x+r.width/2+56,r.y+20);await page.mouse.up();
      expect((await area()).width).toBeLessThan(initial.width-45);
      await grip.press("Home");await expect(grip).toHaveAttribute("aria-valuenow","210");
      await grip.press("End");await tab("Propiedades").focus();
    }else await expect(grip).toBeHidden();
    await page.screenshot({path:info.outputPath("panel.png")});
  });
}
