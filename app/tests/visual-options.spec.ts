import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {basename} from "node:path";
import {pickFirstPiece,renderButton,renderPanel,sendButton,unfoldBatches} from "./support/opciones-visuales";

/**
 * La captura que se enviará ya no se muestra dentro del panel: es lo que se ve en el lienzo y se toma
 * al enviar (ESPECIFICACION.md §5.2, visual-options.tsx `submit`). Por eso se comprueba que nada sale
 * antes de pulsar RENDERIZAR, que lo enviado es una imagen del encuadre del lienzo y que la tanda guarda
 * esa misma captura («Ver captura original»).
 */
const modelOnly={style:".viewer-header,.stagebar,.workspace-bars,.cube-host,.workspace-toast,.scene-strip,.version-rail,.tool-popover,[data-visual-tour]{visibility:hidden!important}"};

test("La ingeniera puede consultar la captura de su IFC antes de enviar datos",async({page},info)=>{
  const file=process.env.TEST_IFC;
  test.skip(!file,"Indica el IFC local con TEST_IFC.");
  test.setTimeout(420000);
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  expect(auth.status()).toBe(201);
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const created=await page.request.post("/api/projects",{headers,data:{name:"Prueba de captura"}});
  const base="/proyectos/"+(await created.json()).id;
  const posts:string[]=[];
  page.on("request",request=>{if(request.method()==="POST" && /\/options(?:[/?]|$)/.test(request.url()))posts.push(request.url());});
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
    const piece=await pickFirstPiece(page);
    if(process.env.TEST_IFC_SITE==="1")await page.getByRole("button",{name:"Encuadrar modelo"}).click();
    await renderButton(page).click({timeout:60000});
    const dialog=renderPanel(page);
    await expect(dialog.getByRole("radiogroup",{name:"Sobre qué pedir opciones"}).getByRole("radio",{name:piece,exact:true})).toHaveAttribute("aria-checked","true");
    // Lo que se enviará es el encuadre del lienzo: el modelo se ve ahí antes de enviar nada.
    const canvas=page.locator(".view canvas");
    await expect(canvas).toBeVisible();
    const shot=await canvas.screenshot({...modelOnly,path:info.outputPath("captura-modelo.png")});
    expect(shot.byteLength).toBeGreaterThan(1000);
    const send=sendButton(dialog);
    await expect(send).toBeDisabled();
    expect(posts).toEqual([]);
    if(process.env.TEST_LIVE_GEMINI==="1"){
      // Solo con TEST_LIVE_GEMINI=1, que autoriza una llamada real y su gasto. Sin esa variable nunca se ejecuta.
      await dialog.getByLabel("Cambio solicitado").fill("Change only the selected door finish to natural oak. Preserve the building and the existing terrain.");
      await send.click();
      await unfoldBatches(dialog);
      const batch=dialog.locator(".option-batch").first();
      await expect(batch.getByText(/generación quedó incompleta/).or(batch.getByRole("button",{name:"Elegir opción 2"}).and(batch.locator("button:enabled")))).toBeVisible({timeout:180000});
      await batch.getByText("Consumo de la generación").click();
      const runs=await batch.locator("details.option-runs").innerText();
      await info.attach("consumo",{body:runs,contentType:"text/plain"});
      if(process.env.TEST_IMAGE_LIMIT==="1" && runs.includes("HTTP_429")){
        await expect(batch.getByRole("region",{name:"Alternativas de texto"}).getByRole("listitem")).toHaveCount(3);
        await expect(batch.getByRole("button",{name:"Elegir opción 2"})).toHaveCount(0);
        await batch.screenshot({path:info.outputPath("alternativas-texto.png")});
        return;
      }
      expect(await batch.getByText(/generación quedó incompleta/).count(),runs).toBe(0);
      await expect(batch.getByText(/^Opción [123] · Generado con IA$/)).toHaveCount(3);
      await batch.getByRole("button",{name:"Elegir opción 2"}).click();
      await expect(batch.getByRole("button",{name:"Elegida"})).toBeDisabled();
      return;
    }
    if(process.env.TEST_NO_GEMINI==="1"){
      await dialog.getByLabel("Cambio solicitado").fill("Cambiar el acabado");
      await expect(dialog.getByText("Para generar imágenes falta configurar Gemini en el servidor.")).toBeVisible();
      await expect(send).toBeDisabled();
    }
    // El panel de RENDERIZAR no tiene X: Escape lo cierra y devuelve el foco a su botón.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(renderButton(page)).toBeFocused();

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
    await renderButton(page).click();
    await dialog.getByLabel("Cambio solicitado").fill("Ensayo");
    const frame=(await canvas.boundingBox())!;
    await send.click();
    await expect.poll(()=>generated).toBe(true);
    // Lo enviado es una imagen real del encuadre del lienzo, con sus mismas proporciones.
    const sentSize=await page.evaluate(async data=>{
      const bitmap=await createImageBitmap(await (await fetch("data:image/jpeg;base64,"+data)).blob());
      return [bitmap.width,bitmap.height];
    },trialImage);
    expect(sentSize[0]).toBeGreaterThan(10);
    expect(sentSize[0]/sentSize[1]).toBeCloseTo(frame.width/frame.height,1);
    // Las tandas quedan plegadas tras «Ver»: la terna lista, con su captura original consultable.
    await unfoldBatches(dialog);
    await expect(dialog.getByText(/^Opción [123] · Generado con IA$/)).toHaveCount(3);
    await dialog.getByText("Ver captura original").click();
    const original=dialog.getByRole("img",{name:"Captura usada para esta terna"});
    await expect(original).toBeVisible();
    expect(await original.evaluate((el:HTMLImageElement)=>[el.naturalWidth,el.naturalHeight])).toEqual(sentSize);
    await dialog.getByRole("button",{name:"Elegir opción 2"}).click();
    await expect(dialog.getByRole("button",{name:"Elegida"})).toBeDisabled();
    expect(selected).toBe(2);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    limited=true;
    // Al abrir otra vez se lee de nuevo el historial; el panel conserva las tandas desplegadas.
    await renderButton(page).click();
    await expect(dialog.getByText(/Revisa la cuota del modelo/)).toBeVisible();
    await expect(dialog.getByRole("button",{name:/Elegir opción/})).toHaveCount(0);
  } finally {await page.request.delete(base.replace("/proyectos/","/api/projects/"),{headers}).catch(()=>undefined);}
});
