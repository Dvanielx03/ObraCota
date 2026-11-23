import type { ElementInfo } from "@/viewer/domain/viewer.port";

export type DrawingQueryKind = "all" | "text" | "dimension" | "layer";

const decimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 6, useGrouping: false });
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("es-CO");

export function matchesDrawingQuery(item: ElementInfo, kind: DrawingQueryKind, query: string) {
  if (kind === "text" && (!item.annotation || item.dimension)) return false;
  if (kind === "dimension" && !item.dimension) return false;
  const fields = kind === "layer" ? [item.level] : [item.name, item.level, item.type, item.id, item.annotation?.handle, item.annotation?.raw,
    ...Object.keys(item.cad?.types ?? {})];
  return normalize(fields.join(" ")).includes(query);
}

export function drawingSearchTerm(query: string) {
  return normalize(query);
}

export function drawingEvidenceLine(item: ElementInfo, units: string) {
  const reference = item.annotation?.handle ? `Handle ${item.annotation.handle}` : item.type;
  return item.dimension ? `${reference} · ${decimal.format(item.dimension.value)} ${units}` : reference;
}

export function drawingQueryReport(name: string, units: string, omissions: string, kind: DrawingQueryKind, query: string,
  groups: ReadonlyMap<string, readonly ElementInfo[]>) {
  const lines = ["Consulta DWG de ObraCota", `Archivo: ${name}`, `Unidad del plano: ${units}`, `Búsqueda: ${query.trim() || "Sin término"}`,
    omissions ? `Importación parcial: ${omissions}` : "Registros leídos del espacio modelo",
    "La medida se calcula con la geometría. El rótulo CAD puede mostrar otro valor por estilo o texto forzado."];
  for (const [layer, items] of groups) {
    lines.push("", `${layer} — ${items.length} registros leídos`);
    if (kind === "layer") continue;
    for (const item of items) {
      const points = item.dimension?.endpoints ?? item.annotation?.position;
      const origin = item.annotation?.raw?.trim();
      lines.push([item.name, drawingEvidenceLine(item, units), points && `Puntos ${points.map(n => decimal.format(n)).join(" / ")}`,
        origin && `Texto CAD: ${origin}`].filter(Boolean).join(" · "));
    }
  }
  return lines.join("\n") + "\n";
}
