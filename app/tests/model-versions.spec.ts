import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";

for (const [format, path] of [["IFC",process.env.TEST_IFC],["DWG",process.env.TEST_DWG]] as const) {
  test("original, visor y observaciones de la versión " + format, async ({page,baseURL}) => {
    test.skip(!path, "Define TEST_" + format + " con el original local.");
    test.setTimeout(360000);
    const source=path!, name=basename(source);
    const email=randomUUID()+"@example.test";
    const registration=await page.request.post("/api/auth/register", {
      headers:{"X-ObraCota-Client":"web"},data:{email,password:"UnaClaveDePrueba!"}
    });
    expect(registration.status()).toBe(201);
    const headers={Authorization:"Bearer "+(await registration.json()).accessToken};
    const created=await page.request.post("/api/projects",{headers,data:{name:"Validación de archivos"}});
    expect(created.status()).toBe(201);
    const project=(await created.json()).id, base="/api/projects/"+project;
    try {
      await page.goto("/proyectos/"+project+"/archivos");
      await page.getByLabel("Archivo IFC o DWG").setInputFiles(source);
      const uploading=page.waitForResponse(r=>r.url().includes("/uploads?"),{timeout:180000});
      await page.getByRole("button",{name:"Guardar versión"}).click();
      const upload=await uploading;
      expect(upload.status()).toBe(201);
      const catalog=await (await page.request.get(base+"/files",{headers})).json();
      const [v]=await (await page.request.get(base+"/files/"+catalog[0].id+"/versions",{headers})).json();
      const hash=createHash("sha256");
      for await(const part of createReadStream(source)) hash.update(part);
      expect(v).toMatchObject({name, format, revision:1, uploaderEmail:email,byteSize:statSync(source).size,sha256:hash.digest("hex")});
      const original=await fetch(baseURL+base+"/versions/"+v.id+"/original",{headers});
      expect(original.status).toBe(200);
      const downloaded=createHash("sha256");
      const reader=original.body!.getReader();
      for(let piece=await reader.read();!piece.done;piece=await reader.read()) downloaded.update(piece.value);
      expect(downloaded.digest("hex")).toBe(v.sha256);
      await page.getByRole("link",{name:"Abrir versión 1 en el visor"}).click();
      await expect(page.locator(".project")).toHaveText(name,{timeout:180000});
      await expect(page.locator(".stagebar")).toContainText(format==="IFC"?"Vista 3D":"Plano 2D");
      await expect(page.locator("canvas").first()).toBeVisible();
      if (!await page.locator("#explorer .entry").count()) await page.locator("#explorer .level").first().click();
      await page.locator("#explorer .entry").first().click();
      await page.getByRole("tab",{name:"Propiedades"}).click();
      await page.getByText("Observaciones de la versión (0)",{exact:true}).click();
      await page.getByLabel("Observación sobre la selección").fill("Verificar en planta");
      await page.getByRole("button",{name:"Guardar observación"}).click();
      await expect(page.getByText("Observación guardada en esta versión.")).toBeVisible();
      const notes=await page.request.get(base+"/versions/"+v.id+"/notes",{headers});
      expect(Object.values(await notes.json())).toEqual(["Verificar en planta"]);
      if(format==="DWG" && process.env.TEST_DWG_REVISION) {
        await page.getByRole("link",{name:"Volver a archivos"}).click();
        await page.getByLabel("Guardar en").selectOption(v.fileId);
        await page.getByLabel("Archivo IFC o DWG").setInputFiles(process.env.TEST_DWG_REVISION);
        await page.getByRole("button",{name:"Guardar versión"}).click();
        await expect(page.getByRole("link",{name:"Abrir versión 2 en el visor"})).toBeVisible();
        const [revision,previous]=await (await page.request.get(base+"/files/"+v.fileId+"/versions",{headers})).json();
        expect(previous.id).toEqual(v.id);
        expect(revision.name).toBe(basename(process.env.TEST_DWG_REVISION));
        expect(revision.sha256).not.toEqual(v.sha256);
        const newNotes=await page.request.get(base+"/versions/"+revision.id+"/notes",{headers});
        expect(await newNotes.json()).toEqual({});
      }
    } finally {
      await page.request.delete(base,{headers});
    }
  });
}
