"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, FileArchive, FileDown, FileText, PackageCheck } from "lucide-react";
import { Spinner } from "@/shared/ui/loading";
import { useDisabledReason } from "@/shared/ui/disabled-reason";
import type { CameraPose } from "@/viewer/domain/viewer.port";
import type { SceneView } from "../domain/scene-view";
import { exportViews, exportViewsDocument } from "../application/export-views";
import { exportReviewPackage } from "../application/review-package";
import { versionRepository } from "@/modules/model-version/infrastructure/version-http";
import { modelChangeRepository } from "@/modules/model-change/infrastructure/model-change-http";
import { nextPaint, pictureBytes, pictureJpeg, saveFile } from "../infrastructure/export-files";
import { screenRoom } from "../infrastructure/thumbnail-canvas";

/** What an export is about, read when it starts. */
export interface ExportContext { views: readonly SceneView[]; project?: string; file: string; version?: string;
  /** The stored version on the server, for «Paquete de revisión (ZIP)». */
  stored?: { project: string; version: string } }

type Notice = (text: string, tone?: "info" | "error") => void;

/**
 * "Exportar" pill of the workspace header and its menu (V-12, F5-04, H7): a switch to keep only the
 * framing on screen, "Documento (PDF)", a cover with the list of views and one page per view, and
 * "Imágenes (ZIP)", a stored ZIP with one PNG per saved view and an index, and "Paquete de revisión (ZIP)" (R6/P-09):
 * the original of the version, its views and the design changes applied to it. All are built in the browser. ARIA menu button: Enter, Space or ↓ open it on the
 * first option and ↑ on the last; the arrows, Inicio and Fin move; Escape closes it and gives the
 * focus back to the pill; Tab or a click outside close it.
 */
