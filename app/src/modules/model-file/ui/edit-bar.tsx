"use client";
import { useRef, type RefObject } from "react";
import { CloudSun, Paintbrush, RotateCcw, SquareDashedMousePointer, SunMedium, Trees, UsersRound } from "lucide-react";
import { GLOBAL_TOOLS, globalSummary, type GlobalEdit, type GlobalTool } from "@/modules/design-option/domain/edit-globals";
import { IconTool, RovingToolbar, ToolSeparator } from "./tool-bar";
import { EditGlobalPopover } from "./edit-global-popover";
import { useAnchorRect } from "./tool-popover";
import { Spinner } from "@/shared/ui/loading";

const GLOBAL_ICONS: Record<GlobalTool, typeof SunMedium> = { time: SunMedium, atmosphere: CloudSun, environment: Trees, people: UsersRound, style: Paintbrush };

export type EditActive = "select" | GlobalTool | null;
/** Line over the sub-bar: the reference's hint, the cost before sending (ObraCota) or what went wrong. */
export interface EditPill { text: string; tone: "hint" | "cost" | "error"; /** A request on its way: a turning icon before the text. */ busy?: boolean }

/**
 * Floating sub-bar of EDITAR (DU-17, 03-herramientas.md §3.1): 10 px above the tool bar, aligned with
 * the EDITAR button, with the bar's surface. Groups: [Seleccionar] │ [Momento del día · Atmósfera ·
 * Entorno · Añadir personas · Estilo] │ [Restablecer ediciones]. Buttons are 34 × 34 with a native
 * tooltip equal to their name; a tool holding something not applied yet shows the 6 px green dot.
 * A global tool opens its card over the sub-bar. «Añadir marca en el centro» is for people who do
 * not use a pointer: it stays out of sight until it receives the focus.
 */
export function EditBar({ anchor, hidden, active, onActive, marks, edit, pill, addReason, onAddCenter, resetReason, onReset, cost, applyReason, applying, error, onChoose, onPrompt, onApply, selectButton }: {
  /** The EDITAR button of the main bar. */
  anchor: RefObject<HTMLButtonElement | null>;
  /** While a tool panel is open the sub-bar steps aside, as the reference's popovers do. */
  hidden: boolean;
  active: EditActive;
  onActive: (active: EditActive) => void;
  marks: number;
  edit: GlobalEdit | null;
  pill: EditPill | null;
  addReason?: string;
  onAddCenter: () => void;
  resetReason?: string;
  onReset: () => void;
  cost?: string;
  applyReason?: string;
  applying: boolean;
  /** What went wrong with the last request, shown inside the open card. */
  error?: string;
  onChoose: (tool: GlobalTool, field: string, value: string) => void;
  onPrompt: (text: string) => void;
  onApply: () => void;
  selectButton: RefObject<HTMLButtonElement | null>;
}) {
  const dock = useAnchorRect(anchor, !hidden);
  const bar = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<GlobalTool, HTMLButtonElement | null>>>({});
  const openTool = active && active !== "select" ? active : null;
  const pendingTool = edit?.tool;
  const summary = globalSummary(edit);
  return (
    <div className="edit-dock" hidden={hidden} style={dock ? { left: Math.max(12, dock.left), bottom: window.innerHeight - dock.top + 10 } : { visibility: "hidden" }}>
      {pill && !openTool && <p className="edit-pill" data-tone={pill.tone} role={pill.tone === "error" ? "alert" : "status"}>{pill.busy && <Spinner size={12} />}{pill.text}</p>}
      <div ref={bar} className="edit-bar-host">
        <RovingToolbar label="Herramientas de Editar" className="edit-bar">
          <IconTool ref={selectButton} icon={SquareDashedMousePointer} aria-label="Seleccionar" aria-pressed={active === "select"} pending={marks > 0}
            data-prisma-tour="mark" onClick={() => onActive(active === "select" ? null : "select")} />
          <ToolSeparator />
          {GLOBAL_TOOLS.map((tool) => (
            <IconTool key={tool.id} ref={(node) => { buttons.current[tool.id] = node; }} icon={GLOBAL_ICONS[tool.id]} aria-label={tool.label}
              title={pendingTool === tool.id && summary ? tool.label + ": " + summary : tool.label} aria-haspopup="dialog" aria-expanded={openTool === tool.id}
              aria-controls={openTool === tool.id ? "edit-" + tool.id : undefined} pending={pendingTool === tool.id && !!summary}
              onClick={() => onActive(openTool === tool.id ? null : tool.id)} />
          ))}
          <ToolSeparator />
          <IconTool icon={RotateCcw} aria-label="Restablecer ediciones" disabledReason={resetReason} onClick={onReset} />
        </RovingToolbar>
        <button type="button" className="edit-add-center" aria-disabled={addReason ? true : undefined} title={addReason ?? "Añade una marca en el centro del lienzo"}
          onClick={() => { if (!addReason) onAddCenter(); }}>Añadir marca en el centro</button>
      </div>
      {openTool && <EditGlobalPopover key={openTool} tool={openTool} anchor={bar} opener={() => buttons.current[openTool] ?? null}
        edit={edit} cost={cost} applyReason={applyReason} busy={applying} error={error}
        onChoose={(field, value) => onChoose(openTool, field, value)} onPrompt={onPrompt} onApply={onApply} onClose={() => onActive(null)} />}
    </div>
  );
}
