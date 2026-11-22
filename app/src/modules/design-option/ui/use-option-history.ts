"use client";
import { useCallback, useEffect, useState } from "react";
import { isWorking, type OptionHistory } from "../domain/option-history";
import { listOptions, optionImage } from "../infrastructure/option-http";

export interface OptionHistoryState {
  history?: OptionHistory;
  /** True until the first answer for the current key arrives. */
  loading: boolean;
  error: string;
  reload: () => void;
}

/**
 * History of the visual options of one piece (or group). It is read as soon as a piece is chosen,
 * so the toolbar knows whether Comparar and Descargar have something to show, and polled while a
 * batch is being generated.
 */
export function useOptionHistory(base: string | null, key: string | null): OptionHistoryState {
  const [history, setHistory] = useState<OptionHistory>();
  const [loaded, setLoaded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const scope = base && key ? base + "|" + key : null;
  useEffect(() => {
    setHistory(undefined); setError(""); setLoaded(null);
  }, [scope]);
  useEffect(() => {
    if (!base || !key) return;
    const control = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const next = await listOptions(base!, key!, control.signal);
        if (control.signal.aborted) return;
        setHistory(next); setLoaded(base + "|" + key); setError("");
        if (isWorking(next)) timer = setTimeout(read, 1800);
      } catch {
        if (!control.signal.aborted) { setError("No se pudo consultar el historial."); setLoaded(base + "|" + key); }
      }
    }
    void read();
    return () => { control.abort(); clearTimeout(timer); };
  }, [base, key, refresh]);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  return { history, loading: !!scope && loaded !== scope, error, reload };
}

/** An image behind the session, as an object URL that is revoked when the path changes. */
export function usePrivateImage(path: string | null): { url: string; error: boolean } {
  const [url, setUrl] = useState(""), [error, setError] = useState(false);
  useEffect(() => {
    setUrl(""); setError(false);
    if (!path) return;
    const control = new AbortController();
    let objectUrl = "";
    optionImage(path, control.signal).then((blob) => {
      if (!control.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(() => { if (!control.signal.aborted) setError(true); });
    return () => { control.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return { url, error };
}
