import {expect,test} from "@playwright/test";
import {statSync} from "node:fs";
import {expectWalkable,findFloor,walkButton} from "./walk-support";

test("Recorrido móvil en IFC real y regreso al visor",async({page},info)=>{
  // Variante de ancho móvil (390 × 844): la app es solo de escritorio.
  test.skip(true,"Solo escritorio (D-12)");
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc);
  await page.setViewportSize({width:390,height:844});
  await page.goto("/proyectos/restage/visor");
  await expect(page.locator(".project")).toHaveText("ReStage");
  await expect(page.getByRole("button",{name:"Recorrer",exact:true})).toHaveCount(0);
  await page.locator("header input").setInputFiles(ifc!);
  await expect(page.getByRole("button",{name:"Recorrer",exact:true})).toBeVisible();
  await findFloor(page);
  const forward=page.getByRole("button",{name:"Adelante",exact:true});
  await expect(forward).toBeVisible();
  expect((await forward.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const bounds=(await forward.boundingBox())!;
  await page.mouse.move(bounds.x+20,bounds.y+20);await page.mouse.down();
  await page.waitForTimeout(400);await page.mouse.up();
  await page.screenshot({path:info.outputPath("recorrido-movil.png")});
  await page.getByRole("button",{name:"Salir",exact:true}).click();
  await expect(page.getByRole("button",{name:"Recorrer",exact:true})).toBeVisible();
  await expect(page.getByRole("tab",{name:"Lectura"})).toBeVisible();
});

test("Medición del IFC original de ReStage",async({page},info)=>{
  test.setTimeout(240_000);
  const ifc=process.env.RESTAGE_IFC;
  test.skip(!ifc);
  await page.setViewportSize({width:1366,height:768});
  await page.goto("/proyectos/restage/visor");
  await expect(page.locator(".project")).toHaveText("ReStage");
  // El ejemplo no se puede recorrer: RECORRIDO está en la barra, pero deshabilitado.
  await expect(walkButton(page)).toHaveAttribute("aria-disabled","true");
  const opened=Date.now();
  await page.locator("header input").setInputFiles(ifc!);
  await expect(page.locator(".project")).toHaveText(/\.ifc$/i,{timeout:180_000});
  await expectWalkable(page,180_000);
  const openingMs=Date.now()-opened;
  console.log(JSON.stringify({bytes:statSync(ifc!).size,openingMs}));
  await findFloor(page);
  const hint=await page.locator(".walk-hint").innerText();
  await page.locator(".view canvas").focus();
  await page.keyboard.down("ArrowRight");
  const profile=await page.evaluate(async()=>{
    const gl=document.querySelector("canvas")!.getContext("webgl2");
    const debug=gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer=debug?gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
    const index=performance.getEntriesByName("obracota:walk-index").map(entry=>({ms:entry.duration,triangles:(entry as PerformanceMeasure).detail.triangles}));
    const frames=await new Promise<number>(resolve=>{
      const end=performance.now()+3000;
      let count=0;
      function next(t:number){if(t>=end)resolve(count);else{count++;requestAnimationFrame(next);}}
      requestAnimationFrame(next);
    });
    return {renderer,index,rafPerSecond:frames/3};
  });
  await page.keyboard.up("ArrowRight");
  const result={bytes:statSync(ifc!).size,openingMs,hint,...profile};
  console.log(JSON.stringify(result));
  await info.attach("medicion",{body:JSON.stringify(result,null,2),contentType:"application/json"});
  await page.screenshot({path:info.outputPath("restage-ifc.png")});
  expect(hint).toMatch(/Arrastra para mirar/);
  await page.getByRole("button",{name:"Salir",exact:true}).click();
  // Al salir vuelve la barra de herramientas con RECORRIDO disponible.
  await expect(page.getByRole("toolbar",{name:"Controles del recorrido"})).toHaveCount(0);
  await expectWalkable(page);
  await expect(page.locator("main")).not.toHaveAttribute("data-walk",/.+/);
});
