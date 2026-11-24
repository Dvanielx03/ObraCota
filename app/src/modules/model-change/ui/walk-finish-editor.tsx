"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, X } from "lucide-react";
import { finishMaterial } from "@/modules/design-option/domain/finish-material";
import { FINISHES, TONES, type Finish, type Tone } from "@/modules/design-option/domain/option-request";
import { sha256Hex } from "@/modules/model-version/application/download-original";
import { versionRepository } from "@/modules/model-version/infrastructure/version-http";
import type { ElementInfo, ViewerPort } from "@/viewer/domain/viewer.port";
import { reportFindings, shortGuid, type ModelChange } from "../domain/model-change";
import { modelChangeRepository as changes } from "../infrastructure/model-change-http";

const EDITABLE = new Set(["IFCCOVERING", "IFCFURNISHINGELEMENT", "IFCFURNITURE", "IFCSYSTEMFURNITUREELEMENT"]);
const DIFFERENT_SCOPE = new Set(["MATERIAL_EXTERIOR_LAYER", "MATERIAL_FINISH_ADDED", "STYLE_SHARED_KEPT"]);

export function WalkFinishEditor({ viewer, project, version, base, onApplying, onClose, onApplied }: {
  viewer: ViewerPort;
  project: string;
  version: string;
  base: File;
  onApplying(value: boolean): void;
  onClose(): void;
  onApplied(version: string, file: File): void;
}) {
  const [piece, setPiece] = useState<ElementInfo | null>(null);
  const [material, setMaterial] = useState<Finish | "">("");
  const [tone, setTone] = useState<Tone>("medium");
  const [change, setChange] = useState<ModelChange | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [showing, setShowing] = useState(false);
  const [issue, setIssue] = useState("");
  const [refused, setRefused] = useState(false);
  const [working, setWorking] = useState("");
  const job = useRef<AbortController | null>(null);
  const aim = useRef<HTMLButtonElement>(null);
  const editable = !!piece?.guid && EDITABLE.has(piece.type.toUpperCase());
  const finish = material ? finishMaterial(material, tone) : null;
  const changeHref = change ? `/proyectos/${project}/cambios#${change.id}` : null;

  useEffect(() => {
    aim.current?.focus({ preventScroll: true });
    return () => job.current?.abort();
  }, []);

  function pick() {
    const target = viewer.walkTarget();
    const allowed = !!target?.guid && EDITABLE.has(target.type.toUpperCase());
    setPiece(target);
    viewer.walkHighlight(allowed ? target.id : null);
    setMaterial("");
    setIssue(!target ? "No hay una pieza en la mira. Ajusta la vista y vuelve a seleccionar."
      : !allowed ? "Desde aquí puedes cambiar el acabado de revestimientos y muebles con GlobalId." : "");
  }

  async function run(label: string, work: (signal: AbortSignal) => Promise<void>, publishing = false) {
    if (job.current) return;
    const operation = new AbortController();
    job.current = operation;
    if (publishing) onApplying(true);
    setIssue("");
    setWorking(label);
    try {
      await work(operation.signal);
    } catch (error) {
      if (!operation.signal.aborted) setIssue(error instanceof Error ? error.message : "No se pudo completar el cambio.");
    } finally {
      job.current = null;
      if (!operation.signal.aborted) {
        if (publishing) onApplying(false);
        setWorking("");
      }
    }
  }

  async function prepare(signal: AbortSignal) {
    if (!piece?.guid || !editable || !finish) return;
    const element = piece.guid;
    let draft = change ? await changes.get(project, change.id, signal)
      : await changes.create(project, version, `Acabado «${finish.material}» en ${piece.name}, elegido en Recorrido.`);
    signal.throwIfAborted();
    setChange(draft);
    if (draft.status !== "DRAFT" && draft.status !== "READY") throw new Error("El cambio ya se gestionó desde su tarjeta.");
    if (!draft.recipe.operations.length) {
      draft = await changes.addOperation(project, draft.id, { op: "ifc.set_material", element, elements: [element], ...finish });
      setChange(draft);
    }
    signal.throwIfAborted();
    if (!draft.preview.available || !draft.reportCurrent) {
      draft = await changes.preview(project, draft.id);
      setChange(draft);
    }
    signal.throwIfAborted();
    if (!draft.report?.ok) {
      const detail = draft.report?.operations.flatMap(operation => operation.errors).find(error => error.detail)?.detail
        ?? draft.report?.errors?.find(error => error.detail)?.detail;
      throw new Error(detail || "El IFC no superó la verificación. Revisa el detalle en la tarjeta del cambio.");
    }
    if (reportFindings(draft.report).some(finding => DIFFERENT_SCOPE.has(finding.rule))) {
      // A walk finish covers the whole selected piece. The exterior operation also supports layer sets and shared styles.
      await changes.discard(project, draft.id, "El acabado en Recorrido requiere una superficie independiente, sin capas ni estilos compartidos.");
      setRefused(true);
      throw new Error("La pieza tiene capas o estilos compartidos. Elige un revestimiento o mueble con acabado independiente.");
    }
    if (!draft.preview.sha256) throw new Error("La vista previa no tiene una huella de verificación.");
    const file = await changes.openPreview(project, draft, signal);
    if (await sha256Hex(await file.arrayBuffer()) !== draft.preview.sha256.toLowerCase())
      throw new Error("El IFC descargado difiere de la vista previa verificada.");
    await viewer.switchWalk(file, signal, setWorking);
    setPreview(file);
    setShowing(true);
    if (draft.actions.submit) {
      draft = await changes.submit(project, draft.id);
      setChange(draft);
    }
  }

  async function apply(signal: AbortSignal) {
    if (!change || !preview) return;
    // Fetch the status first so a lost response or a refresh in another tab does not publish twice.
    let result = await changes.get(project, change.id, signal);
    if (result.status === "READY") {
      if (result.preview.sha256 !== change.preview.sha256)
        throw new Error("La vista previa cambió. Revísala en la tarjeta antes de aprobar.");
      result = await changes.apply(project, change.id);
    }
    if (!result.appliedVersion || result.status !== "APPLIED") throw new Error("El cambio todavía no se ha aplicado.");
    const published = await versionRepository.get(project, result.appliedVersion, signal);
    if (published.sha256.toLowerCase() !== change.preview.sha256?.toLowerCase())
      throw new Error("La versión guardada difiere de la vista verificada. Ábrela desde la tarjeta del cambio.");
    await viewer.switchWalk(preview, signal, setWorking);
    onApplied(published.id, preview);
  }

  async function close(signal: AbortSignal) {
    if (showing) await viewer.switchWalk(base, signal, setWorking);
    viewer.walkHighlight(null);
    onClose();
  }

  async function discard(signal: AbortSignal) {
    if (!change) return;
    if (showing) await viewer.switchWalk(base, signal, setWorking);
    setShowing(false);
    if (!refused) await changes.discard(project, change.id);
    setChange(null);
    setPreview(null);
    setRefused(false);
    setPiece(null);
    setMaterial("");
    viewer.walkHighlight(null);
    aim.current?.focus({ preventScroll: true });
  }

  return <>
    {!preview && <Crosshair size={24} aria-hidden="true" className="walk-crosshair"/>}
    <aside className="walk-edit" aria-label="Editar acabado en recorrido" aria-busy={!!working}>
      <div className="walk-edit-heading">
        <h2>Acabado de pieza</h2>
        <button type="button" className="walk-edit-icon" aria-label="Cerrar edición de acabado" disabled={!!working}
          onClick={() => void run("Volviendo al modelo…", close)}><X size={18} aria-hidden="true"/></button>
      </div>
      {!change && <>
        <p>Apunta la mira a un revestimiento o mueble.</p>
        <button ref={aim} type="button" className="walk-edit-secondary" onClick={pick}>Seleccionar en la mira</button>
      </>}
      {piece && <div className="walk-edit-piece">
        <strong>{piece.name}</strong>
        <span>{piece.type}{piece.guid && <> · <code title={piece.guid}>{shortGuid(piece.guid)}</code></>}</span>
      </div>}
      {editable && !preview && !refused && <div className="walk-edit-fields">
        <label>Material<select value={material} disabled={!!change || !!working} onChange={event => {
          const next = event.target.value as Finish | "";
          setMaterial(next);
          viewer.walkHighlight(piece.id, next ? finishMaterial(next, tone).color : undefined);
        }}><option value="">Elige un material</option>{FINISHES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Tono<select value={tone} disabled={!!change || !!working} onChange={event => {
          const next = event.target.value as Tone;
          setTone(next);
          if (material) viewer.walkHighlight(piece.id, finishMaterial(material, next).color);
        }}>{TONES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>}
      {finish && !preview && !refused && <p>Color de referencia. Verifica el IFC antes de aplicar.</p>}
      {preview && !refused && <>
        <p><strong>{finish?.material}</strong> · IFC verificado</p>
        <div className="walk-edit-compare" role="group" aria-label="Comparar acabado">
          {[false, true].map(proposal => <button key={String(proposal)} type="button" className="walk-edit-secondary"
            aria-pressed={showing === proposal} disabled={!!working} onClick={() => {
              if (showing !== proposal) void run("Abriendo el IFC…", async signal => {
                await viewer.switchWalk(proposal ? preview : base, signal, setWorking);
                setShowing(proposal);
              });
            }}>{proposal ? "Propuesta" : "Base"}</button>)}
        </div>
        <p>{change?.report?.estimate?.complete ? "Consulta el presupuesto del cambio en su tarjeta." : "Sin estimación completa para este acabado."}</p>
      </>}
      {issue && <p className="walk-edit-error" role="alert">{issue}</p>}
      {working && <p role="status">{working}</p>}
      <footer>
        {editable && !refused && change?.status !== "READY" && <button type="button" className="panel-action"
          disabled={!finish || !!working} onClick={() => void run("Verificando el cambio en el IFC…", prepare)}>Verificar propuesta</button>}
        {preview && change?.status === "READY" && <button type="button" className="panel-action" disabled={!!working || !change.actions.apply}
          title={change.actions.reasons.apply} onClick={() => void run("Guardando la nueva versión…", apply, true)}>Aprobar y aplicar</button>}
        {change && <button type="button" className="walk-edit-secondary" disabled={!!working}
          onClick={() => void run("Cerrando el borrador…", discard)}>{refused ? "Elegir otra pieza" : "Descartar cambio"}</button>}
        {changeHref && <a href={changeHref} target="_blank" rel="noreferrer">Ver ficha del cambio</a>}
      </footer>
    </aside>
  </>;
}
