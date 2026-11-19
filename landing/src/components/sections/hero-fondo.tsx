"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import { MOVIMIENTO_OK, ScrollTrigger } from "@/lib/gsap";

/**
 * Fondo de la portada: el edificio se levanta con el scroll, del terreno a la obra.
 *
 * - Tres fotos nítidas (terreno, estructura, terminado) se funden según el avance. Son lo
 *   que se ve en reposo y lo único que ve quien no carga el vídeo.
 * - Encima, dos clips cuyo tiempo sigue al scroll. Cada clip empieza y termina en las
 *   fotos vecinas, así el paso de uno a otro no salta.
 * - Con movimiento reducido, ahorro de datos o un equipo modesto no se descarga vídeo.
 *
 * Las imágenes son una recreación hecha con IA a partir del modelo real de ReStage.
 */
const FOTOS = [
  { src: "/images/portada-terreno.jpg", alt: "Terreno al atardecer con tres franjas de cimentación de concreto recién fundidas" },
  { src: "/images/portada-estructura.jpg", alt: "La estructura de acero ya montada sobre la cimentación, con los muros de concreto de la planta baja" },
  { src: "/images/portada-terminado.jpg", alt: "El edificio terminado al anochecer: pórticos de acero, volumen de madera iluminado por dentro y fachada verde" },
] as const;
const CLIPS = ["portada-1", "portada-2"] as const;
/** El cover recorta por los lados en pantallas altas: la imagen necesita el ancho de 16:9 del alto. */
const TAMANOS = "(max-width: 1023px) and (orientation: portrait) 93vh, (max-aspect-ratio: 16/9) 178vh, 100vw";

const limitar = (x: number) => Math.min(1, Math.max(0, x));

export function HeroFondo({ alCambiarEtapa }: { alCambiarEtapa?: (etapa: number) => void }) {
  const raiz = useRef<HTMLDivElement>(null);
  const avisar = useRef(alCambiarEtapa);
  useEffect(() => {
    avisar.current = alCambiarEtapa;
  });

  useEffect(() => {
    const fondo = raiz.current;
    const pista = fondo?.closest<HTMLElement>("[data-portada-pista]");
    if (!fondo || !pista) return;
    const fotos = [...fondo.querySelectorAll<HTMLElement>("[data-foto]")];
    const capa = fondo.querySelector<HTMLElement>("[data-clips]");
    const videos = [...fondo.querySelectorAll<HTMLVideoElement>("video")];
    if (!window.matchMedia(MOVIMIENTO_OK).matches) {
      // Sin recorrido se muestra la obra terminada.
      avisar.current?.(2);
      return;
    }

    const listos = videos.map(() => false);
    const blobs: string[] = [];
    let avance = 0;
    let cancelado = false;

    const pintar = () => {
      // Las fotos se funden en dos tramos: terreno → estructura → terminado.
      const w = avance * 2;
      avisar.current?.(w < 0.5 ? 0 : w < 1.5 ? 1 : 2);
      fotos[1].style.opacity = String(limitar(w));
      fotos[2].style.opacity = String(limitar(w - 1));
      const activo = Math.min(videos.length - 1, Math.floor(w));
      // En las tres paradas manda la foto nítida; el vídeo solo se ve entre una y otra.
      // La parada central además tapa la costura entre los dos clips, que no coinciden al píxel.
      const enReposo = avance < 0.012 || avance > 0.988 || Math.abs(w - 1) < 0.035;
      const video = videos[activo];
      if (!listos[activo] || enReposo || !Number.isFinite(video.duration)) {
        if (capa) capa.style.opacity = "0";
        return;
      }
      const tiempo = Math.min((w - activo) * video.duration, video.duration - 0.05);
      videos.forEach((v, i) => (v.style.visibility = i === activo ? "visible" : "hidden"));
      // Nunca se solapan dos búsquedas: al terminar una, `seeked` vuelve a pintar.
      if (video.seeking) return;
      if (Math.abs(video.currentTime - tiempo) > 0.02) video.currentTime = tiempo;
      else if (capa) capa.style.opacity = "1";
    };

    const disparador = ScrollTrigger.create({
      trigger: pista,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (st) => {
        avance = st.progress;
        pintar();
      },
    });

    // El vídeo se pide después de cargar la página, uno a uno, y solo si tiene sentido.
    const conexion = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const modesto = Boolean(conexion?.saveData) || memoria < 4 || (navigator.hardwareConcurrency ?? 8) < 4;
    const ancho = window.innerWidth * Math.min(window.devicePixelRatio, 2) > 1100 ? 1280 : 960;
    const cargar = async () => {
      if (modesto) return;
      for (const [i, video] of videos.entries()) {
        if (cancelado) return;
        try {
          const respuesta = await fetch(`/video/${CLIPS[i]}-${ancho}.mp4`);
          if (!respuesta.ok) continue;
          const url = URL.createObjectURL(await respuesta.blob());
          blobs.push(url);
          if (cancelado) return;
          video.src = url;
          await new Promise<void>((ok) => video.addEventListener("loadeddata", () => ok(), { once: true }));
          // iOS no deja buscar en un vídeo que nunca se reprodujo.
          await video.play().catch(() => {});
          video.pause();
          video.addEventListener("seeked", pintar);
          listos[i] = true;
          pintar();
        } catch {
          // Sin vídeo se sigue viendo el fundido de fotos.
        }
      }
    };
    // Solo se descarga si la portada está en pantalla (quien entra directo a otra sección
    // no la necesita) y cuando el navegador queda libre tras cargar la página.
    let pedido = false;
    let reposo = 0;
    const observador = new IntersectionObserver((entradas) => {
      if (pedido || !entradas.some((e) => e.isIntersecting)) return;
      pedido = true;
      observador.disconnect();
      const empezar = () => {
        reposo = window.setTimeout(() => void cargar(), 600);
      };
      if (document.readyState === "complete") empezar();
      else window.addEventListener("load", empezar, { once: true });
    });
    observador.observe(pista);

    return () => {
      cancelado = true;
      observador.disconnect();
      window.clearTimeout(reposo);
      disparador.kill();
      videos.forEach((v) => {
        v.removeEventListener("seeked", pintar);
        v.removeAttribute("src");
        v.load();
      });
      blobs.forEach((b) => URL.revokeObjectURL(b));
    };
  }, []);

  return (
    <div ref={raiz} data-portada-fondo className="absolute inset-0 overflow-hidden bg-ink">
      {FOTOS.map((foto, i) => (
        <Image
          key={foto.src}
          data-foto
          src={foto.src}
          alt={i === 0 ? foto.alt : ""}
          aria-hidden={i === 0 ? undefined : true}
          fill
          preload={i === 0}
          loading={i === 0 ? undefined : "lazy"}
          sizes={TAMANOS}
          // Sin movimiento no hay recorrido: se muestra directamente el edificio terminado.
          className={`object-cover object-[71%_50%] ancho:object-[0%_50%] ${i === 0 ? "" : i === 2 ? "opacity-0 motion-reduce:opacity-100" : "opacity-0"}`}
        />
      ))}
      <div data-clips aria-hidden="true" className="absolute inset-0 opacity-0 transition-opacity duration-300 ease-out">
        {CLIPS.map((clip) => (
          <video key={clip} muted playsInline preload="none" tabIndex={-1} className="absolute inset-0 size-full object-cover object-[71%_50%] ancho:object-[0%_50%]" />
        ))}
      </div>
    </div>
  );
}
