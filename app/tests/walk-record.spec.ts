import {expect,test,type Download,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {expectWalkable,findFloor} from "./walk-support";
import {recordingClock,recordingName,recordingType} from "../src/viewer/infrastructure/walk-recording";

// H7 · «Grabar» of RECORRIDO: MediaRecorder over the canvas, a WebM the browser downloads. Local IFC, no backend, no AI.
test.use({viewport:{width:1366,height:768}});

test("Nombre, reloj y tipo de la grabación",()=>{
  expect(recordingName("Duplex_A_20110907.ifc",new Date(2026,10,21,14,5))).toBe("obracota-duplex-a-20110907-recorrido-20261121-1405.webm");
  expect(recordingName("Ñandú.IFC",new Date(2026,0,2,3,4))).toBe("obracota-nandu-recorrido-20260102-0304.webm");
  expect(recordingClock(0)).toBe("0:00");
  expect(recordingClock(65_400)).toBe("1:05");
  expect(recordingType(type=>type==="video/webm;codecs=vp8")).toBe("video/webm;codecs=vp8");
  expect(recordingType(()=>false)).toBeUndefined();
});

/** The video the page can decode: its frame size, read by a <video> element from the downloaded bytes. */
async function decoded(page:Page,download:Download){
  const bytes=readFileSync(await download.path());
  return {bytes,frame:await page.evaluate(async data=>{
    const video=document.createElement("video");
    video.muted=true;
    video.src=URL.createObjectURL(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:"video/webm"}));
    await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error("WebM ilegible"));});
    return {width:video.videoWidth,height:video.videoHeight};
  },bytes.toString("base64"))};
}

test("Grabar el recorrido descarga un WebM que se puede reproducir, también al salir mientras graba",async({page},info)=>{
  test.setTimeout(240_000);
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc,"Indica el IFC Duplex original con DUPLEX_IFC.");
  await page.goto("/proyectos/restage/visor");
  await expect(page.locator(".project")).toHaveText("ReStage");
  await page.locator("header input").setInputFiles(ifc!);
  await expect(page.locator(".project")).toHaveText(/Duplex/i,{timeout:180_000});
  await expectWalkable(page,180_000);
  await page.getByRole("button",{name:"Encuadrar modelo"}).click();
  await findFloor(page);
  await expect(page.locator(".walk-hint")).toContainText("Arrastra para mirar");
  const bar=page.getByRole("toolbar",{name:"Controles del recorrido"});
  const record=bar.getByRole("button",{name:"Grabar recorrido"});
  await expect(record).toHaveAttribute("aria-pressed","false");
  await record.click();
  const stop=bar.getByRole("button",{name:"Detener grabación"});
  await expect(stop).toHaveAttribute("aria-pressed","true");
  // Walk forward and turn while it records; the walk measures the frames it draws (KNOWN_ISSUES #4).
  await page.locator(".view canvas").focus();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1600);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(1600);
  await page.keyboard.up("ArrowLeft");
  await expect(stop).toContainText(/Detener\s*0:0[2-9]/);
  const fps=await page.evaluate(()=>(performance.getEntriesByName("obracota:walk-fps").at(-1) as PerformanceMark|undefined)?.detail?.fps??null);
  await info.attach("cuadros-por-segundo",{body:JSON.stringify({fps,gpu:process.env.TEST_HARDWARE_GPU==="1"}),contentType:"application/json"});
  console.log(JSON.stringify({walkFps:fps}));
  expect(fps).toBeGreaterThan(0);
  const first=page.waitForEvent("download");
  await stop.click();
  const video=await first;
  expect(video.suggestedFilename()).toMatch(/^obracota-duplex-a-20110907-recorrido-\d{8}-\d{4}\.webm$/);
  const {bytes,frame}=await decoded(page,video);
  expect([...bytes.subarray(0,4)]).toEqual([0x1a,0x45,0xdf,0xa3]);
  expect(bytes.length).toBeGreaterThan(5_000);
  const canvas=await page.locator(".view canvas").evaluate((node:HTMLCanvasElement)=>({width:node.width,height:node.height}));
  expect(frame).toEqual(canvas);
  await expect(page.getByRole("status").filter({hasText:/Descargado obracota-duplex-a-20110907-recorrido-.*\.webm · 0:0\d de recorrido\./})).toBeAttached();
  await expect(record).toHaveAttribute("aria-pressed","false");

  // Leaving the walk while recording keeps what was recorded.
  await record.click();
  await page.locator(".view canvas").focus();
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(1200);
  await page.keyboard.up("ArrowDown");
  const second=page.waitForEvent("download");
  await page.keyboard.press("Escape");
  const kept=await second;
  expect((await decoded(page,kept)).frame.width).toBeGreaterThan(0);
  await expect(page.getByRole("toolbar",{name:"Controles del recorrido"})).toHaveCount(0);
});
