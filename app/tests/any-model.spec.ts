import {expect,test,type Page} from "@playwright/test";
import {existsSync,readFileSync,statSync} from "node:fs";
import {basename} from "node:path";
import {MODEL_ONLY} from "./support/visor";
import {createProject,openFirstVersion,renderButton,renderPanel} from "./support/opciones-visuales";
import {editBar,editButton} from "./support/editar-prisma";
import {png} from "./support/png";

/**
 * Lo implementado funciona en cualquier modelo 3D de los motores disponibles (IFC con web-ifc, DWG 3D con sus sólidos
 * ACIS teselados en el servidor, FBX y OBJ). Tres modelos distintos y extensos, uno por variable:
 *   MODEL_A  ReStage (IFC4, Bonsai/cadwork, 181 MB)       landing/modelos-fuente/candidatos/restage/Restage_IP_ALL_MULTI_001.ifc
 *   MODEL_B  Torre del Rame (IFC2x3, Edificius, 19 MB)    landing/modelos-fuente/candidatos/torre-rame/Rame_Tower.ifc
 *   MODEL_C  un modelo 3D que no es IFC (DWG 3D, FBX u OBJ), p. ej. BIMobject «Jalis Sofa/Jalis.dwg»
 * Cada uno se sube por el formulario de Archivos de una cuenta nueva y se abre en el visor. Después:
 *   1. Renderizar › Ver en el modelo 3D: Piedra · Claro · Tarde cambia piezas exteriores (> 0) y el lienzo; Restablecer
 *      lo deja como estaba.
 *   2. Editar › Escena › Presentación al cliente › «Recorrer esta escena en 3D»: la escena rodea el modelo, el recorrido
 *      empieza sobre el suelo de la escena, se camina y el visor de panorama abre una imagen de prueba sin usar cuota.
 *   3. Con la escena y un acabado, una captura por modelo en los resultados de la prueba.
 *   4. Editar: una marca sobre una pieza. En un IFC, «Proponer cambio al modelo» con el agente de prueba (fake) deja un
 *      cambio READY que se aprueba (versión 2) y «Guardar en el modelo» crea el cambio de material, a cualquier tamaño
 *      (propiedades y materiales se verifican entidad por entidad hasta 256 MiB). En un DWG o DXF «Proponer cambio al
 *      modelo» queda disponible (revisiones dwg.*; aquí no se ejecuta: la nota FireRating no es un cambio de plano) y
 *      «Guardar en el modelo» explica por qué no aplica; en FBX u OBJ los dos botones lo explican.
 * Las tareas largas del hilo principal (PerformanceObserver «longtask») se miden por fase y se adjuntan al informe.
 */
const MODELS=(["MODEL_A","MODEL_B","MODEL_C"] as const).map(key=>({key,file:process.env[key]??""}));
const hidden={style:MODEL_ONLY+".scene-walk,.edit-dock,.edit-popover,.tool-popover,.marks-layer,.edit-layer{visibility:hidden!important}"};

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

/** Mayor tarea larga (ms) del hilo principal desde `since` (performance.now() de la página). */
const longest=(page:Page,since:number)=>page.evaluate(from=>Math.round(Math.max(0,...((window as unknown as {__long:{start:number;duration:number}[]}).__long??[])
  .filter(task=>task.start>=from).map(task=>task.duration))),since);
const now=(page:Page)=>page.evaluate(()=>performance.now());
const t0=Date.now();
/** Progreso en la consola de la prueba (los modelos grandes tardan minutos). */
const log=(key:string,what:string)=>console.log(key+" +"+Math.round((Date.now()-t0)/1000)+"s "+what);

/** GlobalId de la primera puerta del IFC (o, sin puertas, del primer muro): la pieza que el agente de prueba cambia. */
function doorOrWall(file:string){
  const text=readFileSync(file,"latin1");
  for(const type of ["IFCDOOR","IFCWALLSTANDARDCASE","IFCWALL"]){
    const match=new RegExp("=\\s*"+type+"\\('([0-9A-Za-z_$]{22})'").exec(text);
    if(match)return {guid:match[1],type};
  }
  return null;
}

