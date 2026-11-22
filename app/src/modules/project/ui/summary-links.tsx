import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowUpRight, type LucideProps } from "lucide-react";

export interface SummaryEntry {
  key: string;
  title: string;
  text: string;
  icon: ComponentType<LucideProps>;
  /** Missing when the destination is not available yet; `reason` then says why. */
  href?: string;
  reason?: string;
  /** Pages outside the panel (the full-screen viewer). */
  external?: boolean;
}

/** Section cards of a project summary: icon box, title, one line and an arrow that darkens on hover. */
export function SummaryLinks({ entries }: { entries: readonly SummaryEntry[] }) {
  return <ul className="summary-links">{entries.map(({ key, title, text, icon: Icon, href, reason }) =>
    <li key={key} className="summary-link" aria-disabled={href ? undefined : true} title={href ? undefined : reason}>
      <span className="summary-link-icon" aria-hidden="true"><Icon size={16}/></span>
      <span className="summary-link-text">
        {href ? <Link href={href}>{title}</Link> : <span>{title}</span>}
        <span>{href ? text : reason || text}</span>
      </span>
      <ArrowUpRight className="summary-link-arrow" size={16} aria-hidden="true"/>
    </li>)}</ul>;
}
