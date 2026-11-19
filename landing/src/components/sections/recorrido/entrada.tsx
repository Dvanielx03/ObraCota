"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { FRASE } from "@/lib/caso";

// La frase del producto, partida donde termina su primera idea: «…en el plano.»
const CORTE = FRASE.indexOf(". ") + 1;
const PROBLEMA = FRASE.slice(0, CORTE); // «Un detalle cambia en el plano.»
const RESPUESTA = FRASE.slice(CORTE + 1);
const ANTES = PROBLEMA.replace(/\s*plano\.$/i, ""); // «Un detalle cambia en el»
const PALABRA = "PLANO";
/** Posición de la «O» dentro de la palabra: por su hueco entra la cámara. */
const LETRA = PALABRA.indexOf("O");

const limitar = (x: number) => Math.min(1, Math.max(0, x));
const tramo = (q: number, a: number, b: number) => limitar((q - a) / (b - a));
const suave = (t: number) => t * t * (3 - 2 * t);

export type Entrada = {
  /** Lleva la capa al avance indicado (0 = frase quieta, 1 = ya dentro del modelo). */
  pintar: (q: number) => void;
};

/**
 * Cuánto del modelo se ve todavía como plano (solo líneas). Se rellena mientras la cámara
 * aún cruza la letra: al llegar, el modelo ya tiene su color y no hay espera.
 */
export const planoEn = (q: number) => 1 - suave(tramo(q, 0.46, 0.8));
/**
 * Cuánto papel claro hay detrás del plano. Solo se ve dentro del hueco mientras es pequeño:
 * se apaga antes de que el hueco llene la pantalla, para que nunca haya un fogonazo claro.
 */
export const papelEn = (q: number) => suave(tramo(q, 0.08, 0.26)) * (1 - suave(tramo(q, 0.4, 0.72)));

/**
 * Entrada al recorrido: la frase termina en un gran «PLANO» y el scroll acerca la cámara
 * hasta cruzar el hueco de la «O». Dentro del hueco ya está el edificio, dibujado en
 * líneas; al llenar la pantalla, las líneas se rellenan y empieza el recorrido 3D.
 *
 * Las letras son texto vectorial: el zoom cambia el encuadre del SVG (`viewBox`), no
 * estira una imagen, así que se mantienen nítidas a cualquier escala.
 */