test.use({viewport:{width:1366,height:768},screenshot:"only-on-failure"});

for(const model of MODELS)test(`Cualquier modelo · ${model.key} · ${basename(model.file)||"sin archivo"}`,async({page},info)=>{
  test.skip(!model.file || !existsSync(model.file),"Indica "+model.key+" con un modelo 3D");
  test.setTimeout(45*60_000);
  const ifc=/\.ifc$/i.test(model.file);
  // The agent and «Guardar en el modelo» draft properties and materials, which the IFC engine verifies entity by entity up to
  // the upload limit (ENGINE_DATA_PREVIEW_MAX_BYTES, 256 MiB): every IFC takes them, ReStage (190 MB) included.
  const changeable=ifc;
  const timings:Record<string,number|string>={size:(statSync(model.file).size/1e6).toFixed(1)+" MB"};
  await page.addInitScript(()=>{
    const store:{start:number;duration:number}[]=[];
    (window as unknown as {__long:typeof store}).__long=store;
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries())store.push({start:entry.startTime,duration:entry.duration});}).observe({type:"longtask",buffered:true});}catch{/* sin longtask */}
  });
  if(process.env.ANY_DEBUG){
    page.on("console",message=>{if(message.type()!=="log"||/obracota|walk|Error/i.test(message.text()))log(model.key,"consola "+message.type()+": "+message.text().slice(0,300));});
    page.on("pageerror",error=>log(model.key,"error de página: "+error.message.slice(0,300)));
    page.on("crash",()=>log(model.key,"la pestaña se cerró (crash)"));
  }
  const project=await createProject(page,"Cualquier modelo "+model.key);
  const base="/api/projects/"+project.id;
  try{
    // 0 · Subida por el formulario y apertura en el visor.
    let start=Date.now();
    await openFirstVersion(page,project.id,model.file,basename(model.file),20*60_000);
    timings.openMs=Date.now()-start;
    const canvas=page.locator(".view canvas"),stage=page.locator(".stage");
    await page.waitForTimeout(2000);
    const neutral=await canvas.screenshot(hidden);
    const [file]=await (await page.request.get(base+"/files",{headers:project.headers})).json();
    const [v1]=await (await page.request.get(base+"/files/"+file.id+"/versions",{headers:project.headers})).json();

    log(model.key,"1 renderizar");
    // 1 · Renderizar › Ver en el modelo 3D.
    let from=await now(page);start=Date.now();
    await renderButton(page).click();
    const panel=renderPanel(page);
    await expect(panel.getByRole("button",{name:"Ver en el modelo 3D"})).toHaveAttribute("aria-pressed","true");
    await panel.getByRole("radio",{name:"Piedra"}).click();
    await panel.getByRole("radio",{name:"Claro"}).click();
    await panel.getByRole("radio",{name:"Tarde"}).click();
    const status=panel.getByRole("status").filter({hasText:/piezas? exteriores?|No se encontraron/});
    await expect(status).toBeVisible({timeout:60_000});
    const said=await status.innerText();
    timings.exterior=said;
    const pieces=Number(/Acabado en (\d+)/.exec(said)?.[1]??0);
    expect(pieces,said).toBeGreaterThan(0);
    timings.exteriorMs=Date.now()-start;
    timings.shellMs=await page.evaluate(()=>Math.round(performance.getEntriesByName("obracota:exterior-shell").at(-1)?.duration??-1));
    await expect.poll(async()=>difference(page,neutral,await canvas.screenshot(hidden)),{timeout:30_000}).toBeGreaterThan(.01);
    timings.exteriorLongTaskMs=await longest(page,from);
    // In an IFC, «Guardar en el modelo» names the same pieces; elsewhere it says why it cannot.
    const save=panel.getByRole("button",{name:"Guardar en el modelo"});
    if(changeable && pieces<=500)await expect(save).toBeEnabled();
    else{
      await expect(save).toBeDisabled();
      timings.saveReason=(await save.getAttribute("title"))??"";
      if(!ifc)expect(timings.saveReason).toContain("Solo un IFC guarda materiales");
    }
    await panel.getByRole("button",{name:"Restablecer materiales"}).click();
    await expect.poll(async()=>difference(page,neutral,await canvas.screenshot(hidden)),{timeout:15_000}).toBeLessThan(.01);
    await renderButton(page).click();
    await expect(panel).toHaveCount(0);

    log(model.key,"2 escena");
    // 2 · Editar › Escena › «Recorrer esta escena en 3D», el recorrido y el panorama 360°.
    from=await now(page);start=Date.now();
    await editButton(page).click();
    await editBar(page).getByRole("button",{name:"Escena",exact:true}).click();
    const card=page.getByRole("dialog",{name:"Escena"});
    await card.getByRole("button",{name:"Presentación al cliente"}).click();
    await card.getByRole("button",{name:"Recorrer esta escena en 3D"}).click();
    log(model.key,"2a recorrer pulsado");
    await expect(stage).toHaveAttribute("data-environment","afternoon clear - city photo");
    await expect(page.locator("main")).toHaveAttribute("data-walk","on");
    timings.sceneMs=Date.now()-start;
    log(model.key,"2b escena puesta");
    // The walk starts on the scene's ground: Enter takes the point under the centre; if that is not a free floor,
    // a point low on the canvas (the ground in front of the model) is tried.
    const hint=page.locator(".walk-hint");
    await expect(hint).toContainText("Elige un punto libre en el piso");
    const box=(await canvas.boundingBox())!;
    let walking=false;
    log(model.key,"2c buscando piso");
    // Enter takes the point under the centre (as fbx-obj.spec); then points of the canvas clear of the bars.
    for(const [x,y] of [[0,0],[.5,.62],[.3,.62],[.7,.62],[.2,.45],[.8,.45]]){
      if(!x){await canvas.focus();await page.keyboard.press("Enter");}
      else await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
      log(model.key,"clic piso "+x+","+y);
      try{await expect(hint).toContainText("WASD o flechas para caminar",{timeout:8_000});walking=true;break;}catch{/* otro punto */}
      if(process.env.ANY_DEBUG){log(model.key,"medidas: "+await page.evaluate(()=>performance.getEntriesByType("measure").map(e=>e.name+"="+Math.round(e.duration)).join(" ")).catch(()=>"?"));log(model.key,"pista: "+await hint.innerText({timeout:5_000}).catch(()=>"?"));await page.screenshot({path:info.outputPath("piso-"+x+"-"+y+".png"),timeout:10_000}).catch(()=>log(model.key,"sin captura"));}
    }
    timings.walk=walking?"camina":"sin punto de piso: "+(await hint.innerText());
    expect(walking,String(timings.walk)).toBe(true);
    await page.keyboard.down("w");await page.waitForTimeout(600);await page.keyboard.up("w");
    await expect(hint).not.toHaveAttribute("data-tone","error");
    timings.walkLongTaskMs=await longest(page,from);
    timings.walkIndex=await page.evaluate(()=>{const m=performance.getEntriesByName("obracota:walk-index").at(-1) as PerformanceMeasure|undefined;return m?Math.round(m.duration)+" ms "+JSON.stringify(m.detail):"-";});
    timings.longTasks=await page.evaluate(from=>((window as unknown as {__long:{start:number;duration:number}[]}).__long??[]).filter(t=>t.start>=from && t.duration>1000).map(t=>Math.round(t.duration)).join(","),from);
    log(model.key,"2d caminado");
    const bar=page.getByRole("group",{name:"Escena en 3D"});
    await page.route("**/api/projects/*/versions/*/options/panorama",route=>
      route.fulfill({contentType:"image/png",body:png(64,32,[173,148,107])}));
    start=Date.now();
    await bar.getByRole("button",{name:"Panorama 360° con IA"}).click();
    log(model.key,"panorama");
    const panorama=page.getByRole("dialog",{name:"Panorama 360° con IA"});
    await expect(panorama).toBeVisible({timeout:180_000});
    await expect(panorama.locator(".panorama-view")).toHaveAttribute("data-state","ready",{timeout:180_000});
    timings.panoramaMs=Date.now()-start;
    await page.screenshot({path:info.outputPath("panorama.png")});
    await page.keyboard.press("Escape");
    await expect(panorama).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("main")).not.toHaveAttribute("data-walk",/.+/);
    await expect(stage).toHaveAttribute("data-environment","afternoon clear - city photo");

    log(model.key,"3 captura");
    // 3 · The scene and a finish together: one picture per model.
    if(await editButton(page).getAttribute("aria-pressed")==="true")await editButton(page).click();
    await renderButton(page).click();
    await panel.getByRole("radio",{name:"Madera"}).click();
    await expect(panel.getByRole("status").filter({hasText:/piezas? exteriores?/})).toBeVisible({timeout:60_000});
    await page.waitForTimeout(2500);
    await page.screenshot({path:info.outputPath(model.key.toLowerCase()+"-"+basename(model.file).replace(/\.[^.]+$/,"").replace(/[^\w-]+/g,"_")+".png"),
      style:".tool-popover,.workspace-toast{visibility:hidden!important}"});
    await panel.getByRole("button",{name:"Restablecer materiales"}).click();
    await renderButton(page).click();
    await bar.getByRole("button",{name:"Restablecer"}).click();
    await expect(stage).not.toHaveAttribute("data-environment",/.+/);

    log(model.key,"4 marca");
    // 4 · Editar: a mark on a piece; the agent in an IFC, its reason elsewhere.
    await editButton(page).click();
    await expect(editButton(page)).toHaveAttribute("aria-pressed","true");
    const layer=page.locator(".edit-layer");
    for(const [x,y] of [[.5,.5],[.45,.55],[.55,.45],[.4,.4],[.6,.6]]){
      await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
      if(await layer.locator('[data-edit-mark][data-kind="point"]').count())break;
      if(await layer.locator("[data-edit-mark]").count())await page.keyboard.press("Escape");
    }
    await expect(layer.locator('[data-edit-mark][data-kind="point"]')).toHaveCount(1);
    const note=layer.getByRole("textbox",{name:"Describe el cambio de la marca 1"});
    await note.fill("Cambiar FireRating a EI 60");
    const propose=layer.getByRole("button",{name:"Proponer cambio al modelo"});
    if(/\.(dwg|dxf)$/i.test(model.file)){
      // A drawing takes the agent (dwg.* revisions as DXF): the format never turns the button off. The fake agent's FireRating
      // note is NO_CHANGE on a plan, so it is not run here: dwg-revision.spec.ts covers the drawing's revision. A mark on a
      // 3D solid without a DWG handle (Jalis) keeps it off only for the missing identifier, which the title says.
      const title=(await propose.getAttribute("title"))??"";
      expect(title).not.toContain("solo modelos IFC");
      if(await propose.getAttribute("aria-disabled")==="true")expect(title).toContain("identificador");
      timings.agent=(await propose.getAttribute("aria-disabled")==="true"?"sin identificador · ":"disponible · ")+title;
      return;
    }
    if(!changeable){
      await expect(propose).toHaveAttribute("aria-disabled","true");
      timings.agent=(await propose.getAttribute("title"))??"";
      expect(timings.agent).toContain("solo modelos IFC");
      return;
    }
    const availability=await (await page.request.get(base+"/agent-runs",{headers:project.headers})).json();
    expect(availability.provider,"el backend debe correr con AGENT_PROVIDER=fake").toBe("fake");
    const piece=doorOrWall(model.file);
    expect(piece,"el IFC no tiene puertas ni muros").not.toBeNull();
    // The mark keeps the clicked piece's GlobalId; only that GlobalId is swapped for a door's (or a wall's), as in design-agent.spec.
    await page.route("**/api/projects/*/agent-runs/stream",async route=>{
      if(route.request().method()!=="POST")return route.fallback();
      const body=route.request().postDataJSON();
      return route.continue({postData:JSON.stringify({...body,notes:body.notes.map((n:object)=>({...n,globalId:piece!.guid}))})});
    });
    await expect(propose).not.toHaveAttribute("aria-disabled","true");
    start=Date.now();
    await propose.click();
    const run=page.getByRole("region",{name:"Propuesta del agente"});
    await expect(run).toHaveAttribute("data-status","READY",{timeout:240_000});
    const openChange=run.getByRole("link",{name:"Abrir la tarjeta del cambio"});
    const changeHref=await openChange.getAttribute("href");
    expect(changeHref).toMatch(/\/cambios#[0-9a-f-]+$/i);
    const agentChange=changeHref!.split("#")[1];
    timings.agentMs=Date.now()-start;
    timings.agent="READY · "+piece!.type;

    log(model.key,"5 guardar");
    // «Guardar en el modelo» with the same finish: a READY material change (≤ 500 exterior pieces).
    await page.unroute("**/api/projects/*/agent-runs/stream");
    await editButton(page).click();
    await renderButton(page).click();
    await panel.getByRole("radio",{name:"Piedra"}).click();
    const shown=panel.getByRole("status").filter({hasText:/piezas? exteriores?/});
    await expect(shown).toBeVisible({timeout:60_000});
    const count=Number(/Acabado en (\d+)/.exec(await shown.innerText())?.[1]??0);
    if(count<=500){
      start=Date.now();
      const created=page.waitForResponse(response=>/\/model-changes$/.test(response.url()) && response.request().method()==="POST");
      await save.click();
      const material=(await (await created).json()).id as string;
      // Either the engine verifies it (READY, the card opens) or it says clearly why not (its deadline on a heavy model).
      const refused=panel.getByRole("status").filter({hasText:/plazo|no se pudo|motor/i});
      await Promise.race([page.waitForURL(/\/cambios#/,{timeout:10*60_000}).catch(()=>undefined),refused.waitFor({timeout:10*60_000}).catch(()=>undefined)]);
      // A material change no longer re-meshes heavy booleans (measured once, without openings): it must verify.
      expect(/\/cambios#/.test(page.url()),"el cambio de material no llegó a READY: "+(await refused.allInnerTexts()).join(" | ")).toBe(true);
      const body=await (await page.request.get(base+"/model-changes/"+material,{headers:project.headers})).json();
      timings.materialMs=Date.now()-start;
      if(/\/cambios#/.test(page.url())){
        timings.material=body.status+" · "+body.recipe.operations[0]?.elements?.length+" piezas";
        expect(body.status,JSON.stringify(body.report)).toBe("READY");
      }else timings.material="sin verificar · "+body.recipe.operations[0]?.elements?.length+" piezas · "+await refused.innerText();
    }else timings.material="más de 500 piezas: "+await save.getAttribute("title");

    log(model.key,"6 aprobar");
    // The agent's change is approved by the owner: version 2.
    await page.goto(changeHref!);
    const changeCard=page.locator(`article[id="${agentChange}"]`);
    await expect(changeCard.getByText("Lista para aprobar",{exact:true})).toBeVisible({timeout:120_000});
    start=Date.now();
    await changeCard.getByRole("button",{name:"Aprobar y aplicar cambio"}).click();
    await expect(changeCard.getByRole("link",{name:"Abrir nueva versión"})).toBeVisible({timeout:20*60_000});
    timings.approveMs=Date.now()-start;
    const versions=await (await page.request.get(base+"/files/"+file.id+"/versions",{headers:project.headers})).json();
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(v1.revision).toBe(1);
  }finally{
    await info.attach("timings",{body:JSON.stringify(timings,null,1),contentType:"application/json"});
    console.log(model.key+" "+JSON.stringify(timings));
    await project.remove();
  }
});
