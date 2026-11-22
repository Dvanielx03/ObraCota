"use client";
import { useEffect, useState } from "react";
import { coverPattern, initials } from "../domain/project-card";
import { projectCoverHttp } from "../infrastructure/project-cover-http";
import { useThemedCapture } from "@/modules/scene-view/ui/themed-capture";

/**
 * Object URL of the project cover, or undefined while loading, without a cover or on failure.
 * The URL is revoked when the card unmounts or the project changes.
 */
export function useProjectCover(id: string | undefined, refresh: unknown = 0): string | undefined {
  const [cover, setCover] = useState<{ id: string; url: string }>();
  useEffect(() => {
    if (!id) return;
    const control = new AbortController();
    let url = "";
    projectCoverHttp.load(id, control.signal).then(blob => {
      if (!blob || control.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setCover({ id, url });
    }).catch(() => { /* No cover: the card keeps its gradient. */ });
    return () => {
      control.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, refresh]);
  return cover && cover.id === id ? cover.url : undefined;
}

/** Five own decorative drawings, in white at 7–10 % over the gradient. Drawn on a 400 × 300 box. */
function CoverShape({ variant }: { variant: number }) {
  const line = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return <svg className="project-cover-shape" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    {variant === 0 && <g>
      {/* Structural grid with axis bubbles. */}
      <g {...line} strokeWidth={6} opacity={.1}>
        <path d="M250 36V180M310 36V180M370 36V180M214 80H400M214 140H400"/>
        <circle cx={250} cy={22} r={14}/><circle cx={310} cy={22} r={14}/><circle cx={370} cy={22} r={14}/>
      </g>
      <circle cx={58} cy={250} r={36} fill="currentColor" opacity={.08}/>
    </g>}
    {variant === 1 && <g>
      {/* Stair section. */}
      <path {...line} d="M-10 292H62V250H112V208H162V166H212V124H262" strokeWidth={14} opacity={.09}/>
      <circle {...line} cx={344} cy={64} r={46} strokeWidth={10} opacity={.08}/>
    </g>}
    {variant === 2 && <g>
      {/* Axonometric volume. */}
      <path {...line} d="M330 8L392 42L330 76L268 42ZM268 42V116L330 150L392 116V42M330 76V150" strokeWidth={10} opacity={.1}/>
      <circle cx={68} cy={232} r={42} fill="currentColor" opacity={.07}/>
    </g>}
    {variant === 3 && <g>
      {/* Dimension line with ticks. */}
      <path {...line} d="M40 252H262M40 222V276M262 222V276M30 262L50 242M252 262L272 242" strokeWidth={6} opacity={.1}/>
      <circle {...line} cx={342} cy={58} r={70} strokeWidth={16} opacity={.08}/>
    </g>}
    {variant === 4 && <g>
      {/* Door swing on plan. */}
      <path {...line} d="M300 40V150H410M300 40A110 110 0 0 1 410 150" strokeWidth={10} opacity={.09}/>
      <rect {...line} x={36} y={40} width={62} height={62} rx={10} strokeWidth={12} opacity={.08}/>
      <circle cx={92} cy={250} r={24} fill="currentColor" opacity={.09}/>
    </g>}
  </svg>;
}

/**
 * Card cover layers, bottom to top: own gradient chosen by the id, decorative drawing, monogram,
 * the picture when there is one, and the dark veil that keeps the white text readable.
 */
export function ProjectCover({ id, name, image: captured, imageAlt = "" }: { id: string; name: string; image?: string; imageAlt?: string }) {
  const { tone, shape } = coverPattern(id);
  // The cover is a saved view's capture: on a dark canvas its light background follows the theme.
  const image = useThemedCapture(captured);
  return <div className="project-cover" data-tone={tone}>
    <CoverShape variant={shape}/>
    <span className="project-monogram" aria-hidden="true">{initials(name)}</span>
    {image && <img className="project-cover-image" src={image} alt={imageAlt} decoding="async"
      onLoad={event => { event.currentTarget.dataset.loaded = "true"; }}/>}
    <span className="project-veil" aria-hidden="true"/>
  </div>;
}
