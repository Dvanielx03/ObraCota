import Link from "next/link";
import { EmptyState, PanelView } from "@/shared/ui/panel-view";
import { EmptyArt } from "@/shared/ui/loading";

export function DesignChanges() {
  return <PanelView title="Cambios de diseño"><div className="panel-columns">
    <EmptyState heading="Solicitudes" icon={<EmptyArt kind="changes" width={184}/>}>Sin cambios registrados. Aquí podrás comparar las opciones de una pieza y consultar la decisión tomada.</EmptyState>
    <section><h2>Pieza del modelo</h2><p>Explora la pieza en el visor. Guardar la solicitud y vincularla a una versión estará disponible con la edición de cambios.</p>
      <Link className="panel-action" href="/proyectos/restage/visor?desde=cambios">Seleccionar en el visor →</Link></section>
  </div></PanelView>;
}
