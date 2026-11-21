"use client";
import { useEffect, useRef, useState } from "react";
import { AI_MARK, NEUTRAL, RANGES, adjustPixels, downloadName, formatValue, isNeutral, type Adjustments } from "../domain/image-adjust";

const KEYS = ["sharpness", "brightness", "warmth"] as const;

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

/** Preview and download of one option with sharpness, brightness and warmth applied on a canvas. */
export function OptionDownload({ image, slot, element, onClose }: { image: string; slot: number; element: string; onClose: () => void }) {
  const [value, setValue] = useState<Adjustments>(NEUTRAL);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<ImageData | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    setReady(false); setFailed(false); setValue(NEUTRAL); source.current = null;
    const picture = new Image();
    picture.onload = () => {
      const target = canvas.current;
      if (!active || !target) return;
      target.width = picture.naturalWidth; target.height = picture.naturalHeight;
      const context = target.getContext("2d", { willReadFrequently: true });
      if (!context) { setFailed(true); return; }
      context.drawImage(picture, 0, 0);
      source.current = context.getImageData(0, 0, target.width, target.height);
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
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), original.width, original.height), 0, 0);
    stamp(context, original.width, original.height);
  }, [ready, value]);
  function download() {
    canvas.current?.toBlob(blob => {
      if (!blob) { setFailed(true); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = downloadName(element, slot);
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }
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
    <div className="compare-footer">
      <p>Los ajustes se aplican en tu navegador. El archivo es un PNG y conserva la marca «{AI_MARK}».</p>
      <div className="option-download-actions">
        <button type="button" disabled={!ready || isNeutral(value)} onClick={() => setValue(NEUTRAL)}>Restablecer</button>
        <button type="button" onClick={onClose}>Cerrar descarga</button>
        <button type="button" className="option-download-run" disabled={!ready} onClick={download}>Descargar imagen</button>
      </div>
    </div>
  </section>;
}
