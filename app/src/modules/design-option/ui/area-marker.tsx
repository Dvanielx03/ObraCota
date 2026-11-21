"use client";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_AREA, STEP, areaBetween, describeArea, moveArea, resizeArea, type Area } from "../domain/selection-area";

/**
 * The capture that will be sent, with an optional rectangle that limits where the change may
 * happen. Drag to draw it; with the keyboard, add it with the button and adjust it with the
 * arrow keys (Shift resizes, Delete removes).
 */
export function AreaMarker({ src, alt, area, onChange, onSize, disabled }: {
  src: string; alt: string; area: Area | null; onChange: (area: Area | null) => void;
  onSize: (width: number, height: number) => void; disabled?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  function point(event: PointerEvent) {
    const r = stage.current!.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || event.target === box.current) return;
    start.current = point(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const now = point(event);
    const next = areaBetween(start.current.x, start.current.y, now.x, now.y);
    if (next) onChange(next);
  }
  function up() {
    start.current = null;
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (!area || disabled) return;
    const direction: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); onChange(null); return; }
    const d = direction[event.key];
    if (!d) return;
    event.preventDefault();
    onChange(event.shiftKey ? resizeArea(area, d[0] * STEP, d[1] * STEP) : moveArea(area, d[0] * STEP, d[1] * STEP));
  }

  return (
    <div className="area-marker">
      <div ref={stage} className="area-stage" data-marked={area ? "" : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <img src={src} alt={alt} draggable={false} onLoad={(event) => onSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
        {area && (
          <div ref={box} className="area-box" tabIndex={0} role="group" onKeyDown={keys}
            aria-label={"Área marcada: " + describeArea(area) + ". Flechas para mover, Mayús con flechas para cambiar el tamaño, Supr para quitar."}
            style={{ left: area.x * 100 + "%", top: area.y * 100 + "%", width: area.w * 100 + "%", height: area.h * 100 + "%" }} />
        )}
      </div>
      <div className="area-controls">
        <p>{area ? "El cambio se limitará al área marcada: " + describeArea(area) + "." : "Arrastra sobre la imagen para limitar el cambio a un área. Sin área, se edita la pieza seleccionada."}</p>
        {area
          ? <button type="button" disabled={disabled} onClick={() => onChange(null)}>Quitar el área</button>
          : <button type="button" disabled={disabled} onClick={() => { onChange(DEFAULT_AREA); requestAnimationFrame(() => box.current?.focus()); }}>Marcar un área</button>}
      </div>
    </div>
  );
}

/** Black image of the capture's size with the area in white: the format the image model expects. */
export function areaMask(area: Area, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.fillRect(Math.round(area.x * width), Math.round(area.y * height), Math.round(area.w * width), Math.round(area.h * height));
  return canvas.toDataURL("image/jpeg", 0.92);
}
