import {expect,test,type Page} from "@playwright/test";
import {mkdirSync} from "node:fs";
import {basename,resolve} from "node:path";
import {editButton} from "./support/editar-prisma";
import {createProject,renderButton,renderPanel,sendButton} from "./support/opciones-visuales";
import {backendReady} from "./support/backend";

/**
 * «Revisión DXF real»: Editar, Renderizar and the design agent on a 2D DWG plan, with the real backend, the real engine
 * (LibreDWG converts the DWG to DXF, ezdxf applies the change, both read the revision back) and PostgreSQL. The backend
 * runs with AGENT_PROVIDER=fake: a scripted agent without AI reads the marked entity, drafts one dwg.* operation,
 * previews and submits it. Publishing is the owner's click: the approved revision is a new DXF version of the same
 * file, opened in the viewer next to the original.
 *
 * Only the four Autodesk samples of docs/mvp/modelos-nuevos-26-11/dwg are used (never the files of earlier suites).
 * Screenshots go to docs/auditoria-manual/evidencia/dwg-revision.
 */
const SAMPLES=resolve(__dirname,"../../docs/mvp/modelos-nuevos-26-11/dwg");
const EVIDENCE=resolve(__dirname,"../../docs/auditoria-manual/evidencia/dwg-revision");
const ARCHITECTURAL=resolve(SAMPLES,"architectural_-_annotation_scaling_and_multileaders.dwg");
const BLOCKS=resolve(SAMPLES,"blocks_and_tables_-_metric.dwg");
const ALL=["architectural_-_annotation_scaling_and_multileaders.dwg","architectural_example-imperial.dwg",
  "blocks_and_tables_-_metric.dwg","civil_example-imperial.dwg"];

test.use({viewport:{width:1440,height:900}});
test.beforeAll(()=>mkdirSync(EVIDENCE,{recursive:true}));

const shot=(page:Page,name:string)=>page.screenshot({path:resolve(EVIDENCE,name)});
const search=(page:Page)=>page.getByRole("searchbox",{name:"Buscar elemento"});
const entries=(page:Page)=>page.locator("#explorer .entry");
/** The plan on screen, after the entry hold of the workspace (the canvas is hidden until then). */
const planReady=async(page:Page)=>{
  await expect(page.getByRole("region",{name:"Mesa de planos"})).toBeVisible({timeout:120_000});
  await expect(page.locator(".view[data-ready]")).toBeVisible({timeout:120_000});
};

/** Uploads a DWG through «Archivos» and opens version 1 on the plan table. */
async function openPlan(page:Page,project:string,file:string){
  await page.goto("/proyectos/"+project+"/archivos");
  await page.getByTestId("model-upload").setInputFiles(file);
  await page.getByRole("button",{name:"Guardar versión"}).click();
  await page.getByRole("link",{name:"Abrir versión 1 en el visor"}).click();
  await planReady(page);
  await expect(renderButton(page)).toBeVisible({timeout:120_000});
}

/** Finds a text in «Lectura», selects it (the plan frames it) and answers where its marker sits on screen. */
async function pickText(page:Page,text:string){
  await page.getByRole("tab",{name:"Lectura"}).click();
  await search(page).fill(text);
  await expect(entries(page)).toHaveCount(1);
  await entries(page).first().click();
  const marker=page.locator(".note-marker");
  await expect(marker).toBeVisible();
  await page.waitForTimeout(600);
  const box=(await marker.boundingBox())!;
  return {x:box.x+box.width/2,y:box.y+box.height/2};
}

