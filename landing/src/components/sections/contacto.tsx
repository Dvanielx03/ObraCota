import { ContactoFondo } from "./contacto-fondo";
import { FormularioDemo } from "./formulario-demo";

/**
 * Cierre de la página: la foto de la casa terminada ocupa toda la sección, sin marco, y el
 * formulario flota encima en una tarjeta hueso sobre el lado izquierdo. La casa queda libre
 * a la derecha. El fondo enseña cómo empezó (el terreno) y cómo termina (ver ContactoFondo).
 * En móvil se apila: la foto arriba y la tarjeta debajo, montada sobre su borde inferior.
 */
export function Contacto() {
  return (
    <section id="contacto" aria-labelledby="titulo-contacto" className="relative bg-ink-deep">
      <div data-contacto-escena className="relative isolate flow-root motion-safe:sticky motion-safe:top-20 lg:motion-safe:top-28 bg-ink-deep lg:flex lg:min-h-[calc(100svh-7rem)] lg:items-center lg:px-[max(3rem,calc((100%-84rem)/2))] lg:py-[clamp(1.25rem,4svh,3rem)]">
        <ContactoFondo />

        <div className="on-bone relative mx-4 -mt-10 mb-8 rounded-[1.5rem] border border-ink/15 bg-bone p-[clamp(1.25rem,3vw,2.5rem)] text-ink shadow-[0_16px_48px_-28px_rgb(4_8_13/0.6)] lg:m-0 lg:w-[min(48vw,38rem)]">
          <h2 id="titulo-contacto" className="font-display text-balance text-[clamp(2.5rem,3.25vw,3.25rem)] leading-[1.02] tracking-[0.01em]">
            Solicita una demostración
          </h2>
          <p className="mt-2 max-w-[46ch] text-base leading-normal text-slate">
            Te mostramos el proyecto de ejemplo, del terreno a la obra.
          </p>
          <div className="mt-[clamp(0.75rem,2.5svh,1.75rem)]">
            <FormularioDemo />
          </div>
        </div>
      </div>
      <div data-contacto-tramo aria-hidden="true" className="pointer-events-none h-0 motion-safe:h-[70svh]" />
    </section>
  );
}
