"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "./use-reduced-motion";

/** The moments of the app that have their own animation (docs/reference/vibe3d/HIGGSFIELD.md). */
export type LoaderArtName = "viewer" | "model" | "upload" | "options" | "done";

interface Art {
  /** VP9 WebM without audio. */
  video: string;
  /** First frame, shown until the video plays. */
  poster: string;
  /** The picture shown with reduced motion and once a capped loop ends. */
  still: string;
  loop: boolean;
  /** "paper": line art on a light sheet, inverted in dark mode. "photo": shaded image, kept as is. */
  tone: "paper" | "photo";
}

/**
 * Animations generated with AI in Higgsfield on 21 Nov 2026 (credits in public/loaders/CREDITOS.txt).
 * The GIFs were converted to WebM (1.5× slower, 1.25× for the one-shot check) to weigh 10–38 KB.
 */
export const LOADER_ART: Record<LoaderArtName, Art> = {
  viewer: { video: "/loaders/maqueta-orbita.webm", poster: "/loaders/maqueta-orbita-poster.webp", still: "/loaders/maqueta-orbita-poster.webp", loop: true, tone: "photo" },
  model: { video: "/loaders/edificio-arma.webm", poster: "/loaders/edificio-arma-poster.webp", still: "/loaders/edificio-arma-quieto.webp", loop: true, tone: "paper" },
  upload: { video: "/loaders/plano-a-volumen.webm", poster: "/loaders/plano-a-volumen-poster.webp", still: "/loaders/plano-a-volumen-poster.webp", loop: true, tone: "paper" },
  options: { video: "/loaders/fachada-revela.webm", poster: "/loaders/fachada-revela-poster.webp", still: "/loaders/fachada-revela-quieto.webp", loop: true, tone: "photo" },
  done: { video: "/loaders/listo.webm", poster: "/loaders/listo-inicio.webp", still: "/loaders/listo-poster.webp", loop: false, tone: "paper" },
};

/**
 * Decorative animation of a wait (never content: hidden from assistive technology, no AI label).
 * Starts as its still picture and only plays when motion is welcome. `maxLoopMs` ends the loop
 * after that time and rests on the still picture (WCAG 2.2.2 for waits shown beside other content);
 * without it the loop goes on, for preload screens where nothing else can be used yet.
 */
export function LoaderArt({ name, size = 160, maxLoopMs, className, style }: {
  name: LoaderArtName; size?: number; maxLoopMs?: number; className?: string; style?: CSSProperties;
}) {
  const art = LOADER_ART[name];
  const reduced = useReducedMotion();
  // "playing" → "finishing" (the cap passed: the current loop ends) → "still".
  const [phase, setPhase] = useState<"playing" | "finishing" | "still">("playing");
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (reduced || !maxLoopMs || !art.loop) return;
    const timer = setTimeout(() => setPhase(current => current === "playing" ? "finishing" : current), maxLoopMs);
    return () => clearTimeout(timer);
  }, [reduced, maxLoopMs, art.loop]);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    // Autoplay needs the muted property itself, not only the attribute.
    node.muted = true;
    node.play().catch(() => setPhase("still"));
  }, [reduced]);
  const still = reduced || phase === "still";
  return <span className={"loader-art" + (className ? " " + className : "")} data-tone={art.tone} data-art={name}
    style={{ "--art-size": size + "px", ...style } as CSSProperties} aria-hidden="true">
    {still ? <img src={art.still} alt="" width={size} height={size} decoding="async" draggable={false} />
      : <video ref={video} src={art.video} poster={art.poster} width={size} height={size} muted autoPlay playsInline preload="auto"
          loop={art.loop && phase === "playing"} disablePictureInPicture disableRemotePlayback tabIndex={-1}
          onEnded={() => { if (art.loop) setPhase("still"); }} onError={() => setPhase("still")} />}
  </span>;
}
