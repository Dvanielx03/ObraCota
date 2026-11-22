import {expect,test,type APIRequestContext,type Page} from "@playwright/test";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {expectWalkable,findFloor,walkButton} from "./walk-support";

// H1 §8.3: the generalised model change with the real engine, no page.route and no AI. During H1 it runs against the
// parallel stack (VIEWER_URL=http://localhost:3301).
const door="1hOSvn6df7F8_7GcBWlS8Z",alternate="2klOFZffH6WQFlV10uM1wF";
const slow={timeout:180_000};

/**
 * RECORRIDO from the top view, switching between the two models of the walk (`older` first, then back to `newer`):
 * the point of view is kept across the switch (`obracota:walk-switch`), as `design-change.spec.ts` checks.
 */
async function walkBetween(page:Page,older:string,newer:string){
  await expectWalkable(page,60_000);
  await page.getByRole("button",{name:"Encuadrar modelo"}).click();
  await findFloor(page);
  const before=page.getByRole("button",{name:older,exact:true}),after=page.getByRole("button",{name:newer,exact:true});
  await expect(after).toHaveAttribute("aria-pressed","true");
  await before.click();
  await expect(before).toHaveAttribute("aria-pressed","true");
  const transition=await page.evaluate(()=>(performance.getEntriesByName("obracota:walk-switch").at(-1) as PerformanceMark).detail);
  expect(transition.distance).toBeLessThan(.03);
  expect(transition.angle).toBeLessThan(.001);
  await after.click();
  await expect(after).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Salir",exact:true}).click();
  await expect(page.getByRole("toolbar",{name:"Controles del recorrido"})).toHaveCount(0);
  await expect(walkButton(page)).toBeFocused();
}

