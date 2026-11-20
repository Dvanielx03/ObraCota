import Link from "next/link";

export function PanelView({ title, trail = title, project = true, children }: { title: string; trail?: string; project?: boolean; children: React.ReactNode }) {
  return <><div className="panel-trail"><Link href="/proyectos">Panel</Link>{project && <> / <Link href="/proyectos/restage">ReStage</Link></>} / {trail}</div>
    <div className="panel-content"><h1>{title}</h1>{children}</div></>;
}

export function EmptyState({ heading, children }: { heading: string; children: React.ReactNode }) {
  return <section className="panel-empty"><h2>{heading}</h2><p>{children}</p></section>;
}
