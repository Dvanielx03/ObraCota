import { test, expect } from "@playwright/test";
import { MODEL_ONLY, modelShown } from "./support/visor";

test("Rueda al cursor, pan, órbita y recuperación de encuadre",async({page})=>{
  await page.setViewportSize({width:1480,height:667});
  await page.goto("/proyectos/restage/visor");await expect(page.locator(".inspector")).toContainText("GlobalId");
  await modelShown(page);
  const canvas=page.locator("canvas"), rect=(await canvas.boundingBox())!;
  // Only the model render: the floating header, bars and the view cube (which turns with the camera) stay out.
  const modelImage=()=>canvas.screenshot({style:MODEL_ONLY});
  const x=rect.x+rect.width*.58,y=rect.y+rect.height*.5;
  // The sample opens with a piece already chosen: the click must pick its own piece from the canvas.
  const preset=await page.locator(".inspector strong").innerText();
  await page.mouse.click(x,y);
  await expect(page.locator(".inspector strong")).not.toHaveText(preset);
  const selected=await page.locator(".inspector strong").innerText();
  const initial=await modelImage();
  await page.mouse.wheel(0,-460);
  await expect.poll(async()=>!(await modelImage()).equals(initial)).toBe(true);
  await page.mouse.click(x,y);
  await expect(page.locator(".inspector strong")).toHaveText(selected);
  for(const shift of [false,true]){
    const before=await modelImage();
    if(shift)await page.keyboard.down("Shift");
    await page.mouse.move(x,y);await page.mouse.down({button:"middle"});
    await page.mouse.move(x+65,y-25,{steps:8});await page.mouse.up({button:"middle"});
    if(shift)await page.keyboard.up("Shift");
    expect((await modelImage()).equals(before)).toBe(false);
  }
  await page.getByRole("button",{name:"Zoom ventana"}).click();
  await page.mouse.move(x-70,y-60);await page.mouse.down();await page.mouse.move(x+70,y+60);
  await expect(page.locator(".zoom-rectangle")).toBeVisible();await page.mouse.up();
  await expect(page.getByRole("button",{name:"Zoom ventana"})).toHaveAttribute("aria-pressed","false");
  await page.getByRole("button",{name:"Restablecer cámara"}).click();
  const views=page.getByRole("combobox",{name:"Cambiar orientación"});
  await views.click();
  await page.keyboard.press("Escape");
  await views.selectOption("left");
  const left=await modelImage();
  await views.click();
  await page.keyboard.press("Escape");
  await views.selectOption("top");
  const top=await modelImage();
  expect(top.equals(left)).toBe(false);
  await views.selectOption("iso");
  expect((await modelImage()).equals(top)).toBe(false);
  await views.selectOption("top");
  await page.getByRole("button",{name:"Restablecer cámara"}).click();
  expect((await modelImage()).equals(top)).toBe(false);
});
