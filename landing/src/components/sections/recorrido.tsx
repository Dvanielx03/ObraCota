"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowClockwise, ArrowCounterClockwise } from "@phosphor-icons/react/dist/ssr";
import { cn } from "cn";

import fichaJson from "@/lib/modelo/ficha-restage.json";
import { FRASE } from "@/lib/caso";
import { DETALLE, FUENTE_MODELO, URL_MODELO } from "@/lib/modelo/fuente";
import { gsap, MOVIMIENTO_OK, MOVIMIENTO_REDUCIDO, type ScrollTrigger, useGSAP } from "@/lib/gsap";
import { desplazarA } from "@/lib/scroll";
import { AVANCE_LIBRE, type Encuadre, estadoEn, estadoFinal, etiquetaVisible, type FaseId, FASES, faseDe } from "./recorrido/coreografia";
import { type Entrada, EntradaPlano, papelEn, planoEn } from "./recorrido/entrada";
import { construirSecuencia, fechaHito, type FichaModelo, nombreHito } from "./recorrido/secuencia";
import type { VisorModelo } from "./recorrido/visor";

/** Pantallas de scroll: primero la entrada por la «O» de PLANO, después el recorrido. */
const TRAMO = { ancho: { entrada: 180, recorrido: 640 }, corto: { entrada: 150, recorrido: 520 } } as const;

const ficha = fichaJson as unknown as FichaModelo;
const SECUENCIA = construirSecuencia(ficha);
const HITOS = SECUENCIA.hitos ?? [];
const MEGAS = (ficha.totales.bytesGlb / 1_048_576).toFixed(1).replace(".", ",");
const ELEMENTOS = ficha.totales.elementos.toLocaleString("es-CO");
/** Hito en el que el IFC da por terminada la viga del detalle. */
const HITO_DETALLE = HITOS[ficha.cubos.find((c) => c.destacado === "viga")?.hito ?? -1];

const TEXTOS: Record<FaseId, string> = {
  reconocer: `Un edificio real de acero, madera y concreto, abierto en el navegador desde su archivo IFC: ${ELEMENTOS} elementos.`,
  separar: "Cimentación, planta baja, planta alta y cubierta se separan. La viga en ámbar sube con la cubierta; su columna se queda abajo.",
  entrar: "La misma viga, de cerca. La cámara cruza el vano que ella enmarca y se detiene bajo el nudo.",
  estructura: "Solo queda la estructura. Desde el otro lado de la columna se ve llegar una segunda viga al mismo apoyo.",
  tiempo: `El edificio se recompone con las ${HITOS.length} fechas reales de terminación que trae el archivo.`,
};

type Carga = "espera" | "cargando" | "listo" | "error";

const BOTON_REDONDO =
  "grid size-11 place-items-center rounded-full border border-bone/50 bg-ink-deep/80 text-bone transition-[background-color,transform] duration-300 ease-out-quart hover:bg-bone/10 active:scale-[0.96]";

