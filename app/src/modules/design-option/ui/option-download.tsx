"use client";
import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { Download, Droplets, Sun, Thermometer, Triangle } from "lucide-react";
import { AI_MARK, ADJUSTMENT_KEYS, RANGES, adjustPixels, cropRect, downloadName, fillPercent, formatValue, isFullFrame, isNeutral, type Adjustments, type Framing } from "../domain/image-adjust";
import type { OptionBatch } from "../domain/option-history";
import { optionImagePath } from "../infrastructure/option-http";
import { OptionSwitch } from "./option-compare";
import { usePrivateImage } from "./use-option-history";
import { LoadingStatus, Skeleton } from "@/shared/ui/loading";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean | "true" }>;
const ICONS: Record<keyof Adjustments, Icon> = { sharpness: Triangle, brightness: Sun, warmth: Thermometer, saturation: Droplets };
/** What the panel used to say under the sliders; now the download button's tooltip and description. */
const NOTE = "Los ajustes se aplican en tu navegador. El primer plano es un recorte: no inventa detalle. El archivo es un PNG con la marca «" + AI_MARK + "».";
const FRAMING: [keyof Framing, string, number, number][] = [["zoom", "Acercar", 100, 300], ["x", "Horizontal", 0, 100], ["y", "Vertical", 0, 100]];

/** Small label in the lower right corner, sized with the image so it survives any resolution. */
function stamp(context: CanvasRenderingContext2D, width: number, height: number) {
  const size = Math.max(11, Math.round(width / 58));
  const pad = Math.round(size * 0.6);
  // Burned into the exported pixels, so it uses fixed values instead of theme tokens.
  context.font = "600 " + size + "px ui-sans-serif, system-ui, sans-serif";
  const box = context.measureText(AI_MARK).width + pad * 2;
  context.fillStyle = "rgba(0, 0, 0, 0.7)";
  context.fillRect(width - box - pad, height - size - pad * 3, box, size + pad * 2);
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  context.fillText(AI_MARK, width - box, height - pad * 2 - size / 2);
}

/** One slider row of the panel: icon and name, the signed value on the right, the track below. */
function AdjustRow({ icon: Glyph, label, value, current, min, max, step = 1, fill, disabled, onChange }: {
  icon?: Icon; label: string; value: string; current: number; min: number; max: number; step?: number; fill: number; disabled: boolean; onChange: (value: number) => void;
}) {
  const id = useId();
  return <div className="adjust-row">
    <label htmlFor={id}>{Glyph && <Glyph size={14} strokeWidth={2} aria-hidden="true" />}{label}<b>{value}</b></label>
    <input id={id} className="adjust-range" type="range" min={min} max={max} step={step} disabled={disabled}
      style={{ "--fill": fill + "%" } as React.CSSProperties} value={current}
      onChange={(event) => onChange(Number(event.target.value))} />
  </div>;
}

/**
 * Content of the Descargar panel: which option, its preview with the adjustments applied, the
 * four sliders, an optional close-up and the download. Sharpness, brightness, warmth and
 * saturation are applied on a canvas, and a close-up is a crop of the same pixels: nothing is
 * enlarged or sent anywhere. The adjustments are controlled by the panel, which owns the reset
 * button in its header; the download button stays in the panel footer while the body scrolls.
 */
export function OptionDownloadPanel({ base, batch, slot, onSlot, element, value, framing, onValue, onFraming }: {
  base: string; batch: OptionBatch; slot: number; onSlot: (slot: number) => void; element: string;
  value: Adjustments; framing: Framing; onValue: (value: Adjustments) => void; onFraming: (framing: Framing) => void;
}) {
  const image = usePrivateImage(optionImagePath(base, batch.id, slot));
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<ImageData | null>(null);
  useEffect(() => {
    setReady(false); setFailed(false); source.current = null;
    if (!image.url) return;
    let active = true;
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
    };
    picture.onerror = () => { if (active) setFailed(true); };
    picture.src = image.url;
    return () => { active = false; };
  }, [image.url]);
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
    canvas.current?.toBlob((blob) => {
      if (!blob) { setFailed(true); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = downloadName(element, slot, !isFullFrame(framing));
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }
  const broken = failed || image.error;
  const noteId = useId();
  return <>
    <section className="tool-popover-body option-download" aria-label={"Descargar la opción " + slot}>
      <OptionSwitch batch={batch} slot={slot} onSlot={onSlot} compact />
      <div className="adjust-list">
        {ADJUSTMENT_KEYS.map((key) => <AdjustRow key={key} icon={ICONS[key]} label={RANGES[key].label} value={formatValue(key, value[key])} current={value[key]}
          min={RANGES[key].min} max={RANGES[key].max} fill={fillPercent(key, value[key])} disabled={!ready}
          onChange={(next) => onValue({ ...value, [key]: next })} />)}
      </div>
      {/* The reference has no preview: here the preview and the close-up fold into one line, so the panel keeps
          its height. The canvas stays mounted while folded, as the download is drawn from it. */}
      <details className="adjust-closeup">
        <summary>Vista previa y primer plano{!isFullFrame(framing) && <small> · {framing.zoom} %</small>}</summary>
        <div className="option-download-preview">
          <canvas ref={canvas} role="img" aria-label={"Opción " + slot + " con los ajustes aplicados · " + AI_MARK} hidden={!ready} />
          {!broken && !ready && <><Skeleton className="download-skeleton" /><LoadingStatus>Preparando la imagen…</LoadingStatus></>}
        </div>
        <div className="adjust-list">
          {FRAMING.map(([key, label, min, max]) => <AdjustRow key={key} label={label} value={framing[key] + " %"} current={framing[key]} min={min} max={max}
            step={key === "zoom" ? 10 : 1} fill={((framing[key] - min) / (max - min)) * 100}
            disabled={!ready || (key !== "zoom" && framing.zoom === 100)} onChange={(next) => onFraming({ ...framing, [key]: next })} />)}
        </div>
      </details>
      {broken && <p role="alert" className="options-alert">No se pudo preparar la imagen.</p>}
    </section>
    <div className="tool-popover-foot">
      <button type="button" className="main-button" disabled={!ready} onClick={download} aria-describedby={noteId} title={NOTE}>
        <Download size={16} strokeWidth={2} aria-hidden="true" />Descargar imagen
      </button>
      <p id={noteId} className="visually-hidden">{NOTE}</p>
    </div>
  </>;
}
