/** RGB colour, 0–255 per channel. */
export type Rgb = readonly [number, number, number];

/** Largest channel difference still read as the capture background (JPEG noise, soft ground shadows). */
export const BACKDROP_TOLERANCE = 26;

/** "#F3F2F1", "#fff" or "rgb(29 32 38)" to RGB; undefined when it is not a plain colour. */
export function parseColor(value: string): Rgb | undefined {
  const text = value.trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map((d) => d + d).join("") : hex[1];
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as unknown as Rgb;
  }
  const rgb = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}

/** Relative luminance (WCAG), 0 for black and 1 for white. */
export function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * Viewer captures are flattened on the light capture background in both modes (exports and the
 * image model need it). On a dark canvas that background reads as a white card, so for display the
 * background is moved to the theme's canvas colour: every pixel close to `key` that is connected to
 * the picture's border is shifted by `target − key`, which keeps soft shadows on the ground. Pixels
 * of the model, including light walls enclosed by it, stay as captured. Works in place on RGBA data.
 */
export function recolorBackdrop(data: Uint8ClampedArray, width: number, height: number, key: Rgb, target: Rgb, tolerance = BACKDROP_TOLERANCE): void {
  const size = width * height;
  if (!size || data.length < size * 4) return;
  const near = (pixel: number) => {
    const at = pixel * 4;
    return Math.abs(data[at] - key[0]) <= tolerance && Math.abs(data[at + 1] - key[1]) <= tolerance && Math.abs(data[at + 2] - key[2]) <= tolerance;
  };
  const seen = new Uint8Array(size);
  const queue = new Int32Array(size);
  let head = 0, tail = 0;
  const visit = (pixel: number) => { if (!seen[pixel] && near(pixel)) { seen[pixel] = 1; queue[tail++] = pixel; } };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const pixel = queue[head++], x = pixel % width;
    if (x > 0) visit(pixel - 1);
    if (x < width - 1) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel < size - width) visit(pixel + width);
  }
  const shift = [target[0] - key[0], target[1] - key[1], target[2] - key[2]];
  for (let pixel = 0; pixel < size; pixel++) {
    if (seen[pixel]) {
      const at = pixel * 4;
      data[at] += shift[0]; data[at + 1] += shift[1]; data[at + 2] += shift[2];
      continue;
    }
    // A model pixel touching the background (its anti-aliased edge) moves halfway, so no light halo remains.
    const x = pixel % width;
    const edge = (x > 0 && seen[pixel - 1]) || (x < width - 1 && seen[pixel + 1]) || (pixel >= width && seen[pixel - width]) || (pixel < size - width && seen[pixel + width]);
    if (!edge) continue;
    const at = pixel * 4;
    const weight = Math.max(0, 1 - Math.max(Math.abs(data[at] - key[0]), Math.abs(data[at + 1] - key[1]), Math.abs(data[at + 2] - key[2])) / 96);
    data[at] += shift[0] * weight; data[at + 1] += shift[1] * weight; data[at + 2] += shift[2] * weight;
  }
}
