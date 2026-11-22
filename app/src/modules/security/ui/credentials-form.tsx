"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BusyButton } from "@/shared/ui/loading";
import { identify } from "../application/session-actions";
import { sessionHttp } from "../infrastructure/session-http";
import { entryRoute } from "@/modules/user-profile/application/onboarding.use-case";
import { localUserProfileRepository } from "@/modules/user-profile/infrastructure/local-user-profile.repository";

/** Sign-in and sign-up card, centred in the panel. */
export function CredentialsForm({ registration = false, assistant = false }: { registration?: boolean; assistant?: boolean }) {
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
      const usual = assistant ? "/proyectos/restage/asistente" : "/proyectos";
      // A new account meets the onboarding once; signing in keeps the usual destination.
      router.replace(registration && !assistant ? entryRoute(localUserProfileRepository, usual) : usual);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo acceder."); setBusy(false); }
  }
  return <div className="panel-scroll"><div className="auth-page">
    <form className="auth-card account-form" method="post" onSubmit={submit} aria-labelledby="auth-title">
      <div className="auth-head">
        <h1 id="auth-title">{title}</h1>
        <p>{registration ? "Guarda tus proyectos, sus versiones y tus observaciones." : "Entra para abrir tus proyectos guardados."}</p>
      </div>
      <label>Correo electrónico<input type="email" name="email" autoComplete="username" maxLength={254} required/></label>
      <label>Contraseña<input type="password" name="password" autoComplete={registration ? "new-password" : "current-password"}
        minLength={registration ? 10 : 1} maxLength={72} required aria-describedby={registration ? "password-rule" : undefined}/></label>
      {registration && <p id="password-rule" className="auth-hint">Usa al menos 10 caracteres y hasta 72 bytes.</p>}
      {error && <p role="alert">{error}</p>}
      <BusyButton className="panel-action" busy={busy} busyLabel={registration ? "Creando la cuenta…" : "Entrando…"}>{title}</BusyButton>
      <p className="auth-switch">{registration ? "¿Ya tienes cuenta?" : "¿Todavía no tienes cuenta?"}{" "}
        <Link href={(registration ? "/ingresar" : "/registro") + (assistant ? "?desde=asistente" : "")}>{registration ? "Ya tengo cuenta" : "Crear cuenta"}</Link></p>
    </form>
  </div></div>;
}
