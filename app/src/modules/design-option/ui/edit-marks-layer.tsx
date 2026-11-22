"use client";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ImagePlus, Trash } from "lucide-react";
import { Spinner } from "@/shared/ui/loading";
import { useDisabledReason } from "@/shared/ui/disabled-reason";
import type { CameraPose, ViewerPort } from "@/viewer/domain/viewer.port";
// Same tolerance as the export (0.1 % of the visible height): a resize that keeps the framing is not a move.
import { samePose } from "@/modules/scene-view/domain/view-export";
import { areaBetween, type Area } from "../domain/selection-area";
import { EDIT_MARK_STEP, EDIT_MARK_TEXT_LIMIT, describeEditMark, nudgeArea, type EditMark } from "../domain/edit-marks";

/** Floating field of the reference: 340 × 44, 2 px from a point, 14 px over a zone's number. */
const FIELD_WIDTH = 340, FIELD_HEIGHT = 44, EDGE = 8, POINT_GAP = 2, DOT = 12, ZONE_GAP = 14;
/** A drag shorter than this is a click. */
const CLICK_SLOP = 4;
/** Floating controls of the workspace the field never covers, with the room kept around them. */
const AVOID = [".viewer-header .viewer-crumbs", ".viewer-header .viewer-actions", ".cube-host .orientation", ".version-rail", ".scene-strip",
  ".workspace-bars .tool-bar", ".workspace-bars .tools", ".edit-dock .edit-bar-host", ".edit-dock .edit-pill", ".stagebar > .explorer-toggle"];
const CLEAR = 8;
/** Column on the right of the canvas that holds the view cube, its axes and the version rail. */
const RIGHT_GUTTER = 88;

type Spot = { x: number; y: number } | null;
type Box = { left: number; top: number; right: number; bottom: number };
export interface MarkFocus { id: number; target: "field" | "mark"; at: number }

