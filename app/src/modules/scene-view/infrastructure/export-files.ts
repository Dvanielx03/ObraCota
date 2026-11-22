import { visibleArea, type ScreenRoom } from "../domain/scene-view";

function load(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo leer la captura."));
    image.src = source;
  });
}

/**
 * PNG bytes of a viewer capture, cut to the part of the canvas that the floating panels leave free
 * (`room`), which is where the saved framing sits. The capture must be taken before calling this,
 * so the picture matches the camera of that moment.
 */
export async function pictureBytes(capture: string, room?: ScreenRoom): Promise<Uint8Array> {
  return (await cutPicture(capture, room, "image/png")).bytes;
}

/** {@link pictureBytes} in JPEG (quality 0.9) with its size in pixels, for the pages of the PDF export. */
export async function pictureJpeg(capture: string, room?: ScreenRoom): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const picture = await cutPicture(capture, room, "image/jpeg");
  return { jpeg: picture.bytes, width: picture.width, height: picture.height };
}

async function cutPicture(capture: string, room: ScreenRoom | undefined, type: "image/png" | "image/jpeg") {
  const image = await load(capture);
  const width = image.naturalWidth, height = image.naturalHeight;
  const area = room ? visibleArea(width, height, room) : { x: 0, y: 0, width, height };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.width));
  canvas.height = Math.max(1, Math.round(area.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no pudo preparar la imagen.");
  // A JPEG has no transparency: what the capture leaves transparent turns white, not black.
  if (type === "image/jpeg") { context.fillStyle = "#FFFFFF"; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error(type === "image/png" ? "El navegador no pudo crear el PNG." : "El navegador no pudo crear la imagen JPEG.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

/** Resolves after the next paint, so a progress label can show before heavy work. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/** Hands a file to the browser's download. */
export function saveFile(name: string, bytes: Uint8Array, type: string): void {
  saveBlob(name, new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
}

/** Hands a blob to the browser's download under `name`. */
export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
