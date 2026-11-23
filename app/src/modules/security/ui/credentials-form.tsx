"use client";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BusyButton } from "@/shared/ui/loading";
import { BrandSymbol } from "@/shared/ui/brand-mark";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { continueWithGoogle, identify } from "../application/session-actions";
import { sessionHttp } from "../infrastructure/session-http";
import { HttpError } from "@/core/http/http-client";
import { useSession } from "@/core/auth/use-session";
import { GoogleButton } from "./google-button";
import { localUserProfileRepository } from "@/modules/user-profile/infrastructure/local-user-profile.repository";

type Mode = "login" | "register";
const MODES: readonly { mode: Mode; label: string; path: string; title: string }[] = [
  { mode: "login", label: "Iniciar sesión", path: "/ingresar", title: "Ingresar · ObraCota" },
  { mode: "register", label: "Crear cuenta", path: "/registro", title: "Crear cuenta · ObraCota" },
];

/**
 * Sign-in screen shared by /ingresar and /registro: Google first, then an email account for whoever cannot or
 * will not use Google. The two tabs switch between signing in and creating an account without leaving the page;
 * the address follows the tab so a reload keeps it. The picture on the right is acceso.webp (see CREDITOS.txt).
 */
export function CredentialsForm({ registration = false, from, siteUrl }: {
  /** `desde` of the address: "asistente" or "visor" (the ReStage sample) go back there instead of the panel. */
  registration?: boolean; from?: string; siteUrl?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(registration ? "register" : "login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const acting = useRef(false);
  const { session } = useSession();
  const signingUp = mode === "register";
  const current = MODES.find(m => m.mode === mode)!;

  const back = from === "asistente" ? "/proyectos/restage/asistente" : from === "visor" ? "/proyectos/restage/visor" : undefined;
  const usual = back ?? "/proyectos";
  // Someone already signed in who opens /ingresar (the landing's «Entrar al panel», a bookmark) goes straight to
  // the panel. /registro stays open so a signed-in person can still create another account.
  const skipSignedIn = useRef(!registration);
  useEffect(() => { if (session && skipSignedIn.current && !acting.current) router.replace(usual); }, [session, router, usual]);

  function enter(created: boolean) {
    // A new account always meets the onboarding (even if this browser finished it for another account);
    // signing in to an existing account keeps the usual destination.
    if (created && !back) { localUserProfileRepository.clear(); router.replace("/bienvenida"); return; }
    router.replace(usual);
  }
  function choose(next: Mode, focus = false) {
    const target = MODES.find(m => m.mode === next)!;
    setMode(next); setError("");
    window.history.replaceState(null, "", target.path + window.location.search);
    document.title = target.title;
    if (focus) tabs.current[MODES.indexOf(target)]?.focus();
  }
  function arrows(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "login" : event.key === "End" ? "register" : signingUp ? "login" : "register";
    choose(next, true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    acting.current = true; setBusy(true); setError("");
    try {
      await identify(sessionHttp, mode, { email: String(data.get("email")), password: String(data.get("password")) });
      enter(signingUp);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo acceder."); setBusy(false); acting.current = false; }
  }
  async function google(credential: string) {
    acting.current = true; setBusy(true); setError("");
    try { enter(await continueWithGoogle(sessionHttp, credential)); }
    catch (e) { setError(googleError(e)); setBusy(false); acting.current = false; }
  }

  const site = siteUrl?.replace(/\/$/, "");
  return <div className="auth-screen">
    <div className="auth-bar">
      {site ? <a className="auth-back" href={site}><ArrowLeft size={16} strokeWidth={2} aria-hidden="true"/>Volver al sitio</a> : <span/>}
      <ThemeToggle/>
    </div>

    <main id="contenido" className="auth-main">
      <div className="auth-column">
        <div className="auth-intro">
          <div className="auth-title-row">
            <h1>Del plano<br/>a la obra.</h1>
            <span className="auth-symbol"><BrandSymbol size={48}/></span>
          </div>
          <p className="auth-lead">Crea una cuenta gratis o entra a los proyectos de edificación que ya guardaste.</p>
          <p className="auth-trust">Planos, modelos IFC y sus revisiones, juntos en cada proyecto.</p>
        </div>

        <GoogleButton registration={signingUp} onCredential={google}/>

        <div className="auth-tabs" role="tablist" aria-label="Acceso con correo" onKeyDown={arrows}>
          {MODES.map((m, i) => <button key={m.mode} ref={el => { tabs.current[i] = el; }} type="button" role="tab"
            id={"auth-tab-" + m.mode} aria-controls="auth-panel" aria-selected={mode === m.mode} tabIndex={mode === m.mode ? 0 : -1}
            onClick={() => choose(m.mode)}>{m.label}</button>)}
        </div>

        <form id="auth-panel" className="auth-form" role="tabpanel" aria-labelledby={"auth-tab-" + mode} method="post" onSubmit={submit}>
          <label className="auth-field">Correo electrónico
            <input type="email" name="email" autoComplete="username" placeholder="nombre@empresa.co" maxLength={254} required/>
          </label>
          <label className="auth-field">Contraseña
            <input key={mode} type="password" name="password" autoComplete={signingUp ? "new-password" : "current-password"}
              minLength={signingUp ? 10 : 1} maxLength={72} required aria-describedby={signingUp ? "password-rule" : undefined}/>
          </label>
          {signingUp && <p id="password-rule" className="auth-note">Usa al menos 10 caracteres.</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <BusyButton className="auth-submit" busy={busy} busyLabel={signingUp ? "Creando la cuenta…" : "Entrando…"}>{current.label}</BusyButton>
        </form>

        <p className="auth-legal">ObraCota es un proyecto académico. Consulta los <Link href="/terminos">términos del piloto</Link> y la <Link href="/privacidad">privacidad de la cuenta</Link>.</p>
      </div>
    </main>

    <figure className="auth-visual" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- static webp served from /public, sized by CSS */}
      <img src="/auth/acceso.webp" alt="" width={960} height={1200} fetchPriority="high" decoding="async"/>
    </figure>
  </div>;
}

function googleError(error: unknown) {
  if (error instanceof HttpError) {
    if (error.status === 401) return "Google no confirmó tu cuenta o tu correo no está verificado. Inténtalo de nuevo o usa tu correo.";
    if (error.status === 503) return "El acceso con Google no está disponible ahora. Usa tu correo y contraseña.";
    if (error.status === 429) return error.message;
  }
  return "No se pudo entrar con Google. Revisa tu conexión e inténtalo de nuevo.";
}
