/** Colour mode chosen by the person. "system" follows prefers-color-scheme. */
export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "obracota.theme.v1";
export const THEME_EVENT = "obracota:theme";
export const DEFAULT_THEME: ThemeMode = "system";

/** Order of the toggle: light → dark → system → light. */
const ORDER: readonly ThemeMode[] = ["light", "dark", "system"];

const CURRENT: Record<ThemeMode, string> = { light: "claro", dark: "oscuro", system: "según el sistema" };
const ACTION: Record<ThemeMode, string> = { light: "pasar a claro", dark: "pasar a oscuro", system: "seguir al sistema" };

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function parseTheme(value: unknown): ThemeMode {
  return isThemeMode(value) ? value : DEFAULT_THEME;
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
}

/** Accessible name and tooltip of the toggle: the current mode and what a press does. */
export function themeToggleLabel(mode: ThemeMode): string {
  return "Modo de color: " + CURRENT[mode] + ". Pulsa para " + ACTION[nextTheme(mode)] + ".";
}
