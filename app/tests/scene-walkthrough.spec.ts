import {expect,test,type Page} from "@playwright/test";
import {existsSync} from "node:fs";
import {MODEL_ONLY} from "./support/visor";
import {createProject,openFirstVersion} from "./support/opciones-visuales";
import {editBar,editButton} from "./support/editar-prisma";
import {png} from "./support/png";

/**
 * «Recorrer esta escena en 3D» (edit-global-popover.tsx, scene-walk.tsx, three-viewer.ts `previewEnvironment`): la
 * escena elegida en Editar › Escena se construye con geometría real alrededor del modelo (cielo y sol de la hora,
 * suelo y árboles del entorno, tono del estilo), se entra en el recorrido y «Restablecer» vuelve al visor neutro.
 * «Panorama 360° con IA» se prueba con la ruta del servidor simulada: abre el visor esférico y Escape lo cierra.
 * DUPLEX_IFC apunta al IFC de prueba (docs/mvp/paso-5/Duplex_A_20110907.ifc); sin él la prueba se omite.
 */
const file=process.env.DUPLEX_IFC ?? "";
const hidden={style:MODEL_ONLY+".scene-walk,.edit-dock,.edit-popover,.tool-popover,.marks-layer{visibility:hidden!important}"};

/** Fracción de píxeles que difieren entre dos capturas PNG del mismo tamaño (1 si el tamaño cambia). */
async function difference(page:Page,a:Buffer,b:Buffer){
  return page.evaluate(async([x,y])=>{
    async function pixels(data:string){
      const image=new Image();image.src="data:image/png;base64,"+data;await image.decode();
      const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext("2d")!;context.drawImage(image,0,0);
      return context.getImageData(0,0,image.width,image.height).data;
    }
    const [p,q]=await Promise.all([pixels(x),pixels(y)]);
    if(p.length!==q.length)return 1;
    let changed=0;
    for(let i=0;i<p.length;i+=4)if(Math.abs(p[i]-q[i])+Math.abs(p[i+1]-q[i+1])+Math.abs(p[i+2]-q[i+2])>24)changed++;
    return changed/(p.length/4);
  },[a.toString("base64"),b.toString("base64")] as const);
}

test.use({viewport:{width:1366,height:768}});

test("La escena de Editar se recorre en 3D, abre un panorama 360° y se restablece",async({page},info)=>{
  test.skip(!file || !existsSync(file),"Falta DUPLEX_IFC con el IFC de prueba");
  test.setTimeout(300_000);
  const project=await createProject(page,"Escena recorrible");
  try{
    await openFirstVersion(page,project.id,file,/\.ifc$/i);
    const canvas=page.locator(".view canvas"),stage=page.locator(".stage");
    await page.waitForTimeout(1500);
    const neutral=await canvas.screenshot(hidden);
    await expect(stage).not.toHaveAttribute("data-environment",/.+/);

    await editButton(page).click();
    await editBar(page).getByRole("button",{name:"Escena",exact:true}).click();
    const card=page.getByRole("dialog",{name:"Escena"});
    await card.getByRole("button",{name:"Presentación al cliente"}).click();
    await card.getByRole("button",{name:"Recorrer esta escena en 3D"}).click();

    // The viewer reports the scene it built (time weather season surroundings style) and the walk starts.
    await expect(stage).toHaveAttribute("data-environment","afternoon clear - city photo");
    await expect(page.locator("main")).toHaveAttribute("data-walk","on");
    const bar=page.getByRole("group",{name:"Escena en 3D"});
    await expect(bar).toContainText("Tarde · Despejado · Ciudad · Fotorrealista");

    // Panorama 360° con IA, with the server route stubbed: a small 2:1 picture opens in the sphere viewer.
    let sent:{scene?:string;jpeg?:string}={};
    await page.route("**/api/projects/*/versions/*/options/panorama",async route=>{
      sent=route.request().postDataJSON();
      await route.fulfill({status:200,contentType:"image/png",body:png(64,32,[210,140,60])});
    });
    await bar.getByRole("button",{name:"Panorama 360° con IA"}).click();
    const panorama=page.getByRole("dialog",{name:"Panorama 360° con IA"});
    await expect(panorama).toBeVisible();
    await expect(panorama).toContainText("Imagen generada con IA: no reproduce la geometría exacta");
    await expect(panorama.locator(".panorama-view")).toHaveAttribute("data-state","ready");
    expect(sent.scene).toContain("en la ciudad");
    expect(sent.jpeg?.length).toBeGreaterThan(100);
    await page.screenshot({path:info.outputPath("panorama.png")});
    // Escape closes the panorama alone: the walk stays.
    await page.keyboard.press("Escape");
    await expect(panorama).toHaveCount(0);
    await expect(page.locator("main")).toHaveAttribute("data-walk","on");

    // Leaving the walk keeps the scene around the model; the canvas is no longer the neutral one.
    await page.keyboard.press("Escape");
    await expect(page.locator("main")).not.toHaveAttribute("data-walk",/.+/);
    await expect(stage).toHaveAttribute("data-environment","afternoon clear - city photo");
    await expect.poll(async()=>difference(page,neutral,await canvas.screenshot(hidden)),{timeout:15_000}).toBeGreaterThan(.05);
    await page.screenshot({path:info.outputPath("escena-3d.png")});

    // Restablecer: back to the neutral viewer.
    await bar.getByRole("button",{name:"Restablecer"}).click();
    await expect(bar).toHaveCount(0);
    await expect(stage).not.toHaveAttribute("data-environment",/.+/);
    await expect.poll(async()=>difference(page,neutral,await canvas.screenshot(hidden)),{timeout:10_000}).toBeLessThan(.01);
  }finally{await project.remove();}
});
