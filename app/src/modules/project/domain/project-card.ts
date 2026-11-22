/** Connectors skipped by the monogram, so "Proyecto sin título" reads PT and not PS. */
const CONNECTORS = new Set(["a", "al", "con", "de", "del", "e", "el", "en", "la", "las", "los", "o", "para", "por", "sin", "u", "un", "una", "y"]);

/**
 * Monogram of a project card: the first letter of the first two words (one letter for a single
 * word, "P" for an empty name). Connectors are skipped unless the name has nothing else.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const strong = words.filter(word => !CONNECTORS.has(word.toLocaleLowerCase("es")));
  const letters = (strong.length ? strong : words).slice(0, 2)
    .map(word => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "").join("");
  return letters ? letters.toLocaleUpperCase("es") : "P";
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000], ["month", 2_592_000], ["day", 86_400], ["hour", 3_600], ["minute", 60],
];

/** "Editado hace 3 horas". Empty when the date is missing or not a date. */
export function editedLabel(updatedAt: string | undefined, now: number): string {
  const time = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  const step = STEPS.find(([, size]) => seconds >= size);
  if (!step) return "Editado hace un momento";
  const format = new Intl.RelativeTimeFormat("es", { numeric: "always" });
  return "Editado " + format.format(-Math.floor(seconds / step[1]), step[0]);
}

/** Number of fallback gradients and decorative drawings of a card without a picture. */
export const COVER_TONES = 8;
export const COVER_SHAPES = 5;

/** 32-bit FNV-1a: stable across sessions, so a project keeps its colours. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Gradient and drawing of the fallback cover, chosen from the project id. */
export function coverPattern(id: string): { tone: number; shape: number } {
  const hash = fnv1a(id);
  return { tone: hash % COVER_TONES, shape: (hash >>> 11) % COVER_SHAPES };
}

/** Minimal view of a stored model version, enough to pick the newest one. */
export interface VersionStamp { id: string; revision: number; name: string; uploadedAt: string }

/** Newest version by upload date (then by revision). Undefined for an empty list. */
export function latestVersion<T extends VersionStamp>(versions: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const version of versions) {
    if (!best) { best = version; continue; }
    const time = Date.parse(version.uploadedAt), bestTime = Date.parse(best.uploadedAt);
    if (time > bestTime || (time === bestTime && version.revision > best.revision)) best = version;
  }
  return best;
}

/** Count tag of a project card, like the reference's «N escenas»: "1 versión", "3 versiones". */
export function versionCountLabel(count: number): string {
  return count + (count === 1 ? " versión" : " versiones");
}
