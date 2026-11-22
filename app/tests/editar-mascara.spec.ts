import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {strFromU8,unzipSync} from "three/addons/libs/fflate.module.js";
import {editButton,editTour,selectionPanel} from "./support/editar-prisma";

// Antes «Prisma»: la edición externa con máscara («Editar en Gemini con máscara») vive en el panel
// «Selección» de EDITAR (DU-16). Nada de esto llama a Gemini: se prepara un ZIP y se protege la imagen devuelta.

function visibilityFixture(){
  let step=`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'),'2;1');
FILE_NAME('visibilidad.ifc','2026-01-01T00:00:00',(),(),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#2,$);
#4=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#5=IFCUNITASSIGNMENT((#4));
#6=IFCPROJECT('0000000000000000000001',$,'Prueba de visibilidad',$,$,$,$,(#3),#5);
#7=IFCDIRECTION((0.,0.,1.));
`;
  for(const [id,name,width,depth,height,y,z] of [
    [10,"Bloque exterior",6,6,6,0,0],
    [20,"Pieza posterior",1,1,1,5,2],
    [30,"Pieza interior",1,1,1,0,2],
  ] as const){
    step+=`
#${id}=IFCCARTESIANPOINT((0.,${y}.,${z}.));
#${id+1}=IFCAXIS2PLACEMENT3D(#${id},$,$);
#${id+2}=IFCLOCALPLACEMENT($,#${id+1});
#${id+3}=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,${width}.,${depth}.);
#${id+4}=IFCEXTRUDEDAREASOLID(#${id+3},#2,#7,${height}.);
#${id+5}=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#${id+4}));
#${id+6}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${id+5}));
#${id+7}=IFCBUILDINGELEMENTPROXY('${String(id).padStart(22,"0")}',$,'${name}',$,$,#${id+2},#${id+6},$,.NOTDEFINED.);
`;
  }
  return Buffer.from(step+"ENDSEC;\nEND-ISO-10303-21;");
}

for(const piece of ["Pieza posterior","Pieza interior"])test("Guía y captura de IFC · "+piece,async({page},info)=>{
  await page.goto("/proyectos/restage/visor?panel=asistente");
  const panel=selectionPanel(page);
  await expect(panel).toBeVisible();
  await page.locator("header input[type=file]").setInputFiles({name:"visibilidad.ifc",mimeType:"application/octet-stream",buffer:visibilityFixture()});
  await expect(page.locator(".project")).toHaveText("visibilidad.ifc");
  // Abrir otro IFC con ?panel=asistente vuelve a entrar en Editar.
  await expect(editButton(page)).toHaveAttribute("aria-pressed","true");
  const search=panel.getByLabel("Buscar pieza para la propuesta");
  await search.fill(piece);
  await panel.getByRole("button",{name:new RegExp(piece+" · ")}).click();
  await page.getByLabel("Cambiar orientación").selectOption("front");
  await panel.getByText("Editar en Gemini con máscara",{exact:true}).click();
  await panel.getByRole("button",{name:"Guía de edición con máscara"}).click();
  await panel.getByLabel("Cambio para Gemini").fill("Cambia el acabado de "+piece);
  await panel.getByRole("button",{name:"Preparar paquete para Gemini"}).click();
  const tour=editTour(page);
  const reframe=panel.getByRole("button",{name:"Reencuadrar y preparar de nuevo"});
  await expect(reframe).toHaveAttribute("aria-describedby",/prisma-instruction/);
  const orientation=await page.locator(".stage").evaluate(el=>el.style.getPropertyValue("--cube-pose"));
  await reframe.click();
  const downloadZIP=panel.getByRole("link",{name:"Descargar paquete para Gemini"});
  if(piece==="Pieza interior"){
    const isolate=panel.getByRole("button",{name:"Aislar y preparar el ZIP"});
    await expect(isolate).toHaveAttribute("aria-describedby",/prisma-instruction/);
    await expect(downloadZIP).toHaveCount(0);
    await page.screenshot({path:info.outputPath("aislar-pieza-interior.png")});
    await isolate.press("Enter");
    await expect(panel.getByText("ZIP listo · Solo incluye las piezas seleccionadas.")).toBeVisible();
  }else{
    await expect(downloadZIP).toBeVisible();
    expect(await page.locator(".stage").evaluate(el=>el.style.getPropertyValue("--cube-pose"))).not.toBe(orientation);
  }
  await expect(downloadZIP).toHaveAttribute("aria-describedby",/prisma-instruction/);
  const downloading=page.waitForEvent("download");
  await downloadZIP.click();
  const zip=await downloading;
  const entries=unzipSync(await readFile((await zip.path())!));
  expect(strFromU8(entries["03-prompt-para-gemini.txt"])).toContain(piece);
  expect(entries["01-vista-original.png"].byteLength).toBeGreaterThan(0);
  expect(entries["02-mascara-seleccion.png"].byteLength).toBeGreaterThan(0);
  await expect(tour).toContainText("Importa el resultado de Gemini");
});

