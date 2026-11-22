import {test,expect,type Page} from "@playwright/test";
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {reviewDelivery} from "../src/modules/model-file/application/review-delivery";

// La revisión de entrega es REVISAR (tecla V) en la barra inferior del visor: un panel «Revisión de entrega»
// anclado sobre el botón, con los conceptos del DWG y «Preparar informe», y el informe en un diálogo modal
// «Informe de revisión» con «Descargar informe» (model-file/ui/delivery-review.tsx).
const reportDialog=(page:Page)=>page.getByRole("dialog",{name:"Informe de revisión"});

async function load(page:Page,file:string){
  await page.goto("/proyectos/restage/visor");await expect(page.locator(".inspector")).toContainText("GlobalId");
  await page.locator("input[type=file]").setInputFiles(path.resolve(file));
  await expect(page.locator(".project")).toHaveText(path.basename(file),{timeout:90000});
  await page.getByRole("toolbar",{name:"Acciones del modelo"}).getByRole("button",{name:"Revisar entrega"}).click();
  await expect(page.getByRole("dialog",{name:"Revisión de entrega"})).toBeVisible();
}
async function exported(page:Page){
  const result=page.waitForEvent("download");
  await reportDialog(page).getByRole("button",{name:"Descargar informe"}).click();
  return readFile((await (await result).path())!,"utf8");
}
test("Reglas IFC distinguen relación directa, material y GUID",()=>{
  const items=[{id:"1",type:"IFCBEAM",name:"Viga",level:"Planta",guid:"g",material:"Acero"},{id:"2",type:"IFCBEAM",name:"Viga",level:"Sin nivel directo"}];
  const r=reviewDelivery({name:"control",schema:"IFC4",sample:false,elements:items},"",{"999":"Nota antigua"});
  expect(r.checks.map(c=>c.evidence.map(e=>e.id))).toEqual([["2"],["2"],["2"]]);
  expect(r.observations[0].source).toBeNull();
});
test("Entrega DWG · extracción, variantes, omisiones y archivo descargado",async({page},info)=>{
  const file=process.env.TEST_DWG;test.skip(!file || !file.toLowerCase().endsWith("dwg_piscina_030824.dwg"));
  await load(page,file!);
  const run=page.getByRole("button",{name:"Preparar informe"});
  const terms=page.getByLabel("Conceptos que pide la entrega");
  await run.click();await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await terms.fill(Array.from({length:31},(_,i)=>"t"+i).join("\n"));await run.click();await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await terms.fill("rebose\nRÉBOSE\nrebosse\nxqzwv391");await run.click();
  const report=await exported(page);
  expect(report).toContain("Texto encontrado (6)");expect(report).toMatch(/Texto parecido · verificar \([1-9]/);
  expect(report).toContain("xqzwv391 — Sin evidencia en textos leídos (0)");
  expect(report).toContain("HATCH");expect(report).toMatch(/Versión: [0-9a-f]{64}/);
  expect(report.match(/— Texto encontrado/g)).toHaveLength(1);
  const exact=reportDialog(page).locator("details").first();
  await exact.locator("summary").click();await exact.getByRole("button").first().click();
  await expect(page.locator(".note-marker")).toBeVisible();
  await page.getByText("Texto de origen",{exact:true}).click();
  await expect(page.locator(".inspector code")).toContainText(/rebose/i);
  await page.getByRole("tab",{name:"Propiedades"}).click();await page.getByText("Observaciones locales (0)").click();await page.getByLabel("Observación sobre la selección").fill("Validar con hidráulica");
  await page.getByRole("button",{name:"Guardar observación"}).click();
  await page.getByRole("button",{name:"Revisar entrega"}).click();await run.click();
  const final=await exported(page);expect(final).toContain("Validar con hidráulica —");
  await writeFile(info.outputPath("informe-piscina.txt"),final,"utf8");
  await page.screenshot({path:info.outputPath("revision-piscina.png")});
  // Los conceptos viven en el panel de REVISAR y el informe en su diálogo modal: se cierra el informe,
  // el foco vuelve a REVISAR y la tecla V reabre el panel con lo escrito (delivery-review.tsx, keepMounted).
  const stale=page.locator(".delivery-review").getByRole("button",{name:"Descargar informe",includeHidden:true});
  const reviewButton=page.getByRole("toolbar",{name:"Acciones del modelo"}).getByRole("button",{name:"Revisar entrega"});
  await reportDialog(page).getByRole("button",{name:"Cerrar revisión"}).click();
  await expect(reportDialog(page)).toBeHidden();await expect(reviewButton).toBeFocused();await expect(stale).toHaveCount(1);
  await page.keyboard.press("v");
  const panel=page.getByRole("dialog",{name:"Revisión de entrega"});await expect(panel).toBeVisible();
  await expect(terms).toHaveValue("rebose\nRÉBOSE\nrebosse\nxqzwv391");
  // Cambiar los conceptos descarta el informe anterior: no queda un resultado viejo que descargar.
  await terms.fill("otro");await expect(stale).toHaveCount(0);await expect(page.getByRole("button",{name:"Descargar informe"})).toHaveCount(0);
  await panel.getByRole("button",{name:"Cerrar revisión"}).click();
  await expect(panel).toBeHidden();await expect(reviewButton).toBeFocused();
});
test("Entrega IFC · validar evidencia del informe contra el STEP original",async({page})=>{
  const file=process.env.TEST_IFC;test.skip(!file);await load(page,file!);
  await page.getByRole("button",{name:"Preparar informe"}).click();const report=await exported(page);
  expect(report).toContain("GlobalId sin extraer — Sin hallazgos en el alcance (0)");
  const source=await readFile(path.resolve(file!),"utf8");
  const evidence=Array.from(report.matchAll(/ · ID (\d+) · ([\w$]{22})(?:\r?\n|$)/g));
  expect(evidence.length).toBeGreaterThan(0);
  const objects=new Map(Array.from(source.matchAll(/#(\d+)\s*=\s*IFC\w+\s*\(\s*'([\w$]{22})'/gi),m=>[m[1],m[2]]));
  for(const [,id,guid] of evidence)expect(objects.get(id)).toBe(guid);
  await page.getByRole("button",{name:"Cerrar revisión"}).click();
  await page.getByRole("searchbox").fill("ifc");
  const more=page.getByRole("button",{name:"Ver más elementos"}).first();
  const branch=more.locator(".."), initial=await branch.locator(".entry").count();
  await more.click();expect(await branch.locator(".entry").count()).toBeGreaterThan(initial);
  console.log(report.split(/\r?\n/).filter(l=>l.includes(" — ")||l.startsWith("Registros revisados")).slice(0,4));
});
for(const [width,height] of [[1366,768]])test("Ejemplo · alcance limitado, diálogo y teclado · "+width,async({page})=>{
  await page.setViewportSize({width,height});await page.goto("/proyectos/restage/visor");
  await page.getByRole("button",{name:"Revisar entrega"}).click();
  await page.getByRole("button",{name:"Preparar informe"}).click();
  const text=await exported(page);expect(text).toContain("Conjuntos del ejemplo GLB");expect(text).not.toContain("Material directo sin extraer");
  await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button",{name:"Guía de uso"}).click();
  const popup=page.waitForEvent("popup");await page.getByRole("link",{name:/Créditos/}).click();
  await expect((await popup).locator("body")).toContainText("ReStage");
});

test("Operaciones de revisión, selector de archivos y recuperación de WebGL",async({page})=>{
  await page.goto("/proyectos/restage/visor");await expect(page.locator(".inspector")).toContainText("GlobalId");
  const button=(name:string)=>page.getByRole("button",{name,exact:true});
  const chooser=page.waitForEvent("filechooser");await button("Abrir archivo").click();
  await (await chooser).setFiles({name:"invalido.dwg",mimeType:"application/octet-stream",buffer:Buffer.from("invalido")});
  await expect(page.getByText("La cabecera del archivo DWG no es válida.")).toBeVisible();
  await button("Volver al modelo").click();await button("Desplazar").click();await button("Orbitar").click();
  await expect(button("Orbitar")).toHaveAttribute("aria-pressed","true");
  const canvas=page.locator("canvas");const before=await canvas.screenshot();await button("Alejar").click();expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole("searchbox").fill("STL1");const level=page.locator(".level").first();await level.click();await expect(level).toHaveAttribute("aria-expanded","false");
  await button("Coincidencia siguiente").click();await expect(page.locator(".entry[aria-pressed=true]")).toBeVisible();
  await page.getByRole("tab",{name:"Propiedades"}).click();await page.getByText("Observaciones locales (0)").click();
  const draft=page.getByLabel("Observación sobre la selección");await draft.fill("Revisar");await button("Guardar observación").click();await draft.fill("");await button("Eliminar observación").click();await expect(page.getByText("Observaciones locales (0)")).toBeVisible();
  await button("Ocultar explorador").click();await button("Mostrar explorador").click();
  const views=page.getByRole("combobox",{name:"Cambiar orientación"});let previous=await canvas.screenshot();
  for(const value of ["front","right","back","bottom","left","top","iso"]){await views.selectOption(value);const next=await canvas.screenshot();expect(next.equals(previous)).toBe(false);previous=next;}
  await canvas.evaluate(c=>c.dispatchEvent(new Event("webglcontextlost",{cancelable:true})));await button("Reintentar").click();await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".project")).toHaveText("ReStage");
  await button("Cerrar modelo").click();await expect(button("Revisar entrega")).toHaveCount(0);
  const emptyChooser=page.waitForEvent("filechooser");await button("Elegir archivo").click();
  await (await emptyChooser).setFiles({name:"x.ifc",mimeType:"text/plain",buffer:Buffer.from("invalido")});await expect(page.getByText(/cabecera IFC STEP válida/)).toBeVisible();
});
test("Cancelar una carga conserva la versión previa",async({page})=>{
  const file=process.env.TEST_IFC;test.skip(!file);
  await page.goto("/proyectos/restage/visor");await expect(page.locator(".inspector")).toContainText("GlobalId");
  await page.locator("input[type=file]").setInputFiles(path.resolve(file!));await page.getByRole("button",{name:"Cancelar",exact:true}).click();
  await expect(page.locator(".project")).toHaveText("ReStage");await expect(page.locator("canvas")).toBeVisible();
});
test("Síntesis extractiva · cuatro observaciones reales de sesión y tres citas distintas",async({page})=>{
  await page.goto("/proyectos/restage/visor");await expect(page.locator(".inspector")).toContainText("GlobalId");
  const entries=page.locator(".entry");
  const comments=["Revisar anclaje de viga","Revisar anclaje de viga","Solicitar ficha de cubierta","Contrastar conexión con hidráulica"];
  await page.getByRole("tab",{name:"Propiedades"}).click();await page.getByText("Observaciones locales (0)").click();
  for(const [i,comment] of comments.entries()){
    await page.getByRole("tab",{name:"Lectura"}).click();await entries.nth(i).click();await page.getByRole("tab",{name:"Propiedades"}).click();
    await page.getByLabel("Observación sobre la selección").fill(comment);
    await page.getByRole("button",{name:"Guardar observación"}).click();
    await expect(page.locator(".review-notes summary")).toContainText("("+String(i+1)+")");
  }
  await page.getByRole("button",{name:"Revisar entrega"}).click();await page.getByRole("button",{name:"Preparar informe"}).click();
  const report=await exported(page),summary=report.split("Extractos del revisor")[1].split("Observaciones del revisor")[0];
  expect(summary.split(" — ID ")).toHaveLength(4);
  for(const text of new Set(comments))expect(summary).toContain(text);
  expect(report).toContain("Observaciones del revisor (4)");
});
