import type { Credentials, SessionPort } from "../domain/session";

export function identify(port: SessionPort, mode: "login" | "register", credentials: Credentials) {
  return port.identify(mode, { email: credentials.email.trim(), password: credentials.password });
}
export function continueWithGoogle(port: SessionPort, credential: string) { return port.google(credential); }
export function closeSession(port: SessionPort) { return port.logout(); }
