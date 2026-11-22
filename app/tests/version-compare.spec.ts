import {expect,test} from "@playwright/test";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {DOOR,publishedRevision} from "./support/published-change";
import {backendReady} from "./support/backend";

// H7 · Comparar entre versiones and the download of a published revision, with the real engine and no AI.
test.use({viewport:{width:1366,height:768}});

test("Comparar versiones lista por GlobalId lo que cambió la receta, lo resalta y la revisión se descarga con su SHA-256",async({page},info)=>{
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc,"Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(360_000);
  await backendReady(page.request);
  const {id,base,headers,v1,v2}=await publishedRevision(page,ifc!,"Prueba de comparar versiones");
  try{
    // The server's diff, by API: from v1 to v2 only the door of the recipe changed; the other way round as well.
    const diff=await (await page.request.get(base+"/versions/"+v2+"/diff",{headers,params:{base:v1},timeout:180_000})).json();
    expect(diff.changed.map((entry:{guid:string})=>entry.guid)).toEqual([DOOR]);
    expect(diff.added).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect((await page.request.get(base+"/versions/"+v2+"/diff",{headers,params:{base:v2}})).status()).toBe(400);

    await page.goto("/proyectos/"+id+"/visor/"+v2);
    await expect(page.locator(".view[data-ready]")).toBeVisible({timeout:180_000});
    const rail=page.getByRole("navigation",{name:"Versiones del archivo"});
    await expect(rail.getByRole("link")).toHaveCount(2);
    await rail.getByRole("button",{name:"Comparar versiones"}).click();
    const panel=page.getByRole("dialog",{name:"Comparar versiones"});
    await expect(panel.getByLabel("Comparar v2 con")).toHaveValue(v1);
    await panel.getByRole("button",{name:"Comparar",exact:true}).click();
    await expect(panel.getByRole("status")).toContainText("De v1 a v2 · por GlobalId",{timeout:180_000});
    const changed=panel.getByRole("list",{name:"Elementos cambiados"});
    // Exactly the GlobalIds of the recipe: the door, nothing added or deleted.
    await expect(changed.locator("code")).toHaveCount(1);
    await expect(changed.locator(`code[title="${DOOR}"]`)).toBeVisible();
    await expect(changed).toContainText("tipo");
    await expect(panel.getByRole("list",{name:"Elementos añadidos"})).toHaveCount(0);
    await expect(panel.getByRole("list",{name:"Elementos eliminados"})).toHaveCount(0);
    await expect(panel).toContainText("1 cambiados · 0 añadidos · 0 eliminados");
    await panel.getByRole("checkbox",{name:/Resaltar en 3D/}).check();
    await expect(page.locator(".view canvas")).toHaveAttribute("data-group-preview","");
    await page.screenshot({path:info.outputPath("comparar-versiones.png")});
    await panel.getByRole("checkbox",{name:/Resaltar en 3D/}).uncheck();
    await expect(page.locator(".view canvas")).not.toHaveAttribute("data-group-preview","");
    await changed.getByRole("button",{name:"Localizar en 3D"}).click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    // The published revision downloads from its change card only after its SHA-256 matches the server's.
    const published=await (await page.request.get(base+"/versions/"+v2,{headers})).json();
    await page.goto("/proyectos/"+id+"/cambios");
    const card=page.locator("article.change-card").filter({hasText:"Puerta alternativa para comparar"});
    const downloading=page.waitForEvent("download");
    await card.getByRole("button",{name:"Descargar revisión publicada"}).click();
    const download=await downloading;
    expect(download.suggestedFilename()).toBe(published.name);
    const bytes=readFileSync(await download.path());
    expect(bytes.length).toBe(published.byteSize);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(published.sha256);
    await expect(card.getByRole("status").filter({hasText:"huella SHA-256 comprobada"})).toContainText(published.sha256.slice(0,12));

    // A file that is not the revision is refused: the original answer is cut by one byte, so its hash differs.
    await page.route(url=>url.pathname.endsWith("/versions/"+v1+"/original"),async route=>{
      const response=await route.fetch(),body=await response.body();
      const altered=Buffer.from(body);altered[altered.length-1]^=1;
      await route.fulfill({response,body:altered});
    });
    await page.goto("/proyectos/"+id+"/archivos");
    const history=page.locator(".file-history");
    if(!await history.isVisible())await page.getByRole("button",{name:/Duplex_A\.ifc/}).first().click();
    await history.getByRole("button",{name:"Descargar versión 1"}).click();
    await expect(history.getByRole("alert")).toContainText("no coincide con la de la versión publicada");
  }finally{
    await page.request.delete(base,{headers});
  }
});
