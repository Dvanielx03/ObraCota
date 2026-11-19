"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

import { gsap, MOVIMIENTO_OK, ScrollTrigger } from "@/lib/gsap";
import { NAVEGACION } from "@/lib/caso";
import { fijarLenis } from "@/lib/scroll";

/**
 * Scroll suave de la página. Lenis no tiene bucle propio: avanza con el reloj de GSAP,
 * de modo que ScrollTrigger y el visor 3D leen la misma posición en el mismo cuadro.
 * Con movimiento reducido, los enlaces se resuelven sin interpolación.
 */
export function ScrollSuave() {
  useEffect(() => {
    const movimiento = window.matchMedia(MOVIMIENTO_OK);
    const lenis = new Lenis({
      autoRaf: false,
      lerp: 0.12,
      smoothWheel: movimiento.matches,
      // Se detiene solo cuando un diálogo bloquea el scroll del documento (menú móvil).
      autoToggle: true,
      allowNestedScroll: true,
      stopInertiaOnNavigate: true,
    });
    // El CSS de la página pide scroll suave nativo; con Lenis activo se pisarían.
    const raiz = document.documentElement;
    const previo = raiz.style.scrollBehavior;
    raiz.style.scrollBehavior = "auto";
    const avanzar = (tiempo: number) => lenis.raf(tiempo * 1000);
    lenis.on("scroll", ScrollTrigger.update);
    // Viaje a un ancla. El destino se calcula al pulsar, pero el alto de la página puede
    // cambiar después (el recorrido fijado añade su tramo al hidratar). Durante unos
    // segundos se comprueba la llegada y, si quedó corta, se vuelve a apuntar. Cualquier
    // gesto de la persona cancela la comprobación.
    // #inicio apunta al último cuadro de la pista, con la portada todavía a pantalla completa.
    const posicionDe = (destino: HTMLElement) => {
      const pista = destino.id === "inicio" && destino.closest("[data-portada-pista]");
      if (pista) return window.scrollY + pista.getBoundingClientRect().bottom - destino.offsetHeight;
      const margen = parseFloat(getComputedStyle(raiz).scrollPaddingTop) || 0;
      return window.scrollY + destino.getBoundingClientRect().top - margen;
    };
    let viaje: { destino: HTMLElement; hasta: number; directo: boolean } | null = null;
    const ancla = window.location.hash.length > 1 ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
    // Al entrar con un ancla en la URL no hay viaje que animar: se corrige de golpe.
    if (ancla) viaje = { destino: ancla, hasta: performance.now() + 4000, directo: true };
    let entrada: gsap.core.Tween | undefined;
    const alPulsar = (evento: MouseEvent) => {
      if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      const enlace = (evento.target as Element | null)?.closest<HTMLAnchorElement>("a[href^='#'], a[href='/#inicio']");
      const destino = enlace && enlace.pathname === location.pathname && document.getElementById(enlace.hash.slice(1));
      if (!enlace || !destino || !NAVEGACION.some(({ id }) => id === destino.id)) {
        viaje = null;
        return;
      }
      evento.preventDefault();
      if (location.hash !== enlace.hash) history.pushState(history.state, "", enlace.hash);
      window.dispatchEvent(new CustomEvent("obracota:navegar", { detail: destino.id }));
      lenis.resize();
      const margen = parseFloat(getComputedStyle(raiz).scrollPaddingTop) || 0;
      const { top, bottom } = destino.getBoundingClientRect();
      const cerca = bottom > margen && top < innerHeight && Math.abs(top - margen) < innerHeight;
      viaje = { destino, hasta: performance.now() + 4000, directo: destino.id === "inicio" || !cerca || !movimiento.matches };
      lenis.scrollTo(posicionDe(destino), {
        immediate: viaje.directo, duration: 0.28, force: true,
      });
      entrada?.revert();
      const titulo = destino.querySelector("h1, h2");
      if (titulo && movimiento.matches && !cerca) {
        entrada = gsap.from(titulo, { y: 8, duration: 0.2, ease: "power2.out", clearProps: "transform" });
      }
      if (evento.detail === 0) {
        if (!destino.hasAttribute("tabindex")) destino.tabIndex = -1;
        destino.focus({ preventScroll: true });
      }
    };
    const soltar = () => {
      viaje = null;
    };
    const comprobar = window.setInterval(() => {
      if (!viaje) return;
      if (performance.now() > viaje.hasta) return soltar();
      // Una llegada directa no espera: Lenis puede quedarse «en marcha» contra un límite viejo.
      if (lenis.isScrolling && !viaje.directo) return;
      const limite = document.documentElement.scrollHeight - window.innerHeight;
      const desvio = posicionDe(viaje.destino) - window.scrollY;
      const alFondo = window.scrollY >= limite - 2 && desvio > 0;
      // Se apunta a una posición calculada aquí, con el mismo margen que se comprueba:
      // así la corrección converge y no se repite.
      if (Math.abs(desvio) <= 6 || alFondo || (window.scrollY === 0 && desvio < 0)) return;
      // El alto de la página pudo cambiar desde que Lenis midió: sin esto recorta el destino.
      lenis.resize();
      lenis.scrollTo(Math.min(limite, window.scrollY + desvio), { immediate: true, force: true });
    }, 120);
    window.addEventListener("popstate", soltar);
    document.addEventListener("click", alPulsar, true);
    for (const gesto of ["wheel", "touchstart", "keydown", "pointerdown"] as const) window.addEventListener(gesto, soltar, { passive: true });
    gsap.ticker.add(avanzar);
    gsap.ticker.lagSmoothing(0);
    fijarLenis(lenis);
    return () => {
      entrada?.revert();
      window.removeEventListener("popstate", soltar);
      fijarLenis(null);
      raiz.style.scrollBehavior = previo;
      document.removeEventListener("click", alPulsar, true);
      for (const gesto of ["wheel", "touchstart", "keydown", "pointerdown"] as const) window.removeEventListener(gesto, soltar);
      window.clearInterval(comprobar);
      gsap.ticker.remove(avanzar);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    };
  }, []);
  return null;
}
