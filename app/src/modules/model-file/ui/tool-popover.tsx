"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";

/** Space kept between a floating panel and the edges of the window, and under the header. */
const COLLISION = 12;
const GAP = 10;
const HEADER_ROOM = 64;
const EXIT_MS = 150;

/**
 * Viewport rectangle of an anchor while `active`, kept up to date when the window, the stage or
 * the bar change size (folding the explorer moves every button of the bar).
 */
export function useAnchorRect(anchor: RefObject<HTMLElement | null>, active: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const node = anchor.current;
    if (!active || !node) { setRect(null); return; }
    let frame = 0;
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setRect(node.getBoundingClientRect())); };
    setRect(node.getBoundingClientRect());
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const stage = node.closest(".stage"), bar = node.closest("[role=toolbar]");
    if (stage) observer.observe(stage);
    if (bar) observer.observe(bar);
    window.addEventListener("resize", measure);
    // The bar enters with a short spring: measure again once it has settled.
    const settle = setTimeout(measure, 260);
    return () => { cancelAnimationFrame(frame); clearTimeout(settle); observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [anchor, active]);
  return rect;
}

/**
 * Room kept on the right: the version rail's column while it is on screen (its width plus 24 px), so
 * a panel near the end of the bar shifts left instead of covering the rail; otherwise the usual 12 px.
 */
function rightRoom(): number {
  const rail = document.querySelector<HTMLElement>(".version-rail");
  return rail && rail.getClientRects().length ? rail.offsetWidth + 24 : COLLISION;
}

/** Fixed position of a panel that opens upwards from its anchor, aligned with the anchor's start. */
export function placeAbove(rect: DOMRect | null, width: number): CSSProperties | undefined {
  if (!rect || typeof window === "undefined") return undefined;
  const room = Math.max(160, Math.min(window.innerHeight - 100, rect.top - GAP - HEADER_ROOM));
  const fitted = Math.min(width, window.innerWidth - COLLISION * 2);
  return {
    left: Math.round(Math.max(COLLISION, Math.min(rect.left, window.innerWidth - fitted - rightRoom()))),
    bottom: Math.round(window.innerHeight - rect.top + GAP),
    width: fitted,
    maxHeight: Math.round(room),
  };
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Tool panel anchored above its button in the bottom bar. It is a non-modal dialog: the focus
 * moves into it when it opens; Escape, a click outside or a second click on the button close it,
 * and Escape or the close button give the focus back to the button. With `keepMounted` the
 * content survives closing, so a half-written request is still there when it opens again.
 */
export function ToolPopover({ open, anchor, label, title, closeLabel, width, onClose, children, actions, keepMounted, className, id, bare }: {
  open: boolean; anchor: RefObject<HTMLButtonElement | null>; label: string; title: string; closeLabel: string; width: number;
  onClose: () => void; children: ReactNode; actions?: ReactNode; keepMounted?: boolean; className?: string; id?: string;
  /** No header, as the reference's render panel: it closes with Escape, a click outside or its button. */
  bare?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"open" | "closing" | "closed">(open ? "open" : "closed");
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (open) setPhase("open");
    else setPhase((current) => (current === "open" ? (prefersReducedMotion() ? "closed" : "closing") : current));
  }, [open]);
  useEffect(() => {
    if (phase !== "closing") return;
    const timer = setTimeout(() => setPhase("closed"), EXIT_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  const rect = useAnchorRect(anchor, phase !== "closed");
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A modal dialog opened from inside the panel handles its own Escape.
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      anchor.current?.focus();
      close.current();
    }
    function down(event: PointerEvent) {
      const target = event.target as Node;
      if (box.current?.contains(target) || anchor.current?.contains(target)) return;
      if ((target as Element).closest?.("[data-visual-tour], dialog[open]")) return;
      close.current();
    }
    window.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); };
  }, [open, anchor]);
  const shown = phase !== "closed";
  return (
    <div ref={box} id={id} role="dialog" aria-label={label} tabIndex={-1} hidden={!shown} data-state={phase}
      className={"tool-popover" + (className ? " " + className : "")} style={placeAbove(rect, width)}>
      {!bare && <div className="tool-popover-head">
        <h2 className="tool-popover-title">{title}</h2>
        {actions}
        <button type="button" className="tool-popover-close" aria-label={closeLabel}
          title="Cerrar · Esc" onClick={() => { anchor.current?.focus(); onClose(); }}>
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>}
      {(shown || keepMounted) && children}
    </div>
  );
}
