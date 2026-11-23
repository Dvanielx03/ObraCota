"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { googleClientId, loadGoogleIdentity } from "../infrastructure/google-identity";
import { readTheme, subscribeTheme } from "@/shared/theme/theme-store";

type State = "checking" | "off" | "ready" | "failed";

const DARK = "(prefers-color-scheme: dark)";
function subscribeScheme(notify: () => void) {
  const media = window.matchMedia(DARK);
  const stop = subscribeTheme(notify);
  media.addEventListener("change", notify);
  return () => { stop(); media.removeEventListener("change", notify); };
}
/** True when the page is dark, whether chosen or followed from the system. */
function readDark() {
  const mode = readTheme();
  return mode === "dark" || (mode === "system" && window.matchMedia(DARK).matches);
}

/**
 * «Continuar con Google» with Google Identity Services, the first way in. Hidden while the server has no OAuth
 * client id. Google renders its own button (the official one); it takes the page's primary colour: filled black
 * on light, Google's white outline button on dark, where the primary action is light. The ID token goes to
 * {@link onCredential}.
 */
export function GoogleButton({ registration, onCredential }: {
  registration: boolean; onCredential: (credential: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const [state, setState] = useState<State>("checking");
  const dark = useSyncExternalStore(subscribeScheme, readDark, () => false);
  useEffect(() => { callback.current = onCredential; }, [onCredential]);

  useEffect(() => {
    let alive = true;
    (async () => {
      let clientId = "";
      try { clientId = await googleClientId(); } catch { /* Without the config, the email form is enough. */ }
      if (!alive) return;
      if (!clientId) { setState("off"); return; }
      try {
        const google = await loadGoogleIdentity();
        if (!alive || !host.current) return;
        google.accounts.id.initialize({
          client_id: clientId, context: registration ? "signup" : "signin", ux_mode: "popup", itp_support: true,
          callback: response => { if (response.credential) callback.current(response.credential); },
        });
        host.current.replaceChildren();
        const width = Math.round(Math.min(400, Math.max(200, host.current.clientWidth || 360)));
        google.accounts.id.renderButton(host.current, {
          type: "standard", theme: dark ? "outline" : "filled_black", size: "large", shape: "pill",
          text: "continue_with", width, locale: "es", logo_alignment: "center",
        });
        setState("ready");
      } catch { if (alive) setState("failed"); }
    })();
    return () => { alive = false; };
  }, [registration, dark]);

  if (state === "off") return null;
  return <div className="auth-google" data-state={state}>
    <div ref={host} className="auth-google-button" data-testid="google-button" hidden={state === "failed"}/>
    {state === "failed"
      ? <p className="auth-note" role="status">No se pudo cargar el acceso con Google. Usa tu correo o recarga la página.</p>
      : <p className="auth-check"><Check size={14} strokeWidth={2.25} aria-hidden="true"/>Sin contraseñas nuevas: Google confirma tu correo.</p>}
    <p className="auth-divider"><span>o con tu correo</span></p>
  </div>;
}
