"use client";
import { useEffect, useState } from "react";
import { authenticated } from "@/core/http/http-client";
import { useSession } from "@/core/auth/use-session";

/** Project and version the server keeps for the signed-in person's use of a public sample (Renderizar, Panorama). */
export interface SampleScope { project: string; version: string }

/** Where the sample viewer sends someone who is not signed in, and back to it afterwards. */
export const SAMPLE_SIGN_IN = "/ingresar?desde=visor";

// One request per person and sample in this tab: the scope does not change once created.
const cache = new Map<string, Promise<SampleScope>>();
export function sampleScope(email: string, sample: "restage"): Promise<SampleScope> {
  const key = email + "|" + sample;
  let pending = cache.get(key);
  if (!pending) {
    pending = authenticated<SampleScope>("projects/sample/" + sample, { method: "POST" });
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

/**
 * The scope of the ReStage sample while `active`: "checking" until the session is known, "signed-out" without one,
 * then the scope or the reason it could not be prepared.
 */
export type SampleScopeState = { state: "off" | "checking" | "signed-out" } | { state: "ready"; scope: SampleScope } | { state: "error"; message: string };
export function useSampleScope(active: boolean): SampleScopeState {
  const { session } = useSession();
  const email = session?.email;
  const [result, setResult] = useState<{ email: string; value: SampleScopeState } | null>(null);
  useEffect(() => {
    if (!active || !email) return;
    let live = true;
    sampleScope(email, "restage").then(scope => { if (live) setResult({ email, value: { state: "ready", scope } }); },
      error => { if (live) setResult({ email, value: { state: "error", message: error instanceof Error && error.message ? error.message : "No se pudo preparar el ejemplo en el servidor." } }); });
    return () => { live = false; };
  }, [active, email]);
  if (!active) return { state: "off" };
  if (session === null) return { state: "signed-out" };
  if (!email || result?.email !== email) return { state: "checking" };
  return result.value;
}
