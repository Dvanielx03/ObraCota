import {expect,test} from "@playwright/test";
import {existsSync,readFileSync,statSync} from "node:fs";
import {resolve} from "node:path";
import {backendReady} from "./support/backend";
import {editButton,selectionPanel} from "./support/editar-prisma";
import {createProject,renderButton} from "./support/opciones-visuales";

/**
 * A large IFC takes «Proponer cambio al modelo»: the IFC engine verifies properties and materials entity by entity, without
 * meshing the model, up to the upload limit (ENGINE_DATA_PREVIEW_MAX_BYTES, 256 MiB); only changes of geometry keep the
 * 32 MiB limit. With the real backend and engine (AGENT_PROVIDER=fake, no AI):
 *   1. as-planned.ifc of Schependomlaan (65 MB, IFC2X3; BIG_IFC to point elsewhere), uploaded by API to a throwaway project;
 *   2. its first door chosen in the viewer, marked in Editar with «Cambiar FireRating a EI 60» and sent with «Proponer
 *      cambio al modelo» (the click may land on the wall in front of the door: only that GlobalId is swapped for the door's,
 *      as in design-agent.spec.ts);
 *   3. the agent's draft is READY with a verified preview by entities (diff.method) and is approved on its card;
 *   4. version 2 has Pset_DoorCommon.FireRating = «EI 60» on that door, read back from the engine.
 * The time from the click to READY and from the approval to version 2 is logged and bounded (GRANDE_READY_S, 150 s by
 * default: the engine's deadline). ReStage (190 MB, RESTAGE_IFC) runs the same case only with GRANDE_RESTAGE=1: it is the
 * slow timing check.
 */
const repo=resolve(__dirname,"..","..");
const MODELS=[
  {key:"Schependomlaan",file:process.env.BIG_IFC??resolve(repo,"landing/modelos-fuente/schependomlaan/as-planned.ifc"),on:true},
  {key:"ReStage",file:process.env.RESTAGE_IFC??resolve(repo,"landing/modelos-fuente/candidatos/restage/Restage_IP_ALL_MULTI_001.ifc"),
    on:process.env.GRANDE_RESTAGE==="1"},
];
const READY_S=Number(process.env.GRANDE_READY_S??"150");

