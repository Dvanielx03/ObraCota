"use client";
import { useState } from "react";

/** Pictures that failed to load in this session, so the card does not ask for them again on every open. */
const missing = new Set<string>();
const EXTENSIONS = ["webp", "png"] as const;

/** Own drawing per style while the picture is missing: a small house drawn in that style. */
const LOOKS: Record<string, { sky: string; ground: string; wall: string; roof: string; line: string; width: number; dash?: string; soft?: boolean; tilt?: boolean }> = {
  fotorrealista: { sky: "#A9CDEB", ground: "#8DA86F", wall: "#D9D2C5", roof: "#6B5B4E", line: "#4A4E57", width: .6 },
  "maqueta-blanca": { sky: "#ECEEF1", ground: "#E1E4E8", wall: "#FFFFFF", roof: "#F4F5F7", line: "#C9CDD4", width: 1 },
  maqueta: { sky: "#EFE9DF", ground: "#D9C7A7", wall: "#E8D5B5", roof: "#B98B5E", line: "#8A6A48", width: 1 },
  "color-plano": { sky: "#9BD3F0", ground: "#7CC47F", wall: "#F6C453", roof: "#E5694E", line: "transparent", width: 0 },
  acuarela: { sky: "#CFE6F4", ground: "#BFE0B4", wall: "#F7E6C9", roof: "#E7A58E", line: "#9DB4C8", width: .8, soft: true },
  rotulador: { sky: "#FFFFFF", ground: "#E8F1E4", wall: "#FFFFFF", roof: "#F2C9B7", line: "#2B2F38", width: 2.4 },
  pastel: { sky: "#E7E1F7", ground: "#D8EED9", wall: "#FCE7EF", roof: "#C9DDF7", line: "#B7A9D6", width: 1, soft: true },
  collage: { sky: "#F3E3C4", ground: "#9CC59A", wall: "#E9EEF5", roof: "#D8574B", line: "#3A3A3A", width: .8, tilt: true },
  ilustracion: { sky: "#BFE3F7", ground: "#93C98F", wall: "#FFF4DE", roof: "#5E7CE2", line: "#1F2A44", width: 1.4 },
  "boceto-lapiz": { sky: "#FAFAF8", ground: "#F1F1EE", wall: "#FAFAF8", roof: "#EDEDEA", line: "#8C8C88", width: .9, dash: "3 1.5" },
  "dibujo-tinta": { sky: "#FFFFFF", ground: "#FFFFFF", wall: "#FFFFFF", roof: "#171E2B", line: "#171E2B", width: 1.6 },
};

/**
 * Thumbnail of a graphic style (80 × 60): /edit-styles/<slug>.webp, else .png, else an own drawing.
 * The pictures are generated apart; until they exist the drawing keeps the card readable.
 */
export function StyleThumb({ slug }: { slug: string }) {
  const [attempt, setAttempt] = useState(() => EXTENSIONS.findIndex((extension) => !missing.has(slug + "." + extension)));
  const extension = attempt >= 0 ? EXTENSIONS[attempt] : undefined;
  if (extension) {
    return <img src={"/edit-styles/" + slug + "." + extension} alt="" draggable={false} decoding="async"
      onError={() => { missing.add(slug + "." + extension); setAttempt(EXTENSIONS.findIndex((next) => !missing.has(slug + "." + next))); }} />;
  }
  const look = LOOKS[slug] ?? LOOKS["maqueta-blanca"];
  const stroke = { stroke: look.line, strokeWidth: look.width, strokeDasharray: look.dash, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 80 60" aria-hidden="true" className="edit-style-drawing">
      {look.soft && <filter id={"soft-" + slug}><feGaussianBlur stdDeviation=".9" /></filter>}
      <rect width="80" height="60" fill={look.sky} />
      <rect y="44" width="80" height="16" fill={look.ground} filter={look.soft ? "url(#soft-" + slug + ")" : undefined} />
      <g transform={look.tilt ? "rotate(-4 40 34)" : undefined}>
        <path d="M22 30 L40 16 L58 30 Z" fill={look.roof} {...stroke} />
        <rect x="25" y="30" width="30" height="16" fill={look.wall} {...stroke} />
        <rect x="37" y="36" width="6" height="10" fill={look.line === "transparent" ? "#8A5A3C" : look.line} opacity=".75" />
        <rect x="28" y="33" width="6" height="5" fill={look.line === "transparent" ? "#BFE3F7" : look.sky} {...stroke} />
        <rect x="46" y="33" width="6" height="5" fill={look.line === "transparent" ? "#BFE3F7" : look.sky} {...stroke} />
      </g>
      {look.tilt && <rect x="56" y="8" width="16" height="10" fill="#F6C453" transform="rotate(8 64 13)" opacity=".9" />}
    </svg>
  );
}
