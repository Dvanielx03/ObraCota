"use client";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/core/auth/use-session";
import { closeSession } from "../application/session-actions";
import { sessionHttp } from "../infrastructure/session-http";
import { PanelView } from "@/shared/ui/panel-view";

export function Account() {
  const { session, failed, retry } = useSession();
  const [error, setError] = useState("");
  return <PanelView title="Cuenta" project={false}><div className="panel-columns">
    <section>
      {session ? <><h2>Sesión activa</h2><p>{session.email}</p><button className="panel-action"
        onClick={async () => { try { await closeSession(sessionHttp); setError(""); } catch { setError("No se pudo cerrar la sesión. Inténtalo de nuevo."); } }}>Cerrar sesión</button></>
        : session === null ? <><h2>Sesión de invitado</h2><p>Inicia sesión para trabajar con tus proyectos.</p><Link className="panel-action" href="/ingresar">Iniciar sesión</Link></>
        : failed ? <><p role="alert">No se pudo consultar la sesión.</p><button onClick={retry}>Reintentar</button></> : <p role="status">Consultando sesión…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    <section><h2>Preferencias</h2><p>Las preferencias personales se podrán guardar cuando se habiliten los ajustes de cuenta.</p></section>
  </div></PanelView>;
}
