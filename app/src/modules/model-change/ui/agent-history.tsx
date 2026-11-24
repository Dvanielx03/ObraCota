"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { agentProviderLabel, RUN_HISTORY_LABELS, type AgentRunSummary } from "../domain/agent-run";
import { agentRunHistory } from "../infrastructure/agent-run-http";
import "./agent-run.css";

const date = new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" });

export function AgentRunMeta({ run }: { run: AgentRunSummary }) {
  const label = run.status === "NO_CHANGE" && run.change ? "Borrador sin enviar" : RUN_HISTORY_LABELS[run.status];
  const provider = agentProviderLabel(run.provider, run.model);
  return <div className="agent-history-meta">
    <strong>{label}</strong>
    <time dateTime={run.startedAt}>{date.format(new Date(run.startedAt))}</time>
    {provider && <small>{provider}</small>}
  </div>;
}

export function AgentHistory({ project, version }: { project: string; version: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AgentRunSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    agentRunHistory(project, { version }, controller.signal).then(setEntries).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [open, project, version, reload]);

  function refresh() {
    setEntries(null);
    setFailed(false);
    setReload(count => count + 1);
  }

  return <details className="agent-history" onToggle={event => {
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open) refresh();
  }}>
    <summary>Historial del agente</summary>
    {open && (failed ? <p role="alert">No se pudo cargar el historial.</p>
      : entries === null ? <p role="status">Cargando historial…</p>
      : entries.length === 0 ? <p>Aún no hay ejecuciones registradas para esta versión.</p>
      : <ol className="agent-history-list">{entries.map(run => <li key={run.id}>
        <AgentRunMeta run={run} />
        <p>{run.message}</p>
        {run.change && <Link href={"/proyectos/" + project + "/cambios#" + run.change}>Abrir cambio</Link>}
      </li>)}</ol>)}
    {open && (failed || entries !== null) && <button type="button" onClick={refresh}>Actualizar historial</button>}
  </details>;
}
