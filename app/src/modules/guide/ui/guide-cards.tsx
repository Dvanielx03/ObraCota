import Link from "next/link";
import { PanelView } from "@/shared/ui/panel-view";
import { guides, type Guide } from "../domain/guides";

function stepCount(guide: Guide) { return guide.steps.length + " pasos"; }

function GuideCard({ guide, index }: { guide: Guide; index: number }) {
  return <li className="guide-card">
    <span className="guide-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
    <h3><Link href={"/guias/" + guide.slug}>{guide.title}</Link></h3>
    <p>{guide.summary}</p>
    <span className="guide-meta">{stepCount(guide)}</span>
  </li>;
}

/** Three guides under the project list. */
export function GuideStrip() {
  return <section className="guide-strip" aria-labelledby="guide-strip-title">
    <div className="guide-strip-head"><h2 id="guide-strip-title">Aprende</h2><Link href="/guias">Ver todas las guías →</Link></div>
    <ul className="guide-grid">{guides.slice(0, 3).map((guide, index) => <GuideCard key={guide.slug} guide={guide} index={index}/>)}</ul>
  </section>;
}

export function GuideIndex() {
  const [first, ...rest] = guides;
  return <PanelView title="Guías" project={false}>
    <section className="guide-feature" aria-labelledby="guide-feature-title">
      <div>
        <p className="guide-eyebrow">Recorrido de {first.steps.length} pasos</p>
        <h2 id="guide-feature-title">{first.title}</h2>
        <p>{first.summary}</p>
        <div className="guide-feature-actions">
          {first.practice && <Link className="project-new" href={first.practice.href}>{first.practice.label}</Link>}
          <Link className="panel-action" href={"/guias/" + first.slug}>Leer los pasos</Link>
        </div>
      </div>
      <img src="/models/restage-vista.jpg" alt="Modelo de ejemplo ReStage en el visor" width="1052" height="795"/>
    </section>
    <h2 className="project-heading">Paso a paso</h2>
    <ul className="guide-grid">{rest.map((guide, index) => <GuideCard key={guide.slug} guide={guide} index={index + 1}/>)}</ul>
  </PanelView>;
}

export function GuideDetail({ guide }: { guide: Guide }) {
  const position = guides.indexOf(guide);
  const next = guides[position + 1];
  return <><div className="panel-trail"><Link href="/proyectos">Panel</Link> / <Link href="/guias">Guías</Link> / {guide.title}</div>
    <article className="panel-content guide-detail">
      <p className="guide-eyebrow">{stepCount(guide)} · {guide.place}</p>
      <h1>{guide.title}</h1>
      <p className="guide-lead">{guide.summary}</p>
      <ol className="guide-steps">{guide.steps.map((step, index) => <li key={step.title}>
        <span aria-hidden="true">{index + 1}</span><div><h2>{step.title}</h2><p>{step.text}</p></div></li>)}</ol>
      <div className="guide-feature-actions">
        {guide.practice && <Link className="project-new" href={guide.practice.href}>{guide.practice.label}</Link>}
        {next ? <Link className="panel-action" href={"/guias/" + next.slug}>Siguiente: {next.title} →</Link>
          : <Link className="panel-action" href="/guias">Volver a las guías</Link>}
      </div>
    </article></>;
}
