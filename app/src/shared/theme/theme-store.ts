import { DEFAULT_THEME, THEME_EVENT, THEME_STORAGE_KEY, parseTheme, type ThemeMode } from "./theme";

/** Mode currently applied to <html>; the inline head script sets it before React runs. */
export function readTheme(): ThemeMode {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return parseTheme(document.documentElement.dataset.theme);
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch { /* The mode still applies to this page. */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Notifies on changes from this page and from other tabs. */
export function subscribeTheme(notify: () => void) {
  function storage(event: StorageEvent) {
    if (event.key !== THEME_STORAGE_KEY) return;
    document.documentElement.dataset.theme = parseTheme(event.newValue);
    notify();
  }
  window.addEventListener(THEME_EVENT, notify);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(THEME_EVENT, notify);
    window.removeEventListener("storage", storage);
  };
}
