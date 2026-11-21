"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const projectViews = [
  ["", "Resumen"], ["archivos", "Archivos y versiones"], ["visor", "Visor"],
  ["cambios", "Cambios de diseño"], ["asistente", "Asistente"], ["presupuesto", "Presupuesto"],
];

export function PanelNavigation({ siteUrl }: { siteUrl?: string }) {
  const path = usePathname();
  const [expanded, setExpanded] = useState(false);
  const base = path.match(/^\/proyectos\/([0-9a-f-]{36}|restage)(?:\/|$)/i)?.[0].replace(/\/$/, "") || "/proyectos/restage";
  const project = path === base || path.startsWith(base + "/");
  const items = [
    ["/proyectos", "Proyectos"],
    ...(project ? (base === "/proyectos/restage" ? projectViews : projectViews.filter(([slug])=>slug!=="visor")).map(([slug, label]) => [slug ? base + "/" + slug : base, label]) : []),
    ["/guias", "Guías"],
    ["/cuenta", "Cuenta"],
  ];
  return <div className="panel-rail">
    <Link className="panel-brand" href="/proyectos" onClick={() => setExpanded(false)}>
      <svg viewBox="0 0 64 64" width="29" height="29" fill="currentColor" aria-hidden="true"><path d="M8 10h48l-8 10H18L8 26zM8 30l10-6v17L8 47zM8 51l10-6h30l8 10H8z"/></svg>ObraCota
    </Link>
    <button className="panel-menu" aria-expanded={expanded} aria-controls="panel-nav" onClick={() => setExpanded(!expanded)}>Menú</button>
    <nav id="panel-nav" data-expanded={expanded} aria-label="Panel">
      {items.map(([href, label]) => <Link key={href} href={href} aria-current={path === href || (href === "/guias" && path.startsWith("/guias/")) ? "page" : undefined} onClick={() => setExpanded(false)}>{label}</Link>)}
    </nav>
    {siteUrl && <a className="panel-site" href={siteUrl}>Sitio de ObraCota ↗</a>}
  </div>;
}
