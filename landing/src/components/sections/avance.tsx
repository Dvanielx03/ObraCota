"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type AnimationEvent, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, Pause, Play } from "@phosphor-icons/react/dist/ssr";
import { cn } from "cn";

import { MOVIMIENTO_REDUCIDO } from "@/lib/gsap";
import ficha from "@/lib/modelo/ficha-restage.json";
import { FUENTE_MODELO } from "@/lib/modelo/fuente";

/**
 * Avance de obra: los ocho hitos con fecha de terminación que trae el IFC de ReStage.
 *
 * - La imagen manda (columnas 5 a 12). Es una recreación con IA hecha sobre un render del
 *   modelo terminado, con la misma cámara: enseña el lugar del hito, no el estado de la obra
 *   ese día. La leyenda lo dice siempre.
 * - El carrusel avanza solo: cada vista se queda unos 6 s con un acercamiento lento y la
 *   siguiente se abre desde el centro. El riel marca en ámbar cuánto falta.
 * - De la última a la primera no se rebobina: el riel se vacía, la imagen pasa por tinta y
 *   vuelve al primer hito.
 * - Se detiene con el puntero encima, con foco de teclado, al tocar, fuera de pantalla y con
 *   el botón de pausa. Con movimiento reducido no avanza solo.
 */
const VISTAS: Record<string, { titulo: string; lugar: string; alt: string }> = {
  ConstructionPhase_01: { titulo: "Fase de construcción 1", lugar: "Planta baja, junto a la escalera", alt: "Interior de la planta baja: muros de concreto a la vista, escalera de madera de peldaños abiertos y viguetas del entrepiso." },
  ConstructionPhase_03: { titulo: "Fase de construcción 3", lugar: "Planta alta, entre los pórticos", alt: "Planta alta dentro de la estructura abierta: columnas y vigas de acero atornilladas, tablero de madera y cubierta metálica." },
  SolarPanel: { titulo: "Paneles solares", lugar: "Sobre las cubiertas", alt: "Vista elevada de las cubiertas inclinadas del edificio con los paneles solares." },
  "Concrete Slab Floor": { titulo: "Losa de piso de concreto", lugar: "Interior, sobre la losa", alt: "Interior del edificio con la losa de piso de concreto entre los muros y la estructura." },
  "Underground Water Tank": { titulo: "Tanque de agua enterrado", lugar: "Exterior, junto al tanque", alt: "Exterior a nivel del terreno: el tanque de agua en su excavación, junto a la cimentación de concreto." },
  "Green Facade": { titulo: "Fachada verde", lugar: "Frente a la fachada", alt: "Módulos de la fachada verde montados sobre el exterior de la planta baja." },
  ConstructionPhase_04: { titulo: "Fase de construcción 4", lugar: "Exterior, junto al bastidor de acero", alt: "Exterior a nivel del terreno: bastidor de acero sobre dados de concreto junto al muro de la planta baja, con el volumen de madera encima." },
  "3D-Printed Concrete Wall": { titulo: "Muro de concreto impreso en 3D", lugar: "Interior, hacia el muro impreso", alt: "Interior de la planta baja mirando hacia el muro de concreto impreso en capas." },
};

const HITOS = ficha.hitos.lista.map((hito, i) => {
  const vista = VISTAS[hito.nombre];
  if (!vista) throw new Error(`Falta la vista del hito de ReStage: ${hito.nombre}`);
  const fecha = new Date(hito.fecha + "T12:00:00Z");
  return {
    ...vista,
    n: i + 1,
    registro: hito.nombre,
    fecha: hito.fecha,
    fechaTexto: fecha.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
    anio: fecha.getUTCFullYear(),
    elementos: hito.elementos.toLocaleString("es-CO"),
  };
});
const TOTAL = HITOS.length;
/** Tiempos de la vuelta al primer hito: cuándo cambia la imagen bajo la tinta y cuándo se destapa. */
const VUELTA = { cambio: 700, fin: 1500 } as const;

