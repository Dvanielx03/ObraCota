"use client";
import { useId, useRef, type KeyboardEvent } from "react";

type Item = { id: string; label: string };

/**
 * One choice out of a few, or none: pressing the chosen chip again clears it.
 * Arrow keys move the focus inside the group; Space or Enter chooses.
 */
export function ChipChoice<T extends string>({ legend, items, value, onChange, disabled }: {
  legend: string; items: readonly Item[]; value: T | null; onChange: (value: T | null) => void; disabled?: boolean;
}) {
  const id = useId();
  const group = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const chips = [...(group.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? [])];
    const at = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let target = at;
    if (event.key in step) target = (at + step[event.key] + chips.length) % chips.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = chips.length - 1;
    else return;
    event.preventDefault();
    chips[target].focus();
  }
  const tabStop = value ?? items[0].id;
  return (
    <div className="chip-group">
      <span id={id} className="chip-legend">{legend}</span>
      <div ref={group} role="radiogroup" aria-labelledby={id} className="chips" onKeyDown={onKeyDown}>
        {items.map((item) => (
          <button key={item.id} type="button" role="radio" className="chip" aria-checked={value === item.id} tabIndex={item.id === tabStop ? 0 : -1}
            disabled={disabled} onClick={() => onChange(value === item.id ? null : (item.id as T))}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Independent switches, each on or off. */
export function ChipToggles<T extends string>({ legend, items, value, onChange, disabled }: {
  legend: string; items: readonly Item[]; value: readonly T[]; onChange: (value: T[]) => void; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="chip-group">
      <span id={id} className="chip-legend">{legend}</span>
      <div role="group" aria-labelledby={id} className="chips">
        {items.map((item) => {
          const on = value.includes(item.id as T);
          return (
            <button key={item.id} type="button" className="chip" aria-pressed={on} disabled={disabled}
              onClick={() => onChange(on ? value.filter((v) => v !== item.id) : [...value, item.id as T])}>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
