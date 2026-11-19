"use client";

import Image from "next/image";
import { useRef } from "react";

import { gsap, MOVIMIENTO_OK, useGSAP } from "@/lib/gsap";

const ENCUADRE = "object-cover object-[72%_50%] lg:object-[0%_62%]";

export function ContactoFondo() {
  const figura = useRef<HTMLElement>(null);
  const casa = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const medios = gsap.matchMedia();
    medios.add(MOVIMIENTO_OK, () => {
      const seccion = figura.current!.closest("section")!;
      const escena = seccion.querySelector<HTMLElement>("[data-contacto-escena]")!;
      const tramo = seccion.querySelector<HTMLElement>("[data-contacto-tramo]")!;
      const secuencia = gsap.timeline({
        scrollTrigger: {
          trigger: seccion,
          start: () => `top ${getComputedStyle(escena).top}`,
          end: () => `+=${tramo.offsetHeight}`,
          scrub: true,
        },
      });
      // Conserva un instante de terreno y otro de obra completa dentro del tramo fijo.
      secuencia.fromTo(casa.current, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: "sine.inOut" }, 0.08)
        .to({}, { duration: 0.12 });
    });
    return () => medios.revert();
  }, { scope: figura });

  return (
    <figure ref={figura} className="relative h-[clamp(8.5rem,18svh,19rem)] overflow-hidden bg-ink lg:absolute lg:inset-0 lg:-z-10 lg:h-auto lg:min-h-0">
      <Image src="/images/portada-terreno.jpg" alt="" fill sizes="100vw" className={ENCUADRE} />
      <div ref={casa} data-final className="absolute inset-0">
        <Image
          src="/images/contacto-final.jpg"
          alt="Vista ilustrativa de la casa terminada, con paneles solares, ventanales y fachada verde."
          fill
          sizes="100vw"
          className={ENCUADRE}
        />
      </div>
    </figure>
  );
}
