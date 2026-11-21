import {test,expect} from "@playwright/test";
import path from "node:path";

for(const width of [1480,390])test("Lectura localiza sin perder la escala · "+width,async({page},info)=>{
  const file=process.env.TEST_DWG;
  test.skip(!file || path.basename(file).toLowerCase()!=="dwg_piscina_030824.dwg");
  // Read the horizontal scale that the live WebGL renderer sends to its shaders.
  await page.addInitScript(()=>{
    const gl=WebGL2RenderingContext.prototype;
    const locations=new WeakSet<WebGLUniformLocation>();
    const get=gl.getUniformLocation;
    gl.getUniformLocation=function(program,name){
      const location=get.call(this,program,name);
      if(location && name==="projectionMatrix")locations.add(location);
      return location;
    };
    const send=gl.uniformMatrix4fv;
    gl.uniformMatrix4fv=function(location,transpose,data,...args){
      if(location && locations.has(location))document.documentElement.dataset.testScale=String(Array.from(data)[0]);
      return send.call(this,location,transpose,data,...args);
    };
  });
  await page.setViewportSize({width,height:width===390?844:667});
  await page.goto("/proyectos/restage/visor");await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
  await page.locator("header input").setInputFiles(file!);
  await expect(page.locator(".project")).toHaveText(path.basename(file!),{timeout:60_000});
  const scale=()=>page.evaluate(()=>Number(document.documentElement.dataset.testScale));
  const sheetScale=await scale();
  const search=page.getByRole("searchbox"),zoom=page.getByRole("button",{name:"Acercar",exact:true});
  for(const term of ["rebose","Trazos · Dibujo","2BD4A"]){
    await search.fill(term);
    // Exercise the real working scale, including zoom applied by the user.
    await zoom.click();await zoom.click();
    const before=await scale();expect(before).toBeGreaterThan(0);
    await page.locator(".entry").first().click();
    const after=await scale();
    // Context for a remote annotation may require a wider view. A group
    // on visible geometry must retain the working scale.
    if(term==="Trazos · Dibujo")expect(after).toBeGreaterThanOrEqual(before*.99999);
    else expect(after).toBeGreaterThan(sheetScale);
    if(term==="Trazos · Dibujo"){
      // Verify that the centre contains drawing ink, not the empty space
      // between disjoint traces. Read the real canvas screenshot in the browser.
      const image=(await page.locator("canvas").screenshot()).toString("base64");
      const hasInk=await page.evaluate(async data=>{
        const blob=await (await fetch("data:image/png;base64,"+data)).blob();
        const bitmap=await createImageBitmap(blob);
        const tile=document.createElement("canvas");tile.width=tile.height=9;
        const ctx=tile.getContext("2d")!;
        ctx.drawImage(bitmap,Math.floor(bitmap.width/2)-4,Math.floor(bitmap.height/2)-4,9,9,0,0,9,9);
        bitmap.close();
        const pixels=ctx.getImageData(0,0,9,9).data;
        return pixels.some((value,i)=>i%4===2 && value<160);
      },image);
      expect(hasInk).toBe(true);
    }else{
      const marker=page.locator(".note-marker");
      await expect(marker).toBeVisible();
      const box=(await page.locator("canvas").boundingBox())!,pin=(await marker.boundingBox())!;
      expect(Math.abs(pin.x+pin.width/2-box.x-box.width/2)).toBeLessThan(2);
      expect(Math.abs(pin.y+pin.height/2-box.y-box.height/2)).toBeLessThan(2);
    }
  }
  await page.screenshot({path:info.outputPath("cota-localizada.png")});
});
