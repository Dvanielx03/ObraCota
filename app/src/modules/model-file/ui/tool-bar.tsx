"use client";
import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ComponentType, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { shortcutTitle } from "../domain/shortcuts";
import { Spinner } from "@/shared/ui/loading";
import { useDisabledReason } from "@/shared/ui/disabled-reason";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean | "true" }>;

/**
 * Floating bar with one tab stop: Tab enters on the last focused item, the arrow keys, Home and
 * End move between items (ARIA toolbar pattern). Items are the descendants marked `data-tool`,
 * so a dialog rendered inside an item keeps its own keyboard.
 */
export function RovingToolbar({ label, className, children, hidden }: { label: string; className: string; children: ReactNode; hidden?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>("[data-tool]") ?? [])].filter((item) => item.getClientRects().length > 0);
  function settle(at: number) {
    const list = items();
    if (!list.length) return;
    current.current = Math.max(0, Math.min(at, list.length - 1));
    list.forEach((item, index) => { item.tabIndex = index === current.current ? 0 : -1; });
  }
  // Runs after every render: buttons that appear or disappear keep a single tab stop.
  useLayoutEffect(() => settle(current.current));
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const at = list.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: list.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key] + list.length) % list.length;
    settle(next);
    list[next].focus();
  }
  return (
    <div ref={root} role="toolbar" aria-label={label} aria-orientation="horizontal" className={className} hidden={hidden}
      onKeyDown={onKeyDown} onFocus={(event) => { const at = items().indexOf(event.target as HTMLElement); if (at >= 0) settle(at); }}>
      {children}
    </div>
  );
}

type ToolButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  icon: Icon; ref?: Ref<HTMLButtonElement>;
  /** When set, the button is shown at 40 % and explains why it cannot be used yet. */
  disabledReason?: string;
  /** Unsent work inside this tool: a 6 px dot on the icon. */
  pending?: boolean;
  /** Keyboard shortcut (DU-12, DU-16): shown in the tooltip ("Renderizar · R") and in aria-keyshortcuts. */
  shortcut?: string;
};

/** Tooltip: the reason alone without a shortcut (as before); with one, "Name · Key" and the reason below. */
function toolTitle(name: string, shortcut: string | undefined, reason: string | undefined, title: string | undefined) {
  return shortcut ? shortcutTitle(name, shortcut, reason) : reason ?? title;
}

/** Uppercase mode button of the bottom bar: icon of 16 and an 11 px label. */
export function ModeButton({ icon: Glyph, label, disabledReason, pending, shortcut, busy, className, onClick, title, ...rest }: ToolButtonProps & {
  label: string;
  /** Work of this tool in progress (a batch of options being generated): its icon turns, as in the reference. */
  busy?: boolean;
}) {
  const reason = useDisabledReason(disabledReason, rest["aria-describedby"]);
  return (<>
    <button type="button" data-tool="" {...rest} className={"tool-mode" + (className ? " " + className : "")}
      aria-disabled={disabledReason ? true : undefined} aria-describedby={reason.describedBy} aria-keyshortcuts={shortcut} data-busy={busy || undefined}
      title={toolTitle(title ?? label, shortcut, disabledReason, title)}
      onClick={(event) => { if (disabledReason) { event.preventDefault(); return; } onClick?.(event); }}>
      <span className="tool-glyph">{busy ? <Spinner size={16} /> : <Glyph size={16} strokeWidth={2} aria-hidden="true" />}{pending && <i className="tool-pending" aria-hidden="true" />}</span>
      {label}
    </button>
    {reason.note}
  </>);
}

/** Square 34 × 34 icon button; its name comes from `aria-label`, repeated as a native tooltip. */
export function IconTool({ icon: Glyph, disabledReason, pending, shortcut, className, onClick, title, ...rest }: ToolButtonProps & { "aria-label": string }) {
  const reason = useDisabledReason(disabledReason, rest["aria-describedby"]);
  return (<>
    <button type="button" data-tool="" {...rest} className={"tool-icon" + (className ? " " + className : "")}
      aria-disabled={disabledReason ? true : undefined} aria-describedby={reason.describedBy} aria-keyshortcuts={shortcut}
      title={toolTitle(title ?? rest["aria-label"], shortcut, disabledReason, title ?? rest["aria-label"])}
      onClick={(event) => { if (disabledReason) { event.preventDefault(); return; } onClick?.(event); }}>
      <span className="tool-glyph"><Glyph size={16} strokeWidth={2} aria-hidden="true" />{pending && <i className="tool-pending" aria-hidden="true" />}</span>
    </button>
    {reason.note}
  </>);
}

export function ToolSeparator() {
  return <span className="tool-separator" aria-hidden="true" />;
}