/** Marks the entity under `at` in Editar, writes the note and asks the agent; answers the change id and the body sent. */
async function propose(page:Page,at:{x:number;y:number},note:string){
  await editButton(page).click();
  await expect(editButton(page)).toHaveAttribute("aria-pressed","true");
  const layer=page.locator(".edit-layer");
  await page.mouse.click(at.x,at.y);
  await expect(layer.locator('[data-edit-mark][data-kind="point"]')).toHaveCount(1);
  const field=layer.getByRole("textbox",{name:"Describe el cambio de la marca 1"});
  await field.fill(note);
  const button=layer.getByRole("button",{name:"Proponer cambio al modelo"});
  await expect(button).not.toHaveAttribute("aria-disabled","true");
  const sent=page.waitForRequest(request=>request.url().endsWith("/agent-runs/stream") && request.method()==="POST");
  await button.click();
  const body=(await sent).postDataJSON() as {version:string;notes:{globalId:string|null;name:string|null;text:string}[]};
  const panel=page.getByRole("region",{name:"Propuesta del agente"});
  await expect(panel.getByRole("heading",{name:"Borrador listo para tu revisión"})).toBeVisible({timeout:180_000});
  const steps=panel.getByRole("list",{name:"Pasos del agente"}).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toContainText("Leer la entidad marcada del plano");
  await expect(steps.nth(1)).toContainText("Cambiar el plano en el borrador");
  await expect(steps.nth(2)).toContainText("Verificar la vista previa");
  await expect(steps.nth(3)).toContainText("Enviar a tu aprobación");
  const href=await panel.getByRole("link",{name:"Abrir la tarjeta del cambio"}).getAttribute("href");
  return {panel,change:href!.split("#")[1],body};
}

/** Approves the change on its card (the owner's click) and opens the published revision. */
async function approve(page:Page,project:string,change:string){
  await page.goto("/proyectos/"+project+"/cambios#"+change);
  const card=page.locator(`article[id="${change}"]`);
  await expect(card.getByText("Lista para aprobar",{exact:true})).toBeVisible({timeout:60_000});
  await card.getByRole("button",{name:"Aprobar y aplicar cambio"}).click();
  await expect(card.getByText("Aplicada",{exact:true})).toBeVisible({timeout:120_000});
  return card;
}

test("Los cuatro DWG de Autodesk abren en el visor como plano",async({page})=>{
  test.setTimeout(300_000);
  await page.goto("/proyectos/restage/visor");
  for(const name of ALL){
    await page.locator("input[type=file]").setInputFiles(resolve(SAMPLES,name));
    await expect(page.locator(".project")).toHaveText(name,{timeout:120_000});
    await expect(page.getByRole("region",{name:"Mesa de planos"})).toBeVisible();
    await expect(page.locator(".feedback[data-kind=error]")).toHaveCount(0);
    await expect(page.locator(".view[data-ready]")).toBeVisible({timeout:60_000});
    // Editar and Renderizar are on a plan too (Renderizar asks for a saved version; this one is a local file).
    await expect(editButton(page)).not.toHaveAttribute("aria-disabled","true");
    await expect(renderButton(page)).toBeVisible();
    await page.getByRole("button",{name:"Restablecer cámara"}).click();
    await page.waitForTimeout(400);
    await shot(page,"abre-"+basename(name,".dwg")+".png");
  }
});

