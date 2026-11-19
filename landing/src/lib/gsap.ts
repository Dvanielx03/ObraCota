"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);
// En móvil la barra del navegador cambia el alto de la ventana: no se recalcula por eso.
ScrollTrigger.config({ ignoreMobileResize: true });

// Identidad de movimiento: una curva de llegada y tres duraciones.
gsap.defaults({ ease: "expo.out", duration: 0.8 });

export const DURACION = { rapida: 0.2, normal: 0.5, lenta: 0.8 } as const;
export const MOVIMIENTO_OK = "(prefers-reduced-motion: no-preference)";
export const MOVIMIENTO_REDUCIDO = "(prefers-reduced-motion: reduce)";

if (typeof window !== "undefined") {
  // Para las capturas y pruebas: permite leer el tramo fijado desde fuera.
  (window as unknown as { ScrollTrigger: typeof ScrollTrigger }).ScrollTrigger = ScrollTrigger;
  // Los titulares cambian de alto al llegar Bebas Neue: se recalculan los disparadores.
  void document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

export { gsap, ScrollTrigger, useGSAP };
