"use client";
import Link from "next/link";
import { Check, CircleAlert, X } from "lucide-react";
import { Spinner } from "@/shared/ui/loading";
import { RUN_TITLES, toolLabel, type AgentRun } from "../domain/agent-run";
import "./agent-run.css";

export type AgentRunState = { state: "running"; notes: number } | { state: "done"; run: AgentRun; project: string } | { state: "error"; message: string };

/**
 * Steps of «Proponer cambio al modelo» (H4) over the canvas: while the agent works, what it is doing; when it ends,
 * each tool it called and how it went, and the way to the draft's card, where the owner reviews it in 3D and approves
 * it herself. Nothing in this panel publishes.
 */
export function AgentRunPanel({ value, onClose }: { value: AgentRunState; onClose: () => void }) {
  const title = value.state === "running" ? "El agente está preparando el cambio" : value.state === "error" ? "No se pudo proponer el cambio" : RUN_TITLES[value.run.status];
  return <section className="agent-run" role="region" aria-label="Propuesta del agente" aria-busy={value.state === "running" || undefined}
    data-status={value.state === "done" ? value.run.status : value.state}>
    <header>
      {value.state === "running" ? <Spinner size={16} /> : value.state === "done" && value.run.status === "READY"
        ? <Check size={16} strokeWidth={2.4} aria-hidden="true" /> : <CircleAlert size={16} strokeWidth={2.2} aria-hidden="true" />}
      <h2>{title}</h2>
      {value.state !== "running" && <button type="button" className="agent-run-close" aria-label="Cerrar la propuesta del agente" onClick={onClose}>
        <X size={16} strokeWidth={2} aria-hidden="true" /></button>}
    </header>
    {value.state === "running" && <p className="agent-run-note">Lee {value.notes === 1 ? "la pieza marcada" : "las piezas marcadas"}, prepara un borrador y verifica su vista previa. Puede tardar un par de minutos.</p>}
    {value.state === "error" && <p className="agent-run-note" role="alert">{value.message}</p>}
    {value.state === "done" && <>
      {value.run.provider === "fake" && <p className="agent-run-provider">Agente de prueba: sin IA y sin costo.</p>}
      <ol className="agent-run-steps" aria-label="Pasos del agente">
        {value.run.steps.map((step) => <li key={step.step + "-" + step.seq} data-status={step.status}>
          {step.status === "OK" ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : <X size={14} strokeWidth={2.4} aria-hidden="true" />}
          <span>{toolLabel(step.tool)}{step.status !== "OK" && <small>{step.detail || step.errorCode}</small>}</span>
          <span className="visually-hidden">{step.status === "OK" ? "hecho" : step.status === "REJECTED" ? "rechazado" : "falló"}</span>
        </li>)}
      </ol>
      <p className="agent-run-note">{value.run.message}</p>
      {value.run.change && <div className="agent-run-actions">
        <Link href={"/proyectos/" + value.project + "/cambios#" + value.run.change}>Abrir la tarjeta del cambio</Link>
        {value.run.status === "READY" && <Link href={"/proyectos/" + value.project + "/cambios/" + value.run.change + "/vista"}>Ver propuesta en 3D</Link>}
      </div>}
      {value.run.status === "READY" && <p className="agent-run-provider">Revísalo y apruébalo tú: el agente no publica revisiones.</p>}
    </>}
  </section>;
}
