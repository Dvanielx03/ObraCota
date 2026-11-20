"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PanelView } from "@/shared/ui/panel-view";
import { identify } from "../application/session-actions";
import { sessionHttp } from "../infrastructure/session-http";

export function CredentialsForm({ registration = false }: { registration?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const title = registration ? "Crear cuenta" : "Iniciar sesión";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await identify(sessionHttp, registration ? "register" : "login", {
        email: String(data.get("email")), password: String(data.get("password")),
      });
      router.replace("/proyectos");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo acceder."); setBusy(false); }
  }
  return <PanelView title={title} project={false}><form className="account-form" onSubmit={submit}>
    <label>Correo electrónico<input type="email" name="email" autoComplete="username" maxLength={254} required/></label>
    <label>Contraseña<input type="password" name="password" autoComplete={registration ? "new-password" : "current-password"}
      minLength={registration ? 10 : 1} maxLength={72} required/></label>
    {registration && <p>Usa al menos 10 caracteres y hasta 72 bytes.</p>}
    {error && <p role="alert">{error}</p>}
    <button className="panel-action" disabled={busy}>{busy ? "Procesando…" : title}</button>
    <Link href={registration ? "/ingresar" : "/registro"}>{registration ? "Ya tengo cuenta" : "Crear cuenta"}</Link>
  </form></PanelView>;
}
