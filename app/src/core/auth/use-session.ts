"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { refreshSession, sessionStore } from "@/core/http/http-client";

export function useSession() {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.snapshot, () => undefined);
  const [failed, setFailed] = useState(false);
  async function retry() {
    setFailed(false);
    try { await refreshSession(); } catch { setFailed(true); }
  }
  useEffect(() => { if (session === undefined) void retry(); }, [session]);
  return { session, failed, retry };
}
