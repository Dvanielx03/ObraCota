import {expect,test} from "@playwright/test";
import path from "node:path";

test("Pulso de Lectura sobre geometría y cotas del DWG",async({page})=>{
  const file=process.env.TEST_DWG;test.skip(!file);
  await page.goto("/proyectos/restage/visor");await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
  await page.locator("header input").setInputFiles(file!);
  await expect(page.locator(".project")).toHaveText(path.basename(file!));
  await page.clock.install({time:new Date("2026-01-01T08:00:00Z")});
  await page.clock.pauseAt(new Date("2026-01-01T08:01:00Z"));
  const search=page.getByRole("searchbox"),marker=page.locator(".note-marker");
  const clickEntry=async(term:string)=>{
    await search.fill(term);await page.locator(".entry").first().click();
  };
  const color=()=>marker.evaluate(el=>getComputedStyle(el).outlineColor);
  const bright="rgb(255, 105, 0)",native="rgb(53, 64, 74)";
  // Exclude the HTML marker so a changing screenshot proves the CAD lines themselves change.
  const capture=()=>page.locator("canvas").screenshot({style:".note-marker{visibility:hidden!important}"});
  await clickEntry("Trazos · Dibujo");
  const start=await capture();
  await page.clock.runFor(2990);expect(await color()).toBe(bright);expect((await capture()).equals(start)).toBe(true);
  await page.clock.runFor(1010);expect(await color()).toBe(native);expect((await capture()).equals(start)).toBe(false);
  await page.clock.runFor(1000);expect(await color()).toBe(bright);expect((await capture()).equals(start)).toBe(true);
  await clickEntry("rebose");await page.clock.runFor(2500);
  await clickEntry("2BD4A");await page.clock.runFor(1200);
  expect(await color()).toBe(bright);
  await page.clock.runFor(2800);expect(await color()).toBe(native);
  await page.emulateMedia({reducedMotion:"reduce"});await page.clock.runFor(100);
  expect(await color()).toBe(bright);
  const steady=await capture();await page.clock.runFor(4200);
  expect((await capture()).equals(steady)).toBe(true);expect(await color()).toBe(bright);
});

for(const drawing of [false,true])test("Pulso por clic en navegación · "+(drawing?"DWG":"ReStage"),async({page})=>{
  const file=process.env.TEST_DWG;test.skip(drawing&&!file);
  await page.setViewportSize({width:1480,height:667});
  await page.goto("/proyectos/restage/visor");await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
  if(drawing){
    await page.locator("header input").setInputFiles(file!);
    await expect(page.locator(".project")).toHaveText(path.basename(file!));
    await page.getByRole("searchbox").fill("Trazos · Dibujo");await page.locator(".entry").first().click();
  }
  const canvas=page.locator("canvas"),box=(await canvas.boundingBox())!;
  const x=box.x+box.width*(drawing?.5:.58),y=box.y+box.height*.5;
  await page.clock.install({time:new Date("2026-01-01T08:00:00Z")});
  await page.clock.pauseAt(new Date("2026-01-01T08:01:00Z"));
  await page.mouse.click(x,y);await expect(page.getByRole("tab",{name:"Propiedades"})).toHaveAttribute("aria-selected","true");
  const selected=page.locator(".inspector strong");await expect(selected).toBeVisible();
  const name=await selected.innerText();
  const capture=()=>canvas.screenshot({style:".note-marker{visibility:hidden!important}"});
  const initial=await capture();await page.clock.runFor(2990);expect((await capture()).equals(initial)).toBe(true);
  await page.clock.runFor(1010);const original=await capture();
  expect(original.equals(initial)).toBe(false);
  await page.clock.runFor(1000);expect((await capture()).equals(original)).toBe(false);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y+10,{steps:6});await page.mouse.up();
  await expect(selected).toHaveText(name);
  for(const [u,v] of [[.02,.95],[.98,.95],[.02,.05],[.98,.05]]){
    await page.mouse.click(box.x+u*box.width,box.y+v*box.height);
    if(await selected.count()===0)break;
  }
  await expect(selected).toHaveCount(0);
  const empty=await capture();await page.clock.runFor(4200);expect((await capture()).equals(empty)).toBe(true);
});
