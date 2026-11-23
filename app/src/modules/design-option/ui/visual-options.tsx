"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, Check, Coins, Download, Eye, EyeOff, Footprints, PanelRightDashed, RotateCcw, Ruler, Save, Sparkles, Trees } from "lucide-react";
import { BusyButton, LoaderArt, LoadingStatus, Skeleton, Spinner } from "@/shared/ui/loading";
import type { ExteriorPreview, GroupCapture } from "@/viewer/domain/viewer.port";
import { ChipChoice, ChipToggles } from "./option-chips";
import { usePrivateImage, type OptionHistoryState } from "./use-option-history";
import { archiveEditFiles, recoverEditFiles } from "./external-edit-files";
import { DAYLIGHTS, DEFAULT_CHOICES, FINISHES, KEEPS, REQUEST_LIMIT, TONES, asksForChange, composeRequest, formatUsd, type OptionChoices } from "../domain/option-request";
import { budgetExhausted, isWorking, optionFailure, type OptionBatch, type OptionTarget } from "../domain/option-history";
import { chooseOption, optionImage, optionImagePath, requestOptions } from "../infrastructure/option-http";

/** What Renderizar asks about when there is a selection: the selected pieces or the whole framing (DU-16). */
export type RenderScope = "selection" | "view";

function PrivateImage({ path, label }: { path: string; label: string }) {
  const { url, error } = usePrivateImage(path);
  return url ? <img src={url} alt={label} /> : error ? <span className="option-thumb-wait">Sin imagen</span>
    : <><Skeleton className="image-skeleton" /><span className="visually-hidden">Cargando {label.charAt(0).toLowerCase() + label.slice(1)}…</span></>;
}

/** What «Guardar en el modelo» needs: why it is off, and the action, which answers where the change card is. */
export interface SaveFinish { reason?: string; run: () => Promise<{ href: string; ready: boolean; material: string }> }

/**
 * «Guardar en el modelo» (H2 material): turns the finish previewed on the exterior into a real model change. The engine
 * previews it, and the owner reviews it in 3D and approves it on its card; the file only changes once she approves.
 */