export function Avance() {
  const raiz = useRef<HTMLElement>(null);
  const puntos = useRef<(HTMLButtonElement | null)[]>([]);
  const gesto = useRef<{ x: number; y: number } | null>(null);
  const relojes = useRef<number[]>([]);
  const [indice, setIndice] = useState(0);
  /** Vista que queda debajo mientras la nueva se abre. */
  const [previo, setPrevio] = useState<number | null>(null);
  const [vuelta, setVuelta] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [atento, setAtento] = useState(false);
  const [enPantalla, setEnPantalla] = useState(false);
  const hito = HITOS[indice];
  const detenido = pausado || atento || !enPantalla || vuelta;

  const limpiar = () => {
    relojes.current.forEach((r) => window.clearTimeout(r));
    relojes.current = [];
  };
  useEffect(() => limpiar, []);

  useEffect(() => {
    const seccion = raiz.current;
    if (!seccion) return;
    const observador = new IntersectionObserver((entradas) => setEnPantalla(Boolean(entradas.at(-1)?.isIntersecting)), { threshold: 0.35 });
    observador.observe(seccion);
    return () => observador.disconnect();
  }, []);

  const ir = useCallback(
    (destino: number) => {
      const d = (destino + TOTAL) % TOTAL;
      if (d === indice && !vuelta) return;
      limpiar();
      const reducido = window.matchMedia(MOVIMIENTO_REDUCIDO).matches;
      // De la última a la primera: pasa por tinta en lugar de abrirse como las demás.
      if (indice === TOTAL - 1 && d === 0 && !reducido) {
        setVuelta(true);
        relojes.current.push(
          window.setTimeout(() => {
            setPrevio(null);
            setIndice(0);
          }, VUELTA.cambio),
          window.setTimeout(() => setVuelta(false), VUELTA.fin),
        );
        return;
      }
      setVuelta(false);
      setPrevio(reducido ? null : indice);
      setIndice(d);
    },
    [indice, vuelta],
  );

  function alTeclado(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const destino = { ArrowRight: (i + 1) % TOTAL, ArrowLeft: (i + TOTAL - 1) % TOTAL, Home: 0, End: TOTAL - 1 }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    puntos.current[destino]?.focus();
    ir(destino);
  }
  const alAbrir = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) setPrevio(null);
  };

  const capas = [...new Set([previo, indice, (indice + 1) % TOTAL])].filter((i): i is number => i !== null);
  const marcha = { animationPlayState: detenido ? "paused" : "running" } as const;

  return (
    <section id="avance" ref={raiz} aria-labelledby="titulo-avance" className="bg-ink text-bone">
      <div className="mx-auto max-w-[1440px] px-5 pb-[clamp(2rem,5svh,6rem)] pt-[clamp(2.5rem,6svh,5rem)] ancho:px-[clamp(2rem,4vw,3rem)]">
        <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-bone/25 pb-3">
          <h2 id="titulo-avance" className="font-display text-[clamp(2.2rem,min(5vw,7svh),4rem)] leading-none">Avance de obra</h2>
          <span className="text-sm text-mist">ReStage · IFC4</span>
        </div>

        <div
          role="group"
          aria-roledescription="carrusel"
          aria-label="Hitos terminados del edificio"
          data-detenido={detenido || undefined}
          className="grid gap-x-6 gap-y-5 ancho:grid-cols-12 ancho:items-stretch"
          onFocus={(e) => setAtento((e.target as HTMLElement).matches(":focus-visible"))}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setAtento(false)}
        >
          {/* Imagen: columnas 5 a 12. En móvil va arriba. */}
          <div className="min-w-0 ancho:order-2 ancho:col-start-5 ancho:col-end-13">
            <div
              data-escena
              data-vuelta={vuelta || undefined}
              className="relative aspect-[4/5] max-h-[62svh] w-full touch-pan-y overflow-hidden bg-ink-raised ancho:aspect-auto ancho:h-[clamp(17rem,54svh,44rem)] ancho:max-h-none"
              onPointerEnter={(e) => e.pointerType === "mouse" && setAtento(true)}
              onPointerLeave={(e) => e.pointerType === "mouse" && setAtento(false)}
              onTouchStart={(e) => {
                gesto.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                setAtento(true);
              }}
              onTouchCancel={() => {
                gesto.current = null;
                setAtento(false);
              }}
              onTouchEnd={(e) => {
                const inicio = gesto.current;
                gesto.current = null;
                setAtento(false);
                if (!inicio) return;
                const dx = e.changedTouches[0].clientX - inicio.x;
                const dy = e.changedTouches[0].clientY - inicio.y;
                if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) ir(indice + (dx < 0 ? 1 : -1));
              }}
            >
              {capas.map((i) => {
                const activa = i === indice;
                const visible = activa || i === previo;
                return (
                  <div
                    key={i}
                    data-capa={i + 1}
                    data-activa={activa || undefined}
                    aria-hidden={activa ? undefined : true}
                    onAnimationEnd={activa ? alAbrir : undefined}
                    className={cn(
                      "absolute inset-0",
                      activa ? "z-[2]" : visible ? "z-[1]" : "invisible z-0",
                      activa && previo !== null && "animate-avance-abrir motion-reduce:animate-none",
                    )}
                  >
                    <div className={cn("absolute inset-0", visible && "animate-avance-empuje motion-reduce:animate-none")} style={marcha}>
                      <Image
                        fill
                        src={`/images/avance/h${i + 1}.webp`}
                        alt={activa ? HITOS[i].alt : ""}
                        sizes="(max-width: 640px) 100vw, (max-width: 1440px) 66vw, 940px"
                        className="object-cover"
                      />
                    </div>
                  </div>
                );
              })}
              {/* La vuelta al primer hito pasa por tinta. */}
              <div
                aria-hidden="true"
                className={cn(
                  "absolute inset-0 z-[3] grid place-items-center bg-ink transition-opacity duration-500 ease-out-quart motion-reduce:hidden",
                  vuelta ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                <p className={cn("px-4 text-center font-display text-[clamp(1.5rem,3vw,2.5rem)] uppercase leading-none tracking-[0.02em] text-bone transition-[opacity,transform] duration-500 ease-out-quart", vuelta ? "translate-y-0 opacity-100 delay-200" : "translate-y-3 opacity-0")}>
                  Vuelve al primer hito <span className="text-mist">· {HITOS[0].anio}</span>
                </p>
              </div>
              <p className="absolute inset-x-0 bottom-0 z-[4] bg-[linear-gradient(0deg,rgb(10_21_34/0.82),rgb(10_21_34/0))] px-3 pb-2.5 pt-8 text-[0.8125rem] leading-snug text-bone ancho:px-4 ancho:text-sm">
                Recreación con IA sobre el modelo terminado. No es una foto de la obra en esa fecha.
              </p>
            </div>

            {/* Riel: un tramo por hito. Los ya vistos quedan en hueso; el actual se llena en ámbar. */}
            <div className="mt-3 flex items-center gap-3">
              <ol className="flex min-w-0 flex-1 gap-1.5" aria-label="Elegir hito">
                {HITOS.map((h, i) => (
                  <li key={h.registro} className="min-w-0 flex-1">
                    <button
                      type="button"
                      ref={(el) => {
                        puntos.current[i] = el;
                      }}
                      aria-label={`Hito ${h.n}: ${h.titulo}`}
                      aria-current={i === indice ? "true" : undefined}
                      onClick={() => ir(i)}
                      onKeyDown={(e) => alTeclado(e, i)}
                      className="group flex h-11 w-full flex-col justify-center gap-1.5 focus-visible:outline-offset-2"
                    >
                      <span className="relative block h-[3px] w-full overflow-hidden bg-bone/20 transition-colors duration-200 group-hover:bg-bone/35">
                        <span
                          className={cn("absolute inset-0 origin-left bg-bone/70 transition-transform duration-500 ease-out-quart motion-reduce:transition-none", i < indice && !vuelta ? "scale-x-100" : "scale-x-0")}
                          style={{ transitionDelay: vuelta ? `${(TOTAL - 1 - i) * 45}ms` : "0ms" }}
                        />
                        {i === indice && !vuelta && (
                          <span
                            key={indice}
                            data-llenado
                            onAnimationEnd={() => ir(indice + 1)}
                            className="absolute inset-0 origin-left animate-avance-llenar bg-amber motion-reduce:animate-none"
                            style={marcha}
                          />
                        )}
                      </span>
                      <span aria-hidden="true" className={cn("font-mono text-xs tabular-nums transition-colors duration-200", i === indice ? "text-bone" : "text-mist/70 group-hover:text-mist")}>
                        {String(h.n).padStart(2, "0")}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="flex shrink-0">
                <button
                  type="button"
                  aria-pressed={pausado}
                  aria-label={pausado ? "Reanudar el carrusel" : "Pausar el carrusel"}
                  onClick={() => setPausado((p) => !p)}
                  className="grid size-11 place-items-center rounded-full transition-colors duration-200 hover:bg-bone/10 motion-reduce:hidden"
                >
                  {pausado ? <Play aria-hidden="true" weight="fill" className="size-4" /> : <Pause aria-hidden="true" weight="fill" className="size-4" />}
                </button>
                <button type="button" aria-label="Hito anterior" onClick={() => ir(indice - 1)} className="grid size-11 place-items-center rounded-full transition-colors duration-200 hover:bg-bone/10">
                  <ArrowLeft aria-hidden="true" className="size-5" />
                </button>
                <button type="button" aria-label="Hito siguiente" onClick={() => ir(indice + 1)} className="grid size-11 place-items-center rounded-full transition-colors duration-200 hover:bg-bone/10">
                  <ArrowRight aria-hidden="true" className="size-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Hito: columnas 1 a 4. */}
          <div className="flex min-w-0 flex-col ancho:order-1 ancho:col-span-4 ancho:pr-4" aria-live={detenido ? "polite" : "off"} aria-atomic="true">
            <div key={indice} className="animate-fade-up motion-reduce:animate-none">
              <p className="flex items-baseline gap-2 font-display leading-none">
                <span className="text-[clamp(3.5rem,min(7vw,13svh),7rem)] tabular-nums">{String(hito.n).padStart(2, "0")}</span>
                <span className="text-[clamp(1.25rem,2vw,1.75rem)] text-mist">de {String(TOTAL).padStart(2, "0")}</span>
              </p>
              <h3 className="mt-2 text-balance font-display text-[clamp(1.75rem,min(3.2vw,6svh),3rem)] uppercase leading-[0.95]">{hito.titulo}</h3>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[0.9375rem] leading-snug ancho:text-base">
                <dt className="text-mist">Terminado el</dt>
                <dd className="font-semibold">
                  <time dateTime={hito.fecha}>{hito.fechaTexto}</time>
                </dd>
                <dt className="text-mist">En el IFC</dt>
                <dd>
                  <span className="font-mono text-[0.875em]">{hito.registro}</span> · {hito.elementos} elementos
                </dd>
                <dt className="text-mist">Vista</dt>
                <dd>{hito.lugar}</dd>
              </dl>
            </div>
            {/* Dónde queda el hito dentro del edificio: sus piezas, en ámbar sobre la silueta. */}
            <figure className="mt-auto hidden pt-5 ancho:block">
              <div className="relative aspect-[4/3] w-full max-w-[19rem] [@media(max-height:860px)]:max-w-[12.5rem]">
                <Image key={indice} fill src={`/images/avance/loc-${hito.n}.webp`} alt={`Silueta del edificio con las piezas de «${hito.titulo}» resaltadas.`} sizes="304px" className="animate-fade-up object-contain motion-reduce:animate-none" />
              </div>
              <figcaption className="mt-1 text-sm text-mist">Piezas del hito dentro del modelo</figcaption>
            </figure>
          </div>
        </div>

        <p className="mt-5 border-t border-bone/20 pt-3 text-sm text-mist">
          Fechas de terminación registradas en el IFC ·{" "}
          <a href={FUENTE_MODELO.url} className="underline underline-offset-4">
            Fuente del proyecto
          </a>
        </p>
      </div>
    </section>
  );
}
