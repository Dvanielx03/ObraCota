"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronRight, FolderOpen } from "lucide-react";
import { projectRoute } from "./panel-routes";

type PanelViewProps = {
  title: string;
  /** Controls placed at the right of the title row (tabs, buttons). */
  actions?: ReactNode;
  /** Short line under the title. */
  lead?: ReactNode;
  /** Parent page shown before the title, like "Guías ›". */
  crumb?: { href: string; label: string };
  /** @deprecated The breadcrumb trail was replaced by the top bar and the project bar. Ignored. */
  trail?: string;
  /** @deprecated The project context now comes from the route. Ignored. */
  project?: boolean;
  children: ReactNode;
};

/**
 * Page frame of the panel: a fixed title row and a scrolling area, as on the reference projects page.
 * Inside a project the project bar already holds the page heading (h1), so the title becomes the
 * section heading (h2) at the top of the scrolling area.
 */
export function PanelView({ title, actions, lead, crumb, children }: PanelViewProps) {
  const inProject = projectRoute(usePathname()) !== null;
  if (inProject) return <div className="panel-scroll"><div className="panel-body">
    <div className="panel-section-head">
      <div><h2>{title}</h2>{lead && <p>{lead}</p>}</div>
      {actions}
    </div>
    {children}
  </div></div>;
  return <>
    <div className="panel-head">
      <div className="panel-head-title">
        {crumb && <><Link className="panel-crumb" href={crumb.href}>{crumb.label}</Link><ChevronRight className="panel-crumb-sep" size={20} aria-hidden="true"/></>}
        <h1>{title}</h1>
      </div>
      {actions}
    </div>
    <div className="panel-scroll"><div className="panel-body">
      {lead && <p className="panel-lead">{lead}</p>}
      {children}
    </div></div>
  </>;
}

/** Centred empty state: icon in the border colour, a title and one line of text. */
export function EmptyState({ heading, children, icon = <FolderOpen size={40} strokeWidth={1.5} aria-hidden="true"/> }: { heading: string; children: ReactNode; icon?: ReactNode }) {
  return <section className="panel-empty">{icon}<h2>{heading}</h2><p>{children}</p></section>;
}
