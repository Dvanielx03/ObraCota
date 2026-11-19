"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "cn";

import { NAVEGACION, type SeccionId } from "@/lib/caso";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Logo } from "./logo";

/** Dos trazos que se cruzan al abrir: el mismo icono en sus dos estados. */
function IconoMenu({ abierto }: { abierto: boolean }) {
  const trazo =
    "absolute left-0 top-1/2 h-0.5 w-full rounded-full bg-current transition-transform duration-500 ease-out-quart";
  return (
    <span aria-hidden="true" className="relative block size-[18px]">
      <span className={cn(trazo, abierto ? "rotate-45" : "-translate-y-1")} />
      <span className={cn(trazo, abierto ? "-rotate-45" : "translate-y-1")} />
    </span>
  );
}

function SelectorSeccion({ activa, enInicio, movil = false, alNavegar }: {
  activa: SeccionId;
  enInicio: boolean;
  movil?: boolean;
  alNavegar?: () => void;
}) {
  const barra = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const nav = barra.current;
    const opcion = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !opcion) return;
    const medir = () => {
      if (!opcion.offsetWidth) return;
      nav.style.setProperty("--indicador-x", `${opcion.offsetLeft}px`);
      nav.style.setProperty("--indicador-y", `${opcion.offsetTop}px`);
      nav.style.setProperty("--indicador-ancho", `${opcion.offsetWidth}px`);
      nav.style.setProperty("--indicador-alto", `${opcion.offsetHeight}px`);
      nav.dataset.medido = "true";
    };
    medir();
    const cambios = new ResizeObserver(medir);
    cambios.observe(nav);
    for (const control of nav.querySelectorAll("a")) cambios.observe(control);
    return () => cambios.disconnect();
  }, [activa, enInicio]);

  const estilo = movil
    ? "relative min-h-11 rounded-full px-5 py-1 text-left font-display text-[clamp(1.75rem,5svh,3rem)]"
    : "relative flex h-11 items-center rounded-full px-3.5 text-[15px] font-semibold xl:px-5";
  return (
    <nav ref={barra} aria-label={movil ? "Principal, móvil" : "Principal"}
      className={cn("selector-seccion relative isolate", movil
        ? "mx-3 my-auto flex flex-col gap-1"
        : "hidden items-center gap-0.5 justify-self-center rounded-full bg-ink-black/25 p-1 lg:flex")}>
      {enInicio && <span aria-hidden="true" className="indicador-seccion" />}
      {NAVEGACION.map(({id, etiqueta}) => (
        <a key={id} href={enInicio ? `#${id}` : `/#${id}`}
          aria-current={enInicio && activa === id ? "location" : undefined}
          onClick={alNavegar}
          className={cn(estilo, enInicio ? "text-white mix-blend-difference" : "text-bone")}>{etiqueta}</a>
      ))}
    </nav>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const enInicio = pathname === "/";
  const [activa, setActiva] = useState<SeccionId>("inicio");
  const [abierto, setAbierto] = useState(false);
  // El enlace activo sigue a la sección que cruza el centro de la pantalla.
  useEffect(() => {
    if (!enInicio) return;
    const secciones = NAVEGACION.map((n) => document.getElementById(n.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    let elegido: SeccionId | null = null;
    const seleccionar = (evento: Event) => {
      elegido = (evento as CustomEvent<SeccionId>).detail;
      setActiva(elegido);
    };
    const liberar = () => { elegido = null; };
    window.addEventListener("obracota:navegar", seleccionar);
    const gestos = ["wheel", "touchstart", "keydown", "pointerdown", "popstate"] as const;
    for (const gesto of gestos) window.addEventListener(gesto, liberar, { passive: true });
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (entrada.isIntersecting && (!elegido || elegido === entrada.target.id)) {
            setActiva(entrada.target.id as SeccionId);
          }
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    secciones.forEach((s) => observador.observe(s));
    return () => {
      observador.disconnect();
      window.removeEventListener("obracota:navegar", seleccionar);
      for (const gesto of gestos) window.removeEventListener(gesto, liberar);
    };
  }, [enInicio]);

  const destino = (id: string) => (enInicio ? `#${id}` : `/#${id}`);

  return (
    <header className="fixed inset-x-0 top-3 z-50 px-3 lg:top-6 lg:px-8">
      <div className="header-glass mx-auto flex h-[60px] max-w-[1376px] items-center justify-between rounded-full pl-[18px] pr-2 lg:grid lg:h-[76px] lg:grid-cols-[auto_1fr_auto] lg:pl-7 lg:pr-3.5 xl:grid-cols-[1fr_auto_1fr]">
        <Link
          href={enInicio ? "#inicio" : "/"}
          aria-label="ObraCota, ir al inicio"
          className="flex min-h-11 items-center rounded-full"
        >
          <Logo />
        </Link>

        <SelectorSeccion activa={activa} enInicio={enInicio} />

        <a
          href={destino("contacto")}
          className="group hidden h-12 items-center gap-3 justify-self-end rounded-full bg-bone pl-6 pr-1.5 text-[15px] font-semibold text-ink transition-transform duration-200 ease-out-quart active:scale-[0.98] lg:flex"
        >
          Solicitar demostración
          <span className="grid size-9 place-items-center rounded-full bg-ink text-bone">
            <ArrowRight
              aria-hidden="true"
              weight="bold"
              className="size-4 transition-transform duration-500 ease-out-expo group-hover:translate-x-0.5"
            />
          </span>
        </a>

        <Sheet open={abierto} onOpenChange={setAbierto}>
          <SheetTrigger
            render={
              <button
                type="button"
                className="flex h-11 items-center gap-2.5 rounded-full bg-bone px-[18px] text-[15px] font-semibold text-ink transition-transform duration-200 ease-out-quart active:scale-[0.98] lg:hidden"
              />
            }
          >
            Menú
            <IconoMenu abierto={false} />
          </SheetTrigger>
          <SheetContent
            side="top"
            showCloseButton={false}
            className="h-dvh gap-0 border-0 bg-ink-black p-3 text-bone duration-500 ease-out-quart data-[side=top]:h-dvh data-[side=top]:border-b-0"
          >
            <SheetTitle className="sr-only">Menú principal</SheetTitle>
            <SheetDescription className="sr-only">
              Enlaces a las secciones de la página y a la solicitud de demostración.
            </SheetDescription>
            <div className="flex h-[60px] items-center justify-between pl-[18px] pr-2">
              <Logo />
              <SheetClose
                render={
                  <button
                    type="button"
                    className="flex h-11 items-center gap-2.5 rounded-full bg-bone px-[18px] text-[15px] font-semibold text-ink"
                  />
                }
              >
                Cerrar
                <IconoMenu abierto={abierto} />
              </SheetClose>
            </div>
            <SelectorSeccion movil activa={activa} enInicio={enInicio} alNavegar={() => setAbierto(false)} />
            <SheetClose
              render={
                <a
                  href={destino("contacto")}
                  style={{ animationDelay: "420ms" }}
                  className="animate-menu-link mx-[6px] mb-3 flex h-14 min-h-11 items-center justify-between rounded-full bg-bone pl-6 pr-2 text-base font-semibold text-ink"
                />
              }
            >
              Solicitar demostración
              <span className="grid size-10 place-items-center rounded-full bg-ink text-bone">
                <ArrowRight aria-hidden="true" weight="bold" className="size-4" />
              </span>
            </SheetClose>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
