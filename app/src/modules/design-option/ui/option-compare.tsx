"use client";
import { useId, useRef, type KeyboardEvent } from "react";
import { Star } from "lucide-react";
import { CompareSlider } from "./compare-slider";
import { LoadingStatus, Skeleton } from "@/shared/ui/loading";
import { usePrivateImage } from "./use-option-history";
import type { OptionBatch } from "../domain/option-history";
import { optionImagePath } from "../infrastructure/option-http";

/** Which option of the batch the panel shows: "Opción 1 · 2 · 3", the chosen one with a star. */
export function OptionSwitch({ batch, slot, onSlot, compact }: { batch: OptionBatch; slot: number; onSlot: (slot: number) => void;
  /** 28 px chips with the legend kept for screen readers only (the Descargar panel). */
  compact?: boolean }) {
  const id = useId();
  const group = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const slots = batch.options.map((option) => option.slot);
    const next = slots[(slots.indexOf(slot) + steps[event.key] + slots.length) % slots.length];
    onSlot(next);
    requestAnimationFrame(() => group.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus());
  }
  return <div className="option-switch" data-compact={compact || undefined}>
    <span id={id} className={compact ? "visually-hidden" : "chip-legend"}>Opción</span>
    <div ref={group} role="radiogroup" aria-labelledby={id} className="chips" data-columns={batch.options.length} onKeyDown={onKeyDown}>
      {batch.options.map((option) => <button key={option.slot} type="button" role="radio" className="chip" aria-checked={option.slot === slot}
        tabIndex={option.slot === slot ? 0 : -1} title={batch.selected === option.slot ? "La opción elegida" : undefined} onClick={() => onSlot(option.slot)}>
        {batch.selected === option.slot && <Star size={12} strokeWidth={2} fill="currentColor" aria-label="elegida" />}Opción {option.slot}
      </button>)}
    </div>
  </div>;
}

/** Content of the Comparar panel: the model view against one option, with the divider. */
export function OptionCompare({ base, batch, slot, onSlot }: { base: string; batch: OptionBatch; slot: number; onSlot: (slot: number) => void }) {
  const before = usePrivateImage(optionImagePath(base, batch.id, 0));
  const after = usePrivateImage(optionImagePath(base, batch.id, slot));
  return <div className="tool-popover-body option-compare">
    <OptionSwitch batch={batch} slot={slot} onSlot={onSlot} />
    {before.error || after.error ? <p role="alert" className="options-alert">No se pudo cargar la comparación.</p>
      : !before.url || !after.url ? <div className="compare-wait"><Skeleton className="compare-skeleton" /><LoadingStatus>Preparando la comparación…</LoadingStatus></div>
      : <CompareSlider before={before.url} after={after.url} beforeLabel="Vista del modelo" afterLabel={"Opción " + slot + " · Generado con IA"}
        label={"Comparar la opción " + slot + " con la vista del modelo"} />}
  </div>;
}
