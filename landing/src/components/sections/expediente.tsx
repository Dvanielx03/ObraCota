"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { ArrowsOutSimple, X } from "@phosphor-icons/react/dist/ssr";
import { gsap, MOVIMIENTO_OK, useGSAP } from "@/lib/gsap";
import { FUENTE_MODELO } from "@/lib/modelo/fuente";

const plantas = [
  { nombre: "Planta baja", archivo: "/modelos/restage-planta-baja.svg", cota: "+1,517 m" },
  { nombre: "Planta alta", archivo: "/modelos/restage-planta-alta.svg", cota: "+3,947 m" },
] as const;

function Dibujo({ indice, decorativo = false }: { indice: number; decorativo?: boolean }) {
  const planta = plantas[indice];
  return <Image src={planta.archivo} alt={decorativo ? "" : `${planta.nombre} de ReStage. Corte horizontal de la estructura y los cerramientos.`}
    width={640} height={492} unoptimized className="block h-full w-full object-contain" />;
}

export function Expediente() {
  const raiz = useRef<HTMLElement>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const [indice, seleccionar] = useState(0);
  const [zoom, ampliar] = useState(false);
  const planta = plantas[indice];
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOVIMIENTO_OK, () => {
      const figura = raiz.current!.querySelector("figure")!;
      gsap.fromTo("[data-corte]", { clipPath: "inset(0 100% 0 0)" }, {
        clipPath: "inset(0 0% 0 0)", ease: "none",
        scrollTrigger: { trigger: figura, start: "top 92%", end: "center 54%", scrub: true },
      });
    });
    return () => mm.revert();
  }, { scope: raiz });

  return (
    <section id="expediente" ref={raiz} aria-labelledby="titulo-expediente" className="on-bone bg-ink text-bone ancho:bg-bone ancho:text-ink">
      <div className="mx-auto grid max-w-[1440px] items-center ancho:grid-cols-12 ancho:gap-x-[clamp(1rem,1.8vw,2rem)] ancho:px-[clamp(2rem,4vw,3rem)] ancho:py-[clamp(5.5rem,12svh,9rem)]">
        <div className="order-2 px-5 py-9 ancho:order-1 ancho:col-span-5 ancho:p-0">
          <p className="mb-4 text-sm font-semibold text-mist ancho:text-slate">Expediente · ReStage</p>
          <h2 id="titulo-expediente" className="font-display text-[clamp(3.25rem,min(13vw,10svh),5.5rem)] leading-[0.94] ancho:text-[clamp(3rem,min(6.4vw,12svh),5.6rem)]">
            Del modelo<br /> al plano
          </h2>
          <div className="mt-[clamp(1.25rem,3.5svh,2.75rem)] border-t border-current/35 pt-4">
            <h3 className="text-[clamp(1.125rem,1.7vw,1.45rem)] font-semibold">¿Cómo cambia la estructura entre plantas?</h3>
            <p className="mt-2 max-w-[38ch] leading-relaxed">Compara los dos niveles del edificio que acabas de recorrer. El trazo grueso marca las piezas que atraviesa el corte horizontal.</p>
            <p className="mt-4 text-sm text-mist ancho:text-slate">Modelo de origen · IFC4</p>
            <a href={FUENTE_MODELO.url} className="inline-flex min-h-11 items-center break-all font-semibold underline underline-offset-4">Restage_IP_ALL_MULTI_001.ifc</a>
          </div>
        </div>

        <figure className="order-1 min-w-0 bg-bone px-4 pb-5 pt-[clamp(5rem,11svh,7rem)] text-ink ancho:order-2 ancho:col-start-7 ancho:col-end-13 ancho:p-0">
          <div className="border border-ink/35 bg-paper">
            <div role="group" aria-label="Nivel del plano" className="flex border-b border-ink/25">
              {plantas.map((p, i) => (
                <button key={p.archivo} type="button" aria-pressed={indice === i} onClick={() => seleccionar(i)}
                  className="min-h-11 flex-1 border-b-2 border-transparent text-sm font-semibold text-slate aria-pressed:bg-ink aria-pressed:text-bone">{p.nombre}</button>
              ))}
            </div>
            <div className="relative mx-auto aspect-[1.31] w-full max-w-[min(100%,78svh)]">
              <div className="absolute inset-0 opacity-35"><Dibujo indice={indice} /></div>
              <div data-corte aria-hidden="true" className="absolute inset-0"><Dibujo indice={indice} decorativo /></div>
            </div>
          </div>
          <figcaption className="flex items-center justify-between gap-2 border border-t-0 border-ink/35 bg-paper px-4 py-2 text-sm">
            <span aria-live="polite"><b><span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-amber ring-1 ring-ink/40" />{planta.nombre}</b><br />Corte a {planta.cota}</span>
            <button type="button" aria-haspopup="dialog" onClick={() => dialogo.current?.showModal()}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/35 px-3 font-semibold hover:bg-bone">
              <ArrowsOutSimple aria-hidden="true" /> Ampliar plano
            </button>
          </figcaption>
        </figure>
      </div>
      <dialog onClose={() => ampliar(false)} ref={dialogo} aria-labelledby="titulo-plano" className="fixed inset-0 m-auto max-h-[94dvh] w-[min(94vw,55rem)] overflow-auto border border-ink/30 bg-paper p-4 text-ink backdrop:bg-ink/85" data-lenis-prevent>
        <div className="flex items-center justify-between gap-3 border-b border-ink/30 pb-2">
          <h3 id="titulo-plano" className="font-display text-3xl">ReStage · {planta.nombre}</h3>
          <button type="button" onClick={() => dialogo.current?.close()} className="inline-flex min-h-11 items-center gap-2 px-3"><X aria-hidden="true" />Cerrar</button>
        </div>
        <div className="my-2 flex items-center justify-between text-sm">
          <span>Cotas de extensión · metros</span>
          <button type="button" aria-pressed={zoom} onClick={() => ampliar(!zoom)} className="min-h-11 px-3 underline underline-offset-4">{zoom ? "Ajustar a la vista" : "Zoom ×2"}</button>
        </div>
        <div className="max-h-[62dvh] overflow-auto" role="region" aria-label="Área del plano" tabIndex={0}>
          <div className={zoom ? "w-[200%]" : "w-full"}><Dibujo indice={indice} /></div>
        </div>
        <p className="border-t border-ink/30 pt-3 text-sm">Vista derivada por ObraCota del modelo del recorrido. Corte a {planta.cota}, a 1,20 m sobre la base del nivel. Se muestran estructura y cerramientos.</p>
        <p className="mt-2 text-sm">{FUENTE_MODELO.autores}. <a className="underline" href={FUENTE_MODELO.url}>Modelo ReStage</a> · <a className="underline" href={FUENTE_MODELO.urlLicencia}>{FUENTE_MODELO.licencia}</a>.</p>
      </dialog>
    </section>
  );
}