test("Texto de un plano DWG: Editar, Proponer cambio, aprobar y abrir la revisión DXF",async({page})=>{
  test.setTimeout(420_000);
  await backendReady(page.request);
  const outside:string[]=[];
  page.on("request",request=>{if(/googleapis\.com/.test(request.url()))outside.push(request.url());});
  const project=await createProject(page,"Revisión DXF · texto");
  const api="/api/projects/"+project.id;
  try{
    const availability=await (await page.request.get(api+"/agent-runs",{headers:project.headers})).json();
    test.skip(availability.provider!=="fake","El backend debe correr con AGENT_PROVIDER=fake: esta prueba nunca llama a Gemini.");
    await openPlan(page,project.id,ARCHITECTURAL);
    const v1=page.url().split("/visor/")[1].split("?")[0];
    await expect(page.locator(".workspace .stage")).toBeVisible();
    await shot(page,"01-plano-abierto.png");

    // 1 · Renderizar is enabled on the plan and a request is accepted (Cloudflare Workers AI, free quota).
    await expect(renderButton(page)).not.toHaveAttribute("aria-disabled","true");
    await renderButton(page).click();
    const dialog=renderPanel(page);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Cambio solicitado").fill("Presentación limpia del plano en tinta sobre papel blanco");
    const send=sendButton(dialog);
    const history=await (await page.request.get(api+"/versions/"+v1+"/options?element=vista",{headers:project.headers})).json().catch(()=>null);
    if(history?.available){
      await expect(send).toBeEnabled();
      const posted=page.waitForResponse(response=>/\/options(?:[/?]|$)/.test(response.url()) && response.request().method()==="POST",{timeout:60_000});
      await send.click();
      const response=await posted;
      expect(response.status(),await response.text()).toBeLessThan(300);
      const request=response.request().postDataJSON();
      expect(request.jpeg.length).toBeGreaterThan(1000);
    }else{
      await expect(send).toBeDisabled();
    }
    await shot(page,"02-renderizar-plano.png");
    await page.keyboard.press("Escape");

    // 2 · a text of the plan, marked in Editar, with the note for the agent.
    const at=await pickText(page,"TOP OF SECOND");
    await page.getByRole("tab",{name:"Propiedades"}).click();
    const handle=(await page.locator(".inspector dt").filter({hasText:"Handle CAD"}).locator("+ dd").innerText()).trim();
    expect(handle).toMatch(/^[0-9A-F]{1,16}$/);
    const {panel,change,body}=await propose(page,at,"Cambiar texto a REVISADO OBRA");
    expect(body.version).toBe(v1);
    expect(body.notes).toEqual([expect.objectContaining({globalId:handle,text:"Cambiar texto a REVISADO OBRA"})]);
    await expect(panel).toContainText("Agente de prueba: sin IA y sin costo.");
    await shot(page,"03-agente-listo.png");

    // 3 · the card: READY, dwg.set_text in words, nothing published yet.
    const draft=await (await page.request.get(api+"/model-changes/"+change,{headers:project.headers})).json();
    expect(draft).toMatchObject({status:"READY",origin:"AGENT",format:"DWG"});
    expect(draft.recipe.operations[0]).toMatchObject({op:"dwg.set_text",element:handle,text:"REVISADO OBRA"});
    expect(draft.report.ok).toBe(true);
    // The unpublished proposal opens on the plan with the new text, before anything is published.
    await page.goto("/proyectos/"+project.id+"/cambios#"+change);
    await page.locator(`article[id="${change}"]`).getByRole("link",{name:"Ver propuesta en el plano"}).click();
    await planReady(page);
    await expect(page.locator(".stagebar small")).toHaveText("DXF");
    await page.getByRole("tab",{name:"Lectura"}).click();
    await search(page).fill("REVISADO OBRA");
    await expect(entries(page)).toHaveCount(1);
    await entries(page).first().click();
    await page.waitForTimeout(600);
    await shot(page,"04a-propuesta-en-el-plano.png");
    const card=await approve(page,project.id,change);
    await expect(card.getByRole("region",{name:"Receta"})).toContainText("«REVISADO OBRA»");
    await shot(page,"04-cambio-aplicado.png");

    // 4 · the published revision is a DXF of the same file; it opens and shows the new text.
    const applied=await (await page.request.get(api+"/model-changes/"+change,{headers:project.headers})).json();
    const v2=applied.appliedVersion as string;
    const version=await (await page.request.get(api+"/versions/"+v2,{headers:project.headers})).json();
    expect(version).toMatchObject({format:"DXF",revision:2,name:"architectural_-_annotation_scaling_and_multileaders-r2.dxf"});
    await card.getByRole("link",{name:"Abrir nueva versión"}).click();
    await planReady(page);
    await expect(page.locator(".stagebar small")).toHaveText("DXF");
    await expect(page.locator(".inspector strong")).toHaveText("REVISADO OBRA",{timeout:60_000});
    await page.getByRole("tab",{name:"Lectura"}).click();
    await search(page).fill("REVISADO OBRA");
    await expect(entries(page)).toHaveCount(1);
    await search(page).fill("TOP OF SECOND");
    await expect(entries(page)).toHaveCount(0);
    await search(page).fill("REVISADO OBRA");
    await entries(page).first().click();
    await page.waitForTimeout(600);
    await shot(page,"05-revision-dxf-texto-nuevo.png");

    // 5 · the original keeps the old text.
    await page.goto("/proyectos/"+project.id+"/visor/"+v1);
    await planReady(page);
    await page.getByRole("tab",{name:"Lectura"}).click();
    await search(page).fill("REVISADO OBRA");
    await expect(entries(page)).toHaveCount(0);
    await search(page).fill("TOP OF SECOND");
    await expect(entries(page)).toHaveCount(1);
    await entries(page).first().click();
    await page.waitForTimeout(600);
    await shot(page,"06-original-texto-anterior.png");
    expect(outside).toEqual([]);
  }finally{await project.remove();}
});

