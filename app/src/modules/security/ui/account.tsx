import { EmptyState, PanelView } from "@/shared/ui/panel-view";

export function Account() {
  return <PanelView title="Cuenta" project={false}><div className="panel-columns">
    <EmptyState heading="Sesión de invitado">Estás explorando el ejemplo público. Para guardar proyectos propios hace falta habilitar el registro y el inicio de sesión.</EmptyState>
    <section><h2>Preferencias</h2><p>Cuando haya cuentas podrás conservar tus preferencias entre sesiones.</p></section>
  </div></PanelView>;
}
