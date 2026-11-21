import {expect,test} from "@playwright/test";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {strFromU8,unzipSync} from "three/addons/libs/fflate.module.js";
import {findFloor} from "./walk-support";

const door="1hOSvn6df7F8_7GcBWlS8Z",alternate="2klOFZffH6WQFlV10uM1wF";

test("Revisión real de puerta, avisos, precio, aplicación y restauración",async({page},info)=>{
  test.setTimeout(180_000);
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc,"Indica el IFC Duplex original con DUPLEX_IFC.");
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},
    data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  expect(auth.ok()).toBeTruthy();
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const created=await page.request.post("/api/projects",{headers,data:{name:"Prueba de aplicación IFC"}});
  expect(created.ok()).toBeTruthy();
  const {id}=await created.json();
  const base="/api/projects/"+id,route="/proyectos/"+id;
  const expectedSha=createHash("sha256").update(readFileSync(ifc!)).digest("hex");
  try{
    await page.goto(route+"/archivos");
    await page.getByLabel("Archivo IFC o DWG").setInputFiles(ifc!);
    await page.getByRole("button",{name:"Guardar versión"}).click();
    const viewerLink=page.getByRole("link",{name:"Abrir con Prisma"});
    await expect(viewerLink).toBeVisible();
    const viewerHref=(await viewerLink.getAttribute("href"))!;
    const original=viewerHref.split("?")[0].split("/").pop()!;
    await page.goto(viewerHref+"&element="+door);
    const proposal=page.getByRole("region",{name:"Cambiar tipo de puerta"});
    await proposal.getByRole("button",{name:"Proponer cambio IFC"}).click();
    const types=proposal.getByLabel("Tipo IFC propuesto");
    await expect(types).toHaveValue(alternate);
    const reject=await types.locator("option").filter({hasNotText:/Compatible|Elegir/}).first().getAttribute("value");
    expect(reject).toBeTruthy();
    await types.selectOption(reject!);
    await proposal.getByRole("button",{name:"Revisar costo y avisos"}).click();
    await expect(proposal.getByText("Aviso · Medidas del hueco",{exact:true})).toBeVisible();
    await types.selectOption(alternate);
    await proposal.getByLabel("Describe el cambio").fill("Probar una puerta alternativa con el mismo hueco");
    const prisma=page.getByRole("region",{name:"Asistente de diseño"});
    await prisma.getByText("Editar en Gemini con máscara",{exact:true}).click();
    await prisma.getByLabel("Cambio para Gemini").fill("Aplica un acabado gris solo a la puerta seleccionada.");
    await prisma.getByRole("button",{name:"Preparar paquete para Gemini"}).click();
    const zip=prisma.getByRole("link",{name:"Descargar paquete para Gemini"});
    for(const label of ["Reencuadrar y preparar de nuevo","Aislar y preparar el ZIP"]){
      const recovery=prisma.getByRole("button",{name:label});
      await expect(zip.or(recovery)).toBeVisible();
      if(await recovery.isVisible())await recovery.click();else break;
    }
    const downloading=page.waitForEvent("download");
    await zip.click();
    const archive=await downloading;
    const archivePath=info.outputPath(archive.suggestedFilename());
    await archive.saveAs(archivePath);
    const contents=unzipSync(readFileSync(archivePath));
    expect(strFromU8(contents["03-prompt-para-gemini.txt"])).toContain(door);
    await prisma.getByLabel("Paquete ZIP de Prisma").setInputFiles(archivePath);
    const editedImage=await page.evaluate(async encoded=>{
      const bitmap=await createImageBitmap(await (await fetch(encoded)).blob());
      const canvas=document.createElement("canvas");
      canvas.width=bitmap.width;canvas.height=bitmap.height;bitmap.close();
      const context=canvas.getContext("2d")!;
      context.fillStyle="#545457";context.fillRect(0,0,canvas.width,canvas.height);
      return canvas.toDataURL("image/png").split(",")[1];
    },"data:image/png;base64,"+Buffer.from(contents["01-vista-original.png"]).toString("base64"));
    await prisma.getByLabel("Imagen editada de Gemini").setInputFiles({name:"respuesta-local.png",mimeType:"image/png",buffer:Buffer.from(editedImage,"base64")});
    const saving=page.waitForEvent("download");
    await prisma.getByRole("button",{name:"Guardar PNG protegido"}).click();
    const protectedFile=await saving;
    const illustration=info.outputPath(protectedFile.suggestedFilename());
    await protectedFile.saveAs(illustration);
    await proposal.getByText("Elegir propuesta visual",{exact:true}).click();
    await proposal.getByLabel("Elegir PNG de propuesta").setInputFiles(illustration);
    await expect(proposal.getByAltText("Propuesta visual elegida")).toBeVisible();
    await proposal.getByText("Ingresar precio y ancho mínimo",{exact:true}).click();
    await proposal.getByLabel("Ancho nominal mínimo de proyecto (mm)").fill("800");
    for(const [name,price] of [["Tipo actual","100000"],["Tipo propuesto","125000"]]){
      const group=proposal.getByRole("group",{name,exact:true});
      await group.getByLabel("Precio COP").fill(price);
      await group.getByLabel("Fuente").fill("Cotización de prueba");
      await group.getByLabel("Fecha").fill("2026-11-20");
    }
    await proposal.getByRole("button",{name:"Guardar datos de revisión"}).click();
    await expect(proposal.getByText("Aviso · Ancho mínimo del proyecto",{exact:true})).toBeVisible();
    await expect(proposal.getByRole("region",{name:"Estimación del cambio"})).toContainText(/25[.,]000/);
    await proposal.getByRole("button",{name:"Registrar propuesta IFC"}).click();
    await proposal.getByRole("link",{name:"Revisar y decidir si aplicar"}).click();
    await expect(page.getByAltText("Propuesta visual elegida")).toBeVisible();
    await expect(page.getByRole("button",{name:"Aprobar y aplicar cambio"})).toBeEnabled();
    const publishing=page.waitForResponse(response=>response.url().endsWith("/apply") && response.request().method()==="POST");
    await page.getByRole("button",{name:"Aprobar y aplicar cambio"}).click();
    const published=await publishing;
    expect(published.ok(),await published.text()).toBeTruthy();
    const newLink=page.getByRole("link",{name:"Abrir nueva versión"});
    await expect(newLink).toBeVisible({timeout:60_000});
    const href=(await newLink.getAttribute("href"))!;
    const current=href.split("?")[0].split("/").pop()!;
    expect(href).toContain("anterior="+original);
    async function metadata(version:string){
      const result=await page.request.get(base+"/versions/"+version,{headers});expect(result.ok()).toBeTruthy();
      return result.json();
    }
    expect((await metadata(original)).sha256).toBe(expectedSha);
    expect((await metadata(current)).sha256).not.toBe(expectedSha);
    expect((await metadata(current)).revision).toBe(2);
    const edited=await page.request.get(base+"/design-changes/door",{headers,params:{version:current,element:door}});
    expect(edited.ok()).toBeTruthy();
    expect(await edited.json()).toMatchObject({typeId:alternate,width:.762,height:2.032,element:door});
    await page.screenshot({path:info.outputPath("cambio-aplicado.png")});
    const changes=page.url();
    await page.getByRole("link",{name:"Presupuesto",exact:true}).click();
    await expect(page.getByRole("region",{name:"Estimación del cambio"})).toContainText(/25[.,]000/);
    await page.goto(changes);
    await newLink.click();
    await expect(page.getByRole("button",{name:"Recorrer",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Encuadrar modelo"}).click();
    await findFloor(page);
    const anterior=page.getByRole("button",{name:"Anterior",exact:true}),nueva=page.getByRole("button",{name:"Nueva",exact:true});
    await expect(nueva).toHaveAttribute("aria-pressed","true");
    await anterior.click();
    await expect(anterior).toHaveAttribute("aria-pressed","true");
    const transition=await page.evaluate(()=>(performance.getEntriesByName("obracota:walk-switch").at(-1) as PerformanceMark).detail);
    expect(transition.distance).toBeLessThan(.03);
    expect(transition.angle).toBeLessThan(.001);
    await nueva.click();
    await expect(nueva).toHaveAttribute("aria-pressed","true");
    await page.screenshot({path:info.outputPath("comparacion-primera-persona.png")});
    await page.getByRole("button",{name:"Salir",exact:true}).click();
    await page.goto(changes);
    await page.getByRole("button",{name:"Crear revisión de restauración"}).click();
    const restoredLink=page.getByRole("link",{name:"Abrir revisión restaurada"});
    await expect(restoredLink).toBeVisible();
    const restored=(await restoredLink.getAttribute("href"))!.split("/").pop()!;
    expect(await metadata(restored)).toMatchObject({revision:3,sha256:expectedSha});
  }finally{await page.request.delete(base,{headers});}
});
