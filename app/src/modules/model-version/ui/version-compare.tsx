"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GitCompareArrows } from "lucide-react";
import type { ModelInfo, ViewerPort } from "@/viewer/domain/viewer.port";
import { ToolPopover } from "@/modules/model-file/ui/tool-popover";
import { ChangeCompare } from "@/modules/model-change/ui/change-compare";
import { BusyButton } from "@/shared/ui/loading";
import { revisionLabel, type ModelVersion } from "../domain/model-version";
import { compareRevisions, defaultOther, type RevisionComparison } from "../application/compare-revisions";
import { versionRepository } from "../infrastructure/version-http";

/**
 * «Comparar versiones» of the version rail (H7): the open revision against another one of the same file. IFC uses the
 * server's diff (IfcDiff by GlobalId) and DWG compares texts and dimensions by handle; both list the differences, locate
 * each one and highlight them in the model. FBX and OBJ say why they cannot be compared.
 */
export function VersionCompare({ project, version, versions, model, viewer, selected, locate }: {
  project: string; version: string; versions: readonly ModelVersion[]; model: ModelInfo;
  viewer: () => ViewerPort | null; selected: string | null; locate: (id: string) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  // The rail's blur would become the containing block of the fixed panel: it is portalled to the stage.
  useLayoutEffect(() => { setHost(anchor.current?.closest<HTMLElement>(".stage") ?? null); }, []);
  const current = versions.find((item) => item.id === version);
  const others = versions.filter((item) => item.id !== version);
  const [other, setOther] = useState(() => defaultOther(versions, version)?.id ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<RevisionComparison | null>(null);
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => job.current?.abort(), []);
  const reason = !current ? "Cargando las versiones…"
    : current.format === "FBX" || current.format === "OBJ" ? "Comparar versiones funciona con IFC (por GlobalId) y DWG (por identificador CAD)" : undefined;
  async function compare() {
    const target = versions.find((item) => item.id === other);
    if (!current || !target || reason) return;
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setBusy(true); setError(""); setResult(null);
    try {
      const next = await compareRevisions({ project, open: current, other: target, model, repository: versionRepository, signal: controller.signal });
      if (!controller.signal.aborted) setResult(next);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo comparar las versiones.");
    } finally {
      if (job.current === controller) { job.current = null; setBusy(false); }
    }
  }
  const otherLabel = (id: string) => { const item = versions.find((entry) => entry.id === id); return item ? revisionLabel(item) : ""; };
  // DWG: the handles of the open drawing that changed, to light them up together.
  const [lit, setLit] = useState(false);
  const drawingIds = result?.kind === "drawing" ? result.changes.flatMap((change) => change.after ? [change.after.id] : []) : [];
  useEffect(() => { setLit(false); }, [result]);
  function light(next: boolean) {
    setLit(next);
    const port = viewer();
    if (!port) return;
    if (next) port.previewGroup(drawingIds); else { port.previewGroup([]); port.select(selected); }
  }
  return <>
    <button ref={anchor} type="button" className="version-compare-trigger" aria-label="Comparar versiones" aria-haspopup="dialog"
      aria-expanded={open} aria-controls="version-compare" title="Comparar esta versión con otra del mismo archivo" onClick={() => setOpen(!open)}>
      <GitCompareArrows size={14} strokeWidth={2} aria-hidden="true"/>
    </button>
    {host && createPortal(<ToolPopover open={open} anchor={anchor} id="version-compare" className="version-compare" label="Comparar versiones"
      title="Comparar versiones" closeLabel="Cerrar comparación de versiones" width={384} keepMounted onClose={() => setOpen(false)}>
      <div className="tool-popover-body version-compare-form">
        <p className="version-compare-pair">
          <label>Comparar {current ? revisionLabel(current) : "esta versión"} con
            <select value={other} onChange={(event) => { setOther(event.target.value); setResult(null); setError(""); }} disabled={busy}>
              {others.map((item) => <option key={item.id} value={item.id}>{revisionLabel(item)} · {item.name}</option>)}
            </select></label>
          <BusyButton type="button" className="main-button" busy={busy} busyLabel="Comparando…" spinnerSize={14}
            disabled={!!reason || !other} title={reason} onClick={() => void compare()}>Comparar</BusyButton>
        </p>
        {reason && current && <p className="change-compare-note">{reason}.</p>}
        {error && <p role="alert" className="options-alert">{error}</p>}
        {result && <p className="change-compare-note" role="status">De {otherLabel(other)} a {current ? revisionLabel(current) : ""}{result.kind === "ifc" ? " · por GlobalId (IfcDiff en el servidor)" : " · textos y cotas por identificador CAD"}</p>}
      </div>
      {result?.kind === "ifc" && <ChangeCompare diff={result.diff} elements={model.elements} viewer={viewer} selected={selected}
        note="" empty="El servidor no devolvió la comparación."/>}
      {result?.kind === "drawing" && <div className="tool-popover-body change-compare">
        <p className="change-compare-counts">{result.changes.length} diferencias · {result.ambiguous} identificadores sin correspondencia única</p>
        {result.changes.length ? <ul className="change-compare-list" aria-label="Diferencias por identificador CAD">{result.changes.map((change) => <li key={change.handle}>
          <span className="change-compare-name">{change.reason}</span><code title={change.handle}>{change.handle}</code>
          <span className="change-compare-flags">{change.before?.name ?? "Ausente"} → {change.after?.name ?? "Ausente"}</span>
          {change.after ? <button type="button" className="change-compare-locate" onClick={() => locate(change.after!.id)}>Localizar en el plano</button>
            : <span className="change-compare-flags">No está en el plano abierto</span>}
        </li>)}</ul> : <p className="change-compare-note">No hay diferencias en los textos ni en las cotas leídas.</p>}
        <label className="change-compare-toggle">
          <input type="checkbox" checked={lit} disabled={!drawingIds.length} onChange={(event) => light(event.target.checked)}/>Resaltar en el plano
        </label>
      </div>}
    </ToolPopover>, host)}
  </>;
}
