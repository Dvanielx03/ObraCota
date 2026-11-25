import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";

test("El IFC ensanchado conserva el ancho divergente como evidencia separada",async({page})=>{
  const path=process.env.DUPLEX_WIDER_IFC;
  test.skip(!path,"Indica el IFC derivado del ensayo de ensanchamiento.");
  await page.goto("/proyectos/restage/visor");
  await expect(page.locator(".project")).toHaveText("ReStage");
  await page.locator("input[type=file]").first().setInputFiles(path!);
  await page.getByRole("searchbox").fill("150173");
  await page.locator("#explorer .entry").first().click();
  await page.getByRole("tab",{name:"Propiedades"}).click();
  await page.getByText("Medidas y acabado",{exact:true}).click();
  await expect(page.locator(".door-evidence")).toContainText("0,864 m");
  await expect(page.locator(".door-evidence")).toContainText("Discrepancia de ancho: 0,762 m");
  await expect(page.locator(".door-evidence")).toContainText("PSet_Revit_Type_Dimensions.Width");
});

test("Duplex conserva medidas y ficha con cita verificable por puerta y versión",async({page},info)=>{
  const ifc=process.env.DUPLEX_IFC, pdf=process.env.DUPLEX_DOOR_PDF;
  test.skip(!ifc||!pdf,"Indica DUPLEX_IFC y DUPLEX_DOOR_PDF del conjunto de buildingSMART.");
  test.setTimeout(360000);
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const project=await page.request.post("/api/projects",{headers,data:{name:"Comprobación de fichas"}});
  const id=(await project.json()).id;
  const files="/proyectos/"+id+"/archivos";
  try{
    await page.goto(files);
    async function upload(){await page.getByTestId("model-upload").setInputFiles(ifc!);await page.getByRole("button",{name:"Guardar versión"}).click();}
    async function door(code:string){
      await page.getByRole("tab",{name:"Lectura"}).click();
      await page.getByRole("searchbox").fill(code);
      await page.locator("#explorer .entry").first().click();
      await page.getByRole("tab",{name:"Propiedades"}).click();
      await page.getByText("Medidas y acabado",{exact:true}).click();
    }
    await upload();await page.getByRole("link",{name:"Abrir versión 1 en el visor"}).click();
    await door("150173");
    const view=page.locator(".door-evidence");
    await expect(view).toContainText("0,762 m");
    await expect(view).toContainText("2,032 m");
    await expect(view).toContainText("El IFC no declara un acabado verificable");
    await view.getByText("Envolvente de la geometría visible").click();
    await expect(view).toContainText("2,108");
    await view.getByLabel("Vincular ficha PDF").setInputFiles({name:"0762x2032Door_ProductData.pdf",mimeType:"application/pdf",buffer:readFileSync(pdf!)});
    await expect(view.locator("blockquote").first()).toBeVisible({timeout:240000});
    await view.getByLabel("Buscar en la ficha").fill("Sticking profile");await view.getByRole("button",{name:"Consultar"}).click();
    const citation=view.locator("blockquote").filter({has:page.getByText("0762x2032Door_ProductData.pdf · pág. 1",{exact:true})});
    await expect(citation).toContainText(/sticking profile/i);
    const version=new URL(page.url()).pathname.split("/").pop();
    const endpoint="/api/projects/"+id+"/versions/"+version+"/specifications";
    const metadata=await (await page.request.get(endpoint,{headers,params:{element:"1hOSvn6df7F8_7GcBWlS8Z"}})).json();
    expect(metadata.documents).toHaveLength(1);
    expect(metadata.documents[0].originalAvailable).toBe(false);
    expect((await page.request.get(endpoint+"/"+metadata.documents[0].id,{headers})).status()).toBe(404);
    const visitor=await fetch(new URL("/api/auth/register",page.url()),{method:"POST",headers:{"X-ObraCota-Client":"web","Content-Type":"application/json"},body:JSON.stringify({email:randomUUID()+"@example.test",password:randomUUID()})});
    const forbidden=await page.request.get(endpoint+"/"+metadata.documents[0].id,{headers:{Authorization:"Bearer "+(await visitor.json()).accessToken}});
    expect(forbidden.status()).toBe(404);
    await page.screenshot({path:info.outputPath("ficha-verificada.png")});
    await view.getByLabel("Buscar en la ficha").fill("sinresultado-uuid");await view.getByRole("button",{name:"Consultar"}).click();
    await expect(view).toContainText("Sin coincidencias");
    await door("146596");await expect(view).toContainText("aún no tiene una ficha");
    await page.reload();await door("150173");await expect(view.locator("blockquote").first()).toBeVisible();
    await page.goto(files);await upload();await page.getByRole("link",{name:"Abrir versión 2 en el visor"}).click();
    await door("150173");await expect(view).toContainText("aún no tiene una ficha");
  }finally{await page.request.delete("/api/projects/"+id,{headers});}
});
