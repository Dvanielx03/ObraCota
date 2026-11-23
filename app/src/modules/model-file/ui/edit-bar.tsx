"use client";
import { useRef, type RefObject } from "react";
import { Clapperboard, RotateCcw, SquareDashedMousePointer } from "lucide-react";
import { globalSummary, type SceneCategory, type SceneEdit, type SceneField } from "@/modules/design-option/domain/edit-globals";
import { IconTool, RovingToolbar, ToolSeparator } from "./tool-bar";
import { EditGlobalPopover, type SceneWalk } from "./edit-global-popover";
import { useAnchorRect } from "./tool-popover";
import { Spinner } from "@/shared/ui/loading";
import { useDisabledReason } from "@/shared/ui/disabled-reason";

export type EditActive = "select" | "scene" | null;
/** Line over the sub-bar: the reference's hint, the cost before sending (ObraCota) or what went wrong. */
export interface EditPill { text: string; tone: "hint" | "cost" | "error"; /** A request on its way: a turning icon before the text. */ busy?: boolean }

/**
 * Floating sub-bar of EDITAR (DU-17, 03-herramientas.md §3.1): 10 px above the tool bar, aligned with
 * the EDITAR button, with the bar's surface. Groups: [Seleccionar] │ [Escena] │ [Restablecer
 * ediciones]. Buttons are 34 × 34 with a native tooltip equal to their name; a tool holding something
 * not applied yet shows the 6 px green dot. Escena opens its card over the sub-bar, where time of
 * day, weather and season, surroundings, people and style combine into one request. «Añadir marca en el centro» is for people who do
 * not use a pointer: it stays out of sight until it receives the focus.
 */
export function EditBar({ anchor, hidden, active, onActive, marks, edit, pill, addReason, onAddCenter, resetReason, onReset, cost, applyReason, applying, error, onChoose, onPreset, onClear, onPrompt, onApply, selectButton, walk }: {
  /** The EDITAR button of the main bar. */
  anchor: RefObject<HTMLButtonElement | null>;
  /** While a tool panel is open the sub-bar steps aside, as the reference's popovers do. */
  hidden: boolean;
  active: EditActive;
  onActive: (active: EditActive) => void;
  marks: number;
  edit: SceneEdit | null;
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
  onChoose: (field: SceneField, value: string) => void;
  onPreset: (id: string) => void;
  onClear: (category: SceneCategory) => void;
  onPrompt: (text: string) => void;
  onApply: () => void;
  selectButton: RefObject<HTMLButtonElement | null>;
  /** «Recorrer esta escena en 3D» inside the card. */
  walk?: SceneWalk;
}) {
  const dock = useAnchorRect(anchor, !hidden);
  const bar = useRef<HTMLDivElement>(null);
  const sceneButton = useRef<HTMLButtonElement>(null);
  const openTool = active === "scene";
  const summary = globalSummary(edit);
  const addOff = useDisabledReason(addReason);
  return (
    <div className="edit-dock" hidden={hidden} style={dock ? { left: Math.max(12, dock.left), bottom: window.innerHeight - dock.top + 10 } : { visibility: "hidden" }}>
      {pill && !openTool && <p className="edit-pill" data-tone={pill.tone} role={pill.tone === "error" ? "alert" : "status"}>{pill.busy && <Spinner size={12} />}{pill.text}</p>}
      <div ref={bar} className="edit-bar-host">
        <RovingToolbar label="Herramientas de Editar" className="edit-bar">
          <IconTool ref={selectButton} icon={SquareDashedMousePointer} aria-label="Seleccionar" aria-pressed={active === "select"} pending={marks > 0}
            data-prisma-tour="mark" onClick={() => onActive(active === "select" ? null : "select")} />
          <ToolSeparator />
          <IconTool ref={sceneButton} icon={Clapperboard} aria-label="Escena" title={summary ? "Escena: " + summary : "Escena: momento del día, clima, entorno, personas y estilo"}
            aria-haspopup="dialog" aria-expanded={openTool} aria-controls={openTool ? "edit-scene" : undefined} pending={!!summary}
            onClick={() => onActive(openTool ? null : "scene")} />
          <ToolSeparator />
          <IconTool icon={RotateCcw} aria-label="Restablecer ediciones" disabledReason={resetReason} onClick={onReset} />
        </RovingToolbar>
        <button type="button" className="edit-add-center" aria-disabled={addReason ? true : undefined} title={addReason ?? "Añade una marca en el centro del lienzo"}
          aria-describedby={addOff.describedBy} onClick={() => { if (!addReason) onAddCenter(); }}>Añadir marca en el centro</button>
        {addOff.note}
      </div>
      {openTool && <EditGlobalPopover anchor={bar} opener={() => sceneButton.current}
        edit={edit} cost={cost} applyReason={applyReason} busy={applying} error={error}
        onChoose={onChoose} onPreset={onPreset} onClear={onClear} onPrompt={onPrompt} onApply={onApply} onClose={() => onActive(null)} walk={walk} />}
    </div>
  );
}
