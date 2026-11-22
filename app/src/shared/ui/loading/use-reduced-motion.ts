"use client";
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * Whether the person asked for less motion. The server (and hydration) answers `true`, so the first
 * paint is always the still picture and motion only starts once the browser confirms it is welcome.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(QUERY).matches, () => true);
}
