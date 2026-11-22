"use client";
import { useEffect, useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { SHORTCUT_SHEET } from "../domain/shortcuts";

/**
 * Modal list of the workspace shortcuts, opened with "?" or from the guide (DU-12). Escape or the
 * close button shut it and give the focus back to whatever had it before.
 */
export function ShortcutSheet({ open, onClose, fallback }: {
  open: boolean; onClose: () => void;
  /** Takes the focus back when the element that had it is gone (opened from the guide, which closes). */
  fallback?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.showModal();
    } else if (!open && node.open) node.close();
  }, [open]);
  function closed() {
    onClose();
    const back = opener.current;
    opener.current = null;
    requestAnimationFrame(() => {
      if (back?.isConnected) back.focus();
      if (!back || document.activeElement !== back) fallback?.current?.focus();
    });
  }
  return <dialog ref={dialog} className="shortcut-sheet" aria-labelledby="shortcut-title" aria-describedby="shortcut-note" onClose={closed}>
    <div className="shortcut-head">
      <h2 id="shortcut-title">Atajos de teclado</h2>
      <button type="button" className="shortcut-close" aria-label="Cerrar atajos" title="Cerrar · Esc" onClick={() => dialog.current?.close()}>
        <X size={16} strokeWidth={2} aria-hidden="true"/>
      </button>
    </div>
    <p id="shortcut-note" className="shortcut-note">Funcionan cuando no estás escribiendo en un campo. Los botones muestran su tecla al pasar el puntero.</p>
    <div className="shortcut-groups">
      {SHORTCUT_SHEET.map((group, index) => <section key={group.title} aria-labelledby={"shortcut-group-" + index}>
        <h3 id={"shortcut-group-" + index}>{group.title}</h3>
        <dl>{group.rows.map((row) => <div key={row.label} className="shortcut-row">
          <dt>{row.label}</dt>
          <dd>{row.keys.map((key, at) => key === "…" ? <span key={at} aria-hidden="true">…</span> : <kbd key={at}>{key}</kbd>)}</dd>
        </div>)}</dl>
      </section>)}
    </div>
  </dialog>;
}
