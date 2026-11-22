import { STEP, areaBetween, moveArea, resizeArea, type Area } from "./selection-area";

/**
 * Marks of Editar › Seleccionar (DU-17, 03-herramientas.md §3.2) over the live 3D canvas. A point
 * belongs to a real piece of the model: it keeps the piece (viewer id and IFC GlobalId) and the 3D
 * point that was clicked, so it follows the piece when the camera moves. A zone is a rectangle of
 * the canvas (fractions of its width and height): it only means something for the framing it was
 * drawn on. Every mark with a note becomes a white part of the mask and one line of the request.
 */
export type Point3 = readonly [number, number, number];

export type EditMark =
  | { id: number; kind: "point"; element: string; guid?: string; name: string; at: Point3; text: string }
  | { id: number; kind: "area"; area: Area; text: string };

export type PointMark = Extract<EditMark, { kind: "point" }>;
export type AreaMark = Extract<EditMark, { kind: "area" }>;

/** Points and zones together, as in the reference's limit of marks per edit. */
export const EDIT_MARK_LIMIT = 5;
export const EDIT_MARK_TEXT_LIMIT = 300;
export const EDIT_REQUEST_LIMIT = 2000;
/** Keyboard step of a zone: 2 % of the canvas. */
export const EDIT_MARK_STEP = STEP;

/** Identifier for the next mark: never reused while the list lives, so React keys stay stable. */
export const nextMarkId = (marks: readonly EditMark[]): number => marks.reduce((top, mark) => Math.max(top, mark.id), 0) + 1;

export function pointMark(marks: readonly EditMark[], piece: { element: string; guid?: string; name: string }, at: Point3): PointMark {
  return { id: nextMarkId(marks), kind: "point", element: piece.element, guid: piece.guid, name: piece.name, at: [at[0], at[1], at[2]], text: "" };
}

/** Zone between two corners of a drag (fractions of the canvas), or null when the drag was too short to be one. */
export function areaMark(marks: readonly EditMark[], ax: number, ay: number, bx: number, by: number): AreaMark | null {
  const area = areaBetween(ax, ay, bx, by);
  return area ? { id: nextMarkId(marks), kind: "area", area, text: "" } : null;
}

export const canAddEditMark = (marks: readonly EditMark[]): boolean => marks.length < EDIT_MARK_LIMIT;

/** The list with one more mark, or null when the limit is reached. */
export function addEditMark(marks: readonly EditMark[], mark: EditMark): EditMark[] | null {
  return canAddEditMark(marks) ? [...marks, mark] : null;
}

export const removeEditMark = (marks: readonly EditMark[], id: number): EditMark[] => marks.filter((mark) => mark.id !== id);

export function setEditMarkText(marks: readonly EditMark[], id: number, text: string): EditMark[] {
  return marks.map((mark) => (mark.id === id ? { ...mark, text: text.slice(0, EDIT_MARK_TEXT_LIMIT) } : mark));
}

export function replaceEditMark(marks: readonly EditMark[], mark: EditMark): EditMark[] {
  return marks.map((current) => (current.id === mark.id ? mark : current));
}

/** Moves a zone; with `resize`, grows or shrinks it from its right and bottom edges. Points are moved by the viewer, not here. */
export function nudgeArea(mark: AreaMark, dx: number, dy: number, resize: boolean): AreaMark {
  return { ...mark, area: resize ? resizeArea(mark.area, dx, dy) : moveArea(mark.area, dx, dy) };
}

/** Number shown on a mark: its place in the list (1, 2…), as the reference numbers them. */
export const markNumber = (marks: readonly EditMark[], id: number): number => marks.findIndex((mark) => mark.id === id) + 1;

export const hasEditText = (marks: readonly EditMark[]): boolean => marks.some((mark) => mark.text.trim().length > 0);

/** Marks that will be sent: only those with a note. A mark without one says nothing to the image model. */
export const marksToSend = (marks: readonly EditMark[]): EditMark[] => marks.filter((mark) => mark.text.trim().length > 0);

export const areaMarks = (marks: readonly EditMark[]): AreaMark[] => marks.filter((mark): mark is AreaMark => mark.kind === "area");
export const pointMarks = (marks: readonly EditMark[]): PointMark[] => marks.filter((mark): mark is PointMark => mark.kind === "point");

/** Pieces the points belong to, once each and in the order they were marked. */
export function markedPieces(marks: readonly EditMark[]): { element: string; guid?: string; name: string }[] {
  const seen = new Set<string>();
  const pieces: { element: string; guid?: string; name: string }[] = [];
  for (const mark of pointMarks(marks)) {
    if (seen.has(mark.element)) continue;
    seen.add(mark.element);
    pieces.push({ element: mark.element, guid: mark.guid, name: mark.name });
  }
  return pieces;
}

/** True while another point still holds the piece of the mark `id`. */
export function pieceStillMarked(marks: readonly EditMark[], element: string, without: number): boolean {
  return marks.some((mark) => mark.id !== without && mark.kind === "point" && mark.element === element);
}

const sentence = (text: string) => {
  const flat = text.trim().replace(/\s+/g, " ");
  return /[.!?…]$/.test(flat) ? flat : flat + ".";
};

/**
 * Request text of an edit: «Marca 1 · Puerta P-01: …. Marca 3 · Zona marcada: ….». The numbers are
 * the ones on screen, so a note keeps its number even when an earlier mark has no text.
 */
export function editRequestText(marks: readonly EditMark[]): string {
  return marks
    .map((mark, index) => ({ mark, number: index + 1 }))
    .filter(({ mark }) => mark.text.trim())
    .map(({ mark, number }) => "Marca " + number + " · " + (mark.kind === "point" ? mark.name.trim() || "Pieza" : "Zona marcada") + ": " + sentence(mark.text))
    .join(" ")
    .slice(0, EDIT_REQUEST_LIMIT);
}

const percent = (value: number) => Math.round(value * 100) + " %";

/** Spoken description of a mark, for its accessible name. */
export function describeEditMark(mark: EditMark): string {
  if (mark.kind === "point") return "punto sobre " + (mark.name.trim() || "una pieza") + (mark.guid ? " (" + mark.guid + ")" : "");
  return "zona de " + percent(mark.area.w) + " del ancho y " + percent(mark.area.h) + " del alto del lienzo";
}