function SaveFinishButton({ save }: { save: SaveFinish }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [href, setHref] = useState("");
  async function run() {
    setBusy(true); setMessage(""); setHref("");
    try {
      const result = await save.run();
      setHref(result.href);
      setMessage(result.ready ? "Cambio «" + result.material + "» creado y verificado. Abriendo su tarjeta para revisarlo en 3D y aprobarlo…"
        : "El cambio quedó en borrador: el motor encontró algo que revisar. Abriendo su tarjeta…");
      router.push(result.href);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo crear el cambio."); }
    finally { setBusy(false); }
  }
  return <div className="exterior-save">
    <BusyButton type="button" className="text-button exterior-save-button" busy={busy} spinnerSize={12} busyLabel="Verificando en el motor IFC…"
      icon={<Save size={12} strokeWidth={2} aria-hidden="true" />} disabled={busy || !!save.reason} title={save.reason ?? "Crea un cambio de modelo con este material en las piezas exteriores; la propietaria lo aprueba"}
      onClick={() => void run()}>Guardar en el modelo</BusyButton>
    {save.reason && <small className="exterior-save-reason">{save.reason}</small>}
    {message && <p className="options-note" role="status">{message}{href && <> <Link href={href}>Ver el cambio</Link></>}</p>}
  </div>;
}

/** The original capture of a batch is only downloaded when its disclosure is opened. */
function OriginalCapture({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  return <details className="option-original" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Ver captura original</summary>{open && <PrivateImage path={path} label="Captura usada para esta terna" />}
  </details>;
}

function RecoverEdit({base,batch}:{base:string;batch:OptionBatch}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function download(){
    setBusy(true);setError("");
    try{
      const [view,mask]=await Promise.all([optionImage(optionImagePath(base,batch.id,0)),optionImage(`${base}/${batch.id}/mask`)]);
      const zip=archiveEditFiles(await recoverEditFiles(view,mask,batch.request));
      const url=URL.createObjectURL(zip);
      const link=document.createElement("a");
      link.href=url;link.download="ObraCota-edicion-Gemini.zip";link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{setError("No se pudo recuperar el paquete. Intenta descargarlo de nuevo.");}
    finally{setBusy(false);}
  }
  return <><BusyButton type="button" className="text-button" busy={busy} busyLabel="Preparando el ZIP…" onClick={()=>void download()}>
    Descargar paquete para Gemini</BusyButton>{error && <p role="alert" className="options-note">{error}</p>}</>;
}

/**
 * Content of the Renderizar panel (the reference's render panel): closed choices, the written
 * change, the request exactly as it will be sent, the main button with its cost and the batches
 * already generated for this subject — a piece, a selection or the whole framing. The request is
 * the same API call as before (D-14). The edits sent from Editar land in the same batches.
 */
export function VisualOptions({ base, optionKey, name, state, open, group, choices, onChoices, preview, capture, groupCapture, scope, reveal, onRevealed, onCompare, onDownload, onWalkScene }: {
  base: string; optionKey: string; name: string; state: OptionHistoryState; open: boolean; group: boolean;
  choices: OptionChoices; onChoices: (choices: OptionChoices) => void;
  /** The chips previewed on the exterior of the 3D model (local, nothing is sent); absent on 2D plans. */
  preview?: { on: boolean; result: ExteriorPreview | null; onToggle: () => void; onReset: () => void; save?: SaveFinish };
  capture: () => string; groupCapture?: () => GroupCapture;
  /** With a selection, a switch between the selection and the whole framing. */
  scope?: { value: RenderScope; selection: string; onChange: (scope: RenderScope) => void };
  /** An edit was just sent from Editar: the batches scroll into view once, where its result will appear. */
  reveal?: boolean; onRevealed?: () => void;
  onCompare: (target: OptionTarget) => void; onDownload: (target: OptionTarget) => void;
  /** «Recorrer esta escena en 3D»: builds the scene the batch asked for around the model (real geometry, no AI). */
  onWalkScene?: (request: string) => void;
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
    {preview && <div className="exterior-preview" role="group" aria-label="Vista previa en el modelo 3D">
      <button type="button" className="chip exterior-toggle" aria-pressed={preview.on} onClick={preview.onToggle}
        title="Aplica las fichas al exterior del modelo en este visor, sin cambiar el archivo">
        <Box size={16} strokeWidth={2} aria-hidden="true" />Ver en el modelo 3D</button>
      <p className="options-note" role="status">{!preview.on ? "Las fichas solo se usan para la imagen de IA."
        : !preview.result ? "Elige una ficha para verla en el exterior del modelo. Es una vista previa local: el archivo no cambia."
        : !choices.finish && !preview.result.pieces ? "Luz aplicada al modelo. Elige un acabado para el exterior."
        : preview.result.source === "sample" ? "Acabado en la fachada y la cubierta del ejemplo. El archivo no cambia."
        : preview.result.pieces ? "Acabado en " + preview.result.pieces + (preview.result.pieces === 1 ? " pieza exterior" : " piezas exteriores")
          + (preview.result.source === "pset" ? " (marcadas como exteriores en el IFC)." : " (detectadas por el contorno del modelo).") + " El archivo no cambia."
        : "No se encontraron muros o cubiertas exteriores en este modelo."}</p>
      {preview.result && <div className="exterior-actions"><button type="button" className="text-button exterior-reset" onClick={preview.onReset}>
        <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />Restablecer materiales</button>
        {preview.save && preview.on && <SaveFinishButton save={preview.save} />}</div>}
    </div>}
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
        {batch.state === "FAILED" ? <><p className="options-note">{optionFailure(batch)}</p>{batch.hasMask && open && <RecoverEdit base={base} batch={batch}/>}</>
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
              {onWalkScene && <button type="button" className="option-walk" aria-label={"Recorrer esta escena en 3D · opción " + option.slot}
                title="Previsualizar el entorno alrededor del modelo sin consumir IA"
                disabled={!ready} onClick={() => onWalkScene(batch.request + " " + option.description)}>
                <Footprints size={14} strokeWidth={2} aria-hidden="true" />Recorrer esta escena en 3D
              </button>}
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
