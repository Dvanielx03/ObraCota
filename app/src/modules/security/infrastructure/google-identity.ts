"use client";
import { request } from "@/core/http/http-client";

/** The few Google Identity Services calls the sign-in pages use (https://accounts.google.com/gsi/client). */
type CredentialResponse = { credential?: string };
type ButtonOptions = {
  type: "standard"; theme: "outline" | "filled_blue" | "filled_black"; size: "large"; shape: "pill" | "rectangular";
  text: "continue_with" | "signin_with" | "signup_with"; width: number; locale: string; logo_alignment: "left" | "center";
};
type GoogleIdentity = {
  accounts: { id: {
    initialize(options: { client_id: string; callback: (response: CredentialResponse) => void; context?: "signin" | "signup";
      ux_mode?: "popup"; itp_support?: boolean; cancel_on_tap_outside?: boolean }): void;
    renderButton(parent: HTMLElement, options: ButtonOptions): void;
  } };
};
declare global { interface Window { google?: GoogleIdentity } }

const SCRIPT = "https://accounts.google.com/gsi/client";
let loading: Promise<GoogleIdentity> | undefined;

/** The OAuth client id the backend publishes; empty while «Continuar con Google» is off. */
export async function googleClientId(): Promise<string> {
  const config = await request<{ clientId?: string }>("auth/google/config");
  return config.clientId?.trim() ?? "";
}

export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!loading) {
    loading = new Promise<GoogleIdentity>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT;
      script.async = true;
      script.onload = () => window.google?.accounts?.id ? resolve(window.google) : reject(new Error("GIS sin API"));
      script.onerror = () => reject(new Error("GIS no cargó"));
      document.head.appendChild(script);
    }).catch(error => { loading = undefined; throw error; });
  }
  return loading;
}

export type { CredentialResponse };