test("Exporta el encuadre con instrucciones y protege la imagen que devuelve Gemini",async({page},info)=>{
  const posts:string[]=[];
  page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
  await page.goto("/proyectos/restage/visor?panel=asistente");
  const panel=selectionPanel(page);
  await panel.getByRole("textbox",{name:"Buscar pieza para la propuesta"}).fill("fachada");
  await panel.getByRole("button",{name:/fachada.* · /i}).first().click();
  await panel.getByText("Editar en Gemini con máscara",{exact:true}).click();
  await panel.getByLabel("Cambio para Gemini").fill("Aplica zinc oscuro solo a la pieza seleccionada.");
  await panel.getByRole("button",{name:"Preparar paquete para Gemini"}).click();
  const downloading=page.waitForEvent("download");
  await panel.getByRole("link",{name:"Descargar paquete para Gemini"}).click();
  const packageFile=await downloading;
  const savedZip=info.outputPath(packageFile.suggestedFilename());
  await packageFile.saveAs(savedZip);
  const bytes=await readFile(savedZip);
  const entries=unzipSync(bytes);
  const original=entries["01-vista-original.png"],mask=entries["02-mascara-seleccion.png"];
  const prompt=strFromU8(entries["03-prompt-para-gemini.txt"]);
  expect(prompt).toContain("White pixels are the only editable area");
  expect(prompt).toContain("Aplica zinc oscuro solo a la pieza seleccionada.");
  expect(prompt).toMatch(/Fachada.*ID /i);
  const originalURL="data:image/png;base64,"+Buffer.from(original).toString("base64");
  const maskURL="data:image/png;base64,"+Buffer.from(mask).toString("base64");
  const replacement=await page.evaluate(async src=>{
    const image=await createImageBitmap(await (await fetch(src)).blob());
    const canvas=document.createElement("canvas");
    canvas.width=image.width;canvas.height=image.height;image.close();
    const ctx=canvas.getContext("2d")!;
    ctx.fillStyle="#ff00ff";ctx.fillRect(0,0,canvas.width,canvas.height);
    return canvas.toDataURL("image/png");
  },originalURL);
  await page.reload();
  await panel.getByText("Editar en Gemini con máscara",{exact:true}).click();
  await panel.getByLabel("Buscar pieza para la propuesta").fill("fachada");
  await panel.getByRole("button",{name:/fachada.* · /i}).first().click();
  await panel.getByRole("listitem").getByRole("button",{name:/Quitar/}).click();
  await panel.getByRole("button",{name:"Guía de edición con máscara"}).click();
  const tour=editTour(page);
  await expect(tour).toContainText("Recupera tu paquete");
  const openZip=panel.getByRole("button",{name:"Abrir ZIP de edición"});
  await expect(openZip).toHaveAttribute("aria-describedby",/prisma-instruction/);
  const choosingZip=page.waitForEvent("filechooser");
  await openZip.click();
  const zipChooser=await choosingZip;
  expect(await zipChooser.element().getAttribute("accept")).toContain(".zip");
  await zipChooser.setFiles(savedZip);
  await expect(panel.getByRole("status").filter({hasText:"Paquete cargado"})).toBeVisible();
  const importButton=panel.getByRole("button",{name:"Seleccionar imagen de Gemini"});
  await expect(importButton).toHaveAttribute("aria-describedby",/prisma-instruction/);
  const choosingImage=page.waitForEvent("filechooser");
  await importButton.click();
  const imageChooser=await choosingImage;
  expect(await imageChooser.element().getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
  await imageChooser.setFiles(savedZip);
  await expect(panel.getByRole("alert")).toContainText("Para recuperar un ZIP, pulsa Abrir ZIP de edición");
  const file=panel.getByLabel("Imagen editada de Gemini");
  await file.setInputFiles({name:"gemini.png",mimeType:"image/png",buffer:Buffer.from(replacement.split(",")[1],"base64")});
  const preview=panel.getByRole("img",{name:"Vista final con cambios limitados a la selección"});
  await expect(preview).toBeVisible();
  const comparison=await preview.evaluate(async (image,{originalURL,maskURL})=>{
    async function pixels(url:string){
      const bitmap=await createImageBitmap(await (await fetch(url)).blob());
      const canvas=document.createElement("canvas");
      canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext("2d")!;
      ctx.drawImage(bitmap,0,0);bitmap.close();
      return ctx.getImageData(0,0,canvas.width,canvas.height);
    }
    const [base,mask,output]=await Promise.all([originalURL,maskURL,(image as HTMLImageElement).src].map(pixels));
    let inside=0,outside=0,outsideChanges=0,insideWrong=0;
    for(let i=0;i<base.data.length;i+=4){
      if(mask.data[i]>=128){
        inside++;
        if(output.data[i]!==255||output.data[i+1]!==0||output.data[i+2]!==255)insideWrong++;
      }else{
        outside++;
        if([0,1,2,3].some(offset=>output.data[i+offset]!==base.data[i+offset]))outsideChanges++;
      }
    }
    return {inside,outside,outsideChanges,insideWrong,sizeMatches:base.width===output.width && base.height===output.height};
  },{originalURL,maskURL});
  expect(comparison.inside).toBeGreaterThan(0);
  expect(comparison.outside).toBeGreaterThan(0);
  expect(comparison).toMatchObject({outsideChanges:0,insideWrong:0,sizeMatches:true});
  const saving=page.waitForEvent("download");
  await panel.getByRole("button",{name:"Guardar PNG protegido"}).click();
  expect((await saving).suggestedFilename()).toBe("ObraCota-edicion-protegida.png");
  const square=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");canvas.width=32;canvas.height=32;
    return canvas.toDataURL();
  });
  await file.setInputFiles({name:"encuadre-distinto.png",mimeType:"image/png",buffer:Buffer.from(square.split(",")[1],"base64")});
  await expect(panel.getByRole("alert")).toContainText("otro formato de encuadre");
  await expect(preview).toHaveCount(0);
  expect(posts).toEqual([]);
});
