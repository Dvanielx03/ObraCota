import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";

test("Desde la demo se entra al asistente de la cuenta",async({page})=>{
  const name="Proyecto de prueba "+randomUUID();
  await page.goto("/proyectos/restage/asistente");
  await page.getByRole("link",{name:"Iniciar sesión para usar el asistente"}).click();
  await page.getByRole("tab",{name:"Crear cuenta"}).click();
  await expect(page.getByRole("tab",{name:"Crear cuenta"})).toHaveAttribute("aria-selected","true");
  await expect(page).toHaveURL(/\/registro\?desde=asistente$/);
  await page.getByLabel("Correo electrónico").fill(randomUUID()+"@example.test");
  await page.getByLabel("Contraseña").fill(randomUUID());
  await page.getByRole("button",{name:"Crear cuenta"}).click();
  await expect(page).toHaveURL(/\/proyectos\/restage\/asistente$/);
  await page.getByLabel("Nombre del proyecto").fill(name);
  await page.getByRole("button",{name:"Crear proyecto y abrir asistente"}).click();
  await expect(page.getByRole("heading",{name:"Vincula la primera ficha"})).toBeVisible();
  const actual=page.url();
  await page.goto("/proyectos/restage/asistente");
  await page.getByRole("link",{name,exact:true}).click();
  await expect(page).toHaveURL(actual);
});
