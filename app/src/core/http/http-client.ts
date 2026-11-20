"use client";

export type AccessSession = { accessToken: string; email: string };
export type SessionState = AccessSession | null | undefined;
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

let current: SessionState;
let revision = 0;
let refreshing: Promise<SessionState> | undefined;
const subscribers = new Set<() => void>();
export const sessionStore = {
  snapshot: () => current,
  subscribe(listener: () => void) { subscribers.add(listener); return () => { subscribers.delete(listener); }; },
  set(session: SessionState) {
    revision += 1;
    current = session;
    subscribers.forEach(listener => listener());
  },
};

export async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-ObraCota-Client", "web");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", "Bearer " + token);
  const response = await fetch("/api/" + path, { ...init, headers, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new HttpError(response.status, error?.message || "No se pudo completar la solicitud.");
  }
  return response.status === 204 ? undefined as T : response.json();
}

export function refreshSession(): Promise<SessionState> {
  if (!refreshing) {
    const start = revision;
    const rotate = async () => {
      if (start !== revision) return current;
      try {
        const next = await request<AccessSession>("auth/refresh", { method: "POST" });
        if (start === revision) sessionStore.set(next);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 401) throw error;
        if (start === revision) sessionStore.set(null);
      }
      return current;
    };
    const withTabLock = async (): Promise<SessionState> =>
      navigator.locks ? await navigator.locks.request("obracota-session", rotate) : await rotate();
    refreshing = withTabLock().finally(() => { refreshing = undefined; });
  }
  return refreshing;
}

export async function authenticated<T>(path: string, init?: RequestInit): Promise<T> {
  const initial = current ?? await refreshSession();
  if (!initial) throw new HttpError(401, "Inicia sesión para continuar.");
  try { return await request<T>(path, init, initial.accessToken); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
    const renewed = current !== initial ? current : await refreshSession();
    if (!renewed || renewed.email !== initial.email) throw error;
    return request<T>(path, init, renewed.accessToken);
  }
}
