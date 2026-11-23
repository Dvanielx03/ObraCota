import { operationLabel, reportFindings, statusLabel, type ModelChange } from "@/modules/model-change/domain/model-change";
import { exportDate, slug } from "./view-export";

/** "ObraCota-paquete-duplex-v2.zip" */
export function packageName(project: string | undefined, revision: number): string {
  return "ObraCota-paquete-" + slug(project ?? "", "proyecto") + "-v" + revision + ".zip";
}

/** How a change relates to the packaged version: it produced it, or it was applied on top of it. */
export type ChangeRelation = "produced" | "applied-on";
export interface PackagedChange { change: ModelChange; relation: ChangeRelation; file: string }

/** Applied changes that produced the version or were applied on it, oldest first. */
export function versionChanges(changes: readonly ModelChange[], version: string): { change: ModelChange; relation: ChangeRelation }[] {
  return changes
    .filter((change) => change.status === "APPLIED" && (change.appliedVersion === version || change.baseVersion === version))
    .sort((a, b) => (a.appliedAt ?? a.createdAt).localeCompare(b.appliedAt ?? b.createdAt))
    .map((change) => ({ change, relation: change.appliedVersion === version ? "produced" : "applied-on" }));
}

/** "cambios/01-cambiar-puerta.json" */
export function changeFileName(index: number, change: ModelChange): string {
  return "cambios/" + String(index + 1).padStart(2, "0") + "-" + slug(change.description, "cambio") + ".json";
}

/** The change as the package keeps it: recipe, engine report and cost estimate, with Spanish keys for the reader. */
export function changeRecord(change: ModelChange, relation: ChangeRelation): string {
  const { estimate, ...report } = change.report ?? { estimate: null };
  return JSON.stringify({
    id: change.id,
    descripcion: change.description,
    resumen: change.summary,
    estado: change.status,
    relacion: relation === "produced" ? "produjo esta versión" : "se aplicó sobre esta versión",
    origen: change.origin,
    autor: change.author?.email ?? null,
    revisionBase: change.baseRevision,
    versionBase: change.baseVersion,
    versionAplicada: change.appliedVersion,
    aplicadoEn: change.appliedAt,
    aprobadoPor: change.appliedBy?.email ?? null,
    receta: change.recipe,
    informe: change.report ? report : null,
    costo: estimate ?? null,
  }, null, 2) + "\n";
}

function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return amount.toLocaleString("es-CO") + " " + currency; }
}

export interface PackageSummary {
  project?: string; file: string; revision: number; sha256?: string; uploadedAt?: string;
  original: string; pictures: readonly { file: string; name: string }[]; onlyCurrent: boolean;
  changes: readonly PackagedChange[]; exportedAt: Date;
}

/** RESUMEN.md: what the package holds and each applied change in words, for a reviewer without ObraCota. */
export function packageSummary(summary: PackageSummary): string {
  const lines = ["# Paquete de revisión · " + (summary.project ?? summary.file) + " · v" + summary.revision, ""];
  if (summary.project) lines.push("- **Proyecto:** " + summary.project);
  lines.push("- **Archivo:** " + summary.file, "- **Versión:** v" + summary.revision);
  if (summary.uploadedAt) {
    const date = new Date(summary.uploadedAt);
    if (!Number.isNaN(date.getTime())) lines.push("- **Subida:** " + exportDate(date));
  }
  if (summary.sha256) lines.push("- **SHA-256 del original:** `" + summary.sha256 + "`");
  lines.push("- **Exportado:** " + exportDate(summary.exportedAt), "", "## Contenido", "");
  lines.push("- `" + summary.original + "`: el archivo original de la versión, byte a byte.");
  lines.push("- `vistas/`: " + (summary.pictures.length === 1 ? "1 imagen PNG" : summary.pictures.length + " imágenes PNG")
    + (summary.onlyCurrent ? " del encuadre en pantalla" : " de las vistas guardadas") + " y su índice.");
  for (const picture of summary.pictures) lines.push("  - `" + picture.file + "`: " + picture.name);
  if (summary.changes.length) lines.push("- `cambios/`: receta, informe y costo de cada cambio de diseño aplicado, en JSON.");
  lines.push("", "## Cambios de diseño aplicados", "");
  if (!summary.changes.length) lines.push("Ninguna propuesta de cambio aplicada produjo esta versión ni se aplicó sobre ella.");
  for (const [index, { change, relation, file }] of summary.changes.entries()) {
    lines.push("### " + (index + 1) + ". " + change.description, "");
    lines.push("- **Estado:** " + statusLabel(change.status) + " · " + (relation === "produced" ? "produjo esta versión" : "se aplicó sobre esta versión"));
    if (change.appliedAt) lines.push("- **Aplicado:** " + exportDate(new Date(change.appliedAt)) + (change.appliedBy?.email ? " por " + change.appliedBy.email : ""));
    if (change.summary) lines.push("- **Resumen:** " + change.summary);
    lines.push("- **Datos:** `" + file + "`");
    const results = change.report?.operations ?? [];
    if (change.recipe.operations.length) {
      lines.push("- **Operaciones:**");
      for (const operation of change.recipe.operations)
        lines.push("  - " + operationLabel(operation, results.find((result) => result.id === operation.id), change.legacyReview));
    }
    const warnings = change.report ? reportFindings(change.report).filter((finding) => finding.status === "WARNING") : [];
    if (warnings.length) {
      lines.push("- **Avisos de diseño:**");
      for (const finding of warnings) lines.push("  - " + (finding.explanation ?? finding.rule));
    }
    const estimate = change.report?.estimate;
    lines.push("- **Costo estimado:** " + (estimate ? money(estimate.total, estimate.currency || "COP") + (estimate.complete ? "" : " (incompleto: faltan precios)") : "sin estimación"));
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}
