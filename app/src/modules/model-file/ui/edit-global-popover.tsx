"use client";
import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  ArrowUp, Building2, BuildingComplex, Check, Cloud, CloudFog, CloudRain, CloudSun, Coins, Contrast, Flower2, Haze, Kayak, Leaf, Moon, MoonStar,
  Mountain, Parasol, Snowflake, Sprout, Sun, SunDim, SunMedium, Sunrise, Sunset, TreePalm, Trees, UserRound, UserRoundGroup, UsersRound, WavesHorizontal, Wind,
} from "lucide-react";
import {
  CROWDS, ENVIRONMENTS, GLOBAL_TOOLS, GRAPHIC_STYLES, PEOPLE_PROMPT_LIMIT, PEOPLE_STYLES, SEASONS, TIMES, WEATHERS, globalValue,
  type GlobalEdit, type GlobalTool,
} from "@/modules/design-option/domain/edit-globals";
import { placeAbove, useAnchorRect } from "./tool-popover";
import { StyleThumb } from "./edit-style-thumb";
import { useDisabledReason } from "@/shared/ui/disabled-reason";
import { Spinner } from "@/shared/ui/loading";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean | "true" }>;

/** Icons of the reference's table (03-herramientas.md §3.3). */
const ICONS: Record<string, Icon> = {
  morning: SunMedium, afternoon: SunDim, night: Moon, sunrise: Sunrise, noon: Sun, golden: Haze, sunset: Sunset, blue: MoonStar,
  clear: Sun, partly: CloudSun, overcast: Cloud, fog: CloudFog, rain: CloudRain, snow: Snowflake,
  spring: Sprout, summer: Sun, autumn: Leaf, winter: Snowflake,
  countryside: Trees, city: BuildingComplex, coast: Parasol, mountain: Mountain, forest: Trees, lake: Kayak, river: WavesHorizontal,
  desert: Mountain, tropical: TreePalm, residential: Building2, garden: Flower2,
  one: UserRound, couple: UsersRound, few: UsersRound, crowded: UserRoundGroup,
  natural: UserRound, motion: Wind, silhouette: Contrast,
};

const WIDTH: Record<GlobalTool, number> = { time: 384, atmosphere: 384, environment: 384, people: 352, style: 384 };

/**
 * Card of one global edit of the Editar sub-bar (03-herramientas.md §3.3): 10 px above the sub-bar
 * and aligned with its start, 384 px wide (352 for people), a title and a grid of one-value options
 * with the round «Aplicar cambios» button in the last cell, disabled until something is chosen.
 * What ObraCota adds: the cost of the request next to the title. It is a non-modal dialog: the focus
 * moves in when it opens; Escape or a click outside close it, and Escape gives the focus back to
 * the sub-bar button that opened it.
 */
