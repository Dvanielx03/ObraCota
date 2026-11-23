import {expect,test,type Locator} from "@playwright/test";
import {basename} from "node:path";
import {createProject,openFirstVersion} from "./support/opciones-visuales";

async function checkArt(figure:Locator,asset:string,accent:string){
  await expect(figure).toBeVisible();
  await expect(figure).toContainText("Ilustración generada con IA");
  const art=figure.locator(".empty-illustration-image");
  await expect(art).toBeVisible();
  const layers=await art.evaluate(element=>{
    const ink=getComputedStyle(element,"::before"),mark=getComputedStyle(element,"::after");
    return {ink:ink.maskImage,mark:mark.maskImage,accent:mark.backgroundColor};
  });
  expect(layers.ink).toContain(asset+"-tinta.webp");
  expect(layers.mark).toContain(asset+"-acento.webp");
  expect(layers.accent).toBe(accent);
  for(const layer of ["tinta","acento"]){
    const response=await figure.page().request.get("/loaders/"+asset+"-"+layer+".webp");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/webp");
  }
}

for(const [theme,accent] of [["light","rgb(4, 120, 87)"],["dark","rgb(52, 211, 153)"]] as const){
  test("Arte de Cambios y Versiones · "+theme,async({page},info)=>{
    const file=process.env.DUPLEX_IFC;
    test.skip(!file,"Indica DUPLEX_IFC para abrir una versión IFC real.");
    await page.addInitScript(value=>localStorage.setItem("obracota.theme.v1",value),theme);
    await page.emulateMedia({colorScheme:theme,reducedMotion:"reduce"});
    const project=await createProject(page,"Arte de estados "+theme);
    try{
      let release!:()=>void;
      const held=new Promise<void>(resolve=>{release=resolve;});
      const path="/proyectos/"+project.id;
      await page.route("**/api/projects/"+project.id+"/model-changes",async route=>{
        await held;
        await route.continue();
      },{times:1});
      try{
        await page.goto(path+"/cambios");
        await expect(page.getByRole("status").filter({hasText:"Cargando revisiones"})).toBeVisible();
        await checkArt(page.locator(".changes-loading figure"),"sin-cambios",accent);
      }finally{release();}
      await expect(page.getByRole("heading",{name:"Sin cambios registrados"})).toBeVisible();
      await checkArt(page.locator(".panel-empty figure"),"sin-cambios",accent);
      await page.screenshot({path:info.outputPath("cambios-"+theme+".png")});
      await openFirstVersion(page,project.id,file!,basename(file!));
      const rail=page.getByRole("navigation",{name:"Versiones del archivo"});
      await expect(rail.getByText("Primera versión")).toBeVisible();
      await checkArt(rail.locator("figure"),"sin-revisiones",accent);
      await rail.screenshot({path:info.outputPath("versiones-"+theme+".png")});
    }finally{await project.remove();}
  });
}
