"use client";
import type { Area } from "../domain/selection-area";

function paint(context: CanvasRenderingContext2D, areas: readonly Area[], width: number, height: number) {
  context.fillStyle = "#fff";
  for (const area of areas)
    context.fillRect(Math.round(area.x * width), Math.round(area.y * height), Math.round(area.w * width), Math.round(area.h * height));
}

/**
 * Black image of the capture's size with every area in white: the mask format the image model
 * expects. Several marks become one mask, so the API contract does not change.
 */
export function areasMask(areas: readonly Area[], width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  paint(context, areas, width, height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/**
 * The piece mask of a group capture with the zones of Editar added in white. Zones are fractions of
 * the canvas, and the capture covers the whole canvas, so they land on the same pixels.
 */
export async function maskWithAreas(mask: string, width: number, height: number, areas: readonly Area[]): Promise<string> {
  if (!areas.length) return mask;
  const picture = new Image();
  picture.src = mask;
  await picture.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.drawImage(picture, 0, 0, width, height);
  paint(context, areas, width, height);
  return canvas.toDataURL("image/jpeg", 0.92);
}
