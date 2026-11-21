import {expect,test,type Page,type Locator} from "@playwright/test";

test.use({storageState:{cookies:[],origins:[]}});

async function pointsTo(page:Page,target:Locator){
  const marker=page.locator(".tour-light");
  await expect.poll(async()=>{
    const [a,b,c,p]=await Promise.all([target.boundingBox(),marker.boundingBox(),page.locator(".tour-card").boundingBox(),page.locator(".tour-pointer").boundingBox()]);
    if(!a||!b||!c||!p)return false;
    const overlap=Math.min(a.x+a.width,c.x+c.width)>Math.max(a.x,c.x) && Math.min(a.y+a.height,c.y+c.height)>Math.max(a.y,c.y);
    const viewport=page.viewportSize()!;
    const pointerX=Math.max(0,Math.min(a.x+a.width*.68,viewport.width-26));
    const pointerY=Math.max(0,Math.min(a.y+a.height*.62,viewport.height-32));
    return !overlap && Math.abs(b.x-a.x+3)<2 && Math.abs(b.y-a.y+3)<2 && Math.abs(b.width-a.width-6)<2 && Math.abs(p.x-pointerX)<2 && Math.abs(p.y-pointerY)<2;
  }).toBe(true);
}
for(const width of [1006,390]){
  test("Cursor y spotlight desde selección a descarga · "+width,async({page})=>{
    test.skip(width<721,"Móvil fuera de alcance: la aplicación se diseña solo para escritorio.");
    await page.setViewportSize({width,height:width===390?844:667});
    await page.emulateMedia({reducedMotion:width===390?"reduce":"no-preference"});
    await page.goto("/proyectos/restage/visor");await page.getByRole("button",{name:"Iniciar guía"}).click();
    const row=page.locator(".entry").first();await pointsTo(page,row);
    if(width===390)expect(await page.locator(".tour-pointer").evaluate(n=>getComputedStyle(n).transitionDuration)).toBe("0s");
    const controls=page.locator(".tour-controls");
    await controls.getByText("Pausar").click();await expect(page.locator(".tour-pointer")).toHaveCount(0);
    await controls.getByText("Reanudar").click();await pointsTo(page,row);
    await row.click();await pointsTo(page,page.locator(".review-notes summary"));
    await controls.getByText("Atrás").click();await pointsTo(page,row);await row.click();
    await controls.getByText("Reiniciar").click();await pointsTo(page,row);await row.click();
    const summary=page.locator(".review-notes summary");await summary.click();
    const note=page.locator(".review-notes textarea");await pointsTo(page,note);await note.fill("Contrastar detalle con arquitectura.");
    const save=page.getByRole("button",{name:"Guardar observación"});await pointsTo(page,save);await save.click();
    const review=page.getByRole("button",{name:"Revisar entrega"});await pointsTo(page,review);await review.click();
    const prepare=page.getByRole("button",{name:"Preparar informe"});await pointsTo(page,prepare);await prepare.click();
    const download=page.getByRole("button",{name:"Descargar informe"});await pointsTo(page,download);
    const file=page.waitForEvent("download");await download.click();expect((await file).suggestedFilename()).toContain("revision.txt");
    await expect(page.getByRole("dialog",{name:"Guía completada"})).toBeVisible();
  });
}
