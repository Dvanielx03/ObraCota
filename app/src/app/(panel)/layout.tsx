import { exampleCatalog } from "@/modules/project/infrastructure/example-catalog";
import { ProjectBar } from "@/modules/project/ui/project-bar";
import { ProjectScope } from "@/modules/project/ui/project-scope";
import { AccountControl } from "@/modules/security/ui/account-control";
import { PanelTopBar } from "@/shared/ui/panel-navigation";
import "./panel.css";

/**
 * Panel frame: full-height page without document scroll (only the content area scrolls), the 52 px
 * top bar and, inside a project, the project bar with its section tabs.
 */
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <div className="panel-shell"><a className="panel-skip" href="#contenido">Saltar al contenido</a>
    <PanelTopBar siteUrl={process.env.NEXT_PUBLIC_SITE_URL} account={<AccountControl/>}/>
    <ProjectScope examples={exampleCatalog.list()}>
      <main id="contenido" tabIndex={-1} className="panel-main"><ProjectBar/>{children}</main>
    </ProjectScope>
  </div>;
}
