"use client";

import { useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { cn } from "cn";

import { HeroFondo } from "./hero-fondo";

/** Las tres paradas del recorrido de la portada, en el orden en que aparecen al bajar. */
const ETAPAS = ["Terreno", "Estructura", "Obra"] as const;

/**
 * Portada sobre una rejilla de 12 columnas:
 * - columnas 1 a 5: titular, frase y botón, con el mismo borde izquierdo;
 * - columna 6: aire;
 * - columnas 7 a 12: zona protegida del edificio, donde no entra ningún texto.
 * En móvil se apila: la foto arriba, sin texto encima, y el texto debajo sobre tinta.
 */
export function Hero() {
  // Con movimiento reducido no hay recorrido: se muestra la obra terminada.
  const [etapa, setEtapa] = useState(0);

  return (
    // La pista da recorrido al scroll: la portada se queda fija mientras el edificio se levanta.
    <div data-portada-pista className="relative motion-safe:h-[240svh] motion-safe:ancho:h-[280svh]">
      <section
        id="inicio"
        className="relative isolate flex min-h-svh flex-col bg-ink px-4 pb-6 motion-safe:sticky motion-safe:top-0 motion-safe:h-svh ancho:px-[max(3rem,calc((100%-84rem)/2))] ancho:pb-10"
      >
        {/* Fondo: en móvil ocupa la franja de arriba; en escritorio, toda la portada. */}
        <div className="absolute inset-x-0 top-0 -z-10 h-[52svh] overflow-hidden bg-ink [@media(max-height:700px)]:h-[42svh] ancho:inset-0 ancho:!h-auto">
          <HeroFondo alCambiarEtapa={setEtapa} />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(10_21_34/0.55)_0%,rgb(10_21_34/0)_26%,rgb(10_21_34/0)_72%,rgb(10_21_34/1)_100%)] ancho:bg-[linear-gradient(90deg,rgb(10_21_34/0.94)_0%,rgb(10_21_34/0.78)_30%,rgb(10_21_34/0)_52%)]" />

        </div>

        {/* Zona de texto: columnas 1 a 5 en escritorio. */}
        <div className="mt-[54svh] flex flex-1 flex-col [@media(max-height:700px)]:mt-[43svh] ancho:!mt-0 ancho:w-[calc((100%-11*1.5rem)/12*5+4*1.5rem)] ancho:justify-center ancho:pt-[clamp(5rem,13svh,7rem)]">
          <h1 className="font-display text-[clamp(3.25rem,min(17vw,9.5svh),5.5rem)] uppercase leading-[0.9] text-bone ancho:text-[clamp(3rem,min(8.6vw,17svh),9.25rem)]">
            <span className="line-mask">
              <span className="block animate-rise">Del terreno</span>
            </span>
            <span className="line-mask">
              <span className="block animate-rise [animation-delay:90ms]">a la obra</span>
            </span>
          </h1>
          <p className="mt-4 max-w-[26rem] animate-fade-up text-lg font-medium [@media(max-height:700px)]:mt-2.5 [@media(max-height:700px)]:text-base text-mist [animation-delay:260ms] ancho:mt-[clamp(0.75rem,3svh,1.75rem)] ancho:text-[clamp(1rem,3.4svh,1.5rem)] ancho:leading-snug">
            Coordina planos, modelos BIM y avance de obra en un solo proyecto.
          </p>
          <a
            href="#contacto"
            className="group mt-5 flex h-12 [@media(max-height:700px)]:mt-3.5 animate-fade-up items-center gap-3 self-start rounded-full bg-bone pl-6 pr-1.5 text-base font-semibold text-ink transition-transform duration-200 ease-out-quart [animation-delay:340ms] active:scale-[0.98] ancho:mt-[clamp(1rem,4svh,2.25rem)] ancho:h-[clamp(3rem,7.5svh,3.5rem)] ancho:pl-7 ancho:text-lg"
          >
            Solicitar demostración
            <span className="grid size-9 place-items-center rounded-full bg-ink text-bone transition-transform duration-300 ease-out-quart group-hover:translate-x-0.5 ancho:size-[clamp(2.25rem,5.6svh,2.75rem)]">
              <ArrowRight aria-hidden="true" weight="bold" className="size-4" />
            </span>
          </a>
        </div>

        {/* Pie: en qué etapa está la obra. El ámbar marca solo la etapa actual. */}
        <ol aria-label="Etapas de la obra en la portada" className="mt-4 flex animate-fade-up items-center gap-3 whitespace-nowrap text-[0.8125rem] font-semibold min-[380px]:gap-4 min-[380px]:text-sm [animation-delay:420ms] ancho:gap-6 ancho:text-base">
          {ETAPAS.map((nombre, i) => (
            <li
              key={nombre}
              aria-current={i === etapa ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 uppercase tracking-[0.04em] min-[380px]:gap-4 transition-colors duration-500 ease-out-quart ancho:gap-6",
                i === etapa ? "text-amber" : "text-mist",
              )}
            >
              {i > 0 && <span aria-hidden="true" className="h-4 w-px bg-mist/50" />}
              <span>
                <span className="tabular-nums">0{i + 1}</span> {nombre}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
