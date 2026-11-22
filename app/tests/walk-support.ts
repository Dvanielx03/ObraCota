import {expect,type Page} from "@playwright/test";

/** RECORRIDO en la barra inferior del visor (antes «Recorrer»): workspace-tools.tsx, tecla W. */
export const walkButton=(page:Page)=>page.getByRole("toolbar",{name:"Acciones del modelo"}).getByRole("button",{name:"Recorrido",exact:true});

/** Espera a que RECORRIDO pueda usarse: el botón siempre está en un modelo 3D, pero deshabilitado sin un IFC recorrible. */
export async function expectWalkable(page:Page,timeout?:number){
  const walk=walkButton(page);
  await expect(walk).toBeVisible({timeout});
  await expect(walk).not.toHaveAttribute("aria-disabled","true",{timeout});
  await expect(walk).toHaveAttribute("aria-keyshortcuts","W");
}

export async function findFloor(page:Page){
  await page.getByRole("combobox",{name:"Cambiar orientación"}).selectOption("top");
  await walkButton(page).click();
  // La barra del recorrido reemplaza a la de herramientas mientras se elige el punto de partida.
  await expect(page.getByRole("toolbar",{name:"Controles del recorrido"})).toBeVisible();
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
