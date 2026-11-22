"use client";
import { useEffect, useRef } from "react";
import { MAX_PROJECT_NAME } from "../domain/owned-project";

/**
 * In-place name field: Enter or leaving the field saves, Escape cancels. An empty or unchanged
 * value counts as a cancel. It reports once, whichever event comes first.
 */
export function InlineName({ initial, className, onSave, onCancel }: {
  initial: string; className: string; onSave(name: string): void; onCancel(): void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    const value = field.current?.value.trim() ?? "";
    if (save && value && value !== initial.trim()) onSave(value); else onCancel();
  }
  return <input ref={field} className={className} defaultValue={initial} maxLength={MAX_PROJECT_NAME}
    aria-label="Nombre del proyecto" title="Intro guarda · Esc cancela" spellCheck={false} autoComplete="off"
    onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    }}
    onBlur={() => finish(true)}/>;
}
