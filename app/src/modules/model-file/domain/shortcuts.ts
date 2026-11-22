/**
 * Keyboard shortcuts of the workspace (V-14, DU-12, DU-16): which key does what, and the list the
 * shortcut sheet shows. Pure: the UI decides whether the focus allows a shortcut.
 */

export type ToolShortcut = "render" | "edit" | "review" | "walk" | "compare" | "download";

export type ShortcutAction =
  | { kind: "tool"; tool: ToolShortcut }
  | { kind: "version"; position: number }
  | { kind: "view"; step: 1 | -1 }
  | { kind: "home" }
  | { kind: "help" };

/** Key shown in tooltips and in the sheet for each tool (DU-16). */
export const TOOL_KEYS: Record<ToolShortcut, string> = {
  render: "R", edit: "E", review: "V", walk: "W", compare: "C", download: "D",
};

/** Visible name of each tool, for the notice shown when its key cannot run it. */
export const TOOL_NAMES: Record<ToolShortcut, string> = {
  render: "Renderizar", edit: "Editar", review: "Revisar", walk: "Recorrido", compare: "Comparar", download: "Descargar",
};

/** "Renderizar: elige una pieza primero" */
export function toolNotice(tool: ToolShortcut, reason: string): string {
  return TOOL_NAMES[tool] + ": " + reason.charAt(0).toLocaleLowerCase("es") + reason.slice(1);
}

const BY_LETTER = new Map(Object.entries(TOOL_KEYS).map(([tool, key]) => [key.toLowerCase(), tool as ToolShortcut]));

export interface KeyPress { key: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; repeat: boolean }

/**
 * Action of a key press, or null. No modifier is accepted except Shift for "?", and held keys
 * (auto-repeat) do nothing, so a long press cannot run through views or versions.
 */
export function shortcutFor(press: KeyPress): ShortcutAction | null {
  if (press.ctrl || press.meta || press.alt || press.repeat) return null;
  if (press.key === "?") return { kind: "help" };
  if (press.shift) return null;
  if (press.key === "ArrowDown") return { kind: "view", step: 1 };
  if (press.key === "ArrowUp") return { kind: "view", step: -1 };
  if (press.key === "Home") return { kind: "home" };
  if (/^[1-9]$/.test(press.key)) return { kind: "version", position: Number(press.key) };
  const tool = press.key.length === 1 ? BY_LETTER.get(press.key.toLowerCase()) : undefined;
  return tool ? { kind: "tool", tool } : null;
}

/** Tooltip of a button with a shortcut: "Renderizar · R", plus the reason it is off on a second line. */
export function shortcutTitle(name: string, key: string | undefined, reason?: string): string {
  const head = key ? name + " · " + key : name;
  return reason ? head + "\n" + reason : head;
}

export interface ShortcutRow { keys: string[]; label: string }
export interface ShortcutGroup { title: string; rows: ShortcutRow[] }

/** Content of the shortcut sheet. */
export const SHORTCUT_SHEET: ShortcutGroup[] = [
  { title: "Herramientas", rows: [
    { keys: [TOOL_KEYS.render], label: "Renderizar: pedir opciones visuales" },
    { keys: [TOOL_KEYS.edit], label: "Editar: seleccionar piezas y marcar cambios" },
    { keys: [TOOL_KEYS.review], label: "Revisar la entrega" },
    { keys: [TOOL_KEYS.walk], label: "Recorrido en primera persona" },
    { keys: [TOOL_KEYS.compare], label: "Comparar una opción con el modelo" },
    { keys: [TOOL_KEYS.download], label: "Descargar una opción" },
  ] },
  { title: "Vistas y versiones", rows: [
    { keys: ["↑", "↓"], label: "Vista guardada anterior o siguiente" },
    { keys: ["1", "…", "9"], label: "Abrir la versión 1 a 9 del archivo" },
    { keys: ["Inicio"], label: "Restablecer la cámara" },
  ] },
  { title: "General", rows: [
    { keys: ["Esc"], label: "Cerrar el panel abierto o salir de Editar" },
    { keys: ["?"], label: "Ver esta lista" },
  ] },
  { title: "En la presentación", rows: [
    { keys: ["→", "↓", "Av Pág", "Espacio"], label: "Siguiente" },
    { keys: ["←", "↑", "Re Pág"], label: "Anterior" },
    { keys: ["Esc"], label: "Salir y volver a tu encuadre" },
  ] },
];
