"use client";
import { useId, useRef, type ComponentType, type KeyboardEvent } from "react";

type Item = { id: string; label: string };
type Icon = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean | "true" }>;

function Glyph({ icon: Shape }: { icon?: Icon }) {
  return Shape ? <Shape size={16} strokeWidth={2} aria-hidden="true" /> : null;
}

/**
 * One choice out of a few, or none: pressing the chosen chip again clears it.
 * Arrow keys move the focus inside the group; Space or Enter chooses.
 * `columns` lays the chips on an even grid, the way the reference panels do.
 */
export function ChipChoice<T extends string>({ legend, items, value, onChange, disabled, columns, icons }: {
  legend: string; items: readonly Item[]; value: T | null; onChange: (value: T | null) => void; disabled?: boolean;
  columns?: number; icons?: Partial<Record<string, Icon>>;
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
      <div ref={group} role="radiogroup" aria-labelledby={id} className="chips" data-columns={columns} onKeyDown={onKeyDown}>
        {items.map((item) => (
          <button key={item.id} type="button" role="radio" className="chip" aria-checked={value === item.id} tabIndex={item.id === tabStop ? 0 : -1}
            disabled={disabled} onClick={() => onChange(value === item.id ? null : (item.id as T))}>
            <Glyph icon={icons?.[item.id]} />{item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Independent switches, each on or off. `inline` draws them as the small 28 px chips of the
 * reference's request box footer, with the legend on the same line.
 */
export function ChipToggles<T extends string>({ legend, items, value, onChange, disabled, columns, icons, inline }: {
  legend: string; items: readonly Item[]; value: readonly T[]; onChange: (value: T[]) => void; disabled?: boolean;
  columns?: number; icons?: Partial<Record<string, Icon>>; inline?: boolean;
}) {
  const id = useId();
  return (
    <div className="chip-group" data-variant={inline ? "inline" : undefined}>
      <span id={id} className="chip-legend">{legend}</span>
      <div role="group" aria-labelledby={id} className="chips" data-columns={columns}>
        {items.map((item) => {
          const on = value.includes(item.id as T);
          return (
            <button key={item.id} type="button" className="chip" aria-pressed={on} disabled={disabled}
              onClick={() => onChange(on ? value.filter((v) => v !== item.id) : [...value, item.id as T])}>
              <Glyph icon={icons?.[item.id]} />{item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
