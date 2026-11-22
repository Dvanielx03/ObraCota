"use client";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Download, Footprints, PanelRightDashed, Pencil, RotateCcw, Sparkles } from "lucide-react";
import type { CameraPose, ElementInfo, ViewerPort } from "@/viewer/domain/viewer.port";
import { VisualOptions, type RenderScope } from "@/modules/design-option/ui/visual-options";
import { OptionCompare } from "@/modules/design-option/ui/option-compare";
import { OptionDownloadPanel } from "@/modules/design-option/ui/option-download";
import { EditMarksLayer, type MarkFocus } from "@/modules/design-option/ui/edit-marks-layer";
import { maskWithAreas } from "@/modules/design-option/ui/area-mask";
import { useOptionHistory } from "@/modules/design-option/ui/use-option-history";
import { OPTION_KEY_LIMIT, VIEW_KEY, VIEW_NAME, budgetExhausted, isWorking, optionKey, resolveTarget, targetBatch, type OptionTarget } from "@/modules/design-option/domain/option-history";
import {
  EDIT_MARK_LIMIT, addEditMark, areaMarks, canAddEditMark, editRequestText, hasEditText, markedPieces, marksToSend, nextMarkId, pieceStillMarked,
  pointMark, removeEditMark, replaceEditMark, setEditMarkText, type EditMark,
} from "@/modules/design-option/domain/edit-marks";
import { chooseGlobal, globalEditText, isApplicable, withPeoplePrompt, type GlobalEdit } from "@/modules/design-option/domain/edit-globals";
import { DEFAULT_CHOICES, formatUsd, type OptionChoices } from "@/modules/design-option/domain/option-request";
import type { Area } from "@/modules/design-option/domain/selection-area";
import { FULL_FRAME, NEUTRAL, isFullFrame, isNeutral, type Adjustments, type Framing } from "@/modules/design-option/domain/image-adjust";
import { optionsPath, requestOptions } from "@/modules/design-option/infrastructure/option-http";
import { IconTool, ModeButton, RovingToolbar, ToolSeparator } from "./tool-bar";
import { ToolPopover } from "./tool-popover";
import { EditBar, type EditActive, type EditPill } from "./edit-bar";
import { TOOL_KEYS, type ToolShortcut } from "../domain/shortcuts";

type Tool = "render" | "compare" | "download";

/** Fields where Escape belongs to the text being written, not to Editar. */
const TYPING = "input,textarea,select,[contenteditable]:not([contenteditable=false])";
const HINT = "Haz clic en una pieza o arrastra para seleccionar una zona.";
const MISS = "Ahí no hay ninguna pieza: haz clic sobre el modelo o arrastra para marcar una zona.";
const LIMIT = "Puedes poner hasta " + EDIT_MARK_LIMIT + " marcas. Quita una para añadir otra.";
/** Side of the zone that «Añadir marca en el centro» draws when no piece is under the centre. */
const CENTER_ZONE = 0.24;

/** What the workspace can ask of the tools (keyboard shortcuts, presentation). */
export interface WorkspaceToolsHandle {
  /** Runs a tool as its button would; returns why it cannot run, if so. */
  run(tool: ToolShortcut): string | undefined;
  /** Closes the open panel and leaves Editar (asking first if notes would be lost), then calls `then`. */
  release(then: () => void): void;
}

/**
 * Editar mode (DU-16, DU-17). The workspace owns the side dock and the selection of pieces shown
 * there under «Selección»; the tools own the sub-bar, the marks and the global edits. A point mark
 * adds its piece to the selection, and a piece taken out of the selection takes its marks along.
 */
export interface EditControl {
  on: boolean;
  /** Why Editar is off for this file. */
  reason?: string;
  /** "Agrupar" is on in the dock: Escape ends it before leaving Editar. */
  grouping: boolean;
  /** Viewer ids of the pieces in the Editar selection. */
  selection: string[];
  onSelection: (ids: string[]) => void;
  piece: (id: string) => ElementInfo | undefined;
  /** Piece of the mark whose field is open: the model shows that one piece, so the note's anchor is clear. */
  onFocusPiece: (id: string | null) => void;
  onEnter: () => void;
  onExit: () => void;
  onUngroup: () => void;
}

