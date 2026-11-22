/** Generated visual options of one piece (or group of pieces) in one model version. */
export type BatchState = "QUEUED" | "WORKING" | "READY" | "FAILED";
export interface OptionBatch {
  id: string;
  request: string;
  state: BatchState;
  selected: number | null;
  drafts?: string[];
  options: { slot: number; description: string }[];
  runs: { model_id: string; status: string; error_code: string | null; total_tokens: number | null }[];
}
export interface OptionHistory {
  available: boolean;
  /** Newest first, as the server lists them. */
  batches: OptionBatch[];
  budget?: { reserve_cents: number; remaining_cents: number };
}
/** One option of one batch: what Comparar and Descargar act on. */
export interface OptionTarget { batch: string; slot: number }

export const isWorking = (history: OptionHistory | undefined): boolean =>
  !!history?.batches.some((batch) => batch.state === "WORKING" || batch.state === "QUEUED");

export const budgetExhausted = (history: OptionHistory | undefined): boolean =>
  !!history?.budget && history.budget.remaining_cents < history.budget.reserve_cents;

/**
 * The option the tools act on by default: the chosen one of the newest batch that has a choice,
 * otherwise the first option of the newest ready batch. Null when nothing is ready yet.
 */
export function defaultTarget(history: OptionHistory | undefined): OptionTarget | null {
  const batches = history?.batches ?? [];
  const chosen = batches.find((batch) => batch.state === "READY" && batch.selected !== null && batch.options.some((o) => o.slot === batch.selected));
  if (chosen) return { batch: chosen.id, slot: chosen.selected! };
  const ready = batches.find((batch) => batch.state === "READY" && batch.options.length > 0);
  return ready ? { batch: ready.id, slot: ready.options[0].slot } : null;
}

/** A requested target, if it still points at a ready option; otherwise the default one. */
export function resolveTarget(history: OptionHistory | undefined, wanted: OptionTarget | null): OptionTarget | null {
  const batch = wanted && history?.batches.find((item) => item.id === wanted.batch);
  if (wanted && batch?.state === "READY" && batch.options.some((option) => option.slot === wanted.slot)) return wanted;
  return defaultTarget(history);
}

export const targetBatch = (history: OptionHistory | undefined, target: OptionTarget | null): OptionBatch | undefined =>
  target ? history?.batches.find((batch) => batch.id === target.batch) : undefined;

/** Key the history is stored under: one piece, or a sorted group of pieces. */
export function optionKey(keys: readonly string[]): string {
  const sorted = [...keys].sort();
  return sorted.length === 1 ? sorted[0] : "group:" + JSON.stringify(sorted);
}
export const OPTION_KEY_LIMIT = 512;

/**
 * Key of the requests about the whole framing rather than a piece: Renderizar without a piece and
 * the global edits of Editar (DU-16, DU-17). The backend accepts any key of up to 512 characters.
 */
export const VIEW_KEY = "vista";
export const VIEW_NAME = "Vista completa";
