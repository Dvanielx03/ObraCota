/**
 * «Proponer cambio al modelo» (H4, decisión D9): the notes of Editar go to the design agent of the backend, which reads
 * the model and leaves one draft change for the owner to review in 3D and approve herself. The agent never publishes.
 */
export type AgentRunStatus = "READY" | "NO_CHANGE" | "DISCARDED" | "STOPPED_LIMIT" | "FAILED";
export type AgentStepStatus = "OK" | "REJECTED" | "ERROR";

export interface AgentStep { step: number; seq: number; tool: string; status: AgentStepStatus; errorCode: string | null; detail: string | null }

export interface AgentRun {
  id: string;
  status: AgentRunStatus;
  /** `gemini`, or `fake` for the scripted test agent (no AI, no cost). */
  provider: string;
  model: string;
  change: string | null;
  message: string;
  steps: AgentStep[];
}

export interface AgentAvailability { available: boolean; provider: string; reserveCents: number; remainingCents: number; maxSteps: number }

/** A note of Editar as the agent receives it: on a piece (its IFC GlobalId and name) or on a zone (no GlobalId). */
export interface AgentNote { globalId: string | null; name: string | null; text: string }

/** What each tool of the catalog does, in the words of the steps panel. */
const TOOL_LABELS: Record<string, string> = {
  get_element: "Leer la pieza marcada",
  list_exterior_elements: "Listar las piezas exteriores",
  list_types_for: "Buscar tipos compatibles",
  draft_set_property: "Cambiar una propiedad en el borrador",
  draft_change_type: "Cambiar el tipo en el borrador",
  draft_set_material: "Cambiar el acabado en el borrador",
  preview_change: "Verificar la vista previa",
  submit_change: "Enviar a tu aprobación",
  discard_change: "Descartar el borrador",
};

export const toolLabel = (tool: string): string => TOOL_LABELS[tool] ?? "Herramienta no permitida: " + tool;

export const RUN_TITLES: Record<AgentRunStatus, string> = {
  READY: "Borrador listo para tu revisión",
  NO_CHANGE: "El agente no propuso un cambio",
  DISCARDED: "El agente descartó la propuesta",
  STOPPED_LIMIT: "El agente llegó al tope de pasos",
  FAILED: "El agente no pudo terminar",
};

/** The notes that go to the agent: only marks with text; a point carries its piece when it has a GlobalId (IFC). */
export function agentNotes(marks: readonly ({ kind: "point"; guid?: string; name: string; text: string } | { kind: "area"; text: string })[]): AgentNote[] {
  return marks.filter((mark) => mark.text.trim()).map((mark) => mark.kind === "point"
    ? { globalId: mark.guid ?? null, name: mark.name, text: mark.text.trim() }
    : { globalId: null, name: null, text: mark.text.trim() });
}

/** Why the agent cannot be asked yet, or undefined. */
export function proposeReason(notes: readonly AgentNote[]): string | undefined {
  if (!notes.length) return "Escribe en alguna marca qué quieres cambiar";
  if (!notes.some((note) => note.globalId)) return "Marca una pieza de un modelo IFC: el agente necesita su GlobalId";
  return undefined;
}
