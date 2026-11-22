import {expect,type Locator,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";

/**
 * Las opciones visuales dejaron de ser un diálogo modal abierto desde «Propiedades» (diseño Vibe3D,
 * DU-04 y DU-16). Ahora viven en los paneles de la barra inferior: RENDERIZAR pide la terna y lista
 * las tandas (plegadas tras «Ver»), y Comparar y Descargar abren su propio panel sobre una opción.
 * Estos localizadores siguen el código: workspace-tools.tsx, tool-popover.tsx, visual-options.tsx,
 * option-compare.tsx y option-download.tsx.
 */

/** Barra inferior del visor. */
export const actions=(page:Page)=>page.getByRole("toolbar",{name:"Acciones del modelo"});

/** Botón RENDERIZAR de la barra. */
export const renderButton=(page:Page)=>actions(page).getByRole("button",{name:"Renderizar opciones visuales"});

/** Panel de RENDERIZAR (sin cabecera ni X, como en Vibe3D). */
export const renderPanel=(page:Page)=>page.getByRole("dialog",{name:"Renderizar opciones visuales"});

/** Paneles de Comparar y Descargar, que se abren desde su botón o desde una opción de las tandas. */
export const comparePanel=(page:Page)=>page.getByRole("dialog",{name:"Comparar",exact:true});
export const downloadPanel=(page:Page)=>page.getByRole("dialog",{name:"Descargar",exact:true});

/** Botón principal de RENDERIZAR: el texto visible es «Renderizar» y la ficha de costo. */
export const sendButton=(panel:Locator)=>panel.getByRole("button",{name:"Renderizar: enviar captura y generar tres opciones"});

/** Las tandas se resumen en una línea sobre el botón principal; «Ver» las despliega en el mismo panel. */
export async function unfoldBatches(panel:Locator){
  const line=panel.locator(".options-batches-line");
  await line.getByRole("button",{name:"Ver",exact:true}).click();
  await expect(line.getByRole("button",{name:"Ocultar",exact:true})).toHaveAttribute("aria-expanded","true");
  await expect(panel.getByRole("region",{name:"Tandas generadas"})).toBeVisible();
}

/** Cuenta y proyecto nuevos por la API; `remove` borra el proyecto aunque la página ya se haya cerrado. */
export async function createProject(page:Page,name:string){
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  expect(auth.ok()).toBeTruthy();
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const created=await page.request.post("/api/projects",{headers,data:{name}});
  expect(created.ok()).toBeTruthy();
  const {id}=await created.json() as {id:string};
  return {id,headers,remove:()=>page.request.delete("/api/projects/"+id,{headers}).then(()=>undefined,()=>undefined)};
}

/** Sube el IFC desde «Archivos» y abre la versión 1 en el visor, hasta que la barra inferior aparece. */
export async function openFirstVersion(page:Page,project:string,file:string,expectedName:string|RegExp,timeout=120_000){
  await page.goto("/proyectos/"+project+"/archivos");
  await page.getByTestId("model-upload").setInputFiles(file);
  await page.getByRole("button",{name:"Guardar versión"}).click();
  await page.getByRole("link",{name:"Abrir versión 1 en el visor"}).click();
  await expect(page.locator(".project")).toContainText(expectedName,{timeout});
  // Al llegar desde el panel, la pantalla de carga se mantiene un mínimo (entry-hold.ts): la barra sale después.
  await expect(renderButton(page)).toBeVisible({timeout});
}

/** Elige en el explorador la primera pieza del primer nivel y devuelve su nombre. */
export async function pickFirstPiece(page:Page){
  if(!(await page.locator("#explorer .entry").count()))await page.locator("#explorer .level").first().click();
  const entry=page.locator("#explorer .entry").first();
  const name=(await entry.innerText()).trim();
  await entry.click();
  await expect(entry).toHaveAttribute("aria-pressed","true");
  return name;
}
