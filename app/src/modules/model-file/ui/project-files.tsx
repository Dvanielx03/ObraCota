import Link from "next/link";
import { EmptyState, PanelView } from "@/shared/ui/panel-view";

export function ProjectFiles({ sourceFile, schema }: { sourceFile: string; schema: string }) {
  return <PanelView title="Archivos y versiones">
    <div className="panel-columns"><section><h2>Modelo de ejemplo</h2><p className="file-name">{sourceFile}</p>
      <p>Origen {schema}. El visor abre su representación GLB. Puedes abrir un IFC, DWG, FBX u OBJ local desde el visor.</p>
      <Link className="panel-action" href="/proyectos/restage/visor?desde=archivos">Abrir en el visor →</Link></section>
      <EmptyState heading="Historial de versiones">Todavía no hay entregas guardadas. El historial estará disponible cuando se puedan almacenar archivos del proyecto.</EmptyState></div>
  </PanelView>;
}