export function EditGlobalPopover({ tool, anchor, opener, edit, cost, applyReason, busy, error, onChoose, onPrompt, onApply, onClose }: {
  tool: GlobalTool;
  /** The sub-bar: the card opens above it, aligned with its left edge. */
  anchor: RefObject<HTMLElement | null>;
  /** The sub-bar button that opened the card; it gets the focus back on Escape. */
  opener: () => HTMLElement | null;
  edit: GlobalEdit | null;
  /** «1,00 USD», once the budget is known. */
  cost?: string;
  /** Why «Aplicar cambios» cannot run yet. */
  applyReason?: string;
  busy: boolean;
  /** What went wrong with the last request. */
  error?: string;
  onChoose: (field: string, value: string) => void;
  onPrompt: (text: string) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const rect = useAnchorRect(anchor, true);
  const close = useRef(onClose), back = useRef(opener);
  close.current = onClose;
  back.current = opener;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const node = box.current;
      (node?.querySelector<HTMLElement>("[role=radio][aria-checked=true]") ?? node?.querySelector<HTMLElement>("[role=radio]"))?.focus({ preventScroll: true });
    });
    function key(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      back.current()?.focus();
      close.current();
    }
    function down(event: PointerEvent) {
      const target = event.target as Element;
      // The sub-bar buttons toggle their own card; a guide card keeps everything open.
      if (box.current?.contains(target) || target.closest?.(".edit-bar, [data-visual-tour], dialog[open]")) return;
      close.current();
    }
    window.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); };
  }, []);

  const info = GLOBAL_TOOLS.find((item) => item.id === tool)!;
  const style = placeAbove(rect, WIDTH[tool]);
  const apply = <ApplyButton reason={applyReason} busy={busy} cost={cost} onApply={onApply} />;
  const value = (field?: string) => globalValue(edit, tool, field);
  return (
    <div ref={box} id={"edit-" + tool} role="dialog" aria-labelledby={titleId} className="edit-popover" data-tool={tool}
      style={style ? { left: style.left, bottom: style.bottom, width: style.width } : { visibility: "hidden" }}>
      <div className="edit-popover-head">
        <h2 id={titleId} className="edit-popover-title">{info.title}</h2>
        {cost && <span className="edit-popover-cost" title="Reserva de cada edición en el presupuesto mensual de IA"><Coins size={12} strokeWidth={2} aria-hidden="true" />{cost}</span>}
      </div>
      {tool === "time" && <RadioGrid label={info.title} options={TIMES} value={value()} onChoose={(id) => onChoose("time", id)} after={apply} />}
      {tool === "environment" && <RadioGrid label={info.title} options={ENVIRONMENTS} value={value()} onChoose={(id) => onChoose("environment", id)} after={apply} />}
      {tool === "atmosphere" && <>
        <Section title="Clima"><RadioGrid label="Clima" options={WEATHERS} value={value("weather")} onChoose={(id) => onChoose("weather", id)} /></Section>
        <Section title="Estación"><RadioGrid label="Estación" options={SEASONS} value={value("season")} onChoose={(id) => onChoose("season", id)} after={apply} /></Section>
      </>}
      {tool === "people" && <People edit={edit} onChoose={onChoose} onPrompt={onPrompt} apply={apply} />}
      {tool === "style" && <RadioGrid label={info.title} options={GRAPHIC_STYLES} value={value()} onChoose={(id) => onChoose("style", id)} after={apply} columns={4} variant="style"
        render={(option, checked) => <>
          <span className="edit-style-thumb"><StyleThumb slug={(option as (typeof GRAPHIC_STYLES)[number]).slug} />{checked && <i className="edit-style-check"><Check size={12} strokeWidth={3} aria-hidden="true" /></i>}</span>
          <span className="edit-style-label">{option.label}</span>
        </>} />}
      {/* Blocking reasons only once something is chosen: before that the card reads as in the reference. */}
      {(error || (edit?.tool === tool && applyReason && applyReason !== "Elige una opción primero")) &&
        <p className="edit-popover-note" role={error ? "alert" : "status"}>{!error && busy && <Spinner size={12} className="spinner-inline" />}{error || applyReason}</p>}
    </div>
  );
}

/** A soft hyphen inside long words («PARCIAL-MENTE»): at 10 px uppercase they do not fit the 115 px option. */
const breakable = (label: string) => label.replace(/\p{L}{11,}/gu, (word) => word.slice(0, 7) + "\u00AD" + word.slice(7));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="edit-section"><h3 className="edit-section-title">{title}</h3>{children}</section>;
}

function ApplyButton({ reason, busy, cost, onApply }: { reason?: string; busy: boolean; cost?: string; onApply: () => void }) {
  const title = reason ? "Aplicar cambios\n" + reason : "Aplicar cambios" + (cost ? " · reserva " + cost : "");
  const off = useDisabledReason(reason);
  return (
    <div className="edit-apply-cell">
      <button type="button" className="edit-apply" aria-label="Aplicar cambios" aria-disabled={reason || busy ? true : undefined} aria-busy={busy || undefined}
        aria-describedby={off.describedBy} title={title} onClick={() => { if (!reason && !busy) onApply(); }}>
        {busy ? <Spinner size={16} /> : <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />}
      </button>
      {off.note}
    </div>
  );
}

