import { THUMBNAIL_HEIGHT, THUMBNAIL_QUALITY, THUMBNAIL_WIDTH, acceptableThumbnail, thumbnailCrop, visibleArea, type ScreenRoom } from "../domain/scene-view";

function load(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo leer la captura."));
    image.src = source;
  });
}

/** Free room around the model as the workspace declares it (--fit-* custom properties, in px) on `stage`. */
export function screenRoom(stage: HTMLElement): ScreenRoom {
  const style = getComputedStyle(stage);
  const read = (name: string) => Math.max(0, parseFloat(style.getPropertyValue(name)) || 0);
  return { top: read("--fit-top"), right: read("--fit-right"), bottom: read("--fit-bottom"), left: read("--fit-left"),
    width: stage.clientWidth, height: stage.clientHeight };
}

/**
 * Turns a viewer capture into the 540 × 360 JPEG preview of a saved view: a 3:2 crop centred in the part
 * of the canvas that panels leave free (`room`), then scaled. Returns undefined when the browser cannot
 * produce an image the server accepts.
 */
export async function makeThumbnail(capture: string, room?: ScreenRoom): Promise<string | undefined> {
  const image = await load(capture);
  const width = image.naturalWidth, height = image.naturalHeight;
  const crop = thumbnailCrop(width, height, room ? visibleArea(width, height, room) : undefined);
  if (!crop.width || !crop.height) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_WIDTH; canvas.height = THUMBNAIL_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  // A busy model stays well under 80 KB at this size; lower the quality only if it ever exceeds the limit.
  for (const quality of [THUMBNAIL_QUALITY, 0.6, 0.4]) {
    const data = canvas.toDataURL("image/jpeg", quality);
    if (acceptableThumbnail(data)) return data;
  }
  return undefined;
}