/** El scroll presenta los hitos. Al terminar, la línea permite revisarlos. */
function ControlHitos({ tiempo, libre, alCambiar }: {
  tiempo: number;
  libre: boolean;
  alCambiar: (t: number) => void;
}) {
  const total = HITOS.length;
  const hechos = Math.min(total, Math.floor(tiempo * total + 1e-6));
  const hito = HITOS[hechos - 1];
  const titulo = hito ? nombreHito(hito) : "Antes del primer hito";

  return (
    <div className="rounded-lg bg-ink-black/90 p-4 lg:p-5">
      <div className="flex items-baseline justify-between gap-3 text-xs tabular-nums text-mist">
        <span>Hito {hechos} de {total}</span>
        {hito && <span data-fecha-tiempo>{fechaHito(hito)}</span>}
      </div>
      <p data-rotulo-tiempo className="mt-1 text-sm font-semibold text-bone">{titulo}</p>
      {libre ? (
        <input
          type="range"
          aria-label="Elegir hito de construcción"
          aria-valuetext={hito ? `${titulo}, ${fechaHito(hito)}` : titulo}
          min={0}
          max={total}
          step={1}
          value={hechos}
          onChange={(e) => alCambiar(Number(e.target.value) / total)}
          className="block min-h-11 w-full cursor-pointer accent-amber"
        />
      ) : (
        <div aria-hidden="true" className="mt-3 flex gap-1">
          {HITOS.map((h, i) => (
            <span key={h.nombre} className={`h-0.5 flex-1 rounded-full ${i < hechos ? "bg-amber" : "bg-bone/25"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Recorrido() {
  const raiz = useRef<HTMLElement>(null);
  const escenario = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const visor = useRef<VisorModelo | null>(null);
  const disparador = useRef<ScrollTrigger | null>(null);
  const arrastre = useRef<number | null>(null);
  /** Única fuente de verdad del recorrido: avance del scroll y, al final, el control manual. */
  const mando = useRef({ avance: 0, libre: false, tiempo: 1, giro: 0, entrada: 1 });
  const entrada = useRef<Entrada>(null);
  const papel = useRef<HTMLDivElement>(null);
  /** Parte del tramo fijado que ocupa la entrada (0 cuando no hay recorrido con scroll). */
  const parteEntrada = useRef(0);
  const encuadre = useRef<Encuadre>({ aspecto: 1.6, util: 1, vertical: false });

  const [carga, setCarga] = useState<Carga>("espera");
  const [fase, setFase] = useState<FaseId>("reconocer");
  const [tiempo, setTiempo] = useState(0);
  const [libre, setLibre] = useState(false);
  const [conEtiqueta, setConEtiqueta] = useState(false);
  const [segundaLectura, setSegundaLectura] = useState(false);
  const [enPortada, setEnPortada] = useState(true);

  /** Dibuja el estado actual del mando y pone la interfaz al día. */
  const pintar = useCallback(() => {
    const m = mando.current;
    const estado = m.libre ? estadoFinal(encuadre.current, m.tiempo, m.giro) : estadoEn(m.avance, encuadre.current);
    // Durante la entrada el modelo se ve como plano sobre papel; al terminar, se rellena.
    estado.plano = m.entrada < 1 ? planoEn(m.entrada) : 0;
    if (papel.current) papel.current.style.opacity = String(m.entrada < 1 ? papelEn(m.entrada) : 0);
    // La interfaz del recorrido espera a que termine la entrada.
    if (escenario.current) escenario.current.dataset.dentro = String(m.entrada >= 1);
    entrada.current?.pintar(m.entrada);
    visor.current?.aplicar(estado);
    const nueva = faseDe(m.avance);
    setFase((f) => (f === nueva ? f : nueva));
    setLibre((l) => (l === m.libre ? l : m.libre));
    const etiqueta = !m.libre && etiquetaVisible(m.avance);
    setConEtiqueta((v) => (v === etiqueta ? v : etiqueta));
    setSegundaLectura((v) => (v === m.avance > 0.7 ? v : m.avance > 0.7));
    setEnPortada((v) => (v === m.avance < 0.045 ? v : m.avance < 0.045));
    const t = Math.round(estado.tiempo * 400) / 400;
    setTiempo((previo) => (previo === t ? previo : t));
  }, []);

  /** Coloca el recorrido en un avance concreto (scroll, botones o movimiento reducido). */
  const fijarAvance = useCallback(
    (p: number) => {
      const m = mando.current;
      const yaLibre = p >= AVANCE_LIBRE;
      if (yaLibre && !m.libre) Object.assign(m, { tiempo: 1, giro: 0 });
      m.avance = p;
      m.libre = yaLibre;
      pintar();
    },
    [pintar],
  );

  // El visor y el modelo se piden cuando la sección se acerca a la pantalla.
  useEffect(() => {
    const seccion = raiz.current;
    const marco = escenario.current;
    if (!seccion || !marco) return;
    let cancelado = false;

    const medir = () => {
      const vertical = window.matchMedia("(max-width: 1023px)").matches;
      const ancho = Math.max(marco.clientWidth, 1);
      const alto = Math.max(marco.clientHeight, 1);
      // En vertical, los controles ocupan la franja de abajo y el header la de arriba.
      const abajo = vertical ? (panel.current?.offsetHeight ?? 0) + 12 : 0;
      const arriba = vertical ? 132 : 0;
      encuadre.current = { aspecto: ancho / alto, util: (alto - abajo - arriba) / alto, vertical };
      // En horizontal la escena se corre a la derecha: a la izquierda viven el título y el pie.
      visor.current?.fijarMargen(abajo - arriba, vertical ? 0 : ancho * 0.08);
      pintar();
    };
    const tamano = new ResizeObserver(medir);
    tamano.observe(marco);
    if (panel.current) tamano.observe(panel.current);

    const observador = new IntersectionObserver(
      async (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        observador.disconnect();
        setCarga("cargando");
        try {
          const { VisorModelo } = await import("./recorrido/visor");
          if (cancelado || !lienzo.current) return;
          const movil = window.matchMedia("(max-width: 1023px)").matches;
          const nuevo = new VisorModelo(lienzo.current, ficha, SECUENCIA, {
            sombras: !movil,
            pixelRatioMax: movil ? 1.5 : 2,
            ancla: DETALLE.ancla,
          });
          visor.current = nuevo;
          await nuevo.cargar(URL_MODELO);
          if (cancelado) return;
          medir();
          setCarga("listo");
        } catch {
          if (!cancelado) setCarga("error");
        }
      },
      { rootMargin: "150% 0px" },
    );
    observador.observe(seccion);
    return () => {
      cancelado = true;
      observador.disconnect();
      tamano.disconnect();
      visor.current?.destruir();
      visor.current = null;
    };
  }, [pintar]);

  // Momento central de la página: la pantalla se fija y el scroll conduce todo el recorrido.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOVIMIENTO_OK, () => {
        const corto = window.matchMedia("(max-width: 1023px)").matches;
        const tramo = corto ? TRAMO.corto : TRAMO.ancho;
        const parte = tramo.entrada / (tramo.entrada + tramo.recorrido);
        parteEntrada.current = parte;
        mando.current.entrada = 0;
        if (raiz.current) raiz.current.dataset.tramoEntrada = String(parte);
        const guia = { p: 0 };
        const tween = gsap.to(guia, {
          p: 1,
          ease: "none",
          // Un solo avance: su primera parte mueve la entrada y el resto, el recorrido.
          onUpdate: () => {
            // El suavizado del scroll puede quedarse a una milésima del final: se da por terminado.
            const q = guia.p / parte;
            mando.current.entrada = q > 0.995 ? 1 : q;
            fijarAvance(Math.max(0, (guia.p - parte) / (1 - parte)));
          },
          scrollTrigger: {
            trigger: escenario.current,
            start: "top top",
            end: `+=${tramo.entrada + tramo.recorrido}%`,
            pin: true,
            scrub: 0.3,
            anticipatePin: 1,
          },
        });
        disparador.current = tween.scrollTrigger ?? null;
        pintar();
        return () => {
          disparador.current = null;
          parteEntrada.current = 0;
          mando.current.entrada = 1;
        };
      });
    },
    { scope: raiz },
  );

  const irAFase = (id: FaseId) => {
    const destino = FASES.find((f) => f.id === id);
    if (!destino) return;
    const st = disparador.current;
    const parte = parteEntrada.current;
    if (st) desplazarA(st.start + (st.end - st.start) * (parte + (1 - parte) * destino.reposo));
    else fijarAvance(destino.reposo);
  };

  /** Termina de golpe el suavizado del scroll para que no pise el control manual. */
  const asentar = () => {
    disparador.current?.getTween()?.progress(1);
  };

  const cambiarTiempo = (t: number) => {
    asentar();
    mando.current.tiempo = t;
    pintar();
  };

  const girar = (sentido: 1 | -1) => {
    const reducido = window.matchMedia(MOVIMIENTO_REDUCIDO).matches;
    gsap.to(mando.current, {
      giro: mando.current.giro + sentido * 0.6,
      duration: reducido ? 0 : 0.6,
      ease: "power3.out",
      onUpdate: pintar,
      onComplete: pintar,
    });
  };

  const faseActual = FASES.find((f) => f.id === fase) ?? FASES[0];
  const enTiempo = fase === "tiempo";
  const listo = carga === "listo";
  const etiqueta = segundaLectura
    ? { titulo: "Dos vigas, una columna", texto: "Cada viga llega a un tramo corto soldado a la columna y se atornilla a él." }
    : { titulo: DETALLE.titulo, texto: DETALLE.texto };
  const cierreDetalle = HITO_DETALLE ? `Terminada con la ${nombreHito(HITO_DETALLE).toLowerCase()}, el ${fechaHito(HITO_DETALLE)}.` : "";
  /** Al final, con el edificio completo, el nudo queda señalado para volver a situarlo. */
  const conMarca = listo && (conEtiqueta || (libre && tiempo >= 0.999));

  const pie = (
    <div aria-live="polite" className="flex flex-col gap-1.5">
      <p className="flex items-baseline gap-3">
        <span className="display-step text-amber">{faseActual.numero}</span>
        <span className="text-lg font-semibold text-bone lg:text-xl">{faseActual.titulo}</span>
      </p>
      <p className="text-sm text-mist lg:text-base">{TEXTOS[fase]}</p>
    </div>
  );
  const control = (
    <ControlHitos tiempo={tiempo} libre={libre} alCambiar={cambiarTiempo} />
  );

  return (
    <section id="recorrido" ref={raiz} data-fase={fase} data-carga={carga} data-libre={libre} className="bg-ink-deep">
      {/* Sin recorrido con scroll, la frase se lee aquí de una pieza. */}
      <p className="hidden px-4 pb-10 pt-28 text-statement text-bone motion-reduce:block ancho:px-[max(3rem,calc((100%-84rem)/2))]">
        {FRASE}
      </p>
      <div ref={escenario} data-dentro="true" className="group relative h-[100svh] min-h-[600px] overflow-hidden bg-ink-deep">
        {/* Papel: el fondo claro sobre el que el modelo se ve como plano durante la entrada. */}
        <div ref={papel} aria-hidden="true" className="absolute inset-0 bg-bone opacity-0" />
        <div
          ref={lienzo}
          data-lienzo
          role="img"
          aria-label={`Modelo 3D de ${FUENTE_MODELO.nombre}. ${faseActual.titulo}: ${TEXTOS[fase]}`}
          onPointerDown={(e) => {
            if (!mando.current.libre || (e.pointerType === "mouse" && e.button !== 0)) return;
            arrastre.current = e.clientX;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (arrastre.current === null) return;
            mando.current.giro -= (e.clientX - arrastre.current) * 0.006;
            arrastre.current = e.clientX;
            pintar();
          }}
          onPointerUp={() => (arrastre.current = null)}
          onPointerCancel={() => (arrastre.current = null)}
          className={cn("absolute inset-0 touch-pan-y select-none", libre && "cursor-grab active:cursor-grabbing")}
        >
          {/* Etiqueta del detalle: solo aparece con la cámara quieta, anclada a la pieza real. */}
          <div
            data-etiqueta
            aria-hidden={!conEtiqueta}
            className={cn(
              "pointer-events-none absolute z-10 left-[var(--ancla-x,50%)] top-[var(--ancla-y,50%)] transition-opacity duration-500 ease-out-quart",
              conMarca ? "opacity-100" : "opacity-0",
            )}
          >
            <span className="absolute -left-3 -top-3 block size-6 rounded-full border-2 border-amber" />
            <div className="absolute left-7 top-5 hidden w-[19rem] rounded-lg bg-ink-black/90 p-4 lg:block">
              {conEtiqueta ? (
                <>
                  <p className="text-base font-semibold text-bone">{etiqueta.titulo}</p>
                  <p className="mt-1 text-sm text-mist">{etiqueta.texto}</p>
                  <p className="mt-2 text-xs text-mist">
                    En el IFC: <span lang="en">{DETALLE.enArchivo}</span>. {cierreDetalle}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-semibold text-bone">La viga del recorrido</p>
                  <p className="mt-1 text-sm text-mist">{cierreDetalle}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {!listo && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            {carga === "error" ? (
              <figure className="pointer-events-auto mx-4 flex max-w-[44rem] flex-col gap-3">
                <Image src="/images/restage-vista.jpg" alt="Vista exterior del modelo de ReStage: pórtico de acero, volumen de madera y muros de concreto" width={1440} height={900} className="h-auto w-full rounded-lg" />
                <figcaption role="status" className="text-sm text-mist">
                  Este navegador no pudo abrir el visor 3D. Esta es una vista fija del mismo modelo; las cinco etapas siguen descritas en la lista.
                </figcaption>
              </figure>
            ) : (
              <p role="status" className="px-6 text-center text-sm text-mist">
                Cargando el modelo ({MEGAS} MB)…
              </p>
            )}
          </div>
        )}

        {/* Título dentro de la escena: se retira con el primer scroll. */}
        <div
          className={cn(
            "pointer-events-none absolute left-4 top-24 transition-[opacity,transform] duration-700 ease-out-expo group-data-[dentro=false]:!opacity-0 lg:left-12 lg:top-32",
            enPortada ? "opacity-100" : "-translate-y-3 opacity-0",
          )}
        >
          <h2 className="font-display text-[clamp(2.75rem,5.4vw,5rem)] leading-[0.92] text-bone">
            El modelo, <br />
            pieza por pieza
          </h2>
        </div>

        <EntradaPlano ref={entrada} className="pointer-events-none absolute inset-0 z-10 motion-reduce:hidden" />

        <a
          href="#expediente"
          className="absolute right-4 top-24 z-20 rounded-full bg-ink-black/80 px-4 py-2.5 text-sm font-semibold text-bone underline-offset-4 hover:underline lg:right-12 lg:top-32"
        >
          Saltar el recorrido
        </a>

        {libre && listo && (
          <div className="absolute right-4 top-40 flex gap-2 lg:right-12 lg:top-48">
            <button type="button" aria-label="Girar el modelo a la izquierda" onClick={() => girar(-1)} className={BOTON_REDONDO}>
              <ArrowCounterClockwise aria-hidden="true" weight="bold" className="size-[18px]" />
            </button>
            <button type="button" aria-label="Girar el modelo a la derecha" onClick={() => girar(1)} className={BOTON_REDONDO}>
              <ArrowClockwise aria-hidden="true" weight="bold" className="size-[18px]" />
            </button>
          </div>
        )}

        {/* Escritorio: pie abajo a la izquierda y riel de etapas a la derecha. */}
        <div className="absolute bottom-10 left-12 hidden w-[27rem] transition-opacity duration-500 ease-out-quart group-data-[dentro=false]:pointer-events-none group-data-[dentro=false]:opacity-0 lg:block">
          {enTiempo ? control : <div className="rounded-lg bg-ink-black/85 p-5">{pie}</div>}
        </div>
        <ol aria-label="Etapas del recorrido" className="absolute right-12 top-1/2 hidden -translate-y-1/2 flex-col items-end gap-1 transition-opacity duration-500 ease-out-quart group-data-[dentro=false]:pointer-events-none group-data-[dentro=false]:opacity-0 lg:flex">
          {FASES.map((f) => {
            const activa = f.id === fase;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => irAFase(f.id)}
                  aria-current={activa ? "step" : undefined}
                  className="group flex h-11 items-center gap-3 rounded-full pl-4 pr-1 text-sm"
                >
                  <span
                    className={cn(
                      "rounded-full bg-ink-black/90 px-3 py-1.5 font-semibold transition-opacity duration-300 ease-out-quart group-hover:opacity-100 group-focus-visible:opacity-100",
                      activa ? "text-bone opacity-100" : "text-mist opacity-0",
                    )}
                  >
                    {f.numero} · {f.titulo}
                  </span>
                  <span
                    className={cn(
                      "block size-2.5 rounded-full transition-[background-color,transform] duration-300 ease-out-quart",
                      activa ? "scale-125 bg-amber" : "bg-mist/60 group-hover:bg-bone",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ol>

        {/* Móvil: una tarjeta abajo; la cámara centra la pieza en el espacio que queda encima. */}
        <div ref={panel} className="absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-ink-deep/95 px-4 pb-4 pt-3 transition-opacity duration-500 ease-out-quart group-data-[dentro=false]:pointer-events-none group-data-[dentro=false]:opacity-0 lg:hidden">
          <div role="group" aria-label="Etapas del recorrido" className="flex gap-1.5">
            {FASES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => irAFase(f.id)}
                aria-pressed={f.id === fase}
                aria-label={`${f.numero}, ${f.titulo}`}
                className="grid h-11 flex-1 place-items-center"
              >
                <span className={cn("block h-1.5 w-full rounded-full transition-colors duration-300 ease-out-quart", f.id === fase ? "bg-amber" : "bg-mist/40")} />
              </button>
            ))}
          </div>
          {enTiempo ? (
            control
          ) : conEtiqueta ? (
            <div aria-live="polite" className="flex flex-col gap-1">
              <p className="text-lg font-semibold text-bone">{etiqueta.titulo}</p>
              <p className="text-sm text-mist">{etiqueta.texto}</p>
              <p className="text-xs text-mist">
                En el IFC: <span lang="en">{DETALLE.enArchivo}</span>. {cierreDetalle}
              </p>
            </div>
          ) : (
            pie
          )}
        </div>
      </div>

      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 pb-20 pt-6 text-sm text-mist lg:flex-row lg:items-baseline lg:justify-between lg:gap-12 lg:px-12 lg:pb-28">
        <p className="shrink-0 tabular-nums">
          {ELEMENTOS} elementos · {ficha.niveles.length} plantas · {ficha.fuente.esquema}
        </p>
        {process.env.NEXT_PUBLIC_PANEL_URL && <a className="inline-flex min-h-11 items-center font-semibold text-bone underline underline-offset-4"
          href={process.env.NEXT_PUBLIC_PANEL_URL.replace(/\/$/, "") + "/proyectos/restage/visor?desde=recorrido"}>Abrir ReStage en el visor ↗</a>}
        <details className="max-w-[44rem] lg:text-right">
          <summary className="cursor-pointer py-2 font-semibold text-bone">ReStage · Créditos</summary>
          <p className="py-2">
          Modelo: {FUENTE_MODELO.nombre}, de {FUENTE_MODELO.autores}.{" "}
          <a href={FUENTE_MODELO.url} target="_blank" rel="noreferrer" className="font-semibold text-bone underline">
            {FUENTE_MODELO.enlace}
          </a>
          . Licencia{" "}
          <a href={FUENTE_MODELO.urlLicencia} target="_blank" rel="noreferrer" className="font-semibold text-bone underline">
            {FUENTE_MODELO.licencia}
          </a>
          . {FUENTE_MODELO.cambios} Las imágenes de portada son recreaciones con IA del modelo.
          </p>
        </details>
      </div>
    </section>
  );
}