const pieceName = (piece: ElementInfo) => piece.name || piece.type;

/**
 * Bottom of the workspace (DU-03 = C, DU-04 = C, DU-16, DU-17): the tool bar centred on the canvas
 * (RENDERIZAR · EDITAR · REVISAR · RECORRIDO │ Comparar · Descargar), the camera group on its own at
 * the bottom right, the tool panels that open above their buttons, and Editar: its floating sub-bar,
 * the numbered marks anchored to the model and the global edits.
 */
export function WorkspaceTools({ viewer, plan, scope, pieces, edit, review, reviewOpen = false, onCloseReview, walk, camera, onWorking, control, proposal }: {
  /**
   * An unpublished preview is open (H1 §7.4, §7.5): Renderizar explains why it is off, and Comparar opens
   * «Comparar con la base» with `compare` instead of the image options.
   */
  proposal?: { renderReason: string; compare: ReactNode };
  /** Shortcuts and the presentation reach the tools through this handle. */
  control?: Ref<WorkspaceToolsHandle>;
  viewer: () => ViewerPort | null;
  plan: boolean;
  /** Saved version the options belong to; without it Renderizar and the edits explain why they are off. */
  scope?: { project: string; version: string };
  /** The Editar selection, or the piece chosen in the dock; empty means the whole framing. */
  pieces: ElementInfo[];
  edit: EditControl;
  review: ReactNode;
  /** REVISAR's own panel is open: the other panels and Editar's sub-bar give way to it. */
  reviewOpen?: boolean;
  onCloseReview?: () => void;
  walk: { reason?: string; onStart: () => void };
  camera: ReactNode;
  onWorking: (working: boolean) => void;
}) {
  const [tool, setTool] = useState<Tool | null>(null);
  const renderButton = useRef<HTMLButtonElement>(null), editButton = useRef<HTMLButtonElement>(null);
  const compareButton = useRef<HTMLButtonElement>(null), downloadButton = useRef<HTMLButtonElement>(null);
  const selectButton = useRef<HTMLButtonElement>(null);
  const bars = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const fullWidth = useRef(0);
  // Icons only when the labelled bar and the camera group no longer fit side by side.
  useLayoutEffect(() => {
    const node = bars.current;
    if (!node) return;
    const check = () => {
      const bar = node.querySelector<HTMLElement>(".tool-bar"), camera = node.querySelector<HTMLElement>(".tools");
      if (bar && node.dataset.compact === undefined) fullWidth.current = bar.scrollWidth;
      setCompact(node.clientWidth < fullWidth.current + (camera?.offsetWidth ?? 0) + 32);
    };
    const observer = new ResizeObserver(check);
    observer.observe(node);
    const bar = node.querySelector(".tool-bar");
    if (bar) observer.observe(bar);
    check();
    return () => observer.disconnect();
  }, [plan]);
  // The marks live over the viewer's canvas, inside its container.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(bars.current?.closest(".stage")?.querySelector<HTMLElement>(".view") ?? null); }, []);

  // Subject of Renderizar (DU-16): the selection or the chosen piece, or the whole framing.
  const [renderScope, setRenderScope] = useState<RenderScope>("selection");
  const viewScope = renderScope === "view" || !pieces.length;
  const pieceKey = pieces.length ? optionKey(pieces.map((piece) => piece.guid || piece.id)) : null;
  // Choosing other pieces makes them the subject again; "Vista completa" only lasts while the selection stays the same.
  useEffect(() => { setRenderScope("selection"); }, [pieceKey]);
  const tooLong = !!pieceKey && pieceKey.length > OPTION_KEY_LIMIT;
  const key = viewScope ? VIEW_KEY : pieceKey;
  const base = scope ? optionsPath(scope.project, scope.version) : null;
  // A selection too long for one request still lets the budget be read, under the framing's key.
  const historyKey = !viewScope && tooLong ? VIEW_KEY : key;
  const state = useOptionHistory(!plan && base ? base : null, !plan && base ? historyKey : null);
  const selectionName = pieces.map(pieceName).join(", ");
  const name = viewScope ? VIEW_NAME : selectionName;
  const noScope = "Disponible en una versión guardada de un modelo 3D";
  const unavailable = proposal ? proposal.renderReason : !scope ? noScope : !viewScope && tooLong ? "Reduce la selección: hay demasiadas piezas para una petición" : undefined;
  const [wanted, setWanted] = useState<OptionTarget | null>(null);
  useEffect(() => setWanted(null), [key]);
  const target = resolveTarget(state.history, wanted);
  const batch = targetBatch(state.history, target);
  const optionReason = unavailable ?? (state.loading ? "Consultando las opciones…"
    : !target ? (viewScope ? "Genera opciones primero: la vista aún no tiene ninguna lista" : "Genera opciones primero: esta pieza aún no tiene ninguna lista") : undefined);
  // Over a preview, Comparar lists the differences with the base and does not depend on image options.
  const comparing = !!proposal;
  const compareReason = comparing ? undefined : optionReason;
  const working = isWorking(state.history);
  // Opening a panel reads the history again: the budget or a batch may have changed meanwhile.
  const { reload } = state;
  useEffect(() => { if (tool) reload(); }, [tool, reload]);
  useEffect(() => onWorking(working), [working, onWorking]);
  useEffect(() => () => onWorking(false), [onWorking]);
  const [choices, setChoices] = useState<OptionChoices>(DEFAULT_CHOICES);

  // Download adjustments live here so the reset button can sit in the panel header.
  const [adjust, setAdjust] = useState<Adjustments>(NEUTRAL), [framing, setFraming] = useState<Framing>(FULL_FRAME);
  useEffect(() => { setAdjust(NEUTRAL); setFraming(FULL_FRAME); }, [target?.batch, target?.slot]);

  // Editar (DU-17): the sub-bar's active tool, the marks over the canvas and the pending global edit.
  const [active, setActive] = useState<EditActive>("select");
  const [marks, setMarks] = useState<EditMark[]>([]);
  const [openMark, setOpenMark] = useState<number | null>(null);
  const [markFocus, setMarkFocus] = useState<MarkFocus | null>(null);
  const [globalEdit, setGlobalEdit] = useState<GlobalEdit | null>(null);
  const [areaPose, setAreaPose] = useState<CameraPose | null>(null);
  const [lost, setLost] = useState<{ marks: EditMark[]; pose: CameraPose; at: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const [editError, setEditError] = useState("");
  const [sending, setSending] = useState<"marks" | "global" | null>(null);
  /** Set after an edit is sent: Renderizar opens on its batches, where the result appears. */
  const [reveal, setReveal] = useState(false);
  const revealed = useCallback(() => setReveal(false), []);
  const confirm = useRef<HTMLDialogElement>(null), afterConfirm = useRef<(() => void) | null>(null);
  const marking = edit.on && !plan && active === "select" && !tool && !reviewOpen;
  // One panel at a time: REVISAR closes the tool panel, and a tool panel closes REVISAR.
  useEffect(() => { if (reviewOpen) setTool(null); }, [reviewOpen]);
  const closeReview = useRef(onCloseReview);
  closeReview.current = onCloseReview;
  useEffect(() => { if (tool) closeReview.current?.(); }, [tool]);

  useEffect(() => {
    viewer()?.setMarking(marking);
  }, [viewer, marking]);
  useEffect(() => () => viewer()?.setMarking(false), [viewer]);
  // A panel whose subject disappears closes by itself.
  useEffect(() => {
    if ((tool === "render" && unavailable) || (((tool === "compare" && !comparing) || tool === "download") && !batch && !state.loading)) setTool(null);
  }, [tool, unavailable, batch, state.loading, comparing]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!lost) return;
    const timer = setTimeout(() => setLost(null), 8000);
    return () => clearTimeout(timer);
  }, [lost]);
  const flash = (text: string) => setNotice({ text, at: Date.now() });

  const clearEdit = useCallback(() => {
    setMarks([]); setOpenMark(null); setGlobalEdit(null); setAreaPose(null); setLost(null); setEditError(""); setActive("select");
  }, []);
  // Leaving Editar from elsewhere (a guide, another file) drops what was only marked here.
  useEffect(() => { if (!edit.on) clearEdit(); }, [edit.on, clearEdit]);
  // A piece taken out of the selection in the dock takes its marks along.
  const selectionKey = edit.selection.join("|");
  useEffect(() => {
    setMarks((list) => {
      const kept = list.filter((mark) => mark.kind === "area" || edit.selection.includes(mark.element));
      return kept.length === list.length ? list : kept;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);
  // The piece of the open mark is the one shown in the model.
  const openPoint = marks.find((mark) => mark.id === openMark);
  const focusPiece = openPoint?.kind === "point" ? openPoint.element : null;
  const { onFocusPiece } = edit;
  useEffect(() => onFocusPiece(focusPiece), [focusPiece, onFocusPiece]);
  // Zones only match the framing they were drawn on.
  const hasAreas = marks.some((mark) => mark.kind === "area");
  useEffect(() => { if (!hasAreas) setAreaPose(null); }, [hasAreas]);

  /** Runs an action that drops the marks, asking first when some note has been written. */
  const guard = useCallback((action: () => void) => {
    if (!hasEditText(marks)) { action(); return; }
    afterConfirm.current = action;
    confirm.current?.showModal();
  }, [marks]);

  function addPiece(element: string) {
    if (!edit.selection.includes(element)) edit.onSelection([...edit.selection, element]);
  }
  function dropPiece(list: readonly EditMark[], element: string, without: number) {
    if (!pieceStillMarked(list, element, without)) edit.onSelection(edit.selection.filter((id) => id !== element));
  }
  function openNew(mark: EditMark, next: EditMark[]) {
    setMarks(next); setOpenMark(mark.id); setEditError("");
    setMarkFocus({ id: mark.id, target: "field", at: Date.now() });
  }
  function addPoint(clientX: number, clientY: number) {
    const hit = viewer()?.probe(clientX, clientY);
    if (!hit) { flash(MISS); return; }
    if (!canAddEditMark(marks)) { flash(LIMIT); return; }
    const info = edit.piece(hit.id);
    const mark = pointMark(marks, { element: hit.id, guid: info?.guid, name: info ? pieceName(info) : "Pieza" }, hit.point);
    openNew(mark, [...marks, mark]);
    addPiece(hit.id);
  }
  function addArea(area: Area) {
    if (!canAddEditMark(marks)) { flash(LIMIT); return; }
    const mark: EditMark = { id: nextMarkId(marks), kind: "area", area, text: "" };
    const next = addEditMark(marks, mark);
    if (!next) return;
    if (!hasAreas) setAreaPose(viewer()?.pose() ?? null);
    setLost(null);
    openNew(mark, next);
  }
  function addCenter() {
    const rect = host?.getBoundingClientRect();
    if (!rect) return;
    if (viewer()?.probe(rect.left + rect.width / 2, rect.top + rect.height / 2)) addPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    else addArea({ x: 0.5 - CENTER_ZONE / 2, y: 0.5 - CENTER_ZONE / 2, w: CENTER_ZONE, h: CENTER_ZONE });
  }
  function removeMark(id: number) {
    const mark = marks.find((item) => item.id === id);
    const next = removeEditMark(marks, id);
    setMarks(next);
    if (openMark === id) setOpenMark(null);
    if (mark?.kind === "point") dropPiece(marks, mark.element, id);
    if (!next.length) requestAnimationFrame(() => selectButton.current?.focus());
  }
  function moveMark(mark: EditMark, client?: { x: number; y: number }) {
    if (mark.kind === "area" || !client) { setMarks((list) => replaceEditMark(list, mark)); return; }
    const hit = viewer()?.probe(client.x, client.y);
    if (!hit) { flash("No hay ninguna pieza en esa dirección."); return; }
    const info = edit.piece(hit.id);
    setMarks(replaceEditMark(marks, { ...mark, element: hit.id, guid: info?.guid, name: info ? pieceName(info) : "Pieza", at: hit.point }));
    if (hit.id !== mark.element) {
      const others = edit.selection.filter((id) => id !== mark.element || pieceStillMarked(marks, mark.element, mark.id));
      edit.onSelection(others.includes(hit.id) ? others : [...others, hit.id]);
    }
  }
  function areasLost() {
    if (!areaPose) return;
    const zones = areaMarks(marks);
    if (!zones.length) return;
    setLost({ marks: zones, pose: areaPose, at: Date.now() });
    setMarks((list) => list.filter((mark) => mark.kind !== "area"));
    if (zones.some((mark) => mark.id === openMark)) setOpenMark(null);
    setAreaPose(null);
  }
  function restoreAreas() {
    if (!lost) return;
    viewer()?.applyPose(lost.pose);
    const restored = lost.marks.slice(0, Math.max(0, EDIT_MARK_LIMIT - marks.length));
    setMarks((list) => [...list, ...restored.map((mark, index) => ({ ...mark, id: nextMarkId(list) + index }))]);
    setAreaPose(lost.pose);
    setLost(null);
  }
  function resetEdits() {
    guard(() => {
      const held = markedPieces(marks).map((piece) => piece.element);
      if (held.length) edit.onSelection(edit.selection.filter((id) => !held.includes(id)));
      setMarks([]); setOpenMark(null); setGlobalEdit(null); setAreaPose(null); setLost(null); setEditError("");
    });
  }

  // Cost and reasons (DU-17: the cost of the AI call is seen before sending).
  const history = state.history, budget = history?.budget;
  const cost = budget ? formatUsd(budget.reserve_cents) : undefined;
  const aiReason = !scope ? noScope
    : history && !history.available ? "Para generar imágenes falta configurar Gemini en el servidor."
    : budgetExhausted(history) ? "Se agotó el presupuesto mensual de IA. No se pueden generar más opciones este mes."
    : !history ? (state.error || "Consultando el presupuesto de IA…") : undefined;
  const editKey = pieces.length ? pieceKey! : VIEW_KEY;
  const sendReason = !hasEditText(marks) ? "Escribe en alguna marca qué quieres cambiar"
    : pieces.length && tooLong ? "Reduce la selección: hay demasiadas piezas para una petición"
    : aiReason ?? (sending ? "Enviando la edición…" : undefined);
  const sendTitle = "Enviar edición" + (cost ? " · reserva " + cost : "");
  const applyReason = !isApplicable(globalEdit) ? "Elige una opción primero" : aiReason ?? (sending ? "Enviando la edición…" : undefined);
  // Short, like the reference's hint: the cost of sending and what remains of the monthly AI budget.
  const costLine = budget ? "Reserva " + formatUsd(budget.reserve_cents) + " · quedan " + formatUsd(budget.remaining_cents) : undefined;
  const pill: EditPill | null = editError && sending !== "global" && !(active && active !== "select") ? { text: editError, tone: "error" }
    : sending === "marks" ? { text: "Enviando la edición…", tone: "cost", busy: true }
    : marking && !marks.length ? { text: HINT, tone: "hint" }
    : hasEditText(marks) ? { text: (pieces.length && tooLong ? sendReason : aiReason) ?? costLine ?? "", tone: "cost" }
    : null;

  async function send(kind: "marks" | "global") {
    const port = viewer();
    if (!port || !base || sending) return;
    setSending(kind); setEditError("");
    try {
      if (kind === "marks") {
        const sent = marksToSend(marks);
        const frame = port.captureGroup(markedPieces(sent).map((piece) => piece.element), "jpeg", "current");
        if (frame.missing) { setEditError("Una pieza marcada no se ve en este encuadre. Gira la cámara hasta verla y vuelve a enviar."); return; }
        const mask = await maskWithAreas(frame.mask, frame.width, frame.height, areaMarks(sent).map((mark) => mark.area));
        await requestOptions(base, { id: crypto.randomUUID(), element: editKey, name: (pieces.length ? selectionName : VIEW_NAME).slice(0, 512),
          request: editRequestText(marks), jpeg: frame.image.split(",")[1], mask: mask.split(",")[1] });
        // The selection stays: its options are where the result appears.
        setMarks([]); setOpenMark(null); setAreaPose(null); setLost(null);
        // With pieces, their options are where the result appears; without them, the subject is already the view.
        if (pieces.length) setRenderScope("selection");
      } else {
        const frame = port.captureGroup([], "jpeg", "current");
        await requestOptions(base, { id: crypto.randomUUID(), element: VIEW_KEY, name: VIEW_NAME, request: globalEditText(globalEdit), jpeg: frame.image.split(",")[1] });
        setGlobalEdit(null); setActive("select");
        setRenderScope("view");
      }
      reload();
      setReveal(true);
      setTool("render");
    } catch (error) {
      setEditError(error instanceof Error && error.message ? error.message : "No se pudo enviar la edición.");
    } finally { setSending(null); }
  }

  const toggle = (next: Tool) => { setOpenMark(null); setTool((current) => (current === next ? null : next)); };
  /** Leaves Editar: the marks go (after asking, when notes were written) and the focus returns to EDITAR. */
  const leaveEdit = useCallback(() => {
    guard(() => { clearEdit(); edit.onExit(); editButton.current?.focus(); });
  }, [guard, clearEdit, edit]);
  function enterEdit() { setTool(null); clearEdit(); edit.onEnter(); }
  const toggleEdit = () => (edit.on ? leaveEdit() : enterEdit());
  function changeActive(next: EditActive) {
    setActive(next);
    if (next !== "select") setOpenMark(null);
    if (next && next !== "select") setEditError("");
  }
  // Escape: the open card and panels close first (they handle it), then the open field, then "Agrupar",
  // then Editar itself, with the focus back on EDITAR. The reference keeps Editar open on Escape.
  useEffect(() => {
    if (!edit.on) return;
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (event.target instanceof Element && event.target.closest(TYPING)) return;
      if (openMark !== null) { const id = openMark; setOpenMark(null); setMarkFocus({ id, target: "mark", at: Date.now() }); return; }
      if (edit.grouping) { edit.onUngroup(); return; }
      leaveEdit();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [edit, openMark, leaveEdit]);

  const capture = useCallback(() => viewer()?.capture() ?? "", [viewer]);
  const ids = pieces.map((piece) => piece.id);
  const untouched = isNeutral(adjust) && isFullFrame(framing);
  const startWalk = () => { setTool(null); guard(() => { clearEdit(); walk.onStart(); }); };
  // REVISAR keeps its own panel: the shortcut closes the other one first, as a click outside would.
  const clickReview = () => { setTool(null); bars.current?.querySelector<HTMLButtonElement>(".review-trigger")?.click(); };

  // Keyboard shortcuts run what the buttons run, and say why when a tool is off (DU-12, DU-16).
  const latest = useRef({ startWalk, toggle, toggleEdit, guard, clearEdit, clickReview, unavailable, optionReason, compareReason, editReason: edit.reason, walkReason: walk.reason, plan, editing: edit.on, onExit: edit.onExit });
  latest.current = { startWalk, toggle, toggleEdit, guard, clearEdit, clickReview, unavailable, optionReason, compareReason, editReason: edit.reason, walkReason: walk.reason, plan, editing: edit.on, onExit: edit.onExit };
  useImperativeHandle(control, () => ({
    run(name) {
      const now = latest.current;
      if (name === "review") { now.clickReview(); return undefined; }
      if (now.plan) return "No disponible en un plano 2D";
      if (name === "render") { if (now.unavailable) return now.unavailable; now.toggle("render"); return undefined; }
      if (name === "edit") { if (now.editReason && !now.editing) return now.editReason; now.toggleEdit(); return undefined; }
      if (name === "compare" || name === "download") {
        const reason = name === "compare" ? now.compareReason : now.optionReason;
        if (reason) return reason;
        now.toggle(name);
        return undefined;
      }
      if (now.walkReason) return now.walkReason;
      now.startWalk();
      return undefined;
    },
    release(then) {
      const now = latest.current;
      setTool(null);
      if (now.editing) now.guard(() => { now.clearEdit(); now.onExit(); then(); }); else then();
    },
  }), []);

  const port = viewer();
  return <>
    {edit.on && !plan && host && port && <EditMarksLayer viewer={port} host={host} marks={marks} marking={marking} open={openMark} focus={markFocus}
      areaPose={areaPose} sendReason={sendReason} sendTitle={sendTitle} sending={sending === "marks"} onOpen={setOpenMark} onPoint={addPoint} onArea={addArea}
      onText={(id, text) => setMarks((list) => setEditMarkText(list, id, text))} onRemove={removeMark} onMove={moveMark}
      onMiss={() => flash(MISS)} onCameraMoved={areasLost} onSend={() => void send("marks")} />}
    {notice && <p key={notice.at} className="workspace-toast edit-toast" role="status">{notice.text}</p>}
    {lost && <div key={lost.at} className="workspace-toast edit-toast" data-action="" role="status">
      <span>{lost.marks.length === 1 ? "Se quitó la zona marcada: solo valía para el encuadre anterior." : "Se quitaron las zonas marcadas: solo valían para el encuadre anterior."}</span>
      <button type="button" onClick={restoreAreas}>Deshacer</button>
    </div>}
    <div ref={bars} className="workspace-bars" data-editing={edit.on || undefined} data-compact={compact || undefined}>
      <span aria-hidden="true" />
      <RovingToolbar label="Acciones del modelo" className="tool-bar">
        {!plan && <>
          <ModeButton ref={renderButton} icon={Sparkles} label="Renderizar" aria-label="Renderizar opciones visuales" aria-haspopup="dialog" shortcut={TOOL_KEYS.render} busy={working}
            aria-expanded={tool === "render"} aria-controls="tool-render" disabledReason={unavailable} onClick={() => toggle("render")} />
          <ModeButton ref={editButton} icon={Pencil} label="Editar" data-prisma-tour="open" aria-pressed={edit.on}
            shortcut={TOOL_KEYS.edit} disabledReason={edit.on ? undefined : edit.reason} onClick={toggleEdit} />
        </>}
        {review}
        {!plan && <>
          <ModeButton icon={Footprints} label="Recorrido" className="walk-trigger" disabledReason={walk.reason}
            shortcut={TOOL_KEYS.walk} onClick={startWalk} />
          <ToolSeparator />
          <IconTool ref={compareButton} icon={PanelRightDashed} aria-label="Comparar" aria-haspopup="dialog" aria-expanded={tool === "compare"}
            aria-controls="tool-compare" disabledReason={compareReason} shortcut={TOOL_KEYS.compare} onClick={() => toggle("compare")} />
          <IconTool ref={downloadButton} icon={Download} aria-label="Descargar" aria-haspopup="dialog" aria-expanded={tool === "download"}
            aria-controls="tool-download" disabledReason={optionReason} shortcut={TOOL_KEYS.download} onClick={() => toggle("download")} />
        </>}
      </RovingToolbar>
      {camera}
    </div>
    {edit.on && !plan && <EditBar anchor={editButton} hidden={!!tool || reviewOpen} active={active} onActive={changeActive} marks={marks.length} edit={globalEdit} pill={pill}
      addReason={marks.length >= EDIT_MARK_LIMIT ? "Ya hay " + EDIT_MARK_LIMIT + " marcas: quita una para añadir otra" : undefined} onAddCenter={addCenter}
      resetReason={marks.length || globalEdit ? undefined : "No hay ediciones que restablecer"} onReset={resetEdits}
      cost={cost} applyReason={applyReason} applying={sending === "global"} error={sending ? undefined : editError || undefined}
      onChoose={(tool, field, value) => { setEditError(""); setGlobalEdit((current) => chooseGlobal(current, tool, field, value)); }}
      onPrompt={(text) => setGlobalEdit((current) => withPeoplePrompt(current, text))} onApply={() => void send("global")} selectButton={selectButton} />}
    <ToolPopover open={tool === "render"} anchor={renderButton} id="tool-render" label="Renderizar opciones visuales" title="Renderizar"
      closeLabel="Cerrar Renderizar" width={340} keepMounted bare onClose={() => setTool(null)}>
      {base && key && !unavailable && <VisualOptions key={key} base={base} optionKey={key} name={name} state={state} open={tool === "render"} group={edit.on && !viewScope}
        choices={choices} onChoices={setChoices}
        capture={viewScope ? () => viewer()!.captureGroup([], "jpeg", "current").image : capture}
        groupCapture={edit.on && !viewScope ? () => viewer()!.captureGroup(ids) : undefined}
        scope={pieces.length ? { value: viewScope ? "view" : "selection", selection: pieces.length === 1 ? selectionName : pieces.length + " piezas", onChange: setRenderScope } : undefined}
        reveal={reveal} onRevealed={revealed}
        onCompare={(next) => { setWanted(next); setTool("compare"); }} onDownload={(next) => { setWanted(next); setTool("download"); }} />}
    </ToolPopover>
    {proposal ? <ToolPopover open={tool === "compare"} anchor={compareButton} id="tool-compare" label="Comparar con la base" title="Comparar con la base"
      closeLabel="Cerrar comparación" width={384} keepMounted onClose={() => setTool(null)}>
      {proposal.compare}
    </ToolPopover>
    : <ToolPopover open={tool === "compare"} anchor={compareButton} id="tool-compare" label="Comparar" title="Comparar con el modelo"
      closeLabel="Cerrar comparación" width={384} onClose={() => setTool(null)}>
      {base && batch && target && <OptionCompare base={base} batch={batch} slot={target.slot} onSlot={(slot) => setWanted({ batch: batch.id, slot })} />}
    </ToolPopover>}
    <ToolPopover open={tool === "download"} anchor={downloadButton} id="tool-download" label="Descargar" title="Ajustar detalles"
      closeLabel="Cerrar descarga" width={320} onClose={() => setTool(null)}
      actions={<button type="button" className="tool-popover-reset" disabled={untouched} onClick={() => { setAdjust(NEUTRAL); setFraming(FULL_FRAME); }}>
        <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />Restablecer</button>}>
      {base && batch && target && <OptionDownloadPanel base={base} batch={batch} slot={target.slot} onSlot={(slot) => setWanted({ batch: batch.id, slot })}
        element={viewScope ? "vista" : name || "pieza"} value={adjust} framing={framing} onValue={setAdjust} onFraming={setFraming} />}
    </ToolPopover>
    <dialog ref={confirm} className="scene-confirm" aria-labelledby="edit-confirm-title" onClose={() => { afterConfirm.current = null; }}>
      <h2 id="edit-confirm-title">¿Descartar las marcas?</h2>
      <p>Las notas que escribiste en las marcas se perderán.</p>
      <div className="scene-confirm-actions">
        <button type="button" autoFocus onClick={() => confirm.current?.close()}>Seguir editando</button>
        <button type="button" className="scene-confirm-danger" onClick={() => {
          const action = afterConfirm.current;
          afterConfirm.current = null;
          confirm.current?.close();
          action?.();
        }}>Descartar</button>
      </div>
    </dialog>
  </>;
}