/** The JSON body of an API answer, after checking its status (the message of a failure says why). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose test fixture
async function json(response:Awaited<ReturnType<APIRequestContext["get"]>>,status:number):Promise<any>{
  expect(response.status(),await response.text()).toBe(status);
  return response.json();
}

test("Cambio de modelo: borrador, vista previa en 3D, envío, rechazo, aplicación con precios copiados y restauración",async({page})=>{
  test.setTimeout(180_000);
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc,"Indica el IFC Duplex original con DUPLEX_IFC.");
  const email=randomUUID()+"@example.test";
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email,password:randomUUID()}});
  expect(auth.ok()).toBeTruthy();
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const {id}=await json(await page.request.post("/api/projects",{headers,data:{name:"Prueba de cambio de modelo"}}),201);
  const base="/api/projects/"+id,route="/proyectos/"+id;
  const expectedSha=createHash("sha256").update(readFileSync(ifc!)).digest("hex");
  try{
    const original=await json(await page.request.post(base+"/uploads",{headers:{...headers,"Content-Type":"application/octet-stream"},
      params:{name:"Duplex_A.ifc"},data:readFileSync(ifc!)}),201);
    const v1=original.id as string;

    // E1 · a draft by API, its door operation and the two prices of the base.
    const current=(await json(await page.request.get(base+"/versions/"+v1+"/elements/"+door,{headers}),200)).type.guid as string;
    const draft=await json(await page.request.post(base+"/model-changes",{headers,data:{baseVersion:v1,description:"Probar una puerta alternativa con el mismo hueco"}}),201);
    expect(draft.status).toBe("DRAFT");
    const first=draft.id as string;
    expect((await json(await page.request.post(base+"/model-changes/"+first+"/operations",{headers,...slow,
      data:{op:"ifc.change_type",element:door,type_id:alternate}}),201)).status).toBe("DRAFT");
    const prices=[{key:"type:"+current,unit:"UNIT",amount:100000,source:"Cotización de prueba",date:"2026-11-20"},
      {key:"type:"+alternate,unit:"UNIT",amount:125000,source:"Cotización de prueba",date:"2026-11-20"}];
    await json(await page.request.put(base+"/versions/"+v1+"/prices",{headers,data:{prices}}),200);

    // E2 · preview and submit from the card; every section of the report is there.
    await page.goto(route+"/cambios#"+first);
    const card=page.locator(`article[id="${first}"]`);
    await expect(card.getByRole("heading",{name:"Probar una puerta alternativa con el mismo hueco"})).toBeVisible();
    await expect(card.getByRole("button",{name:"Enviar a aprobación"})).toBeDisabled();
    await card.getByRole("button",{name:"Previsualizar cambio"}).click();
    const submit=card.getByRole("button",{name:"Enviar a aprobación"});
    await expect(submit).toBeEnabled({timeout:150_000});
    await expect(card.getByRole("region",{name:"Receta"})).toContainText("Cambiar tipo");
    await expect(card.getByRole("region",{name:"Avisos de diseño"})).toBeVisible();
    const estimate=card.getByRole("region",{name:"Estimación del cambio"});
    await expect(estimate).toContainText(/25[.,]000/);
    await expect(estimate).toContainText("Cotización de prueba");
    await expect(estimate).toContainText("2026-11-20");
    const diff=card.getByRole("region",{name:"Diferencias con la base"});
    await expect(diff.locator(`code[title="${door}"]`)).toBeVisible();
    await expect(diff).toContainText("tipo");
    const validation=card.getByRole("region",{name:"Validación del archivo"});
    await expect(validation).toContainText("Esquema IFC");
    await expect(validation).toContainText("Comprobado");
    await submit.click();
    await expect(card.getByText("Lista para aprobar",{exact:true})).toBeVisible();
    await expect(card.getByRole("button",{name:"Aprobar y aplicar cambio"})).toBeEnabled();

    // E3 · the 3D preview: the verified IFC downloads, the header says it is unpublished, Comparar lists the door and
    // highlights it, and RECORRIDO switches between «Base» and «Propuesta» from the same point.
    const downloaded=page.waitForResponse(response=>response.url().endsWith("/model-changes/"+first+"/preview") && response.request().method()==="GET");
    await card.getByRole("link",{name:"Ver propuesta en 3D"}).click();
    await expect(page).toHaveURL(new RegExp("/cambios/"+first+"/vista$"));
    expect((await downloaded).status()).toBe(200);
    await expect(page.locator(".view[data-ready]")).toBeVisible({timeout:60_000});
    await expect(page.locator(".viewer-header").getByText("Vista previa sin publicar",{exact:true})).toBeVisible();
    const actions=page.getByRole("toolbar",{name:"Acciones del modelo"});
    await expect(actions.getByRole("button",{name:"Editar",exact:true})).toHaveAttribute("aria-disabled","true");
    await actions.getByRole("button",{name:"Comparar",exact:true}).click();
    const compare=page.getByRole("dialog",{name:"Comparar con la base"});
    await expect(compare.locator(`code[title="${door}"]`)).toBeVisible();
    await expect(compare).toContainText("tipo");
    await compare.getByRole("checkbox",{name:/Resaltar en 3D/}).check();
    await expect(page.locator(".view canvas")).toHaveAttribute("data-group-preview","");
    await page.keyboard.press("Escape");
    await expect(compare).toBeHidden();
    await walkBetween(page,"Base","Propuesta");
    await page.goto(route+"/cambios#"+first);

    // E4 · a second draft previewed and submitted by API, then rejected on its card: no revision is created.
    const second=(await json(await page.request.post(base+"/model-changes",{headers,data:{baseVersion:v1,description:"Segunda propuesta para rechazar"}}),201)).id as string;
    await json(await page.request.post(base+"/model-changes/"+second+"/operations",{headers,...slow,data:{op:"ifc.change_type",element:door,type_id:alternate}}),201);
    expect((await json(await page.request.post(base+"/model-changes/"+second+"/preview",{headers,...slow}),200)).report.ok).toBe(true);
    expect((await json(await page.request.post(base+"/model-changes/"+second+"/submit",{headers,...slow,data:{}}),200)).status).toBe("READY");
    // E4b · when the preview file of a ready change is gone (the sweep removed it), the card offers «Previsualizar de
    // nuevo» next to the disabled «Ver propuesta en 3D». The list answer is altered only to tell that state; the new
    // preview is real and gives the link back.
    await page.route(url=>url.pathname.endsWith("/projects/"+id+"/model-changes"),async route=>{
      if(route.request().method()!=="GET")return route.fallback();
      const response=await route.fetch(),rows=await response.json();
      for(const row of rows)if(row.id===second){row.preview.available=false;row.actions.apply=false;
        row.actions.reasons.apply="Pendiente: previsualízalo de nuevo para aprobarlo";}
      await route.fulfill({response,json:rows});
    });
    await page.reload();
    const expired=page.locator(`article[id="${second}"]`);
    await expect(expired.getByRole("button",{name:"Ver propuesta en 3D"})).toBeDisabled();
    await expect(expired.getByRole("button",{name:"Aprobar y aplicar cambio"})).toBeDisabled();
    await page.unroute(url=>url.pathname.endsWith("/projects/"+id+"/model-changes"));
    await expired.getByRole("button",{name:"Previsualizar de nuevo"}).click();
    await expect(expired.getByRole("link",{name:"Ver propuesta en 3D"})).toBeVisible({timeout:150_000});
    await expect(expired.getByRole("button",{name:"Previsualizar de nuevo"})).toHaveCount(0);
    await expect(expired.getByText("Lista para aprobar",{exact:true})).toBeVisible();

    await page.reload();
    await expect(page.locator(`article[id="${first}"]`).getByRole("button",{name:"Aprobar y aplicar cambio"})).toBeEnabled();
    const rejected=page.locator(`article[id="${second}"]`);
    await rejected.getByRole("button",{name:"Rechazar"}).click();
    await expect(rejected.getByText("Descartada",{exact:true})).toBeVisible();
    await expect(rejected).toContainText("por "+email);
    expect(await json(await page.request.get(base+"/files/"+original.fileId+"/versions",{headers}),200)).toHaveLength(1);

    // E5 · approve the first one: v2 opens marked on the rail, its prices were copied and the budget is frozen.
    const approved=page.locator(`article[id="${first}"]`);
    const publishing=page.waitForResponse(response=>response.url().endsWith("/model-changes/"+first+"/apply") && response.request().method()==="POST");
    await approved.getByRole("button",{name:"Aprobar y aplicar cambio"}).click();
    expect((await publishing).ok()).toBeTruthy();
    const opened=approved.getByRole("link",{name:"Abrir nueva versión"});
    await expect(opened).toBeVisible({timeout:60_000});
    const href=(await opened.getAttribute("href"))!;
    expect(href).toContain("anterior="+v1);
    const v2=href.split("?")[0].split("/").pop()!;
    const copied=await json(await page.request.get(base+"/versions/"+v2+"/prices",{headers}),200);
    expect(copied.prices).toHaveLength(2);
    for(const price of prices)expect(copied.prices).toContainEqual(expect.objectContaining({...price,currency:"COP",copiedFrom:v1}));
    const changes=page.url();
    await opened.click();
    await expect(page.getByRole("navigation",{name:"Versiones del archivo"}).getByRole("link",{name:/^Versión 2 .*\(abierta\)$/}))
      .toHaveAttribute("aria-current","page",{timeout:60_000});

    // E6 · RECORRIDO over v2 keeps «Anterior» and «Nueva», as design-change.spec.ts checks.
    await walkBetween(page,"Anterior","Nueva");

    await page.goto(changes.replace(/\/cambios.*$/,"/presupuesto"));
    const frozen=page.locator(`article[id="${first}"]`).getByRole("region",{name:"Estimación del cambio"});
    await expect(frozen).toContainText(/25[.,]000/);
    await expect(frozen).toContainText("Estimación congelada al aprobar");
    // Only the applied change adds up (the rejected one does not), and its card links back to the full change.
    const total=page.getByRole("region",{name:"Total de cambios aprobados"});
    await expect(total).toContainText(/25[.,]000/);
    await expect(total).toContainText("1 cambio aprobado con estimación completa");
    await expect(page.locator(`article[id="${first}"]`).getByRole("link",{name:"Ver el cambio completo"}))
      .toHaveAttribute("href","/proyectos/"+id+"/cambios#"+first);

    // E7 · the restoring revision v3 carries the SHA-256 of the original upload.
    await page.goto(route+"/cambios#"+first);
    await page.locator(`article[id="${first}"]`).getByRole("button",{name:"Crear revisión de restauración"}).click();
    const restoredLink=page.locator(`article[id="${first}"]`).getByRole("link",{name:"Abrir revisión restaurada"});
    await expect(restoredLink).toBeVisible({timeout:60_000});
    const v3=(await restoredLink.getAttribute("href"))!.split("?")[0].split("/").pop()!;
    expect(await json(await page.request.get(base+"/versions/"+v3,{headers}),200)).toMatchObject({revision:3,sha256:expectedSha});
  }finally{await page.request.delete(base,{headers});}
});

// H1 §8.3, second test (H2.1): a typed property from the draft to the published revision, read back in the explorer.
test("Cambio de propiedad: FireRating tipado, booleano rechazado, aprobación y lectura en el explorador",async({page})=>{
  test.setTimeout(180_000);
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc,"Indica el IFC Duplex original con DUPLEX_IFC.");
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  expect(auth.ok()).toBeTruthy();
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const {id}=await json(await page.request.post("/api/projects",{headers,data:{name:"Prueba de cambio de propiedad"}}),201);
  const base="/api/projects/"+id;
  try{
    const v1=(await json(await page.request.post(base+"/uploads",{headers:{...headers,"Content-Type":"application/octet-stream"},
      params:{name:"Duplex_A.ifc"},data:readFileSync(ifc!)}),201)).id as string;

    // 1 · a draft with Pset_DoorCommon.FireRating = «EI 60» on the piece.
    const change=(await json(await page.request.post(base+"/model-changes",{headers,data:{baseVersion:v1,description:"Resistencia al fuego de la puerta"}}),201)).id as string;
    const operations=base+"/model-changes/"+change+"/operations";
    const added=await json(await page.request.post(operations,{headers,...slow,
      data:{op:"ifc.set_property",element:door,scope:"occurrence",pset:"Pset_DoorCommon",property:"FireRating",value:"EI 60"}}),201);
    expect(added.recipe.operations).toHaveLength(1);

    // 2 · IsExternal is an IfcBoolean: the text «si» is rejected with the engine's VALUE_TYPE and the recipe is unchanged.
    const refused=await json(await page.request.post(operations,{headers,...slow,
      data:{op:"ifc.set_property",element:door,scope:"occurrence",pset:"Pset_DoorCommon",property:"IsExternal",value:"si"}}),422);
    expect(refused.code).toBe("VALUE_TYPE");
    expect(refused.message).toContain("IsExternal admite solo verdadero o falso");
    expect((await json(await page.request.get(base+"/model-changes/"+change,{headers}),200)).recipe.operations).toHaveLength(1);

    // 3 · preview and submit by API; approval with one click on the card.
    expect((await json(await page.request.post(base+"/model-changes/"+change+"/preview",{headers,...slow}),200)).report.ok).toBe(true);
    expect((await json(await page.request.post(base+"/model-changes/"+change+"/submit",{headers,...slow,data:{}}),200)).status).toBe("READY");
    await page.goto("/proyectos/"+id+"/cambios#"+change);
    const card=page.locator(`article[id="${change}"]`);
    const publishing=page.waitForResponse(response=>response.url().endsWith("/model-changes/"+change+"/apply") && response.request().method()==="POST");
    await card.getByRole("button",{name:"Aprobar y aplicar cambio"}).click();
    expect((await publishing).ok()).toBeTruthy();

    // 4 · the new version: «Propiedades» › «Conjuntos de propiedades» shows FireRating = «EI 60» «de la pieza».
    const opened=card.getByRole("link",{name:"Abrir nueva versión"});
    await expect(opened).toBeVisible({timeout:60_000});
    await opened.click();
    await expect(page.getByRole("navigation",{name:"Versiones del archivo"}).getByRole("link",{name:/^Versión 2 .*\(abierta\)$/}))
      .toHaveAttribute("aria-current","page",{timeout:60_000});
    const toggle=page.getByRole("button",{name:"Mostrar explorador"});
    if(await toggle.isVisible())await toggle.click();
    await page.getByRole("tab",{name:"Propiedades"}).click();
    const inspector=page.locator("#pane-properties");
    await expect(inspector.locator(".guid",{hasText:door})).toBeVisible();
    const psets=inspector.locator("details.element-psets");
    await psets.locator("summary").click();
    const own=psets.getByRole("region",{name:"Pset_DoorCommon de la pieza"});
    await expect(own).toBeVisible({timeout:60_000});
    const fire=own.locator(`[data-property="FireRating"]`);
    await expect(fire).toContainText("EI 60");
    await expect(fire).toContainText("IfcLabel");
    await expect(own).toContainText("de la pieza");
  }finally{await page.request.delete(base,{headers});}
});
