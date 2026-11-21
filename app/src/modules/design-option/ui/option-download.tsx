"use client";
import { useEffect, useRef, useState } from "react";
import { AI_MARK, FULL_FRAME, NEUTRAL, RANGES, adjustPixels, cropRect, downloadName, formatValue, isFullFrame, isNeutral, type Adjustments, type Framing } from "../domain/image-adjust";

const KEYS = ["sharpness", "brightness", "warmth"] as const;
const FRAMING: [keyof Framing, string, number, number][] = [["zoom", "Acercar", 100, 300], ["x", "Horizontal", 0, 100], ["y", "Vertical", 0, 100]];

/** Small label in the lower right corner, sized with the image so it survives any resolution. */
function stamp(context: CanvasRenderingContext2D, width: number, height: number) {
  const size = Math.max(11, Math.round(width / 58));
  const pad = Math.round(size * 0.6);
  context.font = "600 " + size + "px Manrope, Arial, sans-serif";
  const box = context.measureText(AI_MARK).width + pad * 2;
  context.fillStyle = "rgba(10, 21, 34, 0.82)";
  context.fillRect(width - box - pad, height - size - pad * 3, box, size + pad * 2);
  context.fillStyle = "#f1ede4";
  context.textBaseline = "middle";
  context.fillText(AI_MARK, width - box, height - pad * 2 - size / 2);
}

/**
 * Preview and download of one option. Sharpness, brightness and warmth are applied on a canvas,
 * and a close-up is a crop of the same pixels: nothing is enlarged or sent anywhere.
 */
export function OptionDownload({ image, slot, element, onClose }: { image: string; slot: number; element: string; onClose: () => void }) {
  const [value, setValue] = useState<Adjustments>(NEUTRAL);
  const [framing, setFraming] = useState<Framing>(FULL_FRAME);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<ImageData | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    setReady(false); setFailed(false); setValue(NEUTRAL); setFraming(FULL_FRAME); source.current = null;
    const picture = new Image();
    picture.onload = () => {
      if (!active) return;
      const work = document.createElement("canvas");
      work.width = picture.naturalWidth; work.height = picture.naturalHeight;
      const context = work.getContext("2d", { willReadFrequently: true });
      if (!context) { setFailed(true); return; }
      context.drawImage(picture, 0, 0);
      source.current = context.getImageData(0, 0, work.width, work.height);
      setReady(true);
      root.current?.scrollIntoView({ block: "nearest" });
    };
    picture.onerror = () => { if (active) setFailed(true); };
    picture.src = image;
    return () => { active = false; };
  }, [image]);
  useEffect(() => {
    const target = canvas.current, original = source.current;
    if (!ready || !target || !original) return;
    const context = target.getContext("2d");
    if (!context) return;
    const pixels = isNeutral(value) ? original.data : adjustPixels(original.data, original.width, original.height, value);
    const crop = cropRect(original.width, original.height, framing);
    target.width = crop.width; target.height = crop.height;
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), original.width, original.height), -crop.x, -crop.y);
    stamp(context, crop.width, crop.height);
  }, [ready, value, framing]);
  function download() {
    canvas.current?.toBlob(blob => {
      if (!blob) { setFailed(true); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = downloadName(element, slot, !isFullFrame(framing));
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }
  const untouched = isNeutral(value) && isFullFrame(framing);
  return <section ref={root} className="option-download" aria-label={"Descargar la opción " + slot}>
    <canvas ref={canvas} role="img" aria-label={"Opción " + slot + " con los ajustes aplicados · " + AI_MARK} hidden={!ready}/>
    {failed ? <p role="alert">No se pudo preparar la imagen.</p> : !ready && <p role="status">Preparando la imagen…</p>}
    <div className="option-download-controls">
      {KEYS.map(key => <label key={key}>
        <span>{RANGES[key].label}<b>{formatValue(key, value[key])}</b></span>
        <input type="range" min={RANGES[key].min} max={RANGES[key].max} step={1} value={value[key]} disabled={!ready}
          onChange={event => setValue(current => ({ ...current, [key]: Number(event.target.value) }))}/>
      </label>)}
    </div>
    <fieldset className="option-download-controls option-download-framing">
      <legend>Primer plano</legend>
      {FRAMING.map(([key, label, min, max]) => <label key={key}>
        <span>{label}<b>{framing[key]} %</b></span>
        <input type="range" min={min} max={max} step={key === "zoom" ? 10 : 1} value={framing[key]}
          disabled={!ready || (key !== "zoom" && framing.zoom === 100)}
          onChange={event => setFraming(current => ({ ...current, [key]: Number(event.target.value) }))}/>
      </label>)}
    </fieldset>
    <div className="compare-footer">
      <p>Los ajustes se aplican en tu navegador. El primer plano es un recorte: no inventa detalle. El archivo es un PNG y conserva la marca «{AI_MARK}».</p>
      <div className="option-download-actions">
        <button type="button" disabled={!ready || untouched} onClick={() => { setValue(NEUTRAL); setFraming(FULL_FRAME); }}>Restablecer</button>
        <button type="button" onClick={onClose}>Cerrar descarga</button>
        <button type="button" className="option-download-run" disabled={!ready} onClick={download}>Descargar imagen</button>
      </div>
    </div>
  </section>;
}
