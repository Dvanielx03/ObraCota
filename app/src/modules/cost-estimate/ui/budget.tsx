import { EmptyState, PanelView } from "@/shared/ui/panel-view";

export function Budget() {
  return <PanelView title="Presupuesto"><div className="estimate-sheet">
    <table><caption>Estimación por cambio · COP</caption>
      <thead><tr>{["Material", "Cantidad", "Unidad", "Precio unitario", "Fuente y fecha", "Diferencia"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody><tr><td colSpan={6}><EmptyState heading="Pendiente de estimación">Para calcular una diferencia hacen falta las cantidades antes y después de un cambio y un precio unitario con fuente y fecha.</EmptyState></td></tr></tbody>
    </table>
  </div></PanelView>;
}