export function ExportMenu({ disabledReason, viewCount, context, camera, stage, onNotice, stored }: {
  /** Why nothing can be exported here (2D plan, file outside a project, walking…). */
  disabledReason?: string;
  viewCount: number;
  /** Whether the open file is a stored version (enables «Paquete de revisión (ZIP)»). */
  stored?: boolean;
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
  const packageReason = stored ? undefined : "Disponible en una versión guardada en un proyecto";
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
  const focusItem = useCallback((at: number) => {
    const list = [...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    if (list.length) list[(at + list.length) % list.length].focus();
  }, []);
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
  }, [open, focusItem]);
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

  async function run(kind: "zip" | "pdf" | "package") {
    const subject = context();
    if ((kind !== "package" && zipReason) || !subject || busy) return;
    if (kind === "package") { await runPackage(subject); return; }
    close(true);
    const controller = new AbortController();
    job.current = controller;
    const host = stage();
    const room = host ? screenRoom(host) : undefined;
    setBusy({ done: 0, total: onlyCurrent ? 1 : subject.views.length });
    const source = { project: subject.project, file: subject.file, version: subject.version, onlyCurrent };
    const ports = { pose: camera.pose, apply: camera.apply, settle: nextPaint };
    // The capture is taken right away, with the camera the export has just applied.
    const shot = () => {
      const capture = camera.capture();
      return capture ? Promise.resolve(capture) : Promise.reject(new Error("El visor no está disponible."));
    };
    const progress = (done: number, total: number) => setBusy({ done, total });
    try {
      const result = kind === "zip"
        ? await exportViews(subject.views, source, { ...ports, picture: async () => pictureBytes(await shot(), room) }, progress, controller.signal)
        : await exportViewsDocument(subject.views, source, { ...ports, picture: async () => pictureJpeg(await shot(), room) }, progress, controller.signal);
      if (controller.signal.aborted) return;
      saveFile(result.name, result.bytes, kind === "zip" ? "application/zip" : "application/pdf");
      const pictures = result.count === 1 ? "1 imagen" : result.count + " imágenes";
      onNotice("Descargado " + result.name + " · " + (kind === "zip" ? pictures + " e índice." : "portada y " + (result.count === 1 ? "1 página" : result.count + " páginas") + " de vistas."));
    } catch (error) {
      if (!controller.signal.aborted) onNotice("No se pudo exportar: " + (error instanceof Error ? error.message : "error desconocido") + ".", "error");
    } finally {
      if (job.current === controller) { job.current = null; setBusy(null); }
    }
  }

  async function runPackage(subject: ExportContext) {
    const stored = subject.stored;
    if (!stored) return;
    close(true);
    const controller = new AbortController();
    job.current = controller;
    const host = stage();
    const room = host ? screenRoom(host) : undefined;
    const views = onlyCurrent ? [] : subject.views;
    setBusy({ done: 0, total: Math.max(1, views.length) });
    try {
      const result = await exportReviewPackage(views, { project: subject.project, version: stored.version }, {
        pose: camera.pose, apply: camera.apply, settle: nextPaint,
        picture: async () => {
          const capture = camera.capture();
          if (!capture) throw new Error("El visor no está disponible.");
          return pictureBytes(capture, room);
        },
        version: () => versionRepository.get(stored.project, stored.version, controller.signal),
        original: () => versionRepository.open(stored.project, stored.version, controller.signal),
        changes: () => modelChangeRepository.list(stored.project, controller.signal),
      }, (done, total) => setBusy({ done, total }), controller.signal);
      if (controller.signal.aborted) return;
      saveFile(result.name, result.bytes, "application/zip");
      const pictures = result.count === 1 ? "1 vista" : result.count + " vistas";
      const changes = result.changes === 1 ? "1 cambio aplicado" : result.changes ? result.changes + " cambios aplicados" : "sin cambios aplicados";
      onNotice("Descargado " + result.name + " · original, " + pictures + ", " + changes + " y resumen.");
    } catch (error) {
      if (!controller.signal.aborted) onNotice("No se pudo exportar el paquete: " + (error instanceof Error ? error.message : "error desconocido") + ".", "error");
    } finally {
      if (job.current === controller) { job.current = null; setBusy(null); }
    }
  }

  const exportOff = useDisabledReason(busy ? undefined : unavailable), zipOff = useDisabledReason(zipReason), packageOff = useDisabledReason(packageReason);
  const label = busy ? "Exportando " + Math.max(1, busy.done) + " de " + busy.total + "…" : "Exportar";
  return <div className="export-anchor" ref={anchor}>
    <button ref={button} type="button" className="header-pill header-export" aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? "export-menu" : undefined} aria-disabled={unavailable ? true : undefined} aria-busy={busy ? true : undefined}
      aria-describedby={exportOff.describedBy} title={busy ? "Exportando las vistas: el lienzo pasa por cada una y vuelve a tu encuadre" : unavailable ?? "Exportar las vistas guardadas"}
      onClick={(event) => { if (open) close(false); else show(event.detail === 0 ? 0 : null); }} onKeyDown={onButtonKey}>
      {busy ? <Spinner size={12}/> : <FileDown size={12} strokeWidth={2} aria-hidden="true"/>}
      {label}
      {!busy && <ChevronDown size={12} strokeWidth={2} aria-hidden="true"/>}
    </button>
    {exportOff.note}
    {open && <div ref={menu} id="export-menu" className="export-menu" role="menu" aria-label="Exportar" tabIndex={-1} onKeyDown={onMenuKey}>
      <button type="button" role="menuitemcheckbox" aria-checked={onlyCurrent} tabIndex={-1} className="export-switch-row"
        aria-describedby="export-switch-help" onClick={() => setOnlyCurrent(!onlyCurrent)}>
        <span>Solo la vista actual</span><span className="export-switch" aria-hidden="true"><i/></span>
      </button>
      <hr className="export-separator"/>
      <p id="export-switch-help" className="export-help">Exporta solo el encuadre en pantalla</p>
      <button type="button" role="menuitem" tabIndex={-1} className="export-item" aria-disabled={zipReason ? true : undefined} aria-describedby={zipOff.describedBy}
        title={zipReason ?? (onlyCurrent ? "Un PDF con la portada y la vista actual" : "Un PDF con una portada y una página por vista guardada")}
        onClick={() => void run("pdf")}>
        <FileText size={16} strokeWidth={1.8} aria-hidden="true"/>Documento (PDF)</button>
      <button type="button" role="menuitem" tabIndex={-1} className="export-item" aria-disabled={zipReason ? true : undefined} aria-describedby={zipOff.describedBy}
        title={zipReason ?? (onlyCurrent ? "Una imagen PNG de la vista actual y su índice" : "Una imagen PNG por vista guardada y un índice")}
        onClick={() => void run("zip")}>
        <FileArchive size={16} strokeWidth={1.8} aria-hidden="true"/>Imágenes (ZIP)</button>
      {zipOff.note}
      <hr className="export-separator"/>
      <button type="button" role="menuitem" tabIndex={-1} className="export-item" aria-disabled={packageReason ? true : undefined} aria-describedby={packageOff.describedBy}
        title={packageReason ?? "Un ZIP con el original de la versión, sus vistas en PNG y los cambios de diseño aplicados (receta, informe y costo)"}
        onClick={() => { if (!packageReason) void run("package"); }}>
        <PackageCheck size={16} strokeWidth={1.8} aria-hidden="true"/>Paquete de revisión (ZIP)</button>
      {packageOff.note}
    </div>}
  </div>;
}
