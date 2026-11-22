"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { BusyButton } from "@/shared/ui/loading";
import { saveBlob } from "@/modules/scene-view/infrastructure/export-files";
import { verifiedOriginal } from "../application/download-original";
import { versionRepository } from "../infrastructure/version-http";

/**
 * «Descargar original» of a published version: downloads it, checks its SHA-256 against the one the server recorded
 * and only then hands it to the browser, saying the check passed (or why it did not).
 */
export function VerifiedDownload({ project, version, label = "Descargar original", className = "panel-action change-secondary" }:
  { project: string; version: string; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => job.current?.abort(), []);
  async function download() {
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setBusy(true); setMessage(null);
    try {
      const { file, version: published } = await verifiedOriginal(versionRepository, project, version, controller.signal);
      if (controller.signal.aborted) return;
      saveBlob(published.name, file);
      setMessage({ text: "Descargado " + published.name + " · huella SHA-256 comprobada (" + published.sha256.slice(0, 12) + "…)", error: false });
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ text: error instanceof Error ? error.message : "No se pudo descargar el original.", error: true });
    } finally {
      if (job.current === controller) { job.current = null; setBusy(false); }
    }
  }
  return <>
    <BusyButton type="button" className={className} busy={busy} busyLabel="Descargando y comprobando…" spinnerSize={14}
      icon={<Download size={14} strokeWidth={2} aria-hidden="true"/>} onClick={() => void download()}>{label}</BusyButton>
    {message && <p className="verified-download" role={message.error ? "alert" : "status"} data-error={message.error || undefined}>{message.text}</p>}
  </>;
}
