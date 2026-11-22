/**
 * Slides of a presentation: a cover (slide 0) followed by one slide per saved view.
 * Pure helpers shared by the presentation and its tests.
 */

/** Cover plus one slide per view. */
export function slideCount(views: number): number {
  return Math.max(0, views) + 1;
}

/** Slide to start on: the view applied last, or the cover when none is. */
export function startSlide(views: readonly { id: string }[], current: string): number {
  const at = views.findIndex((view) => view.id === current);
  return at < 0 ? 0 : at + 1;
}

/** Index `to`, kept inside the deck (no wrap: the deck stops at the cover and at the last view). */
export function clampSlide(to: number, total: number): number {
  return Math.max(0, Math.min(total - 1, Math.trunc(to)));
}

/** "03 / 06" */
export function counterLabel(index: number, total: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return pad(index + 1) + " / " + pad(total);
}

/** Side dots get smaller with long decks, so the column fits a laptop screen (24 views + cover). */
export function dotSize(total: number): { dot: number; active: number; gap: number } {
  if (total <= 10) return { dot: 6, active: 22, gap: 7 };
  if (total <= 18) return { dot: 5, active: 16, gap: 6 };
  return { dot: 4, active: 12, gap: 5 };
}

const monthYear = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" });

/** Facts under the cover title: "v2", "3 vistas", "noviembre de 2026". */
export function coverFacts(info: { version?: string; views: number; date?: string }): string[] {
  const facts: string[] = [];
  if (info.version) facts.push(info.version);
  facts.push(info.views === 1 ? "1 vista" : info.views + " vistas");
  const when = info.date ? new Date(info.date) : undefined;
  if (when && !Number.isNaN(when.getTime())) facts.push(monthYear.format(when));
  return facts;
}
