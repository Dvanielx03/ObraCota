"use client";
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { toolLabel, type AgentStep } from "../domain/agent-run";
import { agentRunSteps } from "../infrastructure/agent-run-http";

/**
 * «Pasos del agente» on the card of a change the agent proposed: the tools it called, read from its journal when the
 * person opens it, so the trail survives a reload and can be checked before approving.
 */
export function AgentSteps({ project, run }: { project: string; run: string }) {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open || steps) return;
    const control = new AbortController();
    agentRunSteps(project, run, control.signal).then(setSteps).catch(() => { if (!control.signal.aborted) setError(true); });
    return () => control.abort();
  }, [open, steps, project, run]);
  return <details className="change-agent-steps" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Pasos del agente</summary>
    {error ? <p role="alert">No se pudieron leer los pasos del agente.</p>
      : !steps ? <p role="status">Leyendo los pasos…</p>
      : !steps.length ? <p>El diario no tiene pasos para esta ejecución.</p>
      : <ol className="agent-run-steps" aria-label="Pasos del agente">{steps.map((step) =>
        <li key={step.step + "-" + step.seq} data-status={step.status}>
          {step.status === "OK" ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : <X size={14} strokeWidth={2.4} aria-hidden="true" />}
          <span>{toolLabel(step.tool)}{step.status !== "OK" && <small>{step.detail || step.errorCode}</small>}</span>
          <span className="visually-hidden">{step.status === "OK" ? "hecho" : step.status === "REJECTED" ? "rechazado" : "falló"}</span>
        </li>)}</ol>}
  </details>;
}
