import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {basename} from "node:path";

for(const width of [1366,1920,390])test("Prisma local · selección y exportación · "+width,async({page},info)=>{
  await page.setViewportSize({width,height:width===390?844:width===1920?1080:768});
  await page.emulateMedia({reducedMotion:"reduce"});
  let posts=0;
  page.on("request",r=>{if(r.method()==="POST" && r.url().includes("/options"))posts++;});
  await page.goto("/proyectos/restage/visor?panel=asistente");
  const panel=page.getByRole("region",{name:"Asistente de diseño"});
  await expect(panel).toBeVisible();
  await panel.getByRole("button",{name:"Agrupar"}).click();
  const search=panel.getByRole("textbox",{name:"Buscar pieza para la propuesta"});
  await search.fill("fachada");await panel.getByRole("button",{name:/fachada/i}).first().click();
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await panel.getByRole("listitem").first().getByRole("button").click();
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  await panel.getByRole("button",{name:"Plegar asistente"}).click();
  await expect(panel).toBeHidden();await page.getByRole("button",{name:"Abrir Prisma",exact:true}).click();
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  const canvas=page.locator(".view canvas");
  const before=await canvas.screenshot();
  await panel.getByRole("button",{name:"Probar color"}).click();
  expect((await canvas.screenshot()).equals(before)).toBeFalsy();
  const downloading=page.waitForEvent("download");await panel.getByRole("button",{name:"Exportar PNG"}).click();
  const download=await downloading;expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(readFileSync((await download.path())!).subarray(1,4).toString()).toBe("PNG");
  await page.screenshot({path:info.outputPath("prisma-"+width+".png")});
  await panel.getByRole("button",{name:"Descartar color"}).click();
  expect((await canvas.screenshot()).equals(before)).toBeTruthy();
  expect(posts).toBe(0);
});

test("La petición contiene el grupo IFC y una máscara con la misma cámara",async({page},info)=>{
  const file=process.env.TEST_IFC;
  test.skip(!file,"Indica el IFC completo de ReStage");
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const project=await page.request.post("/api/projects",{headers,data:{name:"Ensayo Prisma"}});
  const id=(await project.json()).id;
  try{
    const result=await page.request.post("/api/projects/"+id+"/uploads",{params:{name:basename(file!)},headers:{...headers,"Content-Type":"application/octet-stream"},data:readFileSync(file!)});
    expect(result.ok()).toBeTruthy();
    await page.goto("/proyectos/"+id+"/asistente");await page.getByRole("link",{name:"Abrir Prisma en el modelo"}).click();
    const panel=page.getByRole("region",{name:"Asistente de diseño"});
    await expect(panel).toBeVisible({timeout:120000});
    const search=panel.getByRole("textbox",{name:"Buscar pieza para la propuesta"});
    await search.fill("1591462");await panel.getByRole("button",{name:/Earth/i}).click();
    await panel.getByRole("button",{name:"Agrupar"}).click();await search.fill("IfcRoof");await panel.locator("button").filter({hasText:/ · \d+$/}).first().click();
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    let payload:{element:string;jpeg:string;mask:string}|undefined;
    let polls=0;
    await page.route(/\/options(?:\?|$)/,async route=>{
      if(route.request().method()==="POST"){payload=route.request().postDataJSON();await route.fulfill({status:202,json:{id:"test"}});}
      else {
        const pending=payload && polls++===0;
        await route.fulfill({json:{available:true,batches:payload?[{id:"test",request:"Prueba",state:pending?"WORKING":"FAILED",options:[],runs:pending?[]:[{error_code:"HTTP_429"}]}]:[]}});
      }
    });
    await panel.getByLabel("Cambio solicitado").fill("Prueba controlada de color");
    await panel.getByRole("button",{name:"Enviar captura y generar tres opciones"}).click();
    const mascot=panel.locator("svg").first();
    await expect(mascot).toHaveCSS("animation-name",/survey/);
    await expect(panel.getByText(/Revisa la cuota/)).toBeVisible();
    await expect(mascot).toHaveCSS("animation-name","none");
    expect(JSON.parse(payload!.element.slice(6))).toHaveLength(2);
    expect(payload!.mask).not.toBe(payload!.jpeg);
    for(const k of ["mask","jpeg"] as const)await info.attach(k,{body:Buffer.from(payload![k],"base64"),contentType:"image/jpeg"});
    await panel.getByRole("button",{name:"Probar color"}).click();
    await expect(panel.getByRole("button",{name:"Exportar PNG"})).toBeEnabled();
  }finally{await page.request.delete("/api/projects/"+id,{headers});}
});

test("Prisma consulta solo las fichas de la pieza y versión abiertas",async({page})=>{
  const file=process.env.DUPLEX_IFC,pdf=process.env.DUPLEX_DOOR_PDF;
  test.skip(!file||!pdf);
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const project=await page.request.post("/api/projects",{headers,data:{name:"Fichas en Prisma"}});
  const id=(await project.json()).id,base="/api/projects/"+id;
  try{
    const upload=await page.request.post(base+"/uploads",{params:{name:basename(file!)},headers:{...headers,"Content-Type":"application/octet-stream"},data:readFileSync(file!)});
    const {id:version,fileId}=await upload.json(),door="1hOSvn6df7F8_7GcBWlS8Z";
    const attached=await page.request.post(base+"/versions/"+version+"/specifications",{params:{element:door,name:basename(pdf!)},headers:{...headers,"Content-Type":"application/pdf"},data:readFileSync(pdf!)});
    expect(attached.ok()).toBeTruthy();
    await page.goto("/proyectos/"+id+"/visor/"+version+"?panel=asistente&element="+door);
    const panel=page.getByRole("region",{name:"Asistente de diseño"});
    await panel.getByText("Consultar fichas de la selección").click();
    await expect(panel.getByRole("link",{name:"Abrir ficha original"})).toBeVisible();
    await expect(panel.getByLabel("Pregunta sobre la ficha")).toBeVisible();
    await panel.getByLabel("Buscar pieza para la propuesta").fill("146596");
    await panel.getByRole("button",{name:/146596 · 6652$/}).click({timeout:10000});
    await expect(panel.getByText("Esta selección no tiene fichas vinculadas en esta versión.")).toBeVisible();
    const revision=await page.request.post(base+"/uploads",{params:{name:basename(file!),file:fileId},headers:{...headers,"Content-Type":"application/octet-stream"},data:readFileSync(file!)});
    expect(revision.ok()).toBeTruthy();
    const nextVersion=(await revision.json()).id;
    expect(nextVersion).not.toBe(version);
    await page.goto("/proyectos/"+id+"/visor/"+nextVersion+"?panel=asistente&element="+door);
    await panel.getByText("Consultar fichas de la selección").click();
    await expect(panel.getByText("Esta selección no tiene fichas vinculadas en esta versión.")).toBeVisible();
  }finally{await page.request.delete(base,{headers});}
});
