import { expect, type Page } from "@playwright/test";

/** Name of a project created with one click (DU-07 = B, `UNTITLED_PROJECT` in owned-project.ts). */
export const UNTITLED = "Proyecto sin título";

/** Path of an owned project's files page, where «Nuevo proyecto» lands. */
export const OWNED_FILES = /\/proyectos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/archivos$/;

/** Path of an owned project's summary. */
export const OWNED_SUMMARY = /\/proyectos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * «Nuevo proyecto» on the board creates «Proyecto sin título» at once, without a dialog, and opens
 * its «Archivos y versiones» page (project-board.tsx `create`).
 */
export async function createUntitledProject(page: Page) {
  await page.getByRole("button", { name: "Nuevo proyecto", exact: true }).click();
  await expect(page).toHaveURL(OWNED_FILES);
  await expect(page.getByRole("heading", { level: 1, name: UNTITLED, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Archivos y versiones", exact: true })).toBeVisible();
}

/** The «…» button of a project card and its menu (project-card.tsx, card-menu.tsx). */
export function cardMenu(page: Page, name: string) {
  return {
    trigger: page.getByRole("button", { name: "Opciones del proyecto " + name, exact: true }),
    menu: page.getByRole("menu", { name: "Opciones de " + name, exact: true }),
  };
}

/** Opens the card menu with the pointer and runs one of its options. */
export async function chooseInCardMenu(page: Page, name: string, option: "Cambiar nombre" | "Archivar" | "Restaurar") {
  const { trigger, menu } = cardMenu(page, name);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await menu.getByRole("menuitem", { name: option, exact: true }).click();
  await expect(menu).toBeHidden();
}
