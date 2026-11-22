"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Coins, Download, Eye, EyeOff, PanelRightDashed, Ruler, Sparkles, Trees } from "lucide-react";
import { BusyButton, LoaderArt, LoadingStatus, Skeleton, Spinner } from "@/shared/ui/loading";
import type { GroupCapture } from "@/viewer/domain/viewer.port";
import { ChipChoice, ChipToggles } from "./option-chips";
import { usePrivateImage, type OptionHistoryState } from "./use-option-history";
import { DAYLIGHTS, DEFAULT_CHOICES, FINISHES, KEEPS, REQUEST_LIMIT, TONES, asksForChange, composeRequest, formatUsd, type OptionChoices } from "../domain/option-request";
import { budgetExhausted, isWorking, type OptionTarget } from "../domain/option-history";
import { chooseOption, optionImagePath, requestOptions } from "../infrastructure/option-http";

/** What Renderizar asks about when there is a selection: the selected pieces or the whole framing (DU-16). */
export type RenderScope = "selection" | "view";

function PrivateImage({ path, label }: { path: string; label: string }) {
  const { url, error } = usePrivateImage(path);
  return url ? <img src={url} alt={label} /> : error ? <span className="option-thumb-wait">Sin imagen</span>
    : <><Skeleton className="image-skeleton" /><span className="visually-hidden">Cargando {label.charAt(0).toLowerCase() + label.slice(1)}…</span></>;
}

