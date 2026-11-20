import {test,expect} from "@playwright/test";
import path from "node:path";

test("La mesa 2D limita arrastre, rueda y zoom por ventana",async({page})=>{
  const file=process.env.TEST_DWG;
  test.skip(!file||path.basename(file).toLowerCase()!=="dwg_piscina_030824.dwg");
  await page.goto("/proyectos/restage/visor");await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
  await page.locator("header input").setInputFiles(file!);
  await expect(page.locator(".project")).toHaveText(path.basename(file!));
  const canvas=page.locator("canvas"),box=(await canvas.boundingBox())!;
  const image=()=>canvas.screenshot({style:".tools,.stagebar{visibility:hidden!important}"});
  const home=await image();
  await page.getByRole("button",{name:"Alejar",exact:true}).click({clickCount:8});
  expect((await image()).equals(home)).toBe(true);
  const x=box.x+box.width*.5,y=box.y+box.height*.5;
  await page.getByRole("button",{name:"Zoom ventana"}).click();
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+18,y+18);await page.mouse.up();
  const zoom=page.getByRole("button",{name:"Acercar",exact:true});
  for(let i=0;i<35;i++)await zoom.click();
  const max=await image();await zoom.click();expect((await image()).equals(max)).toBe(true);
  for(const [dx,dy] of [[.45,.45],[-.45,.45],[-.45,-.45],[.45,-.45]]){
    for(let i=0;i<5;i++){
      await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx*box.width,y+dy*box.height,{steps:3});await page.mouse.up();
    }
    const data=(await image()).toString("base64");
    const visible=await page.evaluate(async data=>{
      const bitmap=await createImageBitmap(await (await fetch("data:image/png;base64,"+data)).blob());
      const tile=document.createElement("canvas");tile.width=bitmap.width;tile.height=bitmap.height;
      const ctx=tile.getContext("2d")!;ctx.drawImage(bitmap,0,0);bitmap.close();
      const pixels=ctx.getImageData(0,0,tile.width,tile.height).data;
      return pixels.some((v,i)=>i%4===2 && v<165);
    },data);
    expect(visible).toBe(true);
  }
  await page.mouse.move(x,y);await page.mouse.wheel(0,16000);
  await page.getByRole("button",{name:"Restablecer cámara"}).click();
  expect((await image()).equals(home)).toBe(true);
});
