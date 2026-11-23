"use client";
import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  ArrowUp, Briefcase, Footprints, Building2, BuildingComplex, Check, Cloud, CloudFog, CloudRain, CloudSun, Coins, Contrast, Flower2, Haze, Kayak, Leaf, Moon, MoonStar,
  Mountain, Parasol, Ruler, Snowflake, Sprout, Square, Sun, SunDim, SunMedium, Sunrise, Sunset, TreePalm, Trees, Trophy, UserRound, UserRoundGroup, UserRoundX,
  UsersRound, WavesHorizontal, Wind, X,
} from "lucide-react";
import {
  CROWDS, ENVIRONMENTS, GRAPHIC_STYLES, PEOPLE_PROMPT_LIMIT, PEOPLE_STYLES, SCENE_CATEGORIES, SCENE_PRESETS, SEASONS, TIMES, WEATHERS,
  categorySummary, globalSummary, matchingPreset, sceneValue, type SceneCategory, type SceneEdit, type SceneField,
} from "@/modules/design-option/domain/edit-globals";
import { placeAbove, useAnchorRect } from "./tool-popover";
import { StyleThumb } from "./edit-style-thumb";
import { useDisabledReason } from "@/shared/ui/disabled-reason";
import { Spinner } from "@/shared/ui/loading";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean | "true" }>;

/** Icons of the reference's table (03-herramientas.md §3.3), plus the ones ObraCota adds. */
const ICONS: Record<string, Icon> = {
  morning: SunMedium, afternoon: SunDim, night: Moon, sunrise: Sunrise, noon: Sun, golden: Haze, sunset: Sunset, blue: MoonStar,
  clear: Sun, partly: CloudSun, overcast: Cloud, fog: CloudFog, rain: CloudRain, snow: Snowflake,
  spring: Sprout, summer: Sun, autumn: Leaf, winter: Snowflake,
  none: Square, countryside: Trees, city: BuildingComplex, coast: Parasol, mountain: Mountain, forest: Trees, lake: Kayak, river: WavesHorizontal,
  desert: Mountain, tropical: TreePalm, residential: Building2, garden: Flower2,
  one: UserRound, couple: UsersRound, few: UsersRound, crowded: UserRoundGroup,
  natural: UserRound, motion: Wind, silhouette: Contrast,
};
const CATEGORY_ICONS: Record<SceneCategory, Icon> = { time: SunMedium, atmosphere: CloudSun, environment: Trees, people: UsersRound, style: Contrast };
const PRESET_ICONS: Record<string, Icon> = { client: Briefcase, contest: Trophy, review: Ruler, night: Moon };

const WIDTH = 660;

/** «Recorrer esta escena en 3D»: why it is off, what the walk lacks (the scene is still shown in 3D) and the action. */
export interface SceneWalk { reason?: string; note?: string; run: () => void }

/**
 * Card «Escena» of the Editar sub-bar (03-herramientas.md §3.3, combined): the five global edits
 * are categories of one scene, each optional and with one choice. On top, shortcuts by goal fill
 * the combination; on the left, the categories with what each holds; on the right, the options of
 * the open category. The footer sums up the combination next to the round «Aplicar cambios».
 * It is a non-modal dialog: the focus moves in when it opens; Escape or a click outside close it,
 * and Escape gives the focus back to the sub-bar button that opened it.
 */
