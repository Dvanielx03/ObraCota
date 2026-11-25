import {expect,test,type Page} from "@playwright/test";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {deflateSync} from "node:zlib";
import {createProject} from "./support/opciones-visuales";

const ifc=process.env.DUPLEX_IFC??resolve(__dirname,"../../docs/mvp/paso-5/Duplex_A_20110907.ifc");
const element="1hOSvn6df7F8_7GcBWlS8Z";

async function scannedPdf(page:Page, embeddedFiles=false){
  const pixels=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");
    canvas.width=720;canvas.height=200;
    const context=canvas.getContext("2d")!;
    context.fillStyle="white";context.fillRect(0,0,720,200);
    context.font="30px Arial";context.fillStyle="black";
    context.fillText("Membrana impermeable sobre concreto.",24,70);
    context.fillText("Ensayo de estanqueidad: 24 horas.",24,133);
    return [...context.getImageData(0,0,720,200).data.filter((_,i)=>i%4===0)];
  });
  const stream=(dict:string,body:Buffer)=>Buffer.concat([Buffer.from(`<< ${dict} /Length ${body.length} >>\nstream\n`),body,Buffer.from("\nendstream")]);
  const pdfObjects=[
    Buffer.from(`<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R ${embeddedFiles?"/Names << /EmbeddedFiles << /Names [] >> >>":""} >>`),
    Buffer.from("<< /Type /Pages /Count 1 /Kids [3 0 R] >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 200] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>"),
    stream("/Type /XObject /Subtype /Image /Width 720 /Height 200 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode",deflateSync(Buffer.from(pixels))),
    stream("",Buffer.from("q 720 0 0 200 0 0 cm /Scan Do Q")),
    Buffer.from("<< /Type /Outlines /First 7 0 R /Last 7 0 R /Count 1 >>"),
    Buffer.from("<< /Title (Impermeabilizacion) /Parent 6 0 R /Dest [3 0 R /Fit] >>"),
  ];
  let pdf=Buffer.from("%PDF-1.4\n");
  const xref=["0000000000 65535 f \n"];
  pdfObjects.forEach((body,index)=>{
    xref.push(String(pdf.length).padStart(10,"0")+" 00000 n \n");
    pdf=Buffer.concat([pdf,Buffer.from(`${index+1} 0 obj\n`),body,Buffer.from("\nendobj\n")]);
  });
  return Buffer.concat([pdf,Buffer.from(`xref\n0 ${xref.length}\n${xref.join("")}trailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`)]);
}

test("Indexa una ficha escaneada, cita el texto y retira el PDF temporal",async({page,browser},info)=>{
  test.skip(!existsSync(ifc),"Falta Duplex IFC");
  test.setTimeout(360_000);
  const project=await createProject(page,"Auditoría PDF temporal");
  const visitorContext=await browser.newContext({baseURL:info.project.use.baseURL});
  const visitor=await createProject(await visitorContext.newPage(),"Cuenta sin permiso documental");
  const base="/api/projects/"+project.id;
  try{
    const uploaded=await page.request.post(base+"/uploads",{params:{name:"Duplex.ifc"},
      headers:{...project.headers,"Content-Type":"application/octet-stream"},data:readFileSync(ifc)});
    expect(uploaded.status()).toBe(201);
    const {id:version}=await uploaded.json();
    await page.goto("/proyectos/"+project.id+"/asistente");
    const spec=base+"/versions/"+version+"/specifications";
    const post=(name:string,data:Buffer)=>page.request.post(spec,{params:{name,element},headers:{...project.headers,"Content-Type":"application/pdf"},data});
    expect((await post("falso.pdf",Buffer.from("Esto no es un PDF."))).status()).toBe(400);
    expect((await post("exceso.pdf",Buffer.alloc(4*1024*1024+1))).status()).toBe(413);
    const rejected=await (await post("contenido-activo.pdf",await scannedPdf(page,true))).json();
    const original=await scannedPdf(page);
    const response=await post("impermeabilizacion.pdf",original);
    expect(response.ok()).toBeTruthy();
    const queued=await response.json();
    expect(queued).toMatchObject({status:"QUEUED",originalAvailable:false});
    expect((await (await post("impermeabilizacion.pdf",original)).json()).id).toBe(queued.id);
    const sources=async()=> (await page.request.get(base+"/assistant",{headers:project.headers})).json();
    const local=process.env.TEST_LIVE_RAG==="1";
    await expect.poll(async()=> (await sources()).find((row:{id:string})=>row.id===queued.id),
      {timeout:240_000}).toMatchObject({status:local?"INDEXED":expect.stringMatching(/TEXT_ONLY|INDEXED/),ocrPages:1,originalAvailable:false});
    expect((await sources()).find((row:{id:string})=>row.id===rejected.id)).toMatchObject({status:"FAILED",error:"ACTIVE_PDF"});
    const evidence=await page.request.get(spec,{headers:project.headers,params:{element,q:"estanqueidad"}});
    expect((await evidence.json()).citations).toContainEqual(expect.objectContaining({page:1,excerpt:expect.stringMatching(/estanqueidad.*24 horas/i),document:queued.id}));
    expect((await page.request.get(spec+"/"+queued.id,{headers:project.headers})).status()).toBe(404);
    expect((await page.request.get(base+"/assistant",{headers:visitor.headers})).status()).toBe(404);
    const forbidden=await page.request.post("/api/projects/"+visitor.id+"/assistant",
      {headers:visitor.headers,data:{document:queued.id,question:"¿Cuánto dura el ensayo?"}});
    expect(forbidden.status()).toBe(404);
    await page.reload();
    await page.getByLabel("Ficha del proyecto").selectOption(queued.id);
    await expect(page.getByText(/OCR en 1 pág/)).toBeVisible();
    await expect(page.getByRole("link",{name:"Abrir ficha original"})).toHaveCount(0);
    if(local){
      await page.getByLabel("Pregunta sobre la ficha").fill("¿Cuánto dura el ensayo de estanqueidad? Cita las palabras exactas.");
      const result=page.waitForResponse(r=>r.url().endsWith("/assistant")&&r.request().method()==="POST",{timeout:150_000});
      await page.getByRole("button",{name:"Consultar ficha"}).click();
      const answer=await (await result).json();
      expect(answer).toMatchObject({status:"ANSWERED",retrieval:"híbrida",evidence:[
        {page:1,section:"Impermeabilizacion",quote:expect.stringMatching(/24 horas/i)},
      ]});
      await expect(page.locator("blockquote")).toContainText(/24 horas[\s\S]*pág\. 1/);
      writeFileSync(info.outputPath("respuesta-ocr.json"),JSON.stringify(answer,null,2));
      await page.locator("blockquote").scrollIntoViewIfNeeded();
    }
    await page.screenshot({path:info.outputPath("ficha-ocr.png"),fullPage:true});
    await info.attach("estado",{body:JSON.stringify(await sources(),null,2),contentType:"application/json"});
  }finally{await Promise.all([project.remove(),visitor.remove()]);await visitorContext.close();}
});
