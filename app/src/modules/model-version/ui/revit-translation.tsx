"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BusyButton, LoadingStatus } from "@/shared/ui/loading";
import { revitTranslations, translationRunning, type RevitTranslation, type RevitTranslationStatus } from "../infrastructure/revit-translation-http";

/** How often the page asks for the stage of a running conversion. */
const POLL_MS = 4000;

const STAGE: Record<RevitTranslationStatus, string> = {
  QUEUED: "En cola para enviar a Autodesk…",
  UPLOADING: "Enviando el RVT a Autodesk…",
  TRANSLATING: "Autodesk está convirtiendo el modelo a IFC…",
  STORING: "Guardando el IFC en el proyecto…",
  DONE: "IFC listo.",
  FAILED: "La conversión no terminó.",
};

/**
 * Under a stored RVT that cannot be drawn: «Convertir a IFC con Autodesk» (layer 2 of RVT support). The server
 * sends the RVT to Autodesk Model Derivative and stores the IFC as a version of the sibling «<nombre>.ifc»; the
 * stage is read every 4 s and, once done, a link opens the IFC in the viewer. The RVT is never changed.
 */
export function RevitTranslationAction({ project, version }: { project: string; version: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [translation, setTranslation] = useState<RevitTranslation | undefined>();
  const [starting, setStarting] = useState(false), [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    const request = new AbortController();
    Promise.all([revitTranslations.available(project, request.signal), revitTranslations.latest(project, version, request.signal)])
      .then(([on, latest]) => { setAvailable(on); setTranslation(latest); })
      .catch(() => { if (!request.signal.aborted) setAvailable(false); });
    return () => request.abort();
  }, [project, version]);

  const running = translationRunning(translation);
  useEffect(() => {
    if (!running) return;
    const request = new AbortController();
    const timer = setInterval(() => {
      revitTranslations.latest(project, version, request.signal).then(next => { if (next) setTranslation(next); })
        .catch(() => undefined); // A missed poll is retried on the next tick.
    }, POLL_MS);
    return () => { clearInterval(timer); request.abort(); };
  }, [running, project, version]);

  async function convert() {
    setStarting(true); setError("");
    try {
      const started = await revitTranslations.start(project, version);
      if (alive.current) setTranslation(started);
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : "No se pudo iniciar la conversión.");
    } finally {
      if (alive.current) setStarting(false);
    }
  }

  if (available === null) return null;
  const note = <small className="revit-translation-note">Convertido por Autodesk Model Derivative; el RVT original no cambia.</small>;
  if (!available && !translation) return <div className="revit-translation" data-state="off">
    <small className="revit-translation-note">Conversión con Autodesk no configurada.</small>
  </div>;
  const done = translation?.status === "DONE" && translation.resultVersion;
  return <div className="revit-translation" data-state={translation?.status.toLowerCase() ?? "idle"}>
    {running && translation && <LoadingStatus>{translation.message || STAGE[translation.status]}</LoadingStatus>}
    {done && <>
      <span role="status">{translation.message || STAGE.DONE}</span>
      <Link className="revit-translation-open" href={`/proyectos/${project}/visor/${translation.resultVersion}`}>Abrir el IFC convertido</Link>
    </>}
    {translation?.status === "FAILED" && <span role="alert">{translation.message || STAGE.FAILED}</span>}
    {error && <span role="alert">{error}</span>}
    {available && !running && !done && <BusyButton type="button" busy={starting} busyLabel="Iniciando…" onClick={() => void convert()}>
      Convertir a IFC con Autodesk
    </BusyButton>}
    {note}
  </div>;
}