test("Mover y anotar en otro DWG: dos revisiones DXF seguidas",async({page})=>{
  test.setTimeout(420_000);
  await backendReady(page.request);
  const project=await createProject(page,"Revisión DXF · mover y nota");
  const api="/api/projects/"+project.id;
  try{
    const availability=await (await page.request.get(api+"/agent-runs",{headers:project.headers})).json();
    test.skip(availability.provider!=="fake","El backend debe correr con AGENT_PROVIDER=fake: esta prueba nunca llama a Gemini.");
    await openPlan(page,project.id,BLOCKS);
    const insertion=async()=>(await page.locator(".inspector dt").filter({hasText:"Inserción del texto"}).locator("+ dd").innerText());
    const at=await pickText(page,"LIVING ROOM HRWD FLOOR");
    await page.getByRole("tab",{name:"Propiedades"}).click();
    const before=await insertion();
    const moved=await propose(page,at,"Mover 500 mm a la derecha");
    const first=await (await page.request.get(api+"/model-changes/"+moved.change,{headers:project.headers})).json();
    expect(first.recipe.operations[0]).toMatchObject({op:"dwg.move",dx:500,dy:0,unit:"mm"});
    await shot(page,"07-mover-listo.png");
    const card=await approve(page,project.id,moved.change);
    await expect(card.getByRole("region",{name:"Receta"})).toContainText("500 mm a la derecha");
    await card.getByRole("link",{name:"Abrir nueva versión"}).click();
    await planReady(page);
    await expect(page.locator(".stagebar small")).toHaveText("DXF");
    await page.getByRole("tab",{name:"Propiedades"}).click();
    // The drawing is in metres: the text moved 0,5 to the right.
    const xOf=(text:string)=>parseFloat(text.match(/X ([-\d,]+)/)![1].replace(",","."));
    await expect.poll(async()=>xOf(await insertion())-xOf(before)).toBeCloseTo(.5,4);
    await shot(page,"08-revision-movida.png");

    // A second change works on the DXF revision: a note with its revision cloud.
    const v2=page.url().split("/visor/")[1].split("?")[0];
    const at2=await pickText(page,"LIVING ROOM HRWD FLOOR");
    const noted=await propose(page,at2,"Agregar nota: Verificar en obra");
    expect(noted.body.version).toBe(v2);
    const second=await (await page.request.get(api+"/model-changes/"+noted.change,{headers:project.headers})).json();
    expect(second).toMatchObject({format:"DXF"});
    expect(second.recipe.operations[0]).toMatchObject({op:"dwg.add_note",text:"Verificar en obra"});
    await approve(page,project.id,noted.change);
    const applied=await (await page.request.get(api+"/model-changes/"+noted.change,{headers:project.headers})).json();
    const v3=await (await page.request.get(api+"/versions/"+applied.appliedVersion,{headers:project.headers})).json();
    expect(v3).toMatchObject({format:"DXF",revision:3,name:"blocks_and_tables_-_metric-r3.dxf"});
    await page.goto("/proyectos/"+project.id+"/visor/"+applied.appliedVersion);
    await planReady(page);
    await page.getByRole("tab",{name:"Lectura"}).click();
    await search(page).fill("Verificar en obra");
    await expect(entries(page)).toHaveCount(1);
    await entries(page).first().click();
    await page.getByRole("tab",{name:"Propiedades"}).click();
    await expect(page.locator(".inspector dd").filter({hasText:"OBRACOTA-REVISION"})).toHaveCount(1);
    await page.waitForTimeout(600);
    await shot(page,"09-nota-de-revision.png");
  }finally{await project.remove();}
});