/** Rectangles of the floating controls, in the coordinates of the canvas container. */
function obstacles(host: HTMLElement): Box[] {
  const root = host.closest(".workspace") ?? document;
  const base = host.getBoundingClientRect();
  const out: Box[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(AVOID.join(","))) {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    out.push({ left: r.left - base.left - CLEAR, top: r.top - base.top - CLEAR, right: r.right - base.left + CLEAR, bottom: r.bottom - base.top + CLEAR });
  }
  return out;
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * Where the field goes: the reference's place first (left of a point, over a zone), then the other
 * sides, each kept inside the canvas and out of the right column. The first place that covers no
 * floating control and not the mark itself wins; if none is free, the one that covers the least.
 */
function placeField(candidates: { left: number; top: number }[], width: number, bounds: { w: number; h: number }, avoid: Box[]) {
  const maxLeft = Math.max(EDGE, bounds.w - width - RIGHT_GUTTER);
  const maxTop = Math.max(EDGE, bounds.h - FIELD_HEIGHT - EDGE);
  let best: { left: number; top: number; cost: number } | null = null;
  for (const wanted of candidates) {
    const left = Math.max(EDGE, Math.min(wanted.left, maxLeft)), top = Math.max(EDGE, Math.min(wanted.top, maxTop));
    const box = { left, top, right: left + width, bottom: top + FIELD_HEIGHT };
    const cost = avoid.reduce((sum, item) => sum + overlap(box, item), 0);
    if (cost === 0) return { left, top };
    if (!best || cost < best.cost) best = { left, top, cost };
  }
  return best ? { left: best.left, top: best.top } : { left: EDGE, top: EDGE };
}

/**
 * Marks of Editar › Seleccionar drawn over the live 3D canvas (DU-17, 03-herramientas.md §3.2). The
 * layer is portalled into the viewer's container and lets the pointer through: the right button
 * still orbits, the middle one pans and the wheel zooms. With Seleccionar on, a left click on a piece
 * asks for a point anchored to it and a left drag draws a zone. Points are projected again after
 * every frame, so they follow their piece and hide when it is out of view or behind the model.
 * Keyboard: Tab reaches the marks; Enter opens the field, Delete removes the mark, the arrows move
 * it (a point jumps to the piece under its new place) and Shift with the arrows resizes a zone.
 */
export function EditMarksLayer({ viewer, host, marks, marking, open, focus, areaPose, sendReason, sendTitle, sending, onOpen, onPoint, onArea, onText, onRemove, onMove, onMiss, onCameraMoved, onSend }: {
  viewer: ViewerPort;
  /** The viewer's container (`.view`): the layer covers exactly its canvas. */
  host: HTMLElement;
  marks: readonly EditMark[];
  /** Seleccionar is on: the left button draws. */
  marking: boolean;
  /** Mark whose field is open; only one at a time. */
  open: number | null;
  focus: MarkFocus | null;
  /** Framing the zones were drawn on; when the camera leaves it, the zones no longer match the model. */
  areaPose: CameraPose | null;
  /** Why the edit cannot be sent yet; the send button is shown at half opacity meanwhile. */
  sendReason?: string;
  /** Tooltip of the send button when it can be used: it carries the cost. */
  sendTitle: string;
  /** The marks are on their way: the send button turns and says it is busy. */
  sending?: boolean;
  onOpen: (id: number | null) => void;
  /** A click on the canvas at a client position (the caller probes the model). */
  onPoint: (clientX: number, clientY: number) => void;
  onArea: (area: Area) => void;
  onText: (id: number, text: string) => void;
  onRemove: (id: number) => void;
  /** A point moved with the keyboard: the caller anchors it again at a client position. A zone comes back already moved. */
  onMove: (mark: EditMark, client?: { x: number; y: number }) => void;
  onMiss: () => void;
  onCameraMoved: () => void;
  onSend: () => void;
}) {
  const sendOff = useDisabledReason(sendReason);
  const layer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: host.clientWidth, h: host.clientHeight });
  const [spots, setSpots] = useState<Record<number, Spot>>({});
  const [draft, setDraft] = useState<Area | null>(null);
  const want = useRef<MarkFocus | null>(null);
  const latest = useRef({ marks, marking, areaPose, onPoint, onArea, onOpen, onMiss, onCameraMoved });
  latest.current = { marks, marking, areaPose, onPoint, onArea, onOpen, onMiss, onCameraMoved };

  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => setSize({ w: host.clientWidth, h: host.clientHeight }));
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);

  // Points follow the camera: projected again (once per animation frame) after every frame drawn.
  useEffect(() => {
    let frame = 0;
    function place() {
      frame = 0;
      const { marks: list, areaPose: pose, onCameraMoved: moved } = latest.current;
      const points = list.filter((mark) => mark.kind === "point");
      const where = viewer.project(points.map((mark) => mark.at), points.map((mark) => mark.element));
      const next: Record<number, Spot> = {};
      points.forEach((mark, index) => { next[mark.id] = where[index]; });
      setSpots(next);
      if (pose && list.some((mark) => mark.kind === "area")) {
        const now = viewer.pose();
        if (!now || !samePose(now, pose)) moved();
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    const stop = viewer.onFrame(schedule);
    schedule();
    return () => { stop(); cancelAnimationFrame(frame); };
  }, [viewer]);
  // New or moved points are placed at once, without waiting for the camera.
  const pointKey = marks.filter((mark) => mark.kind === "point").map((mark) => mark.id + ":" + mark.at.join(",")).join("|");
  useLayoutEffect(() => {
    const points = marks.filter((mark) => mark.kind === "point");
    const where = viewer.project(points.map((mark) => mark.at), points.map((mark) => mark.element));
    const next: Record<number, Spot> = {};
    points.forEach((mark, index) => { next[mark.id] = where[index]; });
    setSpots(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointKey, viewer, size.w, size.h]);

  // Left button on the canvas: a click asks for a point, a drag draws a zone. Other buttons go to the camera.
  useEffect(() => {
    let start: { x: number; y: number; id: number } | null = null;
    const fraction = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    };
    function down(event: PointerEvent) {
      if (!latest.current.marking || event.button !== 0 || !event.isPrimary) return;
      if ((event.target as Element).closest?.(".edit-layer")) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }
    function move(event: PointerEvent) {
      if (!start || event.pointerId !== start.id) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < CLICK_SLOP) { setDraft(null); return; }
      const rect = host.getBoundingClientRect();
      const a = { x: (start.x - rect.left) / rect.width, y: (start.y - rect.top) / rect.height }, b = fraction(event);
      setDraft(areaBetween(a.x, a.y, b.x, b.y) ?? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    }
    function up(event: PointerEvent) {
      if (!start || event.pointerId !== start.id) return;
      const origin = start;
      start = null;
      setDraft(null);
      const rect = host.getBoundingClientRect();
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= CLICK_SLOP) {
        const area = areaBetween((origin.x - rect.left) / rect.width, (origin.y - rect.top) / rect.height,
          (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
        if (area) latest.current.onArea(area); else latest.current.onMiss();
        return;
      }
      // A click inside a zone opens its field, as a click on its fill does in the reference.
      const at = fraction(event);
      const zone = [...latest.current.marks].reverse().find((mark) => mark.kind === "area"
        && at.x >= mark.area.x && at.x <= mark.area.x + mark.area.w && at.y >= mark.area.y && at.y <= mark.area.y + mark.area.h);
      if (zone) { want.current = { id: zone.id, target: "field", at: Date.now() }; latest.current.onOpen(zone.id); return; }
      latest.current.onPoint(event.clientX, event.clientY);
    }
    function cancel() { start = null; setDraft(null); }
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", cancel);
    return () => {
      host.removeEventListener("pointerdown", down); host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up); host.removeEventListener("pointercancel", cancel);
    };
  }, [host]);
  useEffect(() => { if (!marking) setDraft(null); }, [marking]);
  useEffect(() => {
    host.toggleAttribute("data-marking", marking);
    return () => host.removeAttribute("data-marking");
  }, [host, marking]);

  // Focus requests: a new mark opens its field; closing a field gives the focus back to its mark.
  useEffect(() => { if (focus) want.current = focus; }, [focus]);
  useEffect(() => {
    const request = want.current;
    if (!request || !marks.some((mark) => mark.id === request.id)) return;
    if (request.target === "field" && open !== request.id) return;
    want.current = null;
    const selector = request.target === "field" ? ".edit-field textarea" : '[data-edit-mark="' + request.id + '"]';
    requestAnimationFrame(() => layer.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));
  });

  const number = (id: number) => marks.findIndex((mark) => mark.id === id) + 1;
  const zoneBox = (area: Area) => ({ left: area.x * size.w, top: area.y * size.h, width: area.w * size.w, height: area.h * size.h });
  function anchorOf(mark: EditMark): Spot {
    if (mark.kind === "point") return spots[mark.id] ?? null;
    const box = zoneBox(mark.area);
    return { x: box.left, y: box.top };
  }
  function openField(id: number) {
    if (open === id) { onOpen(null); return; }
    want.current = { id, target: "field", at: Date.now() };
    onOpen(id);
  }
  function remove(id: number) {
    const at = marks.findIndex((mark) => mark.id === id);
    const rest = marks.filter((mark) => mark.id !== id);
    const next = rest[Math.min(at, rest.length - 1)];
    if (next) want.current = { id: next.id, target: "mark", at: Date.now() };
    onRemove(id);
  }
  function closeField(id: number) {
    want.current = { id, target: "mark", at: Date.now() };
    onOpen(null);
  }
  function markKeys(event: KeyboardEvent<HTMLButtonElement>, mark: EditMark) {
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(mark.id); return; }
    if (event.key === "Escape" && open !== null) { event.preventDefault(); event.stopPropagation(); onOpen(null); return; }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = arrows[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const [dx, dy] = direction;
    if (mark.kind === "area") { onMove(nudgeArea(mark, dx * EDIT_MARK_STEP, dy * EDIT_MARK_STEP, event.shiftKey)); return; }
    const spot = spots[mark.id];
    if (!spot) return;
    const rect = host.getBoundingClientRect();
    want.current = { id: mark.id, target: "mark", at: Date.now() };
    onMove(mark, { x: rect.left + spot.x + dx * EDIT_MARK_STEP * rect.width, y: rect.top + spot.y + dy * EDIT_MARK_STEP * rect.height });
  }

  const current = open !== null ? marks.find((mark) => mark.id === open) : undefined;
  const anchor = current ? anchorOf(current) : null;
  let field: { left: number; top: number; width: number } | null = null;
  if (current && anchor && size.w) {
    const width = Math.min(FIELD_WIDTH, size.w - EDGE * 2);
    // The mark itself is never covered: its dot, and for a zone the whole zone.
    const own: Box = current.kind === "point"
      ? { left: anchor.x - DOT - POINT_GAP, top: anchor.y - DOT - POINT_GAP, right: anchor.x + DOT + POINT_GAP, bottom: anchor.y + DOT + POINT_GAP }
      : { left: anchor.x - DOT, top: anchor.y - DOT, right: anchor.x + current.area.w * size.w, bottom: anchor.y + current.area.h * size.h };
    const avoid = [...obstacles(host), own];
    let candidates: { left: number; top: number }[];
    if (current.kind === "point") {
      const middle = anchor.y - FIELD_HEIGHT / 2, below = anchor.y + DOT + POINT_GAP + 4, above = anchor.y - DOT - POINT_GAP - 4 - FIELD_HEIGHT;
      candidates = [
        { left: anchor.x - DOT - POINT_GAP - width, top: middle }, { left: anchor.x + DOT + POINT_GAP, top: middle },
        { left: anchor.x - width + DOT, top: below }, { left: anchor.x - width + DOT, top: above },
        { left: anchor.x - DOT, top: below }, { left: anchor.x - DOT, top: above },
      ];
    } else {
      const w = current.area.w * size.w, h = current.area.h * size.h;
      const over = anchor.y - ZONE_GAP - FIELD_HEIGHT, under = anchor.y + h + ZONE_GAP;
      candidates = [
        { left: anchor.x, top: over }, { left: anchor.x, top: under },
        { left: anchor.x + w - width, top: over }, { left: anchor.x + w - width, top: under },
        { left: anchor.x - width - ZONE_GAP, top: anchor.y }, { left: anchor.x + w + ZONE_GAP, top: anchor.y },
      ];
    }
    field = { width, ...placeField(candidates, width, size, avoid) };
  }

  return createPortal(
    <div ref={layer} className="edit-layer" data-marking={marking || undefined}>
      <svg className="edit-areas" aria-hidden="true" width={size.w} height={size.h}>
        {marks.map((mark) => mark.kind === "area" && <g key={mark.id}><rect {...rectOf(zoneBox(mark.area))} rx={3} data-under="" /><rect {...rectOf(zoneBox(mark.area))} rx={3} /></g>)}
        {draft && <g><rect {...rectOf(zoneBox(draft))} rx={3} data-under="" /><rect {...rectOf(zoneBox(draft))} rx={3} data-draft="" /></g>}
      </svg>
      {marks.map((mark) => mark.kind === "area" && <div key={"zone" + mark.id} className="edit-zone" aria-hidden="true" style={zoneBox(mark.area)} />)}
      {draft && <div className="edit-zone" data-draft="" aria-hidden="true" style={zoneBox(draft)} />}
      {marks.map((mark) => {
        const spot = anchorOf(mark);
        const text = mark.text.trim();
        return <button key={mark.id} type="button" className="edit-dot" data-edit-mark={mark.id} data-kind={mark.kind} data-open={open === mark.id || undefined}
          hidden={!spot} style={spot ? { left: spot.x, top: spot.y } : undefined} aria-expanded={open === mark.id}
          aria-label={"Marca " + number(mark.id) + ", " + describeEditMark(mark) + ": " + (text || "sin descripción")}
          aria-describedby="edit-mark-keys" title="Añade un comentario describiendo el cambio"
          onClick={() => openField(mark.id)} onKeyDown={(event) => markKeys(event, mark)}>{number(mark.id)}</button>;
      })}
      <p id="edit-mark-keys" className="visually-hidden">Intro abre su campo. Supr la quita. Las flechas la mueven; con Mayús cambian el tamaño de una zona.</p>
      {current && field && <div className="edit-field" role="group" aria-label={"Cambio de la marca " + number(current.id)} style={field}>
        <textarea rows={1} wrap="off" maxLength={EDIT_MARK_TEXT_LIMIT} placeholder="Describe el cambio aquí" aria-label={"Describe el cambio de la marca " + number(current.id)}
          value={current.text} onChange={(event) => onText(current.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) { event.preventDefault(); event.stopPropagation(); closeField(current.id); }
          }} />
        <button type="button" className="edit-field-icon" aria-label="Añadir imagen de referencia" aria-disabled="true" title="Pendiente: imagen de referencia">
          <ImagePlus size={16} strokeWidth={2} aria-hidden="true" /></button>
        <button type="button" className="edit-field-icon" aria-label={"Eliminar la marca " + number(current.id)} title="Eliminar" onClick={() => remove(current.id)}>
          <Trash size={16} strokeWidth={2} aria-hidden="true" /></button>
        <button type="button" className="edit-field-send" aria-label="Enviar edición" aria-disabled={sendReason ? true : undefined} aria-describedby={sendOff.describedBy} aria-busy={sending || undefined}
          title={sendReason ? "Enviar edición\n" + sendReason : sendTitle} onClick={() => { if (!sendReason) onSend(); }}>
          {sending ? <Spinner size={16} /> : <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />}</button>
        {sendOff.note}
      </div>}
    </div>,
    host,
  );
}

function rectOf(box: { left: number; top: number; width: number; height: number }) {
  return { x: box.left + 1, y: box.top + 1, width: Math.max(0, box.width - 2), height: Math.max(0, box.height - 2) };
}
