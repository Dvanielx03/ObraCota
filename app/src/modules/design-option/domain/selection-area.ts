/** A rectangle over the capture, in fractions of its width and height (0 to 1). */
export type Area = { x: number; y: number; w: number; h: number };

export const MIN_SIDE = 0.04;
export const STEP = 0.02;
export const DEFAULT_AREA: Area = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Keeps the rectangle inside the capture and never thinner than the minimum side. */
export function fitArea(area: Area): Area {
  const w = clamp(area.w, MIN_SIDE, 1);
  const h = clamp(area.h, MIN_SIDE, 1);
  return { x: round(clamp(area.x, 0, 1 - w)), y: round(clamp(area.y, 0, 1 - h)), w: round(w), h: round(h) };
}

/** Rectangle between two corners of a drag; null when the drag was too small to mean anything. */
export function areaBetween(ax: number, ay: number, bx: number, by: number): Area | null {
  const x = clamp(Math.min(ax, bx), 0, 1), y = clamp(Math.min(ay, by), 0, 1);
  const w = clamp(Math.max(ax, bx), 0, 1) - x, h = clamp(Math.max(ay, by), 0, 1) - y;
  return w < MIN_SIDE || h < MIN_SIDE ? null : fitArea({ x, y, w, h });
}

export const moveArea = (area: Area, dx: number, dy: number): Area => fitArea({ ...area, x: area.x + dx, y: area.y + dy });

/** Grows or shrinks from the right and bottom edges, the way a corner handle would. */
export const resizeArea = (area: Area, dw: number, dh: number): Area =>
  fitArea({ ...area, w: clamp(area.w + dw, MIN_SIDE, 1 - area.x), h: clamp(area.h + dh, MIN_SIDE, 1 - area.y) });

export const describeArea = (area: Area): string => `${Math.round(area.w * 100)} % del ancho y ${Math.round(area.h * 100)} % del alto de la captura`;