/**
 * One-value options as `role=radio` buttons in a grid, with a single tab stop (the chosen option,
 * or the first). Arrows move the focus (up and down by a row), Home and End go to the ends;
 * Space or Enter choose.
 */
function RadioGrid<T extends { id: string; label: string }>({ label, options, value, onChoose, after, columns = 3, variant, render }: {
  label: string; options: readonly T[]; value: string | null; onChoose: (id: string) => void; after?: ReactNode;
  columns?: number; variant?: "style" | "count" | "chip"; render?: (option: T, checked: boolean) => ReactNode;
}) {
  const group = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState<string | null>(null);
  const tabStop = stop && options.some((option) => option.id === stop) ? stop : value ?? options[0]?.id;
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const radios = [...(group.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? [])];
    const at = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: columns, ArrowLeft: -1, ArrowUp: -columns };
    let next = at;
    if (event.key in step) next = Math.max(0, Math.min(radios.length - 1, at + step[event.key]));
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = radios.length - 1;
    else return;
    event.preventDefault();
    radios[next].focus();
    setStop(options[next]?.id ?? null);
  }
  return (
    <div className="edit-grid" data-variant={variant} style={{ gridTemplateColumns: "repeat(" + columns + ",minmax(0,1fr))" }}>
      <div ref={group} role="radiogroup" aria-label={label} className="edit-radios" onKeyDown={onKeyDown}>
        {options.map((option) => {
          const checked = value === option.id;
          const Glyph = ICONS[option.id];
          return (
            <button key={option.id} type="button" role="radio" className="edit-option" data-variant={variant} aria-checked={checked} aria-label={option.label}
              tabIndex={option.id === tabStop ? 0 : -1} onFocus={() => setStop(option.id)} onClick={() => onChoose(option.id)}>
              {render ? render(option, checked) : <>{Glyph && <Glyph size={16} strokeWidth={2} aria-hidden="true" />}<span>{breakable(option.label)}</span></>}
            </button>
          );
        })}
      </div>
      {after}
    </div>
  );
}

/** Añadir personas: quantity first; the style and the own indications appear once a quantity is chosen. */
function People({ edit, onChoose, onPrompt, apply }: { edit: GlobalEdit | null; onChoose: (field: string, value: string) => void; onPrompt: (text: string) => void; apply: ReactNode }) {
  const people = edit?.tool === "people" ? edit : null;
  const promptId = useId();
  return <>
    <RadioGrid label="Cantidad de personas" options={CROWDS} value={people?.crowd ?? null} onChoose={(id) => onChoose("crowd", id)} columns={4} variant="count"
      render={(option, checked) => { const Glyph = ICONS[option.id]; return <>
        <span className="edit-count-circle" data-checked={checked || undefined}><Glyph size={16} strokeWidth={2} aria-hidden="true" /></span>
        <span className="edit-count-label">{option.label}</span></>; }} />
    {people && <>
      <Section title="Estilo de las personas">
        <RadioGrid label="Estilo de las personas" options={PEOPLE_STYLES} value={people.style} onChoose={(id) => onChoose("style", id)} variant="chip"
          render={(option) => { const Glyph = ICONS[option.id]; return <><Glyph size={16} strokeWidth={2} aria-hidden="true" /><span>{option.label}</span></>; }} />
      </Section>
      <Section title="Indicaciones personalizadas">
        <div className="edit-prompt-row">
          <textarea id={promptId} aria-label="Indicaciones personalizadas para las personas" maxLength={PEOPLE_PROMPT_LIMIT} rows={1} value={people.prompt}
            placeholder="p. ej., una familia entrando por el acceso…" onChange={(event) => onPrompt(event.target.value)} />
          {apply}
        </div>
      </Section>
    </>}
  </>;
}
