import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {basename} from "node:path";

test("Respuesta documental real con cita, historial y aislamiento del proyecto",async({page},info)=>{
  const ifc=process.env.DUPLEX_IFC,pdf=process.env.DUPLEX_DOOR_PDF;
  test.skip(!ifc||!pdf||process.env.TEST_LIVE_RAG!=="1","Requiere los archivos Duplex y autorización para Gemini.");
  test.setTimeout(300000);
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const project=await page.request.post("/api/projects",{headers,data:{name:"Ensayo documental Duplex"}});
  const id=(await project.json()).id, api="/api/projects/"+id;
  try{
    await page.goto("/proyectos/"+id+"/archivos");
    await page.getByRole("link",{name:"Asistente",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Vincula la primera ficha"})).toBeVisible();
    const version=await page.request.post(api+"/uploads",{params:{name:basename(ifc!)},headers:{...headers,"Content-Type":"application/octet-stream"},data:readFileSync(ifc!)});
    expect(version.ok()).toBeTruthy();
    const versionId=(await version.json()).id;
    const spec=await page.request.post(api+"/versions/"+versionId+"/specifications",{params:{element:"1hOSvn6df7F8_7GcBWlS8Z",name:basename(pdf!)},headers:{...headers,"Content-Type":"application/pdf"},data:readFileSync(pdf!)});
    expect(spec.ok()).toBeTruthy();
    const document=(await spec.json()).id;
    await page.reload();
    async function ask(question:string){
      await page.getByLabel("Pregunta sobre la ficha").fill(question);
      const response=page.waitForResponse(r=>r.url().endsWith("/assistant")&&r.request().method()==="POST",{timeout:180000});
      await page.getByRole("button",{name:"Consultar con Gemini"}).click();
      const res=await response;expect(res.status()).toBe(200);
      return res.json();
    }
    const answer=await ask("¿Qué dice la ficha en el apartado Sticking profile? Cita literalmente esas palabras y su contenido.");
    await info.attach("respuesta",{body:JSON.stringify(answer),contentType:"application/json"});
    expect(answer.status,JSON.stringify(answer)).toBe("ANSWERED");
    const cite=page.getByRole("link",{name:basename(pdf!)+" · pág. "+answer.evidence[0].page});
    await expect(cite).toBeVisible();
    await expect(page.locator("blockquote").first()).toContainText(answer.evidence[0].quote);
    const original=await cite.evaluate(async a=>Array.from(new Uint8Array(await (await fetch((a as HTMLAnchorElement).href)).arrayBuffer())));
    expect(Buffer.from(original).equals(readFileSync(pdf!))).toBeTruthy();
    await page.reload();await expect(cite).toBeVisible();
    await page.screenshot({path:info.outputPath("consulta-con-fuente.png")});
    await page.getByRole("link",{name:"Localizar elemento en el visor"}).click();
    await expect(page.getByRole("tab",{name:"Propiedades"})).toHaveAttribute("aria-selected","true");
    await expect(page.locator(".inspector")).toContainText("1hOSvn6df7F8_7GcBWlS8Z");
    await page.goBack();await expect(cite).toBeVisible();
    const absent=await ask("¿Qué fecha exacta tuvo la elección del alcalde de Bogotá en el año 1990?");
    expect(absent.status).toBe("INSUFFICIENT");expect(absent.evidence).toEqual([]);
    const other=await page.request.post("/api/projects",{headers,data:{name:"Proyecto sin acceso a esta ficha"}});
    const otherUrl="/api/projects/"+(await other.json()).id;
    try{
      const denied=await page.request.post(otherUrl+"/assistant",{headers,data:{document,question:"sticking profile"}});
      expect(denied.status()).toBe(404);
    }finally{await page.request.delete(otherUrl,{headers});}
  }finally{await page.request.delete(api,{headers});}
});
