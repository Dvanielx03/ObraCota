import {expect,test,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {DOOR,publishedRevision} from "./support/published-change";
import {backendReady} from "./support/backend";

// H7 · REVISAR with the server's report: the engine's reading of the version and the model change that published it,
// next to the report made in the browser. Real engine, no AI.
test.use({viewport:{width:1366,height:768}});

async function prepareReport(page:Page){
  await page.getByRole("toolbar",{name:"Acciones del modelo"}).getByRole("button",{name:"Revisar entrega"}).click();
  await page.getByRole("dialog",{name:"Revisión de entrega"}).getByRole("button",{name:"Preparar informe"}).click();
  const report=page.getByRole("dialog",{name:"Informe de revisión"});
  await expect(report).toBeVisible({timeout:120_000});
  return report;
}

test("Revisar añade el informe del servidor: lectura del motor y el cambio que publicó la versión",async({page},info)=>{
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc,"Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(360_000);
  await backendReady(page.request);
  const {id,base,headers,v1,v2}=await publishedRevision(page,ifc!,"Prueba de revisión con el servidor");
  try{
    const summary=await (await page.request.get(base+"/versions/"+v2+"/summary",{headers,timeout:120_000})).json();
    await page.goto("/proyectos/"+id+"/visor/"+v2);
    await expect(page.locator(".view[data-ready]")).toBeVisible({timeout:180_000});
    let report=await prepareReport(page);
    const server=report.getByRole("region",{name:"Informe del servidor"});
    await expect(server).toContainText(summary.schema+" · unidad ");
    await expect(server).toContainText("IfcDoor");
    await expect(server).toContainText("Cambiar el tipo de una puerta: disponible");
    const published=server.getByRole("article",{name:"Cambio que publicó esta versión: Puerta alternativa para comparar"});
    await expect(published).toContainText("Aplicada");
    await expect(published.getByRole("region",{name:"Receta"})).toContainText("Cambiar tipo");
    await expect(published.getByRole("region",{name:"Diferencias con la base"}).locator(`code[title="${DOOR}"]`)).toBeVisible();
    await expect(published.getByRole("region",{name:"Validación del archivo"})).toContainText("Comprobado");
    await expect(published.getByRole("link",{name:"Abrir su tarjeta"})).toHaveAttribute("href",/\/cambios#/);
    await published.scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath("informe-servidor.png")});
    // The browser's checks are still there, and the download carries both parts.
    await expect(report.getByText("GlobalId sin extraer",{exact:false})).toBeVisible();
    const downloading=page.waitForEvent("download");
    await report.getByRole("button",{name:"Descargar informe"}).click();
    const text=readFileSync(await (await downloading).path(),"utf8");
    expect(text).toContain("REVISIÓN DE ENTREGA");
    expect(text).toContain("INFORME DEL SERVIDOR");
    expect(text).toContain("Huella SHA-256: "+summary.sha256);
    expect(text).toContain("Cambio que publicó esta versión · Puerta alternativa para comparar (Aplicada)");
    expect(text).toContain("    "+DOOR+" · IfcDoor");
    await report.getByRole("button",{name:"Cerrar revisión"}).click();

    // The base v1: the engine's reading, and no change published it or is open over it.
    await page.goto("/proyectos/"+id+"/visor/"+v1);
    await expect(page.locator(".view[data-ready]")).toBeVisible({timeout:180_000});
    report=await prepareReport(page);
    await expect(report.getByRole("region",{name:"Informe del servidor"})).toContainText("Ningún cambio de modelo publicó esta versión ni está abierto sobre ella.");

    // A server that cannot read the model does not hide the browser's report: it says why.
    await page.route(url=>url.pathname.endsWith("/versions/"+v1+"/summary"),route=>route.fulfill({status:503,contentType:"application/json",
      body:JSON.stringify({message:"El motor IFC no está disponible."})}));
    await report.getByRole("button",{name:"Cerrar revisión"}).click();
    report=await prepareReport(page);
    await expect(report.getByRole("region",{name:"Informe del servidor"})).toContainText("La lectura del motor no está disponible");
    await expect(report.getByText("GlobalId sin extraer",{exact:false})).toBeVisible();
  }finally{
    await page.request.delete(base,{headers});
  }
});
