import {test,expect} from "@playwright/test";
import {writeFile} from "node:fs/promises";
import path from "node:path";

for(const width of [1480])test("Auditoría individual de Lectura · piscina "+width,async({page},info)=>{
  test.setTimeout(300000);
  const file=process.env.TEST_DWG;
  test.skip(!file || path.basename(file).toLowerCase()!=="dwg_piscina_030824.dwg");
  await page.setViewportSize({width,height:667});
  await page.goto("/proyectos/restage/visor");await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
  await page.locator("header input").setInputFiles(file!);
  await expect(page.locator(".project")).toHaveText(path.basename(file!));
  const levels=page.locator("button.level");
  const total=(await levels.locator("small").allTextContents()).reduce((n,v)=>n+Number(v),0);
  for(const level of await levels.all())if(await level.getAttribute("aria-expanded")==="false")await level.click();
  const more=page.getByRole("button",{name:"Ver más elementos"});
  while(await more.count())await more.first().click();
  await expect(page.locator(".entry")).toHaveCount(total);
  const rows=await page.evaluate(async()=>{
    const canvas=document.querySelector("canvas")!;
    const sample=document.createElement("canvas");sample.width=192;sample.height=128;
    const ctx=sample.getContext("2d",{willReadFrequently:true})!;
    const rows=[];
    const entries=Array.from(document.querySelectorAll<HTMLButtonElement>(".entry"));
    for(const [index,entry] of entries.entries()){
      entry.click();
      // The viewer renders synchronously on selection. Sample before WebGL
      // discards its drawing buffer, excluding the HTML marker and its label.
      ctx.clearRect(0,0,192,128);ctx.drawImage(canvas,0,0,192,128);
      const rgba=ctx.getImageData(0,0,192,128).data;
      let ink=0,highlight=false;
      const isGeometry=!entry.dataset.elementId?.match(/^(annotation|dimension):/);
      function highlighted(pixels:Uint8ClampedArray){
        for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>12 && pixels[i]>210 && pixels[i+1]>75 && pixels[i+1]<140 && pixels[i+2]<32)return true;
        return false;
      }
      if(isGeometry){
        highlight=highlighted(rgba);
        if(!highlight){
          const detail=document.createElement("canvas");detail.width=canvas.width;detail.height=canvas.height;
          const full=detail.getContext("2d")!;full.drawImage(canvas,0,0);
          highlight=highlighted(full.getImageData(0,0,detail.width,detail.height).data);
        }
      }
      for(let i=3;i<rgba.length;i+=4)if(rgba[i]>8)ink++;
      // A thin CAD stroke can disappear when reduced to 192 × 128.
      // Confirm an apparently blank view at its actual rendering resolution.
      if (!ink) {
        const detail = document.createElement("canvas");
        detail.width = canvas.width;
        detail.height = canvas.height;
        const full = detail.getContext("2d")!;
        full.drawImage(canvas, 0, 0);
        const pixels = full.getImageData(0, 0, detail.width, detail.height).data;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) ink++;
      }
      await Promise.resolve();
      const marker=document.querySelector<HTMLElement>(".note-marker")!;
      rows.push({index,level:entry.closest(".branches")!.previousElementSibling!.querySelector("span")!.textContent,
        item:entry.textContent,id:entry.dataset.elementId,notice:document.querySelector<HTMLElement>(".plan-location-hint:not([hidden])")?.textContent??null,
        highlight,isGeometry,selected:entry.getAttribute("aria-pressed")==="true",ink,marker:!marker.hidden});
      if(index%10===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    return rows;
  });
  await writeFile(info.outputPath("elementos.json"),JSON.stringify(rows,null,2));
  expect(new Set(rows.map(r=>r.id)).size).toBe(total);
  const empty=rows.filter(r=>!r.ink);
  console.log({total,empty:empty.length,unselected:rows.filter(r=>!r.selected).length});
  const missing=rows.filter(r=>!r.notice && !(r.isGeometry?(r.highlight || r.marker):r.marker));
  expect(missing.map(r=>r.id)).toEqual([]);
  expect(empty.map(r=>r.index)).toEqual([]);
  expect(rows.every(r=>r.selected)).toBe(true);
});
