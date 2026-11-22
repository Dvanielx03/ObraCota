import { expect, test, type Page } from "@playwright/test";

// Theme toggle (app/src/shared/theme): one button that cycles Claro → Oscuro → Sistema, writes the mode on
// <html data-theme>, keeps it in localStorage and applies it again before the first paint after a reload.

const KEY = "obracota.theme.v1";
/** --bg of app/src/app/theme.css in each palette. */
const BG = { light: "rgb(243, 242, 241)", dark: "rgb(29, 32, 38)" } as const;

const toggle = (page: Page) => page.locator("button.theme-toggle").first();
const mode = (page: Page) => page.locator("html").getAttribute("data-theme");
const stored = (page: Page) => page.evaluate(key => localStorage.getItem(key), KEY);
const themeColors = (page: Page) => page.locator('meta[name="theme-color"]').evaluateAll(metas =>
  metas.map(meta => [meta.getAttribute("content"), meta.getAttribute("media")]));
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());

async function expectBackground(page: Page, palette: keyof typeof BG) {
  const probe = await page.evaluate(value => {
    const node = document.createElement("div");
    node.style.color = value;
    document.body.append(node);
    const color = getComputedStyle(node).color;
    node.remove();
    return color;
  }, await background(page));
  expect(probe).toBe(BG[palette]);
}

test("Tema · ciclo Claro → Oscuro → Sistema, persistencia y sistema", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/proyectos");
  const button = toggle(page);
  await expect(button).toBeVisible();

  // Without a stored choice the system decides.
  expect(await mode(page)).toBe("system");
  await expect(button).toHaveAttribute("data-theme-mode", "system");
  await expect(button).toHaveAccessibleName("Modo de color: según el sistema. Pulsa para pasar a claro.");
  await expectBackground(page, "light");

  await button.click();
  expect(await mode(page)).toBe("light");
  expect(await stored(page)).toBe("light");
  await expect(button).toHaveAccessibleName("Modo de color: claro. Pulsa para pasar a oscuro.");
  await expectBackground(page, "light");

  await button.click();
  expect(await mode(page)).toBe("dark");
  expect(await stored(page)).toBe("dark");
  await expect(button).toHaveAccessibleName("Modo de color: oscuro. Pulsa para seguir al sistema.");
  await expectBackground(page, "dark");
  // The browser chrome follows the forced mode, not only the system (KNOWN_ISSUES #30).
  await expect.poll(() => themeColors(page)).toEqual([["#F3F2F1", "not all"], ["#1D2026", "all"]]);

  // A reload keeps the forced mode even though the system is light.
  await page.reload();
  expect(await mode(page)).toBe("dark");
  await expect(toggle(page)).toHaveAttribute("data-theme-mode", "dark");
  await expectBackground(page, "dark");
  await expect.poll(() => themeColors(page)).toEqual([["#F3F2F1", "not all"], ["#1D2026", "all"]]);

  await toggle(page).click();
  expect(await mode(page)).toBe("system");
  expect(await stored(page)).toBe("system");
  await expectBackground(page, "light");
  await expect.poll(() => themeColors(page)).toEqual([["#F3F2F1", "(prefers-color-scheme: light)"], ["#1D2026", "(prefers-color-scheme: dark)"]]);
  // «Sistema» follows prefers-color-scheme live.
  await page.emulateMedia({ colorScheme: "dark" });
  await expectBackground(page, "dark");

  // The same mode reaches the viewer, with its own toggle.
  await page.goto("/proyectos/restage/visor");
  expect(await mode(page)).toBe("system");
  await expect(toggle(page)).toHaveAttribute("data-theme-mode", "system");
  await expectBackground(page, "dark");
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  expect(await mode(page)).toBe("light");
  await expectBackground(page, "light");
});
