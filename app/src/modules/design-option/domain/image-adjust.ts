/** Adjustments applied in the browser before downloading an option. Nothing is sent to a service. */
export interface Adjustments { sharpness: number; brightness: number; warmth: number }

export const NEUTRAL: Adjustments = { sharpness: 0, brightness: 0, warmth: 0 };
export const RANGES = {
  sharpness: { min: 0, max: 100, label: "Nitidez" },
  brightness: { min: -50, max: 50, label: "Brillo" },
  warmth: { min: -50, max: 50, label: "Calidez" },
} as const;
export const AI_MARK = "Generado con IA";

export function isNeutral(value: Adjustments): boolean {
  return value.sharpness === 0 && value.brightness === 0 && value.warmth === 0;
}

export function clampAdjustments(value: Adjustments): Adjustments {
  const fit = (key: keyof Adjustments) => Math.min(RANGES[key].max, Math.max(RANGES[key].min, Math.round(value[key]) || 0));
  return { sharpness: fit("sharpness"), brightness: fit("brightness"), warmth: fit("warmth") };
}

/** Signed values show their sign so the direction of the change is visible. */
export function formatValue(key: keyof Adjustments, value: number): string {
  return key === "sharpness" || value <= 0 ? String(value) : "+" + value;
}

/**
 * Returns a new RGBA buffer. Sharpness is a 3×3 unsharp kernel, brightness shifts the three
 * channels and warmth moves red and blue in opposite directions. Alpha is kept.
 */
export function adjustPixels(source: Uint8ClampedArray, width: number, height: number, value: Adjustments): Uint8ClampedArray {
  const { sharpness, brightness, warmth } = clampAdjustments(value);
  const out = new Uint8ClampedArray(source.length);
  const amount = sharpness / 100;
  const shift = [brightness * 1.28 + warmth * 0.6, brightness * 1.28, brightness * 1.28 - warmth * 0.6];
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const up = y > 0 ? -row : 0, down = y < height - 1 ? row : 0;
    for (let x = 0; x < width; x++) {
      const i = y * row + x * 4;
      const left = x > 0 ? -4 : 0, right = x < width - 1 ? 4 : 0;
      for (let c = 0; c < 3; c++) {
        const p = i + c;
        const sharp = amount ? source[p] + amount * (4 * source[p] - source[p + up] - source[p + down] - source[p + left] - source[p + right]) : source[p];
        out[p] = sharp + shift[c];
      }
      out[i + 3] = source[i + 3];
    }
  }
  return out;
}

/** A close-up: zoom in percent (100 is the whole image) and where the crop is centred, in percent. */
export interface Framing { zoom: number; x: number; y: number }
export const FULL_FRAME: Framing = { zoom: 100, x: 50, y: 50 };
export function isFullFrame(value: Framing): boolean { return value.zoom <= 100; }

/** Rectangle of the original, in whole pixels, that a framing keeps. It never leaves the image. */
export function cropRect(width: number, height: number, framing: Framing): { x: number; y: number; width: number; height: number } {
  const zoom = Math.min(300, Math.max(100, framing.zoom || 100)) / 100;
  const w = Math.max(1, Math.round(width / zoom)), h = Math.max(1, Math.round(height / zoom));
  const at = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 50)) / 100;
  return { x: Math.round((width - w) * at(framing.x)), y: Math.round((height - h) * at(framing.y)), width: w, height: h };
}

/** "obracota-muro-exterior-opcion-2.png", with "-primer-plano" when it is a crop. */
export function downloadName(element: string, slot: number, closeUp = false): string {
  const slug = element.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return "obracota-" + (slug || "pieza") + "-opcion-" + slot + (closeUp ? "-primer-plano" : "") + ".png";
}
