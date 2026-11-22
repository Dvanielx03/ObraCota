"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { BrandMark } from "./brand-mark";

/**
 * 52 px top bar of the panel (DU-08 = B): logo on the left; site link, colour mode, guides and the
 * account control on the right. The account control comes from the security module.
 */
export function PanelTopBar({ siteUrl, account }: { siteUrl?: string; account?: ReactNode }) {
  const path = usePathname();
  const guides = path === "/guias" || path.startsWith("/guias/");
  return <header className="panel-top">
    <Link className="panel-brand" href="/proyectos" aria-current={path === "/proyectos" ? "page" : undefined}><BrandMark/></Link>
    <div className="panel-top-actions">
      {siteUrl && <a className="panel-site" href={siteUrl}>Sitio de ObraCota<ArrowUpRight size={14} aria-hidden="true"/></a>}
      <ThemeToggle/>
      <nav className="panel-nav" aria-label="Panel">
        <Link className="panel-pill" href="/guias" aria-current={guides ? "page" : undefined}><BookOpen size={12} strokeWidth={2.25} aria-hidden="true"/>Guías</Link>
        {account}
      </nav>
    </div>
  </header>;
}
