"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_THEME, nextTheme, themeToggleLabel, type ThemeMode } from "./theme";
import { applyTheme, readTheme, subscribeTheme, syncThemeColor } from "./theme-store";

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

function serverTheme(): ThemeMode { return DEFAULT_THEME; }

/** 36 × 36 ghost button that cycles light → dark → system. */
export function ThemeToggle({ className }: { className?: string }) {
  const mode = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  useEffect(() => syncThemeColor(mode), [mode]);
  const Icon = ICONS[mode];
  const label = themeToggleLabel(mode);
  return <button type="button" className={className ? "theme-toggle " + className : "theme-toggle"} data-theme-mode={mode}
    aria-label={label} title={label} onClick={() => applyTheme(nextTheme(mode))}>
    <Icon size={16} strokeWidth={2} aria-hidden="true"/>
  </button>;
}
