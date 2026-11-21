import type {Page} from "@playwright/test";

export async function findFloor(page:Page){
  await page.getByRole("combobox",{name:"Cambiar orientación"}).selectOption("top");
  await page.getByRole("button",{name:"Recorrer",exact:true}).click();
  const canvas=page.locator(".view canvas");
  const box=(await canvas.boundingBox())!;
  for(const y of [.53,.42,.65,.35,.73,.55,.62,.46,.25,.75]){
    for(const x of [.49,.43,.55,.39,.6,.32,.67]){
      await canvas.click({position:{x:Math.round(box.width*x),y:Math.round(box.height*y)},timeout:20_000});
      const hint=await page.locator(".walk-hint").textContent();
      if(hint?.includes("Arrastra para mirar") || hint?.includes("triángulos"))return;
    }
  }
}

