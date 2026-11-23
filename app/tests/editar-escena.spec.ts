import {expect,test} from "@playwright/test";
import {editBar,editButton} from "./support/editar-prisma";

test.use({viewport:{width:1366,height:768}});

/**
 * EDITAR › Escena (edit-bar.tsx, edit-global-popover.tsx): las ediciones globales ya no son cinco
 * herramientas excluyentes sino categorías de una sola escena que se combinan. Un acceso rápido por
 * objetivo rellena la combinación, se ajusta después y «Restablecer ediciones» lo limpia todo.
 */
test("Escena combina momento, clima, entorno, personas y estilo con accesos rápidos",async({page},info)=>{
  await page.goto("/proyectos/restage/visor");
  await editButton(page).click();
  const bar=editBar(page);
  await expect(bar).toBeVisible();
  // One button instead of the five exclusive tools.
  await expect(bar.getByRole("button",{name:"Cambiar el momento del día"})).toHaveCount(0);
  const scene=bar.getByRole("button",{name:"Escena",exact:true});
  await scene.click();
  const card=page.getByRole("dialog",{name:"Escena"});
  await expect(card).toBeVisible();
  const tabs=card.getByRole("tablist",{name:"Categorías de la escena"});
  await expect(tabs.getByRole("tab")).toHaveText([/Momento del día/,/Clima y estación/,/Entorno/,/Personas/,/Estilo/]);
  await expect(tabs.getByRole("tab",{name:/Momento del día/})).toBeFocused();
  await expect(card.getByRole("button",{name:"Aplicar cambios"})).toHaveAttribute("aria-disabled","true");

  // A shortcut fills the combination.
  const client=card.getByRole("button",{name:"Presentación al cliente"});
  await client.click();
  await expect(client).toHaveAttribute("aria-pressed","true");
  await expect(card.locator(".scene-summary")).toHaveText("Escena: Tarde · Despejado · Ciudad · Pocas · Natural · Fotorrealista");
  await expect(card.getByRole("radio",{name:"Tarde",exact:true})).toHaveAttribute("aria-checked","true");

  // Keyboard: arrows move between categories; choosing in one keeps the others.
  await tabs.getByRole("tab",{name:/Momento del día/}).focus();
  await page.keyboard.press("End");
  const styleTab=tabs.getByRole("tab",{name:/Estilo/});
  await expect(styleTab).toBeFocused();
  await expect(styleTab).toHaveAttribute("aria-selected","true");
  const styles=card.getByRole("radiogroup",{name:"Estilo"});
  await expect(styles.getByRole("radio")).toHaveCount(11);
  await expect(styles.getByRole("radio",{name:"Fotorrealista"})).toHaveAttribute("aria-checked","true");
  const photo=styles.getByRole("radio",{name:"Fotorrealista"}).locator('img[src="/edit-styles/fotorrealista.webp"]');
  await expect(photo).toBeVisible();
  await expect.poll(()=>photo.evaluate((image: HTMLImageElement)=>image.naturalWidth)).toBe(240);
  await styles.getByRole("radio",{name:"Fotorrealista"}).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(styles.getByRole("radio",{name:"Maqueta blanca"})).toHaveAttribute("aria-checked","true");
  await expect(client).toHaveAttribute("aria-pressed","false");
  await expect(card.locator(".scene-summary")).toHaveText("Escena: Tarde · Despejado · Ciudad · Pocas · Natural · Maqueta blanca");

  // Clima y estación add up; Quitar empties only its category.
  await tabs.getByRole("tab",{name:/Clima y estación/}).click();
  await card.getByRole("radiogroup",{name:"Estación"}).getByRole("radio",{name:"Otoño"}).click();
  await expect(tabs.getByRole("tab",{name:/Clima y estación/})).toContainText("Despejado · Otoño");
  await tabs.getByRole("tab",{name:/Personas/}).click();
  await card.getByRole("button",{name:"Quitar personas"}).click();
  await expect(tabs.getByRole("tab",{name:/Personas/})).toContainText("Sin elegir");
  await expect(card.locator(".scene-summary")).toHaveText("Escena: Tarde · Despejado · Otoño · Ciudad · Maqueta blanca");
  await expect(card.getByRole("radio",{name:"Pocas"})).toHaveAttribute("aria-checked","false");
  await page.mouse.move(10,700);
  await page.screenshot({path:info.outputPath("escena.png")});

  // The pending dot and the tooltip of the Escena button carry the combination.
  await expect(scene).toHaveAttribute("title","Escena: Tarde · Despejado · Otoño · Ciudad · Maqueta blanca");
  // Restablecer ediciones clears everything.
  await bar.getByRole("button",{name:"Restablecer ediciones"}).click();
  await expect(card.locator(".scene-summary")).toHaveText("Elige una o varias categorías, o un acceso rápido.");
  await expect(tabs.getByRole("tab",{name:/Estilo/})).toContainText("Sin elegir");
  // Escape closes the card and gives the focus back to Escena.
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(scene).toBeFocused();
});
