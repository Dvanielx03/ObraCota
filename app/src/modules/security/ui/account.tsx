"use client";
import Link from "next/link";
import { useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { Compass, Monitor, Moon, Palette, SlidersHorizontal, Sun, UserRound } from "lucide-react";
import { accountInitial } from "@/core/auth/account-initial";
import { useSession } from "@/core/auth/use-session";
import { DEFAULT_THEME, type ThemeMode } from "@/shared/theme/theme";
import { applyTheme, readTheme, subscribeTheme } from "@/shared/theme/theme-store";
import { PanelView } from "@/shared/ui/panel-view";
import { LoadingStatus, Skeleton } from "@/shared/ui/loading";

const MODES: readonly { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "light", label: "Claro", icon: Sun }, { mode: "dark", label: "Oscuro", icon: Moon }, { mode: "system", label: "Sistema", icon: Monitor },
];

/** Segmented colour-mode choice: the same setting as the top-bar toggle, as a radio group. */
function ThemeChoice() {
  const current = useSyncExternalStore(subscribeTheme, readTheme, () => DEFAULT_THEME);
  const group = useRef<HTMLDivElement>(null);
  function arrows(event: KeyboardEvent<HTMLDivElement>) {
    const at = MODES.findIndex(item => item.mode === current);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = MODES[(at + step + MODES.length) % MODES.length].mode;
    applyTheme(next);
    group.current?.querySelector<HTMLButtonElement>("[data-mode=" + next + "]")?.focus();
  }
  return <div ref={group} className="account-segments" role="radiogroup" aria-labelledby="account-theme" onKeyDown={arrows}>
    {MODES.map(({ mode, label, icon: Icon }) => <button key={mode} type="button" role="radio" data-mode={mode}
      aria-checked={current === mode} tabIndex={current === mode ? 0 : -1} onClick={() => applyTheme(mode)}>
      <Icon size={14} aria-hidden="true"/>{label}</button>)}
  </div>;
}

export function Account() {
  const { session, failed, retry } = useSession();
  return <PanelView title="Cuenta">
    <div className="account-grid">
      <section className="account-card account-identity" aria-labelledby="account-identity">
        {session ? <>
          <span className="account-avatar" aria-hidden="true">{accountInitial(session.email)}</span>
          <div><p className="account-overline">Sesión activa</p><h2 id="account-identity">{session.email}</h2>
            <p>Cierra la sesión desde la barra superior cuando termines en este equipo.</p></div>
        </> : session === null ? <>
          <span className="account-avatar" data-guest="true" aria-hidden="true"><UserRound size={28} strokeWidth={1.75}/></span>
          <div><p className="account-overline">Sin sesión</p><h2 id="account-identity">Sesión de invitado</h2>
            <p>Inicia sesión para trabajar con tus proyectos.</p>
            <div className="account-actions"><Link className="panel-button" href="/ingresar">Entrar con tu cuenta</Link>
              <Link className="panel-button-outline" href="/registro">Crear una cuenta</Link></div></div>
        </> : failed ? <div><h2 id="account-identity" role="alert">No se pudo consultar la sesión.</h2>
            <button type="button" className="panel-button-outline" onClick={() => void retry()}>Volver a intentar</button></div>
          : <><Skeleton shape="circle" className="account-avatar-skeleton"/>
            <div className="account-identity-skeleton"><h2 id="account-identity" className="sr-only">Sesión</h2><LoadingStatus hidden>Consultando sesión…</LoadingStatus>
              <Skeleton shape="line" width={84} height={10}/><Skeleton shape="line" width="70%" height={18}/><Skeleton shape="line" width="90%"/></div></>}
      </section>
      <section className="account-card account-split" aria-label="Apariencia y bienvenida">
        <div>
          <h2 className="account-label" id="account-theme"><Palette size={16} aria-hidden="true"/>Apariencia</h2>
          <p>Elige el modo de color. Se guarda en este navegador.</p>
          <ThemeChoice/>
        </div>
        <div>
          <h2 className="account-label"><Compass size={16} aria-hidden="true"/>Bienvenida</h2>
          <p>Vuelve a responder las tres preguntas del inicio para cambiar por dónde empiezas.</p>
          <Link className="panel-button-outline" href="/bienvenida">Repetir la bienvenida</Link>
        </div>
      </section>
      <section className="account-card" aria-labelledby="account-preferences">
        <h2 className="account-label" id="account-preferences"><SlidersHorizontal size={16} aria-hidden="true"/>Preferencias</h2>
        <p>Las preferencias personales se podrán guardar cuando se habiliten los ajustes de cuenta.</p>
      </section>
    </div>
  </PanelView>;
}
