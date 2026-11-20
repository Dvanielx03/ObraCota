import { EmptyState, PanelView } from "@/shared/ui/panel-view";

export function ProjectAssistant() {
  return <PanelView title="Asistente"><div className="panel-columns">
    <EmptyState heading="Conversación">Podrás consultar el diseño y abrir la pieza o el documento que sustente cada respuesta.</EmptyState>
    <section><h2>Fuentes del proyecto</h2><p>Todavía no hay fuentes vinculadas. Las consultas se habilitarán cuando los documentos y el modelo estén indexados.</p></section>
  </div></PanelView>;
}
