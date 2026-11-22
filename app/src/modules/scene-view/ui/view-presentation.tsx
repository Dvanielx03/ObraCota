"use client";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { viewNumber, type SceneView } from "../domain/scene-view";
import { clampSlide, counterLabel, coverFacts, dotSize, slideCount } from "../domain/presentation";

/** What the cover says. */
export interface Deck { title?: string; file: string; version?: string; date?: string }

/** Controls fade out after this long without moving the pointer or pressing a key (as in the reference). */
const IDLE_MS = 2500;

/**
 * Full-screen presentation of the saved views (V-08) over #0A0A0B. Slide 0 is a cover (project and file
 * over the first view, under a veil); then one slide per view, where the 3D canvas shows that view.
 * Next: → ↓ Av Pág, space or a click on the cover. Previous: ← ↑ Re Pág. Inicio and Fin jump to the ends.
 * Escape or the round button leave. Dots, counter and caption fade after 2.5 s without activity; the
 * exit button stays. Focus starts on the dialog and Tab stays inside it.
 */
export function ViewPresentation({ views, deck, start, apply, onExit }: {
  views: readonly SceneView[];
  deck: Deck;
  start: number;
  /** Moves the camera to a view, with a short transition when `animate`. */
  apply: (view: SceneView, animate: boolean) => void;
  onExit: () => void;
}) {
  const total = slideCount(views.length);
  const [{ index, direction }, setPlace] = useState({ index: clampSlide(start, total), direction: 1 });
  const [idle, setIdle] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const exit = useRef(onExit);
  exit.current = onExit;
  const go = useCallback((to: (current: number) => number) => {
    setPlace((place) => {
      const next = clampSlide(to(place.index), total);
      return next === place.index ? place : { index: next, direction: next > place.index ? 1 : -1 };
    });
  }, [total]);

  // Camera of the slide: the cover shows the first view under its veil.
  const shown = views[Math.max(0, index - 1)];
  const firstMove = useRef(true);
  useEffect(() => {
    if (!shown) return;
    apply(shown, !firstMove.current);
    firstMove.current = false;
  }, [index, shown, apply]);
  // Entering full screen (or the fixed stage) resizes the canvas: frame the slide again, without moving.
  const latest = useRef(shown);
  latest.current = shown;
  useLayoutEffect(() => {
    const stage = box.current?.closest<HTMLElement>(".stage");
    if (!stage) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (latest.current) apply(latest.current, false); });
    });
    observer.observe(stage);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [apply]);

  // Controls hide after a while without activity and come back with the pointer or a key.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => { clearTimeout(timer.current); window.removeEventListener("pointermove", wake); window.removeEventListener("pointerdown", wake); };
  }, [wake]);

  // The keyboard belongs to the presentation: the canvas would otherwise pan with the arrows.
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
    function key(event: KeyboardEvent) {
      wake();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const onButton = !!(event.target as Element | null)?.closest?.("button");
      const moves: Record<string, (current: number) => number> = {
        ArrowDown: (i) => i + 1, ArrowRight: (i) => i + 1, PageDown: (i) => i + 1,
        ArrowUp: (i) => i - 1, ArrowLeft: (i) => i - 1, PageUp: (i) => i - 1,
        Home: () => 0, End: () => Number.MAX_SAFE_INTEGER,
      };
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); exit.current(); return; }
      if (event.key in moves) { event.preventDefault(); event.stopPropagation(); go(moves[event.key]); return; }
      if (event.key === " " && !onButton) { event.preventDefault(); event.stopPropagation(); go((i) => i + (event.shiftKey ? -1 : 1)); return; }
      if (event.key === "Tab") {
        const list = [...(box.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
        if (!list.length) return;
        const at = list.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); event.stopPropagation();
        const next = at < 0 ? (event.shiftKey ? list.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + list.length) % list.length;
        list[next].focus();
      }
    }
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [go, wake]);

  const cover = index === 0;
  const size = dotSize(total);
  const facts = coverFacts({ version: deck.version, views: views.length, date: deck.date });
  const title = deck.title || deck.file;
  const where = cover ? "Portada: " + title : "Diapositiva " + (index + 1) + " de " + total + ": " + shown?.name;
  return <div ref={box} className="presentation" role="dialog" aria-modal="true" aria-label={"Presentación de " + title}
    aria-describedby="presentation-keys" tabIndex={-1} data-idle={idle || undefined} data-cover={cover || undefined}
    style={{ "--enter": direction, "--dot": size.dot + "px", "--dot-active": size.active + "px", "--dot-gap": size.gap + "px" } as CSSProperties}>
    <div className="presentation-curtain" aria-hidden="true"/>
    {cover
      ? <div className="presentation-cover" onClick={() => go((i) => i + 1)}>
          <div className="presentation-cover-text" key="cover">
            <p className="presentation-overline">{deck.file}</p>
            <h2 className="presentation-title">{title}</h2>
            <p className="presentation-facts">{facts.map((fact, i) => <Fragment key={fact}>{i > 0 && <i aria-hidden="true"/>}<span>{fact}</span></Fragment>)}</p>
          </div>
          <p className="presentation-hint" aria-hidden="true">Pulsa <kbd>↓</kbd> para avanzar</p>
        </div>
      : <div className="presentation-caption" key={shown?.id}>
          <h2>{shown?.name}</h2>
          <p>Vista {viewNumber(index - 1)} · {deck.file}{deck.version ? " · " + deck.version : ""}</p>
        </div>}
    <button type="button" className="presentation-exit" aria-label="Salir de la presentación (Esc)" title="Salir · Esc" onClick={() => exit.current()}>
      <X size={18} strokeWidth={2} aria-hidden="true"/>
    </button>
    <nav className="presentation-dots" aria-label="Diapositivas">
      {Array.from({ length: total }, (_, at) => <button key={at} type="button" aria-current={at === index ? "step" : undefined}
        aria-label={at === 0 ? "Portada" : "Vista " + viewNumber(at - 1) + ": " + views[at - 1].name}
        onClick={() => go(() => at)}><i/></button>)}
    </nav>
    {!cover && <p className="presentation-counter" aria-hidden="true">{counterLabel(index, total)}</p>}
    <p className="visually-hidden" role="status">{where}</p>
    <p id="presentation-keys" className="visually-hidden">Avanza con la flecha abajo, la derecha, Av Pág o la barra espaciadora; retrocede con la flecha arriba, la izquierda o Re Pág. Escape sale.</p>
  </div>;
}
