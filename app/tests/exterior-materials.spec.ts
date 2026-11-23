import {expect,test,type Page} from "@playwright/test";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {MODEL_ONLY} from "./support/visor";
import {createProject,openFirstVersion,renderButton,renderPanel} from "./support/opciones-visuales";

/**
 * Renderizar › Ver en el modelo 3D (visual-options.tsx, three-viewer.ts `previewExteriorFinish`): las fichas
 * de acabado, tono y luz se ven ya en el exterior del modelo, solo en el visor. Se aplica Piedra · Claro ·
 * Tarde, el lienzo cambia; «Restablecer materiales» lo deja como estaba. TEST_IFC cambia el modelo (por
 * defecto, el Duplex de docs/mvp/paso-5).
 */
const file=process.env.TEST_IFC ?? resolve(__dirname,"../../docs/mvp/paso-5/Duplex_A_20110907.ifc");
const hidden={style:MODEL_ONLY.replace(".note-marker{",".note-marker,.tool-popover{")};

/** Fracción de píxeles que difieren entre dos capturas PNG (se decodifican en la página, sin dependencias). */
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

test("Las fichas de Renderizar se ven en el exterior del modelo y se restablecen",async({page})=>{
  test.skip(!existsSync(file),"Falta el IFC de prueba: "+file);
  test.setTimeout(300_000);
  const project=await createProject(page,"Materiales exteriores");
  try{
    await openFirstVersion(page,project.id,file,/\.ifc$/i);
    const canvas=page.locator(".view canvas");
    await page.waitForTimeout(1500);
    const before=await canvas.screenshot(hidden);
    await renderButton(page).click();
    const panel=renderPanel(page);
    const live=panel.getByRole("button",{name:"Ver en el modelo 3D"});
    await expect(live).toHaveAttribute("aria-pressed","true");
    await panel.getByRole("radio",{name:"Piedra"}).click();
    await panel.getByRole("radio",{name:"Claro"}).click();
    await panel.getByRole("radio",{name:"Tarde"}).click();
    await expect(panel.getByRole("status").filter({hasText:/piezas? exterior/})).toBeVisible();
    // Las texturas llegan después del primer cuadro: se espera a que el lienzo cambie de verdad.
    await expect.poll(async()=>difference(page,before,await canvas.screenshot(hidden)),{timeout:20_000}).toBeGreaterThan(.02);
    await panel.getByRole("button",{name:"Restablecer materiales"}).click();
    await expect.poll(async()=>difference(page,before,await canvas.screenshot(hidden)),{timeout:10_000}).toBeLessThan(.002);
  }finally{await project.remove();}
});