/** GlobalId of the first door in the file. */
function firstDoor(file:string){
  const match=/=\s*IFCDOOR\('([0-9A-Za-z_$]{22})'/.exec(readFileSync(file,"latin1"));
  return match?.[1]??null;
}

test.use({viewport:{width:1366,height:768}});

for(const model of MODELS)test(`Modelo grande · ${model.key}: el agente cambia una propiedad y se aprueba`,async({page},info)=>{
  test.skip(!model.on,"ReStage solo con GRANDE_RESTAGE=1 (prueba lenta de tiempos)");
  test.skip(!existsSync(model.file),"No está "+model.file+": indica BIG_IFC o RESTAGE_IFC");
  test.setTimeout(20*60_000);
  const size=statSync(model.file).size;
  expect(size,"el modelo debe superar el tope de geometría (32 MiB)").toBeGreaterThan(33_554_432);
  const door=firstDoor(model.file);
  expect(door,"el IFC no tiene puertas").not.toBeNull();
  const log=(what:string)=>console.log(model.key+" "+(size/1e6).toFixed(0)+" MB · "+what);
  await backendReady(page.request);
  const project=await createProject(page,"Modelo grande "+model.key);
  const base="/api/projects/"+project.id;
  try{
    const availability=await (await page.request.get(base+"/agent-runs",{headers:project.headers})).json();
    test.skip(availability.provider!=="fake","El backend debe correr con AGENT_PROVIDER=fake: esta prueba nunca llama a Gemini.");
    let start=Date.now();
    const uploaded=await page.request.post(base+"/uploads",{headers:{...project.headers,"Content-Type":"application/octet-stream"},
      params:{name:model.key+".ifc"},data:readFileSync(model.file),timeout:300_000});
    expect(uploaded.status(),await uploaded.text()).toBe(201);
    const {id:v1,fileId}=await uploaded.json() as {id:string;fileId:string};
    log("subida "+(Date.now()-start)+" ms");

    // 1 · the door is the chosen piece; Editar takes it into its selection, frames it and marks its centre.
    start=Date.now();
    await page.goto("/proyectos/"+project.id+"/visor/"+v1+"?element="+door);
    await expect(renderButton(page)).toBeVisible({timeout:600_000});
    log("visor "+(Date.now()-start)+" ms");
    await editButton(page).click();
    await expect(editButton(page)).toHaveAttribute("aria-pressed","true");
    await expect(selectionPanel(page).getByRole("listitem")).toHaveCount(1,{timeout:60_000});
    await selectionPanel(page).getByRole("button",{name:"Encuadrar selección"}).click();
    await page.waitForTimeout(2000);
    const layer=page.locator(".edit-layer");
    const canvas=(await page.locator(".view canvas").boundingBox())!;
    for(const [x,y] of [[.5,.5],[.48,.52],[.52,.48],[.45,.55],[.55,.45]]){
      await page.mouse.click(canvas.x+canvas.width*x,canvas.y+canvas.height*y);
      if(await layer.locator('[data-edit-mark][data-kind="point"]').count())break;
      if(await layer.locator("[data-edit-mark]").count())await page.keyboard.press("Escape");
    }
    const mark=layer.locator('[data-edit-mark][data-kind="point"]');
    await expect(mark).toHaveCount(1);
    const note=layer.getByRole("textbox",{name:"Describe el cambio de la marca 1"});
    // The field opens with the new mark; if the viewer closed it meanwhile, the mark itself opens it again.
    if(await mark.getAttribute("aria-expanded")!=="true")await mark.click();
    await note.fill("Cambiar FireRating a EI 60");

    // 2 · on a model above 32 MiB the agent is available: only changes of geometry keep that limit.
    const propose=layer.getByRole("button",{name:"Proponer cambio al modelo"});
    await expect(propose).not.toHaveAttribute("aria-disabled","true");
    await page.route("**/api/projects/*/agent-runs/stream",async route=>{
      if(route.request().method()!=="POST")return route.fallback();
      const body=route.request().postDataJSON() as {notes:{globalId:string|null}[]};
      return route.continue({postData:JSON.stringify({...body,notes:body.notes.map(item=>({...item,globalId:door}))})});
    });
    start=Date.now();
    await propose.click();
    const panel=page.getByRole("region",{name:"Propuesta del agente"});
    await expect(panel.getByRole("heading",{name:"Borrador listo para tu revisión"})).toBeVisible({timeout:(READY_S+60)*1000});
    const readyMs=Date.now()-start;
    log("propuesta READY en "+readyMs+" ms");
    const changeId=(await panel.getByRole("link",{name:"Abrir la tarjeta del cambio"}).getAttribute("href"))?.split("#").at(1);
    expect(changeId).toMatch(/^[\da-f-]{36}$/);
    const change=await (await page.request.get(base+"/model-changes/"+changeId,{headers:project.headers})).json();
    expect(change).toMatchObject({status:"READY",origin:"AGENT"});
    expect(change.recipe.operations[0]).toMatchObject({op:"ifc.set_property",element:door,property:"FireRating",value:"EI 60"});
    expect(change.report.ok).toBe(true);
    expect(change.report.diff.method,"verificado entidad por entidad").toBe("entities");
    expect(change.report.diff.unexpected).toEqual([]);
    log("motor "+JSON.stringify(change.report.timings_ms));

    // 3 · the owner approves it on its card.
    await page.goto("/proyectos/"+project.id+"/cambios#"+changeId);
    const card=page.locator(`article[id="${changeId}"]`);
    await expect(card.getByText("Lista para aprobar",{exact:true})).toBeVisible({timeout:60_000});
    const publishing=page.waitForResponse(response=>response.url().endsWith("/model-changes/"+changeId+"/apply")
      && response.request().method()==="POST",{timeout:(READY_S+60)*1000});
    start=Date.now();
    await card.getByRole("button",{name:"Aprobar y aplicar cambio"}).click();
    expect((await publishing).ok()).toBeTruthy();
    const opened=card.getByRole("link",{name:"Abrir nueva versión"});
    await expect(opened).toBeVisible({timeout:120_000});
    const applyMs=Date.now()-start;
    log("aprobada en "+applyMs+" ms");
    const v2=(await opened.getAttribute("href"))!.split("?")[0].split("/").pop()!;
    const versions=await (await page.request.get(base+"/files/"+fileId+"/versions",{headers:project.headers})).json();
    expect(versions).toHaveLength(2);

    // 4 · version 2 holds the property on that door, as the engine reads it back.
    const element=await page.request.get(base+"/versions/"+v2+"/elements/"+door,{headers:project.headers,timeout:120_000});
    expect(element.status(),await element.text()).toBe(200);
    const psets=(await element.json()).psets as {name:string;source:string;properties:{name:string;value:unknown}[]}[];
    const fire=psets.filter(set=>set.name==="Pset_DoorCommon").flatMap(set=>set.properties).find(prop=>prop.name==="FireRating");
    expect(JSON.stringify(fire?.value)).toContain("EI 60");
    info.annotations.push({type:"tiempos",description:`${model.key} ${(size/1e6).toFixed(0)} MB: READY ${readyMs} ms, aprobada ${applyMs} ms`});
    expect(readyMs,"la propuesta debe quedar lista antes del plazo del motor").toBeLessThan(READY_S*1000);
  }finally{await project.remove();}
});
