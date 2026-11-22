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
  const image = await load(capture);
  const width = image.naturalWidth, height = image.naturalHeight;
  const area = room ? visibleArea(width, height, room) : { x: 0, y: 0, width, height };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.width));
  canvas.height = Math.max(1, Math.round(area.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no pudo preparar la imagen.");
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("El navegador no pudo crear el PNG.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Resolves after the next paint, so a progress label can show before heavy work. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/** Hands a file to the browser's download. */
export function saveFile(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
