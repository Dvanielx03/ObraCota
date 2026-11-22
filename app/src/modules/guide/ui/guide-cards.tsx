import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, ClipboardCheck, Columns2, Compass, Download, Footprints, Play, Sparkles, SquareDashedMousePointer, type LucideProps } from "lucide-react";
import { PanelView } from "@/shared/ui/panel-view";
import { guides, type Guide } from "../domain/guides";

/** Own icon per guide; book for any guide added later. */
const ICONS: Record<string, ComponentType<LucideProps>> = {
  "primeros-pasos": Compass, "pedir-opciones": Sparkles, "marcar-area": SquareDashedMousePointer,
  "comparar-opciones": Columns2, "descargar-opcion": Download, "recorrer": Footprints, "revisar-entrega": ClipboardCheck,
};

function stepCount(guide: Guide) { return guide.steps.length + " pasos"; }

/** Guide card: icon box and arrow, title and summary. Rows line up across cards (subgrid). */
function GuideCard({ guide }: { guide: Guide }) {
  const Icon = ICONS[guide.slug] ?? BookOpen;
  return <li className="guide-card">
    <span className="guide-card-top" aria-hidden="true">
      <span className="guide-card-icon"><Icon size={16}/></span>
      <ArrowUpRight className="guide-card-arrow" size={16}/>
    </span>
    <h3><Link href={"/guias/" + guide.slug}>{guide.title}</Link></h3>
    <p>{guide.summary}</p>
  </li>;
}

/** Four guides under the project list, in the same grid as the cards. */
export function GuideStrip() {
  return <section className="panel-section guide-strip" aria-labelledby="guide-strip-title">
    <div className="panel-section-intro">
      <div><h2 id="guide-strip-title">Aprende</h2><p>Guías cortas para revisar modelos y planos, del primer clic a la entrega.</p></div>
      <Link className="panel-more" href="/guias">Ver todas las guías<ArrowUpRight size={16} aria-hidden="true"/></Link>
    </div>
    <ul className="guide-grid">{guides.slice(0, 4).map(guide => <GuideCard key={guide.slug} guide={guide}/>)}</ul>
  </section>;
}

export function GuideIndex() {
  const [first, ...rest] = guides;
  return <PanelView title="Guías">
    <section className="guide-feature" aria-labelledby="guide-feature-title">
      <div className="guide-feature-text">
        <p className="guide-eyebrow">Recorrido de {first.steps.length} pasos · {first.place}</p>
        <h2 id="guide-feature-title">{first.title}</h2>
        <p>{first.summary}</p>
        <div className="guide-actions">
          {first.practice && <Link className="panel-button" href={first.practice.href}><Play size={14} aria-hidden="true"/>{first.practice.label}</Link>}
          <Link className="panel-button-outline" href={"/guias/" + first.slug}>Leer los pasos</Link>
        </div>
      </div>
      <img src="/models/restage-vista.jpg" alt="Modelo de ejemplo ReStage en el visor" width="1052" height="795"/>
    </section>
    <section className="panel-section" aria-labelledby="guide-steps-title">
      <div className="panel-section-intro">
        <div><h2 id="guide-steps-title">Paso a paso</h2><p>Cada guía explica una herramienta con los controles reales del visor.</p></div>
      </div>
      <ul className="guide-grid">{rest.map(guide => <GuideCard key={guide.slug} guide={guide}/>)}</ul>
    </section>
  </PanelView>;
}

export function GuideDetail({ guide }: { guide: Guide }) {
  const position = guides.indexOf(guide);
  const next = guides[position + 1];
  return <PanelView title={guide.title} crumb={{ href: "/guias", label: "Guías" }}>
    <article className="guide-detail">
      <p className="guide-eyebrow">{stepCount(guide)} · {guide.place}</p>
      <p className="guide-lead">{guide.summary}</p>
      <ol className="guide-steps">{guide.steps.map((step, index) => <li key={step.title}>
        <span aria-hidden="true">{index + 1}</span><div><h2>{step.title}</h2><p>{step.text}</p></div></li>)}</ol>
      <div className="guide-actions">
        {guide.practice && <Link className="panel-button" href={guide.practice.href}><Play size={14} aria-hidden="true"/>{guide.practice.label}</Link>}
        {next ? <Link className="panel-button-outline" href={"/guias/" + next.slug}>Siguiente: {next.title}<ArrowRight size={14} aria-hidden="true"/></Link>
          : <Link className="panel-button-outline" href="/guias">Volver a las guías</Link>}
      </div>
    </article>
  </PanelView>;
}