/** The original capture of a batch is only downloaded when its disclosure is opened. */
function OriginalCapture({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  return <details className="option-original" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Ver captura original</summary>{open && <PrivateImage path={path} label="Captura usada para esta terna" />}
  </details>;
}

/**
 * Content of the Renderizar panel (the reference's render panel): closed choices, the written
 * change, the request exactly as it will be sent, the main button with its cost and the batches
 * already generated for this subject — a piece, a selection or the whole framing. The request is
 * the same API call as before (D-14). The edits sent from Editar land in the same batches.
 */
export function VisualOptions({ base, optionKey, name, state, open, group, choices, onChoices, capture, groupCapture, scope, reveal, onRevealed, onCompare, onDownload }: {
  base: string; optionKey: string; name: string; state: OptionHistoryState; open: boolean; group: boolean;
  choices: OptionChoices; onChoices: (choices: OptionChoices) => void;
  capture: () => string; groupCapture?: () => GroupCapture;
  /** With a selection, a switch between the selection and the whole framing. */
  scope?: { value: RenderScope; selection: string; onChange: (scope: RenderScope) => void };
  /** An edit was just sent from Editar: the batches scroll into view once, where its result will appear. */
  reveal?: boolean; onRevealed?: () => void;
  onCompare: (target: OptionTarget) => void; onDownload: (target: OptionTarget) => void;
}) {
  const field = useId(), listId = useId(), previewId = useId();
  const [peek, setPeek] = useState(false);
  const batches = useRef<HTMLElement>(null);
  const batchCount = state.history?.batches.length ?? 0;
  // The batches fold into one line (the reference's panel has none); «Ver» unfolds them in place.
  const [showBatches, setShowBatches] = useState(false);
  useEffect(() => { if (reveal) setShowBatches(true); }, [reveal]);
  useEffect(() => {
    if (!reveal || !open || !batches.current) return;
    batches.current.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    onRevealed?.();
  }, [reveal, open, batchCount, showBatches, onRevealed]);
  const [request, setRequest] = useState(""), [message, notify] = useState("");
  const [busy, setBusy] = useState(false);
  // Only the request itself turns the main button into its processing state.
  const [sending, setSending] = useState(false);
  const retryId = useRef<string | null>(null);
  const { history, reload } = state;
  // The chips only compose the text that was already being sent as the request.
  const composed = composeRequest(choices, request);
  const exhausted = budgetExhausted(history);
  function choose(next: Partial<OptionChoices>) { onChoices({ ...choices, ...next }); retryId.current = null; }
  async function submit() {
    setBusy(true); setSending(true); notify("");
    try {
      const frame = groupCapture ? groupCapture() : undefined;
      if (frame?.missing) { notify("Hay piezas ocultas o fuera del encuadre. Gira la cámara o encuadra la selección antes de enviar."); return; }
      const jpeg = frame ? frame.image : capture();
      retryId.current ??= crypto.randomUUID();
      await requestOptions(base, { id: retryId.current, element: optionKey, name: name.slice(0, 512), request: composed, jpeg: jpeg.split(",")[1], mask: frame?.mask.split(",")[1] });
      retryId.current = null; setRequest(""); onChoices(DEFAULT_CHOICES); reload();
      notify("Petición enviada. Las opciones aparecerán en Tandas.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo iniciar la generación."); }
    finally { setBusy(false); setSending(false); }
  }
  async function select(id: string, slot: number) {
    setBusy(true);
    try { await chooseOption(base, id, slot); reload(); notify("Elección guardada."); }
    catch (error) { notify(error instanceof Error ? error.message : "No se pudo guardar la elección."); }
    finally { setBusy(false); }
  }
  const working = busy || isWorking(history);
  const cost = history?.budget ? formatUsd(history.budget.reserve_cents) : null;
  const budgetLine = history?.budget ? "Cada envío reserva " + formatUsd(history.budget.reserve_cents) + " del presupuesto mensual de IA. Quedan " + formatUsd(history.budget.remaining_cents) + "." : undefined;
  const ready = history?.batches.filter((batch) => batch.state === "READY") ?? [];
  const failed = history?.batches.filter((batch) => batch.state === "FAILED").length ?? 0;
  const latestReady = ready[0];
  const batchLine = [isWorking(history) ? "Preparando opciones…" : "",
    ready.length ? ready.length + (ready.length === 1 ? " tanda lista" : " tandas listas") : "",
    failed ? failed + (failed === 1 ? " incompleta" : " incompletas") : ""].filter(Boolean).join(" · ") || "Sin tandas listas";
  return <><div className="tool-popover-body visual-options" data-working={working}>
    {scope && <div role="radiogroup" aria-label="Sobre qué pedir opciones" className="chips options-scope" data-columns={2}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const group = event.currentTarget;
        scope.onChange(scope.value === "view" ? "selection" : "view");
        requestAnimationFrame(() => group.querySelector<HTMLElement>("[aria-checked=true]")?.focus());
      }}>
      {([["selection", scope.selection], ["view", "Vista completa"]] as const).map(([value, label]) =>
        <button key={value} type="button" role="radio" aria-checked={scope.value === value} className="chip" title={label}
          tabIndex={scope.value === value ? 0 : -1} onClick={() => scope.onChange(value)}><span>{label}</span></button>)}
    </div>}
    {group && <p className="options-note">Al enviar se comparte con Gemini el encuadre actual y la máscara de las piezas seleccionadas.</p>}
    <fieldset className="option-request" disabled={busy}><legend className="visually-hidden">Qué quieres probar</legend>
      <ChipChoice legend="Acabado o material" items={FINISHES} value={choices.finish} onChange={(finish) => choose({ finish })} columns={3} />
      <ChipChoice legend="Tono" items={TONES} value={choices.tone} onChange={(tone) => choose({ tone })} columns={3} />
      <ChipChoice legend="Luz del día" items={DAYLIGHTS} value={choices.daylight} onChange={(daylight) => choose({ daylight })} columns={3} />
    </fieldset>
    <div className="request-field">
      <div className="request-label-row">
        <label className="section-label" htmlFor={field}>Cambio solicitado</label>
        <span className="request-count" aria-hidden="true">{request.length} / {REQUEST_LIMIT}</span>
        {/* The reference keeps a 24 px icon button in this row; here it shows the request as it will be sent. */}
        <button type="button" className="request-peek" aria-expanded={peek} aria-controls={previewId}
          aria-label="Ver la petición que se enviará" title="Ver la petición que se enviará" onClick={() => setPeek(!peek)}>
          {peek ? <EyeOff size={14} strokeWidth={2} aria-hidden="true" /> : <Eye size={14} strokeWidth={2} aria-hidden="true" />}</button>
      </div>
      <div className="request-box">
        <textarea id={field} maxLength={REQUEST_LIMIT} value={request} disabled={busy} placeholder="Opcional si eliges fichas. Por ejemplo: carpintería en madera clara."
          onChange={(event) => { setRequest(event.target.value); retryId.current = null; }} />
        <p id={previewId} className="request-preview" data-empty={!composed || undefined} hidden={!peek}><span data-request-preview="">{composed || "Elige al menos una ficha o escribe el cambio."}</span></p>
        {/* Footer of the box, like the reference's presets row: what the image must keep, as small chips. */}
        <div className="request-box-foot">
          <ChipToggles legend="Qué conservar" items={KEEPS} value={choices.keep} onChange={(keep) => choose({ keep })} disabled={busy} inline icons={{ shape: Ruler, surroundings: Trees }} />
        </div>
      </div>
    </div>
    {history && !history.available && <p className="options-note">Para generar imágenes falta configurar Gemini en el servidor.</p>}
    {exhausted && <p role="alert" className="options-alert">Se agotó el presupuesto mensual de IA. No se pueden generar más opciones este mes.</p>}
    <p role="status" className="options-status">{message || state.error}</p>
    {(message || state.error) && <button type="button" className="text-button" onClick={reload}>Actualizar historial</button>}
    {!!history?.batches.length && <section ref={batches} id={listId} className="option-batches" aria-label="Tandas generadas" hidden={!showBatches}>
      <h3 className="section-label">Tandas</h3>
      {history.batches.map((batch) => <article key={batch.id} className="option-batch">
        <p className="option-batch-request" title={batch.request}>{batch.request}</p>
        {batch.state === "FAILED" ? <p className="options-note">La generación quedó incompleta. {batch.runs.some((run) => run.error_code === "HTTP_429") ? "Gemini alcanzó un límite de solicitudes o de cuota. Revisa la cuota del modelo antes de volver a enviar la captura." : "Consulta el detalle en Consumo de la generación."}</p>
          : batch.state !== "READY" && <div className="options-waiting">
            <LoaderArt name="options" size={64} maxLoopMs={5000} className="loader-art-small" />
            <div><LoadingStatus className="options-working">Preparando las opciones…</LoadingStatus>
              <p className="options-note">Las tres opciones aparecerán aquí. Puedes seguir trabajando en el modelo.</p></div>
          </div>}
        {batch.state === "FAILED" && !!batch.drafts?.length && <section aria-label="Alternativas de texto"><h4 className="section-label">Propuestas de Gemini</h4><ol>{batch.drafts.map((draft) => <li key={draft}>{draft}</li>)}</ol></section>}
        <ul className="option-list">{batch.options.map((option) => {
          const chosen = batch.selected === option.slot, ready = batch.state === "READY";
          return <li key={option.slot} className="option-row" data-chosen={chosen || undefined}>
            <figure className="option-thumb">{open && <PrivateImage path={optionImagePath(base, batch.id, option.slot)} label={"Opción " + option.slot} />}</figure>
            <div className="option-text">
              <small>Opción {option.slot} · Generado con IA</small>
              <p title={option.description}>{option.description}</p>
              <div className="option-actions">
                <button type="button" className="option-choose" aria-label={chosen ? "Elegida" : "Elegir opción " + option.slot} disabled={busy || !ready || chosen}
                  onClick={() => select(batch.id, option.slot)}>{chosen && <Check size={12} strokeWidth={2.5} aria-hidden="true" />}{chosen ? "Elegida" : "Elegir"}</button>
                <button type="button" className="option-icon compare-open" aria-label={"Comparar opción " + option.slot} title="Comparar con la vista del modelo" aria-haspopup="dialog"
                  disabled={!ready} onClick={() => onCompare({ batch: batch.id, slot: option.slot })}><PanelRightDashed size={14} strokeWidth={2} aria-hidden="true" /></button>
                <button type="button" className="option-icon" aria-label={"Descargar opción " + option.slot} title="Ajustar y descargar" aria-haspopup="dialog"
                  disabled={!ready} onClick={() => onDownload({ batch: batch.id, slot: option.slot })}><Download size={14} strokeWidth={2} aria-hidden="true" /></button>
              </div>
            </div>
          </li>;
        })}</ul>
        {open && <OriginalCapture path={optionImagePath(base, batch.id, 0)} />}
        <details className="option-runs"><summary>Consumo de la generación</summary>{batch.runs.map((run, index) => <p key={index}>{run.model_id} · {run.status} · {run.total_tokens === null ? "Consumo sin confirmar" : run.total_tokens + " tokens"} {run.error_code}</p>)}</details>
      </article>)}
    </section>}
  </div>
  <div className="tool-popover-foot">
    {!!history?.batches.length && <div className="options-batches-line">
      <span>{isWorking(history) && <Spinner size={12} />}{batchLine}</span>
      {latestReady && <button type="button" className="text-button" aria-haspopup="dialog"
        onClick={() => onCompare({ batch: latestReady.id, slot: latestReady.selected ?? latestReady.options[0]?.slot ?? 1 })}>Comparar</button>}
      <button type="button" className="text-button" aria-expanded={showBatches} aria-controls={listId} onClick={() => setShowBatches(!showBatches)}>{showBatches ? "Ocultar" : "Ver"}</button>
    </div>}
    <BusyButton type="button" className="main-button" aria-label="Renderizar: enviar captura y generar tres opciones" busy={sending} busyLabel="Enviando la captura…"
      icon={<Sparkles size={16} strokeWidth={2} aria-hidden="true" />} title={budgetLine}
      disabled={busy || !history?.available || !asksForChange(choices, request) || exhausted} onClick={submit}>
      Renderizar
      {cost && <span className="main-cost"><Coins size={12} strokeWidth={2} aria-hidden="true" />{cost}</span>}
    </BusyButton>
    {/* The reservation and what is left this month stay in sight before sending, not only in a tooltip. */}
    {budgetLine && <p className="budget-note">{budgetLine}</p>}
  </div></>;
}
