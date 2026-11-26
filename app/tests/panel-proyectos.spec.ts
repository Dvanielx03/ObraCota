import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {resolve} from "node:path";

/**
 * «Mis proyectos» as a new user, with an Autodesk sample drawing never used in earlier tests: the project is created
 * from the board, its first version is uploaded from «Archivos y versiones» and the «Visor» tab opens it right away
 * (it used to stay disabled until another section was visited). The plan lists its MTEXT without formatting codes
 * (a stacked fraction reads «1/2», not «\S1/2;»), a project without saved views answers its cover with 204 (no error
 * in the console), and the summary and the changes page speak of pieces and drawings, not only of doors.
 */
const DRAWING=resolve(__dirname,"../../docs/mvp/modelos-nuevos-26-11/dwg/architectural_-_annotation_scaling_and_multileaders.dwg");

test.use({storageState:{cookies:[],origins:[]},viewport:{width:1440,height:900}});

test("Un proyecto nuevo abre su primera versión desde la pestaña Visor y el plano se lee limpio",async({page})=>{
  test.skip(!existsSync(DRAWING),"Falta el DWG de ejemplo de Autodesk en docs/mvp/modelos-nuevos-26-11/dwg");
  test.setTimeout(300_000);
  const errors:string[]=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});

  await page.goto("/registro");
  await page.getByLabel("Correo electrónico").fill("panel-"+randomUUID().slice(0,8)+"@example.test");
  await page.getByLabel("Contraseña").fill(randomUUID());
  await page.getByRole("button",{name:"Crear cuenta"}).click();
  await expect(page).toHaveURL(/\/bienvenida$/);
  await page.getByRole("button",{name:"Omitir por ahora"}).click();
  await expect(page.getByRole("heading",{name:"Mis proyectos"})).toBeVisible();

  await page.getByRole("button",{name:/Nuevo proyecto/i}).click();
  await expect(page).toHaveURL(/\/proyectos\/[\da-f-]{36}\/archivos$/,{timeout:30_000});
  const project=page.url().match(/proyectos\/([\da-f-]{36})/)![1];
  const visor=page.getByRole("navigation",{name:"Secciones del proyecto"}).getByRole("link",{name:"Visor",exact:true});
  await expect(visor).toHaveAttribute("aria-disabled","true");

  await page.getByLabel("Archivo IFC, DWG, DXF, RVT, FBX u OBJ").setInputFiles(DRAWING);
  await page.getByRole("button",{name:"Guardar versión"}).click();
  await expect(page.getByText("Versión 1 guardada.")).toBeVisible({timeout:120_000});
  // The project bar reads the new version without leaving the page.
  await expect(visor).not.toHaveAttribute("aria-disabled","true",{timeout:15_000});
  await visor.click();
  await expect(page).toHaveURL(new RegExp("/proyectos/"+project+"/visor/[\\da-f-]{36}"));
  await expect(page.locator(".stage > .view[data-ready]")).toBeVisible({timeout:120_000});

  // The plan's texts are listed in Lectura without MTEXT codes.
  const reading=page.locator("#explorer");
  const welcome=page.getByRole("dialog",{name:"Empieza por aquí"});
  if(await welcome.isVisible())await welcome.getByRole("button",{name:"Ahora no"}).click();
  // On a plan the editing tools are on, and the explorer opens from the stage bar.
  await expect(page.getByRole("button",{name:"Renderizar opciones visuales"})).toBeEnabled();
  await expect(page.getByRole("button",{name:/^Editar/})).toBeEnabled();
  const show=page.getByRole("button",{name:"Mostrar explorador"});
  if(await show.isVisible())await show.click();
  await page.getByRole("searchbox",{name:"Buscar elemento"}).fill("ELEV");
  const levels=reading.getByRole("button",{name:/^ELEV\./});
  await expect(levels.first()).toBeVisible({timeout:15_000});
  const names=await levels.allInnerTexts();
  // «ELEV. 5'-10\S1/2;" TOP OF LANDING» in the drawing: the stacked fraction reads as text.
  expect(names).toContain("ELEV. 5'-10 1/2\" TOP OF LANDING");
  for(const name of names)expect(name).not.toMatch(/\\[A-Za-z]|[{}]/);

  // A project without saved views has no cover yet: an empty answer, not a 404 in the console.
  const token=await page.evaluate(()=>Object.values(sessionStorage).concat(Object.values(localStorage)).find(v=>/^ey/.test(v))??"");
  if(token){
    const cover=await page.request.get("/api/projects/"+project+"/cover",{headers:{Authorization:"Bearer "+token}});
    expect(cover.status()).toBe(204);
  }
  expect(errors.filter(text=>/\/cover/.test(text))).toEqual([]);

  await page.goto("/proyectos/"+project);
  await expect(page.getByText("Propuestas sobre piezas IFC y planos DWG, con su revisión")).toBeVisible();
  await page.goto("/proyectos/"+project+"/cambios");
  await expect(page.getByRole("main")).not.toContainText("Selecciona una puerta");
});
