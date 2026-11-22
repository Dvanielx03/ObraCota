"use client";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, FileArchive, FileDown, FileText } from "lucide-react";
import { Spinner } from "@/shared/ui/loading";
import type { CameraPose } from "@/viewer/domain/viewer.port";
import type { SceneView } from "../domain/scene-view";
import { exportViews } from "../application/export-views";
import { nextPaint, pictureBytes, saveFile } from "../infrastructure/export-files";
import { screenRoom } from "../infrastructure/thumbnail-canvas";

/** What an export is about, read when it starts. */
export interface ExportContext { views: readonly SceneView[]; project?: string; file: string; version?: string }

type Notice = (text: string, tone?: "info" | "error") => void;

/**
 * "Exportar" pill of the workspace header and its menu (V-12, F5-04): a switch to keep only the
 * framing on screen, "Documento (PDF)" (pending) and "Imágenes (ZIP)", which builds a stored ZIP in the
 * browser with one PNG per saved view and an index. ARIA menu button: Enter, Space or ↓ open it on the
 * first option and ↑ on the last; the arrows, Inicio and Fin move; Escape closes it and gives the
 * focus back to the pill; Tab or a click outside close it.
 */
export function ExportMenu({ disabledReason, viewCount, context, camera, stage, onNotice }: {
  /** Why nothing can be exported here (2D plan, file outside a project, walking…). */
  disabledReason?: string;
  viewCount: number;
  context: () => ExportContext | null;
  camera: { pose(): CameraPose | null; apply(pose: CameraPose): void; capture(): string | null };
  stage: () => HTMLElement | null;
  onNotice: Notice;
}) {
  const [open, setOpen] = useState(false);
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), anchor = useRef<HTMLDivElement>(null);
  // Opened with the keyboard: the focus goes to an option. With the pointer: to the menu itself, as in the reference.
  const firstItem = useRef<number | null>(0);
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => job.current?.abort(), []);
  const unavailable = disabledReason ?? (busy ? "Exportación en curso" : undefined);
  const zipReason = !onlyCurrent && !viewCount ? "Guarda una vista o activa «Solo la vista actual»" : undefined;
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
  function focusItem(at: number) {
    const list = items();
    if (list.length) list[(at + list.length) % list.length].focus();
  }
  function close(focusButton: boolean) {
    setOpen(false);
    if (focusButton) button.current?.focus();
  }
  function show(at: number | null) {
    if (unavailable) return;
    firstItem.current = at;
    setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (firstItem.current === null) menu.current?.focus({ preventScroll: true });
      else focusItem(firstItem.current);
    });
    const outside = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside, true); };
  }, [open]);
  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);

  function onButtonKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show(event.key === "ArrowDown" ? 0 : -1);
    }
  }
  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = items(), at = list.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at < 0 ? list.length - 1 : at - 1, Home: 0, End: list.length - 1 };
    if (event.key in moves) { event.preventDefault(); focusItem(moves[event.key]); return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") setOpen(false);
  }

  async function exportZip() {
    const subject = context();
    if (zipReason || !subject || busy) return;
    close(true);
    const controller = new AbortController();
    job.current = controller;
    const host = stage();
    const room = host ? screenRoom(host) : undefined;
    setBusy({ done: 0, total: onlyCurrent ? 1 : subject.views.length });
    try {
      const result = await exportViews(subject.views, { project: subject.project, file: subject.file, version: subject.version, onlyCurrent }, {
        pose: camera.pose,
        apply: camera.apply,
        // The capture is taken right away, with the camera the export has just applied.
        picture: () => {
          const shot = camera.capture();
          return shot ? pictureBytes(shot, room) : Promise.reject(new Error("El visor no está disponible."));
        },
        settle: nextPaint,
      }, (done, total) => setBusy({ done, total }), controller.signal);
      if (controller.signal.aborted) return;
      saveFile(result.name, result.bytes, "application/zip");
      onNotice("Descargado " + result.name + " · " + (result.count === 1 ? "1 imagen" : result.count + " imágenes") + " e índice.");
    } catch (error) {
      if (!controller.signal.aborted) onNotice("No se pudo exportar: " + (error instanceof Error ? error.message : "error desconocido") + ".", "error");
    } finally {
      if (job.current === controller) { job.current = null; setBusy(null); }
    }
  }

  const label = busy ? "Exportando " + Math.max(1, busy.done) + " de " + busy.total + "…" : "Exportar";
  return <div className="export-anchor" ref={anchor}>
    <button ref={button} type="button" className="header-pill header-export" aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? "export-menu" : undefined} aria-disabled={unavailable ? true : undefined} aria-busy={busy ? true : undefined}
      title={busy ? "Exportando las vistas: el lienzo pasa por cada una y vuelve a tu encuadre" : unavailable ?? "Exportar las vistas guardadas"}
      onClick={(event) => { if (open) close(false); else show(event.detail === 0 ? 0 : null); }} onKeyDown={onButtonKey}>
      {busy ? <Spinner size={12}/> : <FileDown size={12} strokeWidth={2} aria-hidden="true"/>}
      {label}
      {!busy && <ChevronDown size={12} strokeWidth={2} aria-hidden="true"/>}
    </button>
    {open && <div ref={menu} id="export-menu" className="export-menu" role="menu" aria-label="Exportar" tabIndex={-1} onKeyDown={onMenuKey}>
      <button type="button" role="menuitemcheckbox" aria-checked={onlyCurrent} tabIndex={-1} className="export-switch-row"
        aria-describedby="export-switch-help" onClick={() => setOnlyCurrent(!onlyCurrent)}>
        <span>Solo la vista actual</span><span className="export-switch" aria-hidden="true"><i/></span>
      </button>
      <hr className="export-separator"/>
      <p id="export-switch-help" className="export-help">Exporta solo el encuadre en pantalla</p>
      <button type="button" role="menuitem" tabIndex={-1} className="export-item" aria-disabled="true" title="Pendiente: exportar las vistas en un PDF">
        <FileText size={16} strokeWidth={1.8} aria-hidden="true"/>Documento (PDF)</button>
      <button type="button" role="menuitem" tabIndex={-1} className="export-item" aria-disabled={zipReason ? true : undefined}
        title={zipReason ?? (onlyCurrent ? "Una imagen PNG de la vista actual y su índice" : "Una imagen PNG por vista guardada y un índice")}
        onClick={() => void exportZip()}>
        <FileArchive size={16} strokeWidth={1.8} aria-hidden="true"/>Imágenes (ZIP)</button>
    </div>}
  </div>;
}
