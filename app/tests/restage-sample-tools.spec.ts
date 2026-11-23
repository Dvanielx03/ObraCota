import {expect,test,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {png} from "./support/png";
import {renderButton,renderPanel,sendButton,unfoldBatches} from "./support/opciones-visuales";
import {editBar,editButton} from "./support/editar-prisma";
import {findFloor,walkButton} from "./walk-support";

/**
 * El ejemplo ReStage (/proyectos/restage/visor, un GLB público en metros) usa las herramientas del visor:
 * - Con sesión, el visor pide su alcance al servidor (POST /api/projects/sample/restage: un proyecto oculto por persona
 *   con una versión del ejemplo) y Renderizar y el Panorama 360° usan las rutas de opciones de siempre.
 * - Escena 3D, «Recorrer esta escena en 3D», el recorrido en primera persona y la vista previa de materiales son locales.
 * - El agente y «Guardar en el modelo» explican que el ejemplo es un GLB, no un IFC editable.
 * - Sin sesión, Renderizar y el panorama llevan a /ingresar?desde=visor.
 * La generación se simula con page.route (tres PNG pequeños), sin gastar cuota. SAMPLE_REAL_RENDER=1 añade una
 * petición real al proveedor configurado en el servidor.
 */
test.use({viewport:{width:1366,height:768}});
const EVIDENCE=process.env.EVIDENCE_DIR;

async function signIn(page:Page){
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  expect(auth.ok()).toBeTruthy();
  return {Authorization:"Bearer "+(await auth.json()).accessToken};
}
async function openSample(page:Page){
  await page.goto("/proyectos/restage/visor");
  await expect(page.locator(".project")).toHaveText("ReStage",{timeout:90_000});
  await expect(renderButton(page)).toBeVisible({timeout:60_000});
}

test("Con sesión, el ejemplo ReStage renderiza, recorre su escena, abre el panorama y se recorre",async({page},info)=>{
  test.setTimeout(240_000);
  const headers=await signIn(page);
  // The server's scope of the sample: the same for this person on every call.
  const scopeResponse=page.waitForResponse(response=>response.url().endsWith("/api/projects/sample/restage") && response.request().method()==="POST");

  // Renderizar answered by the test: the listing starts empty and, once the request is sent, holds a ready batch.
  let sent:{element:string;request:string;jpeg:string}|null=null;
  const batch=randomUUID(),colours:[number,number,number][]=[[120,126,134],[176,122,62],[58,110,92],[196,188,170]];
  await page.route(/\/api\/projects\/[^/]+\/versions\/[^/]+\/options\?element=/,route=>route.fulfill({json:{available:true,
    budget:{reserve_cents:0,remaining_cents:500},batches:sent?[{id:batch,request:sent.request,state:"READY",selected:null,runs:[],
      options:[1,2,3].map(slot=>({slot,description:"Opción de prueba "+slot}))}]:[]}}));
  await page.route(/\/api\/projects\/[^/]+\/versions\/[^/]+\/options$/,async route=>{
    if(route.request().method()!=="POST")return route.fallback();
    sent=route.request().postDataJSON();
    await route.fulfill({status:202,json:{id:batch}});
  });
  await page.route(/\/options\/[^/]+\/images\/\d$/,route=>{
    const slot=Number(new URL(route.request().url()).pathname.split("/").pop());
    return route.fulfill({contentType:"image/png",body:png(480,300,colours[slot])});
  });

  await openSample(page);
  const scope=await (await scopeResponse).json() as {project:string;version:string};
  const again=await (await page.request.post("/api/projects/sample/restage",{headers})).json();
  expect(again).toEqual(scope);
  // The sample's project stays out of the person's list.
  expect(await (await page.request.get("/api/projects",{headers})).json()).toEqual([]);

  // 1 · Renderizar is on: the exterior preview applies locally, then the request gives three options.
  await expect(renderButton(page)).not.toHaveAttribute("aria-disabled","true");
  await renderButton(page).click();
  const panel=renderPanel(page);
  await expect(panel).toBeVisible();
  await panel.getByRole("radio",{name:"Piedra"}).click();
  await panel.getByRole("radio",{name:"Claro"}).click();
  await expect(panel.getByRole("status").filter({hasText:/fachada y la cubierta del ejemplo/})).toBeVisible();
  // «Guardar en el modelo» says why the sample cannot take it.
  await expect(panel.getByRole("button",{name:"Guardar en el modelo"})).toBeDisabled();
  await expect(panel.locator(".exterior-save-reason")).toContainText("ReStage es un ejemplo en GLB, no un IFC editable");
  await panel.getByLabel("Cambio solicitado").fill("Fachada en piedra clara");
  await sendButton(panel).click();
  await expect.poll(()=>sent?.request??"").toContain("Fachada en piedra clara");
  expect(sent!.jpeg.length).toBeGreaterThan(1000);
  await unfoldBatches(panel);
  for(const slot of [1,2,3])await expect(panel.getByRole("img",{name:"Opción "+slot,exact:true})).toBeVisible();
  await panel.getByRole("img",{name:"Opción 3",exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:EVIDENCE?EVIDENCE+"/renderizar-opciones.png":info.outputPath("renderizar-opciones.png")});
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // 2 · Editar: the agent explains the sample; Escena › «Recorrer esta escena en 3D» builds the scene and walks.
  await editButton(page).click();
  await expect(editButton(page)).toHaveAttribute("aria-pressed","true");
  const layer=page.locator(".edit-layer");
  const box=(await page.locator(".view canvas").boundingBox())!;
  for(const [x,y] of [[.5,.5],[.45,.55],[.55,.45],[.4,.4],[.6,.6]]){
    await page.mouse.click(box.x+box.width*x,box.y+box.height*y);
    if(await layer.locator('[data-edit-mark][data-kind="point"]').count())break;
    if(await layer.locator("[data-edit-mark]").count())await page.keyboard.press("Escape");
  }
  await expect(layer.locator('[data-edit-mark][data-kind="point"]')).toHaveCount(1);
  await layer.getByRole("textbox",{name:"Describe el cambio de la marca 1"}).fill("Cambiar la viga");
  const propose=layer.getByRole("button",{name:"Proponer cambio al modelo"});
  await expect(propose).toHaveAttribute("aria-disabled","true");
  await expect(propose).toHaveAttribute("title",/ReStage es un ejemplo en GLB, no un IFC editable/);

  const stage=page.locator(".stage");
  await editBar(page).getByRole("button",{name:"Escena",exact:true}).click();
  const card=page.getByRole("dialog",{name:"Escena"});
  await card.getByRole("button",{name:"Presentación al cliente"}).click();
  await card.getByRole("button",{name:"Recorrer esta escena en 3D"}).click();
  const discard=page.getByRole("dialog",{name:"¿Descartar las marcas?"});
  if(await discard.isVisible().catch(()=>false))await discard.getByRole("button",{name:"Descartar"}).click();
  await expect(stage).toHaveAttribute("data-environment","afternoon clear - city photo");
  await expect(page.locator("main")).toHaveAttribute("data-walk","on");
  const bar=page.getByRole("group",{name:"Escena en 3D"});
  await expect(bar).toContainText("Tarde · Despejado · Ciudad · Fotorrealista");

  // 3 · Panorama 360° on the sample's scope (the route stubbed): the sphere viewer opens; Escape closes it alone.
  let panoramaUrl="";
  await page.route("**/api/projects/*/versions/*/options/panorama",async route=>{
    panoramaUrl=route.request().url();
    await route.fulfill({status:200,contentType:"image/png",body:png(64,32,[210,140,60])});
  });
  await bar.getByRole("button",{name:"Panorama 360° con IA"}).click();
  const panorama=page.getByRole("dialog",{name:"Panorama 360° con IA"});
  await expect(panorama.locator(".panorama-view")).toHaveAttribute("data-state","ready");
  expect(panoramaUrl).toContain("/projects/"+scope.project+"/versions/"+scope.version+"/options/panorama");
  await page.keyboard.press("Escape");
  await expect(panorama).toHaveCount(0);
  // Pick a starting point on the scene's ground: the walk goes on in first person.
  const canvas=page.locator(".view canvas");
  for(const [x,y] of [[.5,.85],[.3,.85],[.7,.85],[.5,.75]]){
    await canvas.click({position:{x:Math.round(box.width*x),y:Math.round(box.height*y)}});
    if((await page.locator(".walk-hint").textContent())?.includes("Arrastra para mirar"))break;
  }
  await expect(page.locator(".walk-hint")).toContainText("Arrastra para mirar");
  await page.screenshot({path:EVIDENCE?EVIDENCE+"/escena-recorrido.png":info.outputPath("escena-recorrido.png")});
  await page.keyboard.press("Escape");
  await expect(page.locator("main")).not.toHaveAttribute("data-walk","on");

  // 4 · Recorrido from the bar: on the sample's own floor, in first person.
  await bar.getByRole("button",{name:"Restablecer"}).click();
  await expect(stage).not.toHaveAttribute("data-environment",/.+/);
  if(await editButton(page).getAttribute("aria-pressed")==="true")await editButton(page).click();
  await expect(walkButton(page)).not.toHaveAttribute("aria-disabled","true");
  await findFloor(page);
  await expect(page.locator(".walk-hint")).toContainText("Arrastra para mirar");
  await page.locator(".view canvas").focus();
  await page.keyboard.down("ArrowUp");await page.waitForTimeout(600);await page.keyboard.up("ArrowUp");
  await expect(page.locator(".walk-hint")).toContainText("Arrastra para mirar");
  await page.keyboard.press("Escape");
  await expect(page.locator("main")).not.toHaveAttribute("data-walk","on");
});

test("Sin sesión, el ejemplo se ve y se recorre; Renderizar y el panorama piden iniciar sesión",async({page})=>{
  test.setTimeout(150_000);
  await openSample(page);
  await expect(walkButton(page)).not.toHaveAttribute("aria-disabled","true");
  await renderButton(page).click();
  const panel=renderPanel(page);
  await expect(panel).toContainText("Inicia sesión para renderizar");
  await expect(panel.getByRole("link",{name:"Iniciar sesión"})).toHaveAttribute("href","/ingresar?desde=visor");
  await page.keyboard.press("Escape");

  await editButton(page).click();
  await editBar(page).getByRole("button",{name:"Escena",exact:true}).click();
  const card=page.getByRole("dialog",{name:"Escena"});
  await card.getByRole("button",{name:"Presentación al cliente"}).click();
  await card.getByRole("button",{name:"Recorrer esta escena en 3D"}).click();
  await expect(page.locator(".stage")).toHaveAttribute("data-environment","afternoon clear - city photo");
  const link=page.getByRole("group",{name:"Escena en 3D"}).getByRole("link",{name:"Inicia sesión para el panorama 360°"});
  await expect(link).toHaveAttribute("href","/ingresar?desde=visor");
  await link.click();
  await expect(page).toHaveURL(/\/ingresar\?desde=visor/);
});

test("Una petición real de Renderizar sobre el ejemplo (SAMPLE_REAL_RENDER=1)",async({page})=>{
  test.skip(process.env.SAMPLE_REAL_RENDER!=="1","Solo con SAMPLE_REAL_RENDER=1: llama al proveedor de imágenes del servidor");
  test.setTimeout(300_000);
  await signIn(page);
  await openSample(page);
  await renderButton(page).click();
  const panel=renderPanel(page);
  await panel.getByLabel("Cambio solicitado").fill("Fachada en madera clara al atardecer");
  await sendButton(panel).click();
  await unfoldBatches(panel);
  await expect(panel.getByRole("img",{name:"Opción 3",exact:true})).toBeVisible({timeout:240_000});
  await panel.getByRole("img",{name:"Opción 3",exact:true}).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  if(EVIDENCE)await page.screenshot({path:EVIDENCE+"/renderizar-real.png"});
});
