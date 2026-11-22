import type { CameraPose } from "@/viewer/domain/viewer.port";

export const VIEW_NAME_LIMIT = 60;
export const VIEW_LIMIT = 24;
/**
 * Thumbnails are 3:2 JPEG images, sent as data URLs of at most 80 KB (decoded). 540 × 360 is twice the
 * project card's cover, so the summary's 586 px cover and the cards stay sharp on 2× screens.
 */
export const THUMBNAIL_WIDTH = 540;
export const THUMBNAIL_HEIGHT = 360;
export const THUMBNAIL_QUALITY = 0.8;
export const THUMBNAIL_LIMIT = 80 * 1024;
export const THUMBNAIL_PREFIX = "data:image/jpeg;base64,";

export interface SceneView extends CameraPose { id: string; name: string; hasThumbnail: boolean }

export interface SceneViewRepository {
  list(): Promise<SceneView[]>;
  /** `thumbnail` is an optional JPEG data URL (see {@link THUMBNAIL_LIMIT}). */
  save(name: string, pose: CameraPose, thumbnail?: string): Promise<SceneView>;
  rename(id: string, name: string): Promise<SceneView>;
  remove(id: string): Promise<void>;
  thumbnail(id: string, signal?: AbortSignal): Promise<Blob>;
}

/** First free "Vista N" among the existing names. */
export function nextViewName(views: readonly { name: string }[]): string {
  const taken = new Set(views.map(view => view.name.trim().toLocaleLowerCase("es")));
  for (let n = views.length + 1; ; n++) if (!taken.has("vista " + n)) return "Vista " + n;
}

export function cleanViewName(value: string): string {
  const name = value.trim();
  if (!name || name.length > VIEW_NAME_LIMIT) throw new Error("Escribe un nombre de hasta " + VIEW_NAME_LIMIT + " caracteres.");
  return name;
}

/** Two-digit number shown on a view ("01", "02"…). */
export function viewNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export interface CropRect { x: number; y: number; width: number; height: number }
/** Space, in screen pixels, that floating panels cover on each side of a canvas of `width` × `height`. */
export interface ScreenRoom { top: number; right: number; bottom: number; left: number; width: number; height: number }

/**
 * Largest rectangle with the thumbnail's 3:2 proportion, centred in `area` (the whole source by default)
 * and kept inside the source.
 */
export function thumbnailCrop(width: number, height: number, area?: CropRect, ratio = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT): CropRect {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.max(0, Math.min(width, area?.x ?? 0)), top = Math.max(0, Math.min(height, area?.y ?? 0));
  const box = { x: left, y: top, width: Math.min(width - left, area?.width ?? width), height: Math.min(height - top, area?.height ?? height) };
  if (!(box.width > 0) || !(box.height > 0)) return thumbnailCrop(width, height, undefined, ratio);
  if (box.width / box.height > ratio) {
    const cropped = box.height * ratio;
    return { x: box.x + (box.width - cropped) / 2, y: box.y, width: cropped, height: box.height };
  }
  const cropped = box.width / ratio;
  return { x: box.x, y: box.y + (box.height - cropped) / 2, width: box.width, height: cropped };
}

/** The unobstructed part of the canvas, in the pixels of an image of `width` × `height` taken from it. */
export function visibleArea(width: number, height: number, room: ScreenRoom): CropRect {
  const sx = width / Math.max(room.width, 1), sy = height / Math.max(room.height, 1);
  const area = { x: room.left * sx, y: room.top * sy, width: width - (room.left + room.right) * sx, height: height - (room.top + room.bottom) * sy };
  // Panels covering more than half of an axis leave too little to recognise: use the whole image then.
  return area.width < width / 2 || area.height < height / 2 ? { x: 0, y: 0, width, height } : area;
}

/** Decoded size in bytes of a base64 data URL, without decoding it. */
export function dataUrlBytes(value: string): number {
  const data = value.slice(value.indexOf(",") + 1);
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor(data.length * 3 / 4) - padding;
}

/** Whether a data URL is a JPEG the server will accept as a thumbnail. */
export function acceptableThumbnail(value: string): boolean {
  return value.startsWith(THUMBNAIL_PREFIX) && dataUrlBytes(value) > 0 && dataUrlBytes(value) <= THUMBNAIL_LIMIT;
}
