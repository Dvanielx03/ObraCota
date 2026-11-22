import {expect,test,type Page,type Locator} from "@playwright/test";

test.use({storageState:{cookies:[],origins:[]}});

// La revisión de entrega vive ahora en REVISAR (tecla V) de la barra inferior del visor: un panel anclado
// sobre su botón con «Preparar informe» (delivery-review.tsx, ToolPopover) y un diálogo modal
// «Informe de revisión» con «Descargar informe». La guía visual (visual-tour.tsx) recorre esos controles.
// El movimiento reducido no depende del ancho: antes solo se emulaba en la variante de 390 px, que D-12
// omite, así que tiene su propia variante de escritorio (globals.css: .tour-pointer sin transición).

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

const variants=[
  {name:"1006",width:1006,height:667,reducedMotion:false},
  {name:"1006 · movimiento reducido",width:1006,height:667,reducedMotion:true},
  {name:"390",width:390,height:844,reducedMotion:true},
];

for(const {name,width,height,reducedMotion} of variants){
  test("Cursor y spotlight desde selección a descarga · "+name,async({page})=>{
    test.skip(width<1000,"Solo escritorio (D-12)");
    await page.setViewportSize({width,height});
    await page.emulateMedia({reducedMotion:reducedMotion?"reduce":"no-preference"});
    await page.goto("/proyectos/restage/visor");await page.getByRole("button",{name:"Iniciar guía"}).click();
    const row=page.locator(".entry").first();await pointsTo(page,row);
    if(reducedMotion)expect(await page.locator(".tour-pointer").evaluate(n=>getComputedStyle(n).transitionDuration)).toBe("0s");
    const controls=page.locator(".tour-controls");
    await controls.getByText("Pausar").click();await expect(page.locator(".tour-pointer")).toHaveCount(0);
    await controls.getByText("Reanudar").click();await pointsTo(page,row);
    await row.click();await pointsTo(page,page.locator(".review-notes summary"));
    await controls.getByText("Atrás").click();await pointsTo(page,row);await row.click();
    await controls.getByText("Reiniciar").click();await pointsTo(page,row);await row.click();
    const summary=page.locator(".review-notes summary");await summary.click();
    const note=page.locator(".review-notes textarea");await pointsTo(page,note);await note.fill("Contrastar detalle con arquitectura.");
    const save=page.getByRole("button",{name:"Guardar observación"});await pointsTo(page,save);await save.click();
    // REVISAR, en la barra «Acciones del modelo», abre su panel con «Preparar informe».
    const review=page.getByRole("toolbar",{name:"Acciones del modelo"}).getByRole("button",{name:"Revisar entrega"});
    await pointsTo(page,review);await review.click();
    const panel=page.getByRole("dialog",{name:"Revisión de entrega"});await expect(panel).toBeVisible();
    const prepare=panel.getByRole("button",{name:"Preparar informe"});await pointsTo(page,prepare);await prepare.click();
    // El informe se abre en su diálogo modal y la guía señala su descarga.
    const report=page.getByRole("dialog",{name:"Informe de revisión"});await expect(report).toBeVisible();await expect(panel).toBeHidden();
    const download=report.getByRole("button",{name:"Descargar informe"});await pointsTo(page,download);
    const file=page.waitForEvent("download");await download.click();expect((await file).suggestedFilename()).toContain("revision.txt");
    await expect(page.getByRole("dialog",{name:"Guía completada"})).toBeVisible();
  });
}
