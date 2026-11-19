import type Lenis from "lenis";

let lenis: Lenis | null = null;

/** La instancia de scroll suave, si está activa (no lo está con movimiento reducido). */
export const fijarLenis = (instancia: Lenis | null) => {
  lenis = instancia;
};

/** Lleva la página a una posición en píxeles, con o sin animación. */
export function desplazarA(destino: number, inmediato = false) {
  if (lenis) lenis.scrollTo(destino, { immediate: inmediato, duration: inmediato ? 0 : 1.1, force: true });
  else window.scrollTo({ top: destino, behavior: "auto" });
}