export function EditGlobalPopover({ anchor, opener, edit, cost, applyReason, busy, error, onChoose, onPreset, onClear, onPrompt, onApply, onClose, walk }: {
  /** The sub-bar: the card opens above it, aligned with its left edge. */
  anchor: RefObject<HTMLElement | null>;
  /** The sub-bar button that opened the card; it gets the focus back on Escape. */
  opener: () => HTMLElement | null;
  edit: SceneEdit | null;
  /** «1,00 USD», once the budget is known. */
  cost?: string;
  /** Why «Aplicar cambios» cannot run yet. */
  applyReason?: string;
  busy: boolean;
  /** What went wrong with the last request. */
  error?: string;
  onChoose: (field: SceneField, value: string) => void;
  onPreset: (id: string) => void;
  onClear: (category: SceneCategory) => void;
  onPrompt: (text: string) => void;
  onApply: () => void;
  onClose: () => void;
  walk?: SceneWalk;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const titleId = useId(), base = useId();
  const rect = useAnchorRect(anchor, true);
  const [open, setOpen] = useState<SceneCategory>("time");
  const close = useRef(onClose), back = useRef(opener);
  close.current = onClose;
  back.current = opener;
  useEffect(() => {
    const frame = requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus({ preventScroll: true }));
    function key(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      back.current()?.focus();
      close.current();
    }
    function down(event: PointerEvent) {
      const target = event.target as Element;
      // The sub-bar buttons toggle the card or reset it; a guide card keeps everything open.
      if (box.current?.contains(target) || target.closest?.(".edit-bar, [data-visual-tour], dialog[open]")) return;
      close.current();
    }
    window.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); };
  }, []);

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const list = SCENE_CATEGORIES.map((category) => category.id);
    const at = list.indexOf(open);
    const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? Math.min(list.length - 1, at + 1)
      : event.key === "ArrowUp" || event.key === "ArrowLeft" ? Math.max(0, at - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setOpen(list[next]);
    tabs.current?.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus();
  }

  const style = placeAbove(rect, WIDTH);
  const value = (field: SceneField) => sceneValue(edit, field);
  const choose = (field: SceneField) => (id: string) => onChoose(field, id);
  const preset = matchingPreset(edit);
  const summary = globalSummary(edit);
  const info = SCENE_CATEGORIES.find((category) => category.id === open)!;
  const chosen = categorySummary(edit, open);
  return (
    <div ref={box} id="edit-scene" role="dialog" aria-labelledby={titleId} className="edit-popover edit-scene"
      style={style ? { left: style.left, bottom: style.bottom, width: style.width, maxHeight: style.maxHeight } : { visibility: "hidden" }}>
      <div className="edit-popover-head">
        <h2 id={titleId} className="edit-popover-title">Escena</h2>
        {cost && <span className="edit-popover-cost" title="Reserva de cada edición en el presupuesto mensual de IA"><Coins size={12} strokeWidth={2} aria-hidden="true" />{cost}</span>}
      </div>
      <div role="group" aria-label="Accesos rápidos por objetivo" className="scene-presets">
        {SCENE_PRESETS.map((item) => {
          const Glyph = PRESET_ICONS[item.id];
          return (
            <button key={item.id} type="button" className="scene-preset" aria-pressed={preset === item.id}
              title={"Rellena la escena para: " + item.label + ". Después puedes ajustarla."} onClick={() => onPreset(item.id)}>
              <Glyph size={14} strokeWidth={2} aria-hidden="true" /><span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="scene-body">
        <div ref={tabs} role="tablist" aria-label="Categorías de la escena" aria-orientation="vertical" className="scene-tabs" onKeyDown={onTabKey}>
          {SCENE_CATEGORIES.map((category) => {
            const Glyph = CATEGORY_ICONS[category.id];
            const current = categorySummary(edit, category.id);
            const selected = open === category.id;
            return (
              <button key={category.id} type="button" role="tab" id={base + "tab-" + category.id} aria-selected={selected}
                aria-controls={base + "panel-" + category.id} tabIndex={selected ? 0 : -1} className="scene-tab" data-set={current ? "" : undefined}
                onClick={() => setOpen(category.id)}>
                <span className="scene-tab-icon"><Glyph size={16} strokeWidth={2} aria-hidden="true" /></span>
                <span className="scene-tab-text">
                  <span className="scene-tab-title">{category.title}</span>
                  <span className="scene-tab-value">{current ?? "Sin elegir"}</span>
                </span>
                {current && <Check className="scene-tab-check" size={14} strokeWidth={2.5} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id={base + "panel-" + open} aria-labelledby={base + "tab-" + open} className="scene-panel">
          <div className="scene-panel-head">
            <h3 className="edit-section-title">{info.title}</h3>
            {chosen && <button type="button" className="scene-clear" aria-label={"Quitar " + info.title.toLowerCase()} onClick={() => onClear(open)}>
              <X size={12} strokeWidth={2.5} aria-hidden="true" />Quitar</button>}
          </div>
          {open === "time" && <RadioGrid label="Momento del día" options={TIMES} value={value("time")} onChoose={choose("time")} columns={4} />}
          {open === "atmosphere" && <>
            <RadioGrid label="Clima" options={WEATHERS} value={value("weather")} onChoose={choose("weather")} />
            <h3 className="edit-section-title scene-subtitle">Estación</h3>
            <RadioGrid label="Estación" options={SEASONS} value={value("season")} onChoose={choose("season")} columns={4} />
          </>}
          {open === "environment" && <RadioGrid label="Entorno" options={ENVIRONMENTS} value={value("environment")} onChoose={choose("environment")} />}
          {open === "people" && <People edit={edit} onChoose={onChoose} onPrompt={onPrompt} />}
          {open === "style" && <><RadioGrid label="Estilo" options={GRAPHIC_STYLES} value={value("style")} onChoose={choose("style")} columns={4} variant="style"
            render={(option, checked) => <>
              <span className="edit-style-thumb"><StyleThumb slug={(option as (typeof GRAPHIC_STYLES)[number]).slug} />{checked && <i className="edit-style-check"><Check size={12} strokeWidth={3} aria-hidden="true" /></i>}</span>
              <span className="edit-style-label">{option.label}</span>
            </>} /><p className="edit-popover-note">Miniaturas generadas con IA.</p></>}
        </div>
      </div>
      <div className="scene-foot">
        <p className="scene-summary" aria-live="polite">{summary ? <><span className="visually-hidden">Escena: </span>{summary}</> : "Elige una o varias categorías, o un acceso rápido."}</p>
        {walk && <WalkButton walk={walk} />}
        <ApplyButton reason={applyReason} busy={busy} cost={cost} onApply={onApply} />
      </div>
      {/* Blocking reasons only once something is chosen: before that the footer already says what to do. */}
      {(error || (summary && applyReason)) &&
        <p className="edit-popover-note" role={error ? "alert" : "status"}>{!error && busy && <Spinner size={12} className="spinner-inline" />}{error || applyReason}</p>}
    </div>
  );
}

/** A soft hyphen inside long words («PARCIAL-MENTE»): at 10 px uppercase they do not fit the option. */
const breakable = (label: string) => label.replace(/\p{L}{11,}/gu, (word) => word.slice(0, 7) + "­" + word.slice(7));

/** Builds the chosen scene around the model with real geometry and starts the walk; no AI, no cost. */
function WalkButton({ walk }: { walk: SceneWalk }) {
  const off = useDisabledReason(walk.reason);
  const title = walk.reason ?? ("Construye esta escena alrededor del modelo en 3D y entra en el recorrido, sin IA ni costo" + (walk.note ? ". Recorrido: " + walk.note : ""));
  return <>
    <button type="button" className="scene-walk-launch" aria-disabled={walk.reason ? true : undefined} aria-describedby={off.describedBy} title={title}
      onClick={() => { if (!walk.reason) walk.run(); }}><Footprints size={14} strokeWidth={2} aria-hidden="true" />Recorrer esta escena en 3D</button>
    {off.note}
  </>;
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
function RadioGrid<T extends { id: string; label: string }>({ label, options, value, onChoose, columns = 3, variant, render }: {
  label: string; options: readonly T[]; value: string | null; onChoose: (id: string) => void;
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
    <div ref={group} role="radiogroup" aria-label={label} className="edit-grid" data-variant={variant} onKeyDown={onKeyDown}
      style={{ gridTemplateColumns: "repeat(" + columns + ",minmax(0,1fr))" }}>
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
  );
}

/** Personas: quantity first; the style and the own indications appear once there are people in the scene. */
function People({ edit, onChoose, onPrompt }: { edit: SceneEdit | null; onChoose: (field: SceneField, value: string) => void; onPrompt: (text: string) => void }) {
  const crowd = edit?.crowd ?? null;
  const withPeople = !!crowd && crowd !== "none";
  return <>
    <RadioGrid label="Cantidad de personas" options={CROWDS} value={crowd} onChoose={(id) => onChoose("crowd", id)} columns={5} variant="count"
      render={(option, checked) => { const Glyph = option.id === "none" ? UserRoundX : ICONS[option.id]; return <>
        <span className="edit-count-circle" data-checked={checked || undefined}><Glyph size={16} strokeWidth={2} aria-hidden="true" /></span>
        <span className="edit-count-label">{option.label}</span></>; }} />
    {withPeople && <>
      <h3 className="edit-section-title scene-subtitle">Estilo de las personas</h3>
      <RadioGrid label="Estilo de las personas" options={PEOPLE_STYLES} value={edit!.peopleStyle} onChoose={(id) => onChoose("peopleStyle", id)} variant="chip"
        render={(option) => { const Glyph = ICONS[option.id]; return <><Glyph size={16} strokeWidth={2} aria-hidden="true" /><span>{option.label}</span></>; }} />
      <h3 className="edit-section-title scene-subtitle">Indicaciones personalizadas</h3>
      <div className="edit-prompt-row">
        <textarea aria-label="Indicaciones personalizadas para las personas" maxLength={PEOPLE_PROMPT_LIMIT} rows={1} value={edit!.prompt}
          placeholder="p. ej., una familia entrando por el acceso…" onChange={(event) => onPrompt(event.target.value)} />
      </div>
    </>}
  </>;
}
