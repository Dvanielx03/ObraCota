import {test,expect} from "@playwright/test";
import path from "node:path";

for(const [variable,is3D] of [["TEST_DWG",false],["TEST_DWG_3D",true]] as const){
  test("DWG local "+variable,async({page},info)=>{
    const file=process.env[variable];test.skip(!file,"Indicar la ruta a un DWG de prueba.");
    // Compare camera positions without the independent selection pulse.
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.goto("/proyectos/restage/visor");await expect(page.locator(".inspector")).toContainText("GlobalId");
    await page.locator("input[type=file]").setInputFiles(path.resolve(file!));
    await expect(page.locator(".project")).toHaveText(path.basename(file!),{timeout:90000});
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("tab",{name:"Propiedades"}).click();await page.getByText("Datos de importación").click();
    const depth=await page.locator("dt").filter({hasText:"Rango Z visible"}).locator("+ dd").innerText();
    if(is3D)await expect(page.getByRole("button",{name:"Orbitar"})).toBeVisible();
    if(is3D) expect(parseFloat(depth.replace(/\./g,"").replace(",","."))).toBeGreaterThan(0);
    console.log(variable,await page.locator(".drawing-info").innerText());
    await page.screenshot({path:info.outputPath("dwg.png")});
    await page.getByRole("tab",{name:"Lectura"}).click();await page.locator(".level").first().click();await page.locator(".entry").first().click();await page.getByRole("tab",{name:"Propiedades"}).click();
    await expect(page.locator(".inspector")).toContainText("Entidades");
    const canvas=page.locator("canvas");
    // The first group can be a single point with a constant screen-space marker.
    await page.getByRole("button",{name:is3D?"Encuadrar modelo":"Encuadrar plano"}).click();
    const before=await canvas.screenshot();
    await page.getByRole("button",{name:"Acercar",exact:true}).click();
    expect((await canvas.screenshot()).equals(before)).toBe(false);
    if(path.basename(file!).toLowerCase()==="dwg_piscina_030824.dwg"){
      await expect(page.getByRole("region",{name:"Mesa de planos"})).toBeVisible();
      await expect(page.getByRole("button",{name:"Orbitar"})).toHaveCount(0);
      await expect(page.getByRole("combobox",{name:"Cambiar orientación"})).toHaveCount(0);
      await page.getByRole("button",{name:"Restablecer cámara"}).click();
      await canvas.press("Home");await canvas.blur();
      const drawing=()=>canvas.screenshot({style:".tools,.stagebar{visibility:hidden!important}"});
      const home=await drawing();
      const rect=(await canvas.boundingBox())!;
      const x=rect.x+rect.width*.5,y=rect.y+rect.height*.5;
      const pose=()=>page.locator(".stage").evaluate(el=>getComputedStyle(el).getPropertyValue("--cube-pose"));
      const top=await pose();
      await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+80,y+40,{steps:6});await page.mouse.up();
      expect(await pose()).toBe(top);expect((await drawing()).equals(home)).toBe(false);
      await canvas.press("Home");await canvas.blur();expect((await drawing()).equals(home)).toBe(true);
      const search=page.getByRole("searchbox");
      await page.getByRole("tab",{name:"Lectura"}).click();await search.fill("rebose");
      const hits=page.locator(".entry");
      await expect(hits).toHaveCount(6);
      await page.getByRole("button",{name:"Coincidencia siguiente"}).click();
      await expect(hits.first()).toHaveAttribute("aria-pressed","true");
      await expect(page.locator(".note-marker")).toBeVisible();
      await expect(page.locator(".inspector strong")).toContainText(/rebose/i);
      const first=await canvas.screenshot();
      await page.getByRole("button",{name:"Coincidencia anterior"}).click();
      await expect(hits.last()).toHaveAttribute("aria-pressed","true");
      expect((await canvas.screenshot()).equals(first)).toBe(false);
      await page.getByRole("tab",{name:"Propiedades"}).click();await page.getByText("Observaciones locales (0)").click();
      await page.getByRole("textbox",{name:"Observación sobre la selección"}).fill("Comprobar con hidráulica");
      await page.getByRole("button",{name:"Guardar observación"}).click();
      await expect(page.getByText("Observaciones locales (1)")).toBeVisible();
      await page.screenshot({path:info.outputPath("lectura-rebose.png")});
      await page.getByRole("button",{name:"Cerrar modelo"}).click();
      await page.locator("input[type=file]").setInputFiles(path.resolve(file!));
      await expect(page.locator(".project")).toHaveText(path.basename(file!));
      await page.getByRole("tab",{name:"Propiedades"}).click();await page.getByText("Observaciones locales (1)").click();
      await page.getByRole("button",{name:/Comprobar con hidráulica/}).click();
      await expect(page.locator(".note-marker")).toBeVisible();
      await expect(page.locator(".note-marker")).toHaveAttribute("data-label",/rebose/i);
    }
    if(!is3D && process.env.TEST_IFC){
      const ifc=path.resolve(process.env.TEST_IFC);
      await page.locator("input[type=file]").setInputFiles(ifc);
      await expect(page.locator(".project")).toHaveText(path.basename(ifc),{timeout:90000});
      await page.getByRole("tab",{name:"Lectura"}).click();await page.locator(".level").first().click();await page.locator(".entry").first().click();await page.getByRole("tab",{name:"Propiedades"}).click();
      await expect(page.locator(".inspector")).toContainText("GlobalId");
      await expect(page.getByText("Observaciones locales (0)")).toBeVisible();
      await expect(page.getByRole("button",{name:"Orbitar"})).toBeVisible();
      const focused=await canvas.screenshot();
      await page.getByRole("button",{name:"Encuadrar modelo"}).click();
      const general=await canvas.screenshot();
      expect(focused.equals(general)).toBe(false);
      await page.getByRole("button",{name:"Volver a encuadrar"}).click();
      // The camera eases back to the previous framing: wait until it settles there instead of reading one frame.
      await expect.poll(async()=>(await canvas.screenshot()).equals(focused),{timeout:10_000}).toBe(true);
    }
  });
}
