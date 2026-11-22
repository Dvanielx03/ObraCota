"use client";
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

export interface MenuItem { label: string; icon: ReactNode; run(): void }

/**
 * Context menu of a project card (160 px, radius 12). Unlike the reference it closes with Escape
 * and gives the focus back to its button; it also closes on Tab, on a click outside or on scroll.
 */
export function CardMenu({ id, label, items, trigger, onClose, focusFirst = true }: {
  id: string; label: string; items: readonly MenuItem[];
  /** Opened with the keyboard: the first option takes the focus. Otherwise the menu itself does, with nothing highlighted. */
  focusFirst?: boolean;
  trigger: RefObject<HTMLButtonElement | null>;
  /** `restore` is true when the focus must go back to the trigger. */
  onClose(restore: boolean): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const first = focusFirst ? menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]") : null;
    (first ?? menu.current)?.focus({ preventScroll: true });
    // Scroll positions when the menu opened: a real scroll closes it, a late scroll event from
    // bringing the card into view (0–2 px) does not.
    const start = new Map<EventTarget, number>();
    const position = (target: EventTarget) => target instanceof Element ? target.scrollTop + target.scrollLeft : window.scrollY + window.scrollX;
    for (let node = trigger.current?.parentElement; node; node = node.parentElement) start.set(node, position(node));
    start.set(document, position(document));
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      close.current(false);
    }
    function scrolled(event: Event) {
      const target = event.target ?? document;
      if (menu.current && target instanceof Node && menu.current.contains(target)) return;
      if (Math.abs(position(target) - (start.get(target) ?? 0)) > 2) close.current(false);
    }
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scrolled, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const options = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    const move: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
    if (event.key === "Tab") { onClose(false); return; }
    let next = -1;
    if (event.key in move) next = at < 0 ? (move[event.key] > 0 ? 0 : options.length - 1) : (at + move[event.key] + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    options[next].focus();
  }
  return <div ref={menu} id={id} role="menu" aria-label={label} className="card-menu" tabIndex={-1} onKeyDown={onKeyDown}>
    {items.map(item => <button key={item.label} type="button" role="menuitem" tabIndex={-1} onClick={item.run}>
      {item.icon}{item.label}</button>)}
  </div>;
}
