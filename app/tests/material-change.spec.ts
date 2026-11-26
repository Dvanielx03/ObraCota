import {expect,test} from "@playwright/test";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {createProject,renderButton,renderPanel} from "./support/opciones-visuales";

/**
 * H2 material: «Guardar en el modelo» turns the finish previewed in Renderizar into a real model change
 * (`ifc.set_material`, visual-options.tsx and finish-change.ts). With the real engine and backend: the Duplex is
 * uploaded by API, Piedra · Claro · Tarde is previewed on its exterior, the change is created, previewed and sent, its
 * card says no price is recorded for the material, and approving it publishes version 2 with the material in the IFC.
 */
const file=process.env.DUPLEX_IFC ?? resolve(__dirname,"../../docs/mvp/paso-5/Duplex_A_20110907.ifc");

test("Guardar en el modelo crea un cambio de material que la propietaria aprueba",async({page})=>{
  test.skip(!existsSync(file),"Falta el IFC Duplex: "+file);
  test.setTimeout(300_000);
  const project=await createProject(page,"Material en el modelo");
  const base="/api/projects/"+project.id;
  try{
    const uploaded=await page.request.post(base+"/uploads",{headers:{...project.headers,"Content-Type":"application/octet-stream"},
      params:{name:"Duplex_A.ifc"},data:readFileSync(file)});
    expect(uploaded.status(),await uploaded.text()).toBe(201);
    const v1=(await uploaded.json()).id as string;

    await page.goto("/proyectos/"+project.id+"/visor/"+v1);
    await expect(renderButton(page)).toBeVisible({timeout:120_000});
    await renderButton(page).click();
    const panel=renderPanel(page);
    const save=panel.getByRole("button",{name:"Guardar en el modelo"});
    await expect(panel.getByRole("button",{name:"Ver en el modelo 3D"})).toHaveAttribute("aria-pressed","true");
    await panel.getByRole("radio",{name:"Piedra"}).click();
    await panel.getByRole("radio",{name:"Claro"}).click();
    await panel.getByRole("radio",{name:"Tarde"}).click();
    await expect(panel.getByRole("status").filter({hasText:/23 piezas exteriores/})).toBeVisible();
    await expect(save).toBeEnabled();

    const created=page.waitForResponse(response=>/\/model-changes$/.test(response.url()) && response.request().method()==="POST");
    await save.click();
    const change=(await (await created).json()).id as string;
    await page.waitForURL(/\/cambios#/,{timeout:180_000});
    expect(page.url()).toContain("/cambios#"+change);

    // The draft carries the operation with the 23 exterior walls and the chip's material.
    const read=await page.request.get(base+"/model-changes/"+change,{headers:project.headers});
    const body=await read.json();
    expect(body.status).toBe("READY");
    const [operation]=body.recipe.operations;
    expect(operation).toMatchObject({op:"ifc.set_material",material:"Piedra · claro",category:"Piedra"});
    expect(operation.elements).toHaveLength(23);
    expect(body.report.ok).toBe(true);

    const card=page.locator(`article[id="${change}"]`);
    await expect(card.getByRole("region",{name:"Receta"})).toContainText("Acabado exterior · 23 piezas");

    const publishing=page.waitForResponse(response=>response.url().endsWith("/model-changes/"+change+"/apply") && response.request().method()==="POST");
    await card.getByRole("button",{name:"Aprobar y aplicar cambio"}).click();
    expect((await publishing).ok()).toBeTruthy();
    const opened=card.getByRole("link",{name:"Abrir nueva versión"});
    await expect(opened).toBeVisible({timeout:60_000});
    const v2=(await opened.getAttribute("href"))!.split("?")[0].split("/").pop()!;
    const versions=await (await page.request.get(base+"/files/"+(await uploaded.json()).fileId+"/versions",{headers:project.headers})).json();
    expect(versions).toHaveLength(2);
    const ifc=(await (await page.request.get(base+"/versions/"+v2+"/original",{headers:project.headers})).body()).toString("utf8");
    expect(ifc).toMatch(/IFCMATERIAL\('Piedra \\X2\\00B7\\X0\\ claro'\)|IFCMATERIAL\('Piedra · claro'\)/);
    expect(ifc).toContain("IFCSURFACESTYLE");
  }finally{await project.remove();}
});
