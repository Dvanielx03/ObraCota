/** Up to two letters that stand for a project on its card. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toLocaleUpperCase("es");
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
