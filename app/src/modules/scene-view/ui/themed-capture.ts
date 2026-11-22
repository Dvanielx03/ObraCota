"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { subscribeTheme } from "@/shared/theme/theme-store";
import { luminance, parseColor, recolorBackdrop } from "../domain/capture-backdrop";

/** Canvas and capture colours of the theme in force, as "#RRGGBB|#RRGGBB" so the snapshot is a string. */
function readColors(): string {
  if (typeof document === "undefined") return "";
  const style = getComputedStyle(document.documentElement);
  return style.getPropertyValue("--bg").trim() + "|" + style.getPropertyValue("--capture-bg").trim();
}

function subscribe(notify: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const stop = subscribeTheme(notify);
  media.addEventListener("change", notify);
  return () => { stop(); media.removeEventListener("change", notify); };
}

/**
 * Picture of a viewer capture (a saved view's thumbnail, a project cover) for the theme in force.
 * On a dark canvas the light capture background becomes the canvas colour, so the picture no longer
 * shows as a white card (see `recolorBackdrop`). In the light theme, or while it is being prepared,
 * the original source is returned; on any failure too.
 */
export function useThemedCapture(source: string | undefined): string | undefined {
  const colors = useSyncExternalStore(subscribe, readColors, () => "");
  const [themed, setThemed] = useState<{ source: string; colors: string; url: string }>();
  useEffect(() => {
    if (!source || !colors) return;
    const [canvasColor, captureColor] = colors.split("|");
    const target = parseColor(canvasColor), key = parseColor(captureColor);
    if (!target || !key || luminance(target) > 0.4) return;
    let active = true, made: string | undefined;
    const image = new Image();
    image.onload = () => {
      if (!active || !image.naturalWidth) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      recolorBackdrop(pixels.data, canvas.width, canvas.height, key, target);
      context.putImageData(pixels, 0, 0);
      canvas.toBlob((blob) => {
        if (!active || !blob) return;
        made = URL.createObjectURL(blob);
        setThemed({ source, colors, url: made });
      }, "image/png");
    };
    // Unreadable picture: it is shown as it came.
    image.onerror = () => { if (active) setThemed({ source, colors, url: source }); };
    image.src = source;
    return () => { active = false; if (made) URL.revokeObjectURL(made); };
  }, [source, colors]);
  const target = parseColor(colors.split("|")[0] ?? "");
  if (!source || !target || luminance(target) > 0.4) return source;
  return themed && themed.source === source && themed.colors === colors ? themed.url : undefined;
}
