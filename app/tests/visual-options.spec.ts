import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {basename} from "node:path";

test("La ingeniera puede consultar la captura de su IFC antes de enviar datos",async({page},info)=>{
  const file=process.env.TEST_IFC;
  test.skip(!file,"Indica el IFC local con TEST_IFC.");
  test.setTimeout(420000);
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  expect(auth.status()).toBe(201);
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const created=await page.request.post("/api/projects",{headers,data:{name:"Prueba de captura"}});
  const base="/proyectos/"+(await created.json()).id;
  try {
    await page.goto(base+"/archivos");
    await page.getByLabel("Archivo IFC o DWG").setInputFiles(file!);
    await page.getByRole("button",{name:"Guardar versión"}).click();
    await page.getByRole("link",{name:"Abrir versión 1 en el visor"}).click();
    await expect(page.locator(".project")).toHaveText(basename(file!),{timeout:120000});
    if(process.env.TEST_IFC_SITE==="1"){
      const search=page.getByRole("searchbox");
      await search.fill("1591462");
      await expect(page.locator("#explorer .entry").first()).toContainText(/earth/i);
      await search.fill("IfcDoor");
      await expect(page.locator("#explorer .entry").first()).toBeVisible();
    }
    if(!await page.locator("#explorer .entry").count())await page.locator("#explorer .level").first().click();
    await page.locator("#explorer .entry").first().click();
    await page.getByRole("tab",{name:"Propiedades"}).click();
    if(process.env.TEST_IFC_SITE==="1")await page.getByRole("button",{name:"Encuadrar modelo"}).click();
    await page.getByRole("button",{name:"Opciones visuales"}).click();
    const dialog=page.getByRole("dialog",{name:"Opciones visuales"});
    await dialog.getByText("Captura que se enviará a Gemini").click();
    const original=dialog.getByRole("img",{name:"Encuadre original del visor"});
    await expect(original).toBeVisible();
    expect(await original.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(10);
    await expect(dialog.getByRole("button",{name:"Enviar captura y generar tres opciones"})).toBeDisabled();
    await original.screenshot({path:info.outputPath("captura-modelo.png")});
    if(process.env.TEST_LIVE_GEMINI==="1"){
      await dialog.getByLabel("Cambio solicitado").fill("Change only the selected door finish to natural oak. Preserve the building and the existing terrain.");
      await dialog.getByRole("button",{name:"Enviar captura y generar tres opciones"}).click();
      await expect(dialog.locator("section").first()).toBeVisible();
      const batch=dialog.locator("section").first();
      await expect(batch.getByText(/generación quedó incompleta/).or(batch.getByRole("button",{name:"Elegir opción 2"}).and(batch.locator("button:enabled")))).toBeVisible({timeout:180000});
      await batch.getByText("Consumo de la generación").click();
      const runs=await batch.locator("details").last().innerText();
      await info.attach("consumo",{body:runs,contentType:"text/plain"});
      if(process.env.TEST_IMAGE_LIMIT==="1" && runs.includes("HTTP_429")){
        await expect(batch.getByRole("region",{name:"Alternativas de texto"}).getByRole("listitem")).toHaveCount(3);
        await expect(batch.getByRole("button",{name:"Elegir opción 2"})).toHaveCount(0);
        await batch.screenshot({path:info.outputPath("alternativas-texto.png")});
        return;
      }
      expect(await batch.getByText(/generación quedó incompleta/).count(),runs).toBe(0);
      await expect(batch.getByText("Generado con IA",{exact:true})).toHaveCount(3);
      await batch.getByRole("button",{name:"Elegir opción 2"}).click();
      await expect(batch.getByRole("button",{name:"Elegida"})).toBeDisabled();
      return;
    }
    if(process.env.TEST_NO_GEMINI==="1"){
      await dialog.getByLabel("Cambio solicitado").fill("Cambiar el acabado");
      await expect(dialog.getByText("Para generar imágenes falta configurar Gemini en el servidor.")).toBeVisible();
      await expect(dialog.getByRole("button",{name:"Enviar captura y generar tres opciones"})).toBeDisabled();
    }
    await dialog.getByRole("button",{name:"Cerrar opciones"}).click();
    await expect(dialog).toBeHidden();

    // Exercise the rendered selection controls without authorizing a paid provider request.
    let selected:number|null=null,generated=false,limited=false;
    let trialImage="";
    await page.route(/\/options(?:[/?]|$)/,async route=>{
      const req=route.request(), url=new URL(req.url());
      if(req.method()==="POST"){
        trialImage=req.postDataJSON().jpeg;
        generated=true;
        return route.fulfill({status:202,json:{id:"trial"}});
      }
      if(req.method()==="PUT"){
        selected=Number(url.pathname.split("/").pop());
        return route.fulfill({status:204});
      }
      if(url.pathname.includes("/images/"))return route.fulfill({contentType:"image/jpeg",body:Buffer.from(trialImage,"base64")});
      if(limited)return route.fulfill({json:{available:true,batches:[{id:"limit",request:"Ensayo",state:"FAILED",selected:null,options:[],runs:[{model_id:"image",status:"FAILED",error_code:"HTTP_429",total_tokens:null}]}]}});
      return route.fulfill({json:{available:true,batches:generated?[{id:"trial",state:"READY",request:"Ensayo",selected,
        options:[1,2,3].map(slot=>({slot,description:"Alternativa de ensayo "+slot})),runs:[]}]:[]}});
    });
    await page.getByRole("button",{name:"Opciones visuales"}).click();
    await dialog.getByLabel("Cambio solicitado").fill("Ensayo");
    await dialog.getByRole("button",{name:"Enviar captura y generar tres opciones"}).click();
    await expect(dialog.getByText("Generado con IA",{exact:true})).toHaveCount(3);
    await dialog.getByRole("button",{name:"Elegir opción 2"}).click();
    await expect(dialog.getByRole("button",{name:"Elegida"})).toBeDisabled();
    expect(selected).toBe(2);
    await dialog.getByRole("button",{name:"Cerrar opciones"}).click();
    limited=true;
    await page.getByRole("button",{name:"Opciones visuales"}).click();
    await expect(dialog.getByText(/Revisa la cuota del modelo/)).toBeVisible();
    await expect(dialog.getByRole("button",{name:/Elegir opción/})).toHaveCount(0);
  } finally {await page.request.delete(base.replace("/proyectos/","/api/projects/"),{headers});}
});
