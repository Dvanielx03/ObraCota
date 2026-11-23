"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, RotateCcw, Trees, X } from "lucide-react";
import { Spinner } from "@/shared/ui/loading";
import { panoramaSphere } from "@/viewer/infrastructure/panorama-sphere";
import type { SceneEnvironment } from "@/viewer/domain/viewer.port";
import { environmentLabel, environmentText } from "../domain/scene-environment";
import { requestPanorama } from "../infrastructure/option-http";

/** The scene shown in 3D right now and the request it came from (what the panorama asks for). */
export interface WalkScene { environment: SceneEnvironment; request: string }

/**
 * Line over the 3D view while a scene is built around the model (and during the walk): what it shows,
 * «Panorama 360° con IA» and «Restablecer», which returns to the neutral viewer.
 */
export function SceneWalkBar({ scene, base, capture, onReset }: {
  scene: WalkScene;
  /** Options path of the saved version; without it the panorama explains why it is off. */
  base?: string;
  /** JPEG data URL of the current view (the walk's own when walking), sent as the reference picture. */
  capture: () => string | null;
  onReset: () => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function generate() {
    if (!base || busy) return;
    setBusy(true); setError("");
    const control = new AbortController(); request.current = control;
    try {
      const image = capture();
      const scene360 = (scene.request.trim() || environmentText(scene.environment)).slice(0, 2000);
      const blob = await requestPanorama(base, { scene: scene360, jpeg: image ? image.split(",")[1] : undefined }, control.signal);
      if (!control.signal.aborted) setUrl(URL.createObjectURL(blob));
    } catch (failure) {
      if (!control.signal.aborted) setError(failure instanceof Error && failure.message ? failure.message : "No se pudo generar el panorama.");
    } finally { if (!control.signal.aborted) setBusy(false); }
  }
  const label = environmentLabel(scene.environment);
  return <>
    <div className="scene-walk" role="group" aria-label="Escena en 3D">
      <span className="scene-walk-label" title={label}><Trees size={14} strokeWidth={2} aria-hidden="true" /><span>Escena 3D · {label}</span></span>
      <button type="button" className="scene-walk-button" aria-busy={busy || undefined} aria-disabled={!base || busy ? true : undefined}
        title={!base ? "Disponible en una versión guardada de un proyecto" : "Genera con IA una imagen de 360° de esta escena para mirar alrededor (sin costo con el proveedor gratuito)"}
        onClick={() => void generate()}>
        {busy ? <Spinner size={12} /> : <Globe size={14} strokeWidth={2} aria-hidden="true" />}{busy ? "Generando panorama…" : "Panorama 360° con IA"}
      </button>
      <button type="button" className="scene-walk-button" title="Quita la escena y vuelve al visor neutro" onClick={onReset}>
        <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />Restablecer</button>
      {error && <p className="scene-walk-error" role="alert">{error}</p>}
    </div>
    {/* On the body: the stage's own stacking would leave the header over the full-screen view. */}
    {url && createPortal(<PanoramaViewer url={url} label={label} onClose={() => setUrl(null)} />, document.body)}
  </>;
}

/** Full-screen look-around of the generated panorama; Escape or «Cerrar» close it. */
export function PanoramaViewer({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!host.current) return;
    const back = document.activeElement as HTMLElement | null;
    const sphere = panoramaSphere(host.current, url, () => { setState("ready"); sphere.canvas.focus(); }, () => setState("error"));
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // The walk also leaves on Escape: the panorama closes first, alone.
      event.preventDefault(); event.stopImmediatePropagation();
      close.current();
    }
    window.addEventListener("keydown", key, true);
    closeButton.current?.focus();
    return () => { window.removeEventListener("keydown", key, true); sphere.dispose(); back?.focus?.({ preventScroll: true }); };
  }, [url]);
  return <div className="panorama" role="dialog" aria-modal="true" aria-label="Panorama 360° con IA">
    <div ref={host} className="panorama-view" data-state={state} />
    <div className="panorama-head">
      <div>
        <h2>Panorama 360° con IA</h2>
        <p className="panorama-note">Imagen generada con IA: no reproduce la geometría exacta. {label}</p>
      </div>
      <button ref={closeButton} type="button" className="panorama-close" aria-label="Cerrar panorama" title="Cerrar · Esc" onClick={onClose}><X size={18} strokeWidth={2} aria-hidden="true" /></button>
    </div>
    <p className="panorama-hint" role="status">{state === "loading" ? "Cargando el panorama…" : state === "error" ? "No se pudo abrir la imagen." : "Arrastra o usa las flechas para mirar alrededor · rueda para acercar · Esc para cerrar"}</p>
  </div>;
}
