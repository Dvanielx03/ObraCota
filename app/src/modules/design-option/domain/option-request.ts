/**
 * Closed choices for a visual-options request. They only compose the text that is already
 * sent as `request`: the API contract does not change.
 */
export const FINISHES = [
  { id: "wood", label: "Madera" },
  { id: "concrete", label: "Concreto a la vista" },
  { id: "steel", label: "Acero" },
  { id: "glass", label: "Vidrio" },
  { id: "stone", label: "Piedra" },
  { id: "paint", label: "Pintura" },
] as const;

export const TONES = [
  { id: "light", label: "Claro" },
  { id: "medium", label: "Medio" },
  { id: "dark", label: "Oscuro" },
] as const;

export const DAYLIGHTS = [
  { id: "morning", label: "Mañana" },
  { id: "afternoon", label: "Tarde" },
  { id: "night", label: "Noche" },
] as const;

export const KEEPS = [
  { id: "shape", label: "Forma y medidas", text: "la forma y las medidas de la pieza" },
  { id: "surroundings", label: "Entorno", text: "el resto del modelo y el entorno" },
] as const;

export type Finish = (typeof FINISHES)[number]["id"];
export type Tone = (typeof TONES)[number]["id"];
export type Daylight = (typeof DAYLIGHTS)[number]["id"];
export type Keep = (typeof KEEPS)[number]["id"];

export type OptionChoices = { finish: Finish | null; tone: Tone | null; daylight: Daylight | null; keep: Keep[] };

/** What a fresh request starts with: nothing asked yet, and both safeguards on. */
export const DEFAULT_CHOICES: OptionChoices = { finish: null, tone: null, daylight: null, keep: ["shape", "surroundings"] };
export const REQUEST_LIMIT = 2000;

const label = <T extends readonly { id: string; label: string }[]>(list: T, id: string | null) => list.find((item) => item.id === id)?.label.toLowerCase();

/** True when there is something to generate: a choice that changes the image, or a written note. */
export function asksForChange(choices: OptionChoices, note: string): boolean {
  return Boolean(choices.finish || choices.tone || choices.daylight || note.trim());
}

/**
 * The exact text sent to the image model. Empty when nothing is asked: what to keep is a
 * safeguard, not a request on its own.
 */
export function composeRequest(choices: OptionChoices, note: string): string {
  if (!asksForChange(choices, note)) return "";
  const parts: string[] = [];
  const finish = label(FINISHES, choices.finish);
  const tone = label(TONES, choices.tone);
  if (finish) parts.push(`Acabado: ${finish}${tone ? ` en tono ${tone}` : ""}.`);
  else if (tone) parts.push(`Tono: ${tone}.`);
  const daylight = label(DAYLIGHTS, choices.daylight);
  if (daylight) parts.push(`Luz del día: ${daylight}.`);
  const kept = KEEPS.filter((item) => choices.keep.includes(item.id)).map((item) => item.text);
  if (kept.length) parts.push(`Conservar ${kept.join(" y ")}.`);
  const written = note.trim();
  if (written) parts.push(written);
  return parts.join(" ").slice(0, REQUEST_LIMIT);
}

/** Cents as "1,00 USD", the way the rest of the product writes money. */
export function formatUsd(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " USD";
}
