import { PanelNavigation } from "@/shared/ui/panel-navigation";
import "./panel.css";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <div className="panel-shell"><a className="panel-skip" href="#contenido">Saltar al contenido</a>
    <PanelNavigation siteUrl={process.env.NEXT_PUBLIC_SITE_URL}/>
    <main id="contenido" tabIndex={-1} className="panel-body">{children}</main></div>;
}
