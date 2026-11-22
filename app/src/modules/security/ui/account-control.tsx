"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { accountInitial } from "@/core/auth/account-initial";
import { useSession } from "@/core/auth/use-session";
import { isAuthPath } from "@/shared/ui/panel-routes";
import { closeSession } from "../application/session-actions";
import { sessionHttp } from "../infrastructure/session-http";

/**
 * Right end of the top bar: avatar linking to the account page, "Iniciar sesión" for guests and,
 * on the account page itself, "Cerrar sesión" in place of the avatar (as the reference profile page).
 */
export function AccountControl() {
  const path = usePathname();
  const { session } = useSession();
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  if (isAuthPath(path)) return null;
  if (session === undefined) return <span className="panel-avatar" data-pending="true" aria-hidden="true"><span/></span>;
  if (session === null) return <Link className="panel-pill panel-pill-primary" href="/ingresar"><LogIn size={12} strokeWidth={2.25} aria-hidden="true"/>Iniciar sesión</Link>;
  if (path === "/cuenta") {
    async function leave() {
      setLeaving(true); setError("");
      try { await closeSession(sessionHttp); }
      catch { setError("No se pudo cerrar la sesión. Inténtalo de nuevo."); }
      finally { setLeaving(false); }
    }
    return <span className="panel-account-exit">
      <button type="button" className="panel-pill" disabled={leaving} aria-busy={leaving || undefined} onClick={() => void leave()}>
        <LogOut size={12} strokeWidth={2.25} aria-hidden="true"/>Cerrar sesión</button>
      {error && <span role="alert" className="panel-top-alert">{error}</span>}
    </span>;
  }
  return <Link className="panel-avatar" href="/cuenta" aria-label="Cuenta" title={"Cuenta · " + session.email}>
    <span aria-hidden="true">{accountInitial(session.email)}</span>
  </Link>;
}
