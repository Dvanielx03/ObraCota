import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {unzipSync} from "three/addons/libs/fflate.module.js";
import {editBar,editButton,editTour,selectionPanel} from "./support/editar-prisma";

// Antes «Guía de Prisma»: desde DU-16 es la «Guía de Editar» y practica la selección, el acabado local
// y la edición con máscara sobre los controles reales de EDITAR, sin llamar a Gemini.
// El movimiento reducido no depende del ancho: antes solo se emulaba en la variante de 390 px (D-12 la omite),
// así que ahora tiene su propia variante de escritorio. Lo implementan globals.css (.tour-pointer sin transición)
// y selection-assistant.module.css (edit-arrival solo con prefers-reduced-motion:no-preference).

const variants=[
  {name:"1366",width:1366,reducedMotion:false},
  {name:"1366 · movimiento reducido",width:1366,reducedMotion:true},
];

for(const {name,width,reducedMotion} of variants)test("Guía de Editar · práctica sin Gemini · "+name,async({page},info)=>{
  await page.setViewportSize({width,height:768});
  if(reducedMotion)await page.emulateMedia({reducedMotion:"reduce"});
  const requests:string[]=[];
  page.on("request",request=>{if(request.method()==="POST")requests.push(request.url());});
  await page.goto("/proyectos/restage/visor");
  const launch=editButton(page);
  await expect(launch).toBeVisible();
  await expect(launch).toHaveText(/Editar/);
  await expect(launch).toHaveAttribute("aria-pressed","false");
  await page.getByRole("button",{name:"Guía de uso"}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Guía de Editar"}).click();
  const tour=editTour(page);
  await expect(tour).toContainText("Abre Editar");
  await expect(launch).toHaveAttribute("aria-describedby",/prisma-instruction/);
  await page.screenshot({path:info.outputPath("entrada-"+width+".png")});
  await launch.click();
  await expect(launch).toHaveAttribute("aria-pressed","true");
  await expect(editBar(page)).toBeVisible();
  const panel=selectionPanel(page);
  await expect(panel).toBeVisible();
  const mascot=panel.locator("svg").first();
  const mascotEntry=mascot.locator("..");
  const pointer=page.locator(".tour-pointer");
  if(reducedMotion){
    await expect(mascotEntry).toHaveCSS("animation-name","none");
    await expect(pointer).toHaveCSS("transition-property","none");
  }else{
    await expect(mascotEntry).toHaveCSS("animation-name",/edit-arrival/);
    await expect(pointer).toHaveCSS("transition-property","transform");
  }
  const group=panel.getByRole("button",{name:"Agrupar"});
  const search=panel.getByRole("textbox",{name:"Buscar pieza para la propuesta"});
  if(await panel.getByRole("listitem").count()===0){
    await expect(search).toHaveAttribute("aria-describedby",/prisma-instruction/);
    await search.fill("acero");
    await panel.locator('[data-prisma-tour="result"]').first().click();
  }
  await expect(tour).toContainText("Activa Agrupar");
  await tour.getByRole("button",{name:"Pausar"}).click();
  await expect(pointer).toHaveCount(0);
  await tour.getByRole("button",{name:"Reanudar"}).click();
  await group.click();
  await expect(tour).toContainText("Busca otra pieza");
  await search.fill("fachada");
  await expect(tour).toContainText("Añade esta pieza");
  await panel.locator('[data-prisma-tour="result"]').first().click();
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  // Plegar el panel no sale de Editar: la guía señala el botón del explorador, que lo despliega con la misma selección.
  await panel.getByRole("button",{name:"Plegar selección"}).click();
  await expect(tour).toContainText("Muestra la selección");
  const showExplorer=page.getByRole("button",{name:"Mostrar explorador"});
  await expect(showExplorer).toHaveAttribute("aria-describedby",/prisma-instruction/);
  await expect(launch).toHaveAttribute("aria-pressed","true");
  await showExplorer.click();
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await expect(tour).toContainText("Encuadra la selección");
  await panel.getByRole("button",{name:"Encuadrar selección"}).click();
  await expect(tour).toContainText("Prueba un acabado");
  await panel.getByRole("button",{name:"Probar color"}).click();
  await expect(tour).toContainText("Exporta la propuesta");
  await page.screenshot({path:info.outputPath("exportar-"+width+".png")});
  const download=page.waitForEvent("download");
  await panel.getByRole("button",{name:"Exportar PNG"}).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await expect(tour).toContainText("Edita con una máscara");
  const edit=panel.getByText("Editar en Gemini con máscara",{exact:true});
  await expect(edit).toHaveAttribute("aria-describedby",/prisma-instruction/);
  await edit.click();
  await expect(tour).toContainText("Describe el cambio");
  await panel.getByLabel("Cambio para Gemini").fill("Aplica zinc oscuro a las piezas seleccionadas.");
  const prepare=panel.getByRole("button",{name:"Preparar paquete para Gemini"});
  await expect(prepare).toHaveAttribute("aria-describedby",/prisma-instruction/);
  // Con Seleccionar activo, arrastrar sobre el lienzo dibuja una zona (DU-17): se apaga para desplazar la cámara.
  const select=editBar(page).getByRole("button",{name:"Seleccionar"});
  await select.click();
  await expect(select).toHaveAttribute("aria-pressed","false");
  await page.getByRole("button",{name:"Desplazar",exact:true}).click();
  const canvas=(await page.locator(".view canvas").boundingBox())!;
  for(let drag=0;drag<5;drag++){
    const y=canvas.y+canvas.height*.44;
    await page.mouse.move(canvas.x+canvas.width*.85,y);
    await page.mouse.down();
    await page.mouse.move(canvas.x+canvas.width*.16,y,{steps:4});
    await page.mouse.up();
  }
  await prepare.click();
  await expect(panel.getByRole("alert")).toContainText("Hay piezas fuera de vista");
  const recover=panel.getByRole("button",{name:"Reencuadrar y preparar de nuevo"});
  await expect(recover).toHaveAttribute("aria-describedby",/prisma-instruction/);
  await recover.click();
  const packageButton=panel.getByRole("link",{name:"Descargar paquete para Gemini"});
  await expect(packageButton).toHaveAttribute("aria-describedby",/prisma-instruction/);
  const mask=panel.getByRole("img",{name:"Área editable de la selección"});
  await expect(mask).toBeVisible();
  await expect.poll(async()=>{
    const card=await tour.boundingBox(),image=await mask.boundingBox();
    return !!card && !!image && (card.y+card.height<=image.y || card.y>=image.y+image.height ||
      card.x+card.width<=image.x || card.x>=image.x+image.width);
  }).toBe(true);
  await page.screenshot({path:info.outputPath("paquete-listo-"+width+".png")});
  const downloadZIP=page.waitForEvent("download");
  await packageButton.click();
  const zip=await downloadZIP;
  expect(zip.suggestedFilename()).toBe("ObraCota-edicion-Gemini.zip");
  const original=unzipSync(await readFile((await zip.path())!))["01-vista-original.png"];
  await expect(tour).toContainText("Importa el resultado de Gemini");
  const importButton=panel.getByRole("button",{name:"Seleccionar imagen de Gemini"});
  await expect(importButton).toHaveAttribute("aria-describedby",/prisma-instruction/);
  await expect(tour).toContainText("El paquete ya está cargado");
  const retryZIP=page.waitForEvent("download");
  await packageButton.click();
  expect((await retryZIP).suggestedFilename()).toBe(zip.suggestedFilename());
  await page.screenshot({path:info.outputPath("importar-mascara-"+width+".png")});
  const choosingImage=page.waitForEvent("filechooser");
  await importButton.click();
  const imageChooser=await choosingImage;
  expect(await imageChooser.element().getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
  await imageChooser.setFiles({name:"ensayo-mismo-encuadre.png",mimeType:"image/png",buffer:Buffer.from(original)});
  const saveProtected=panel.getByRole("button",{name:"Guardar PNG protegido"});
  await expect(saveProtected).toHaveAttribute("aria-describedby",/prisma-instruction/);
  const downloadProtected=page.waitForEvent("download");
  await saveProtected.click();
  expect((await downloadProtected).suggestedFilename()).toBe("ObraCota-edicion-protegida.png");
  await expect(tour).toContainText("Guía de Editar completada");
  await tour.getByRole("button",{name:"Finalizar"}).click();
  await expect(tour).toHaveCount(0);
  expect(requests).toEqual([]);
  await panel.getByRole("button",{name:"Guía de Editar",exact:true}).click();
  await expect(tour).toBeVisible();
  await tour.getByRole("button",{name:"Omitir"}).click();
  await expect(tour).toHaveCount(0);
  await page.getByRole("button",{name:"Guía de uso"}).click();
  await page.getByRole("button",{name:"Iniciar guía",exact:true}).click();
  const reviewTour=page.getByRole("region",{name:"Tutorial visual"});
  await expect(reviewTour).toBeVisible();
  await reviewTour.getByRole("button",{name:"Omitir"}).click();
  await expect(reviewTour).toHaveCount(0);
});