export const EntradaPlano = forwardRef<Entrada, { className?: string }>(function EntradaPlano({ className }, ref) {
  const raiz = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const palabra = useRef<SVGTextElement>(null);
  const palabraMascara = useRef<SVGTextElement>(null);
  const hueco = useRef<SVGRectElement>(null);
  const fondo = useRef<SVGRectElement>(null);
  const mascaraFondo = useRef<SVGRectElement>(null);
  const arriba = useRef<HTMLParagraphElement>(null);
  const abajo = useRef<HTMLParagraphElement>(null);
  /** Geometría medida: tamaño del escenario, centro del hueco y escala final. */
  const medida = useRef({ ancho: 1, alto: 1, cx: 0.5, cy: 0.5, escala: 30, listo: false });
  const avance = useRef(0);

  const pintar = (q: number) => {
    avance.current = q;
    const capa = raiz.current;
    const m = medida.current;
    if (!capa || !svg.current || !m.listo) return;
    // Zoom exponencial, con arranque suave y sin frenar al final: la cámara cruza la letra a
    // velocidad plena y la entrada termina justo cuando el hueco cubre la pantalla.
    const t = Math.pow(tramo(q, 0.08, 1), 1.4);
    const s = Math.pow(m.escala, t);
    const w = m.ancho / s;
    const h = m.alto / s;
    // El encuadre se cierra sobre el hueco y, a la vez, lo lleva al centro de la pantalla.
    const fx = m.cx / m.ancho + (0.5 - m.cx / m.ancho) * t;
    const fy = m.cy / m.alto + (0.5 - m.cy / m.alto) * t;
    svg.current.setAttribute("viewBox", `${m.cx - w * fx} ${m.cy - h * fy} ${w} ${h}`);
    const textos = String(1 - suave(tramo(q, 0.1, 0.26)));
    if (arriba.current) arriba.current.style.opacity = textos;
    if (abajo.current) abajo.current.style.opacity = textos;
    // De cerca, el trazo de la letra ocuparía media pantalla en claro: se va apagando hacia
    // el fondo para que lo único luminoso sea el modelo que asoma por el hueco.
    if (palabra.current) palabra.current.style.opacity = String(1 - 0.82 * suave(tramo(q, 0.48, 0.9)));
    // Cuando el hueco ya cubre la pantalla, la capa deja de existir.
    capa.style.visibility = q >= 0.97 ? "hidden" : "visible";
  };
  useImperativeHandle(ref, () => ({ pintar }));

  useEffect(() => {
    const capa = raiz.current;
    if (!capa) return;
    const medir = () => {
      const texto = palabra.current;
      if (!texto || !hueco.current) return;
      const ancho = capa.clientWidth;
      const alto = capa.clientHeight;
      const margen = ancho >= 1024 ? Math.max(48, (ancho - 1344) / 2) : 16;
      // La palabra ocupa el ancho útil sin pasarse de alto. Bebas Neue: 0,4 em por letra y 0,7 em de alto.
      const cuerpo = Math.min((ancho - margen * 2) / 2.04, (alto * 0.5) / 0.7);
      const base = alto * 0.5 + cuerpo * 0.35;
      for (const t of [texto, palabraMascara.current]) {
        if (!t) continue;
        t.setAttribute("x", String(margen - cuerpo * 0.025));
        t.setAttribute("y", String(base));
        t.setAttribute("font-size", String(cuerpo));
      }
      for (const r of [fondo.current, mascaraFondo.current]) {
        if (!r) continue;
        // El fondo se extiende mucho más allá de la pantalla: al acercarse nunca se ve su borde.
        r.setAttribute("x", String(-ancho * 2));
        r.setAttribute("y", String(-alto * 2));
        r.setAttribute("width", String(ancho * 5));
        r.setAttribute("height", String(alto * 5));
      }
      const celda = texto.getExtentOfChar(LETRA);
      // El hueco queda por dentro del trazo de la «O»; la propia letra, dibujada encima en la
      // máscara, recorta su borde exacto.
      const x = celda.x + cuerpo * 0.085;
      const y = base - cuerpo * 0.7 + cuerpo * 0.05;
      const w = celda.width - cuerpo * 0.17;
      const h = cuerpo * 0.6;
      hueco.current.setAttribute("x", String(x));
      hueco.current.setAttribute("y", String(y));
      hueco.current.setAttribute("width", String(Math.max(w, 1)));
      hueco.current.setAttribute("height", String(h));
      hueco.current.setAttribute("rx", String(cuerpo * 0.1));
      // Hueco interior real de la letra, para saber cuánto hay que acercarse hasta que tape la pantalla.
      const huecoAncho = Math.max(celda.width - cuerpo * 0.3, 1);
      const huecoAlto = cuerpo * 0.46;
      medida.current = {
        ancho,
        alto,
        cx: celda.x + celda.width / 2,
        cy: base - cuerpo * 0.35,
        escala: 1.4 * Math.max(ancho / huecoAncho, alto / huecoAlto),
        listo: true,
      };
      if (arriba.current) arriba.current.style.bottom = `${alto - (base - cuerpo * 0.7) + cuerpo * 0.06}px`;
      if (abajo.current) abajo.current.style.top = `${base + cuerpo * 0.1}px`;
      pintar(avance.current);
    };
    const observador = new ResizeObserver(medir);
    observador.observe(capa);
    // La medida depende de la tipografía: se repite cuando Bebas Neue termina de cargar.
    void document.fonts.ready.then(medir);
    return () => observador.disconnect();
  }, []);

  return (
    <div ref={raiz} data-entrada className={className}>
      <svg ref={svg} aria-hidden="true" className="absolute inset-0 size-full" preserveAspectRatio="none">
        <defs>
          <mask id="entrada-hueco" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">
            <rect ref={mascaraFondo} fill="#fff" />
            <rect ref={hueco} fill="#000" />
            <text ref={palabraMascara} fill="#fff" style={{ fontFamily: "var(--font-bebas)" }}>
              {PALABRA}
            </text>
          </mask>
        </defs>
        <rect ref={fondo} className="fill-ink" mask="url(#entrada-hueco)" />
        <text ref={palabra} className="fill-bone" style={{ fontFamily: "var(--font-bebas)" }}>
          {PALABRA}
        </text>
      </svg>
      <p className="sr-only">{FRASE}</p>
      <p
        ref={arriba}
        aria-hidden="true"
        className="absolute left-4 max-w-[80%] text-[clamp(1.375rem,min(5.6vw,4.2svh),2.75rem)] font-medium leading-tight tracking-[-0.02em] text-mist ancho:left-[max(3rem,calc((100%-84rem)/2))]"
      >
        {ANTES}
      </p>
      <p
        ref={abajo}
        aria-hidden="true"
        className="absolute left-4 right-4 max-w-[34rem] text-[clamp(1.0625rem,min(4.4vw,3.2svh),1.75rem)] font-medium leading-snug tracking-[-0.015em] text-bone ancho:left-[max(3rem,calc((100%-84rem)/2))] ancho:max-w-[44rem]"
      >
        {RESPUESTA}
      </p>
    </div>
  );
});
