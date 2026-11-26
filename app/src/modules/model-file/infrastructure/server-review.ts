import { authenticated } from "@/core/http/http-client";
import { modelChangeRepository } from "@/modules/model-change/infrastructure/model-change-http";
import { diffCounts, flagLabels, ifcText, operationLabel, reportFindings, statusLabel, type ModelChange } from "@/modules/model-change/domain/model-change";

/** The engine's `/summary` of a stored IFC version, as the backend passes it on (§4.4). */
export interface ServerSummary {
  schema: string;
  sha256: string;
  length_unit: { name: string; scale: number } | null;
  storeys: { guid: string; name: { text: string } | string | null; elevation_m: number | null }[];
  counts: Record<string, number>;
  operations: Record<string, { available: boolean; reason?: string }>;
}

/** How a model change relates to what is open in the viewer. */
export type ChangeRole = "published" | "pending" | "proposal";

/** What the server knows about the open model for Revisar (H7): its reading and the changes that concern it. */
export interface ServerReview {
  summary: ServerSummary | null;
  /** Why the summary could not be read (the engine down, a file it cannot open…). */
  summaryError?: string;
  changes: { role: ChangeRole; change: ModelChange }[];
}

/** Where the open model lives on the server: a stored version, or the preview of a change. */
export type ReviewScope = { project: string; version: string } | { project: string; change: string };

const summaryPath = (project: string, version: string) => "projects/" + encodeURIComponent(project) + "/versions/" + encodeURIComponent(version) + "/summary";

/**
 * Reads the server's report for Revisar. For a stored version: the engine's summary of that version, the change that
 * published it and the changes still open over it (drafts and ready ones with a preview report). For a 3D preview:
 * the change itself, with the summary of its base. A summary that fails is reported, not thrown: the changes are
 * still worth showing.
 */
export async function loadServerReview(scope: ReviewScope, signal?: AbortSignal): Promise<ServerReview> {
  const summary = async (version: string) => {
    try { return { summary: await authenticated<ServerSummary>(summaryPath(scope.project, version), { signal }) }; }
    catch (error) {
      if (signal?.aborted) throw error;
      return { summary: null, summaryError: error instanceof Error ? error.message : "El servidor no pudo leer el modelo." };
    }
  };
  if ("change" in scope) {
    const change = await modelChangeRepository.get(scope.project, scope.change, signal);
    return { ...(await summary(change.baseVersion)), changes: [{ role: "proposal", change }] };
  }
  const [read, all] = await Promise.all([summary(scope.version), modelChangeRepository.list(scope.project, signal)]);
  const changes: ServerReview["changes"] = [
    ...all.filter((change) => change.appliedVersion === scope.version || change.restoredVersion === scope.version)
      .map((change) => ({ role: "published" as const, change })),
    ...all.filter((change) => change.baseVersion === scope.version && (change.status === "DRAFT" || change.status === "READY") && change.report)
      .map((change) => ({ role: "pending" as const, change })),
  ];
  return { ...read, changes };
}

const roles: Record<ChangeRole, string> = {
  published: "Cambio que publicó esta versión",
  pending: "Propuesta abierta sobre esta versión",
  proposal: "Vista previa abierta",
};
/** «Cambio que publicó esta versión», «Propuesta abierta sobre esta versión» or «Vista previa abierta». */
export const roleLabel = (role: ChangeRole) => roles[role];

/** «IFC2X3 · metre · 3 niveles · 1.204 elementos»: one line about what the engine read. */
export function summaryLine(summary: ServerSummary): string {
  const elements = Object.values(summary.counts).reduce((total, count) => total + count, 0);
  const storeys = summary.storeys.length;
  return [summary.schema, summary.length_unit ? "unidad " + summary.length_unit.name.toLowerCase() : "sin unidad de longitud única",
    storeys === 1 ? "1 nivel" : storeys + " niveles", elements.toLocaleString("es-CO") + " elementos"].join(" · ");
}

/** The classes with the most elements, «IfcWall 57 · IfcDoor 14 · …», at most `limit`. */
export function topClasses(summary: ServerSummary, limit = 6): string {
  return Object.entries(summary.counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
    .map(([name, count]) => name + " " + count.toLocaleString("es-CO")).join(" · ");
}

const operationNames: Record<string, string> = { "ifc.change_type": "Cambiar el tipo de una puerta", "ifc.set_property": "Cambiar una propiedad" };
/** Each operation the engine offers on this model, with the reason when it is off. */
export function operationLines(summary: ServerSummary): string[] {
  return Object.entries(summary.operations ?? {}).map(([op, state]) =>
    (operationNames[op] ?? op) + ": " + (state.available ? "disponible" : "no disponible · " + (state.reason ?? "sin motivo")));
}

/** The server part of the downloaded report, in plain text. */
export function serverReportLines(review: ServerReview): string[] {
  const lines = ["", "INFORME DEL SERVIDOR"];
  if (review.summary) {
    lines.push("Lectura del motor: " + summaryLine(review.summary), "Clases: " + topClasses(review.summary, 12),
      "Huella SHA-256: " + review.summary.sha256, ...operationLines(review.summary).map((line) => "Operación · " + line));
  } else lines.push("Lectura del motor: " + (review.summaryError ?? "sin lectura"));
  if (!review.changes.length) lines.push("Cambios de modelo: ninguno publicado ni abierto sobre esta versión");
  for (const { role, change } of review.changes) {
    const results = new Map(change.report?.operations.map((result) => [result.id, result]) ?? []);
    lines.push("", roleLabel(role) + " · " + change.description + " (" + statusLabel(change.status) + (change.origin === "AGENT" ? " · propuesto por el agente de diseño" : "") + ")");
    change.recipe.operations.forEach((operation, index) => lines.push("  " + (index + 1) + ". " + operationLabel(operation, results.get(operation.id), change.legacyReview)));
    if (!change.report) { lines.push("  Sin vista previa del servidor"); continue; }
    for (const finding of reportFindings(change.report))
      lines.push("  Aviso · " + finding.rule + " · " + finding.status + (finding.explanation ? " · " + finding.explanation : "") + (finding.element ? " · " + finding.element : ""));
    const diff = change.report.diff;
    if (diff) {
      const counts = diffCounts(diff);
      lines.push("  Diferencias con la base: " + counts.changed + " cambiados · " + counts.added + " añadidos · " + counts.deleted + " eliminados");
      for (const entry of [...diff.changed, ...diff.added, ...diff.deleted])
        lines.push("    " + entry.guid + " · " + entry.class + " · " + (ifcText(entry.name) ?? "Sin nombre") + (entry.flags?.length ? " · " + flagLabels(entry).join(", ") : ""));
    }
    for (const layer of change.report.validation?.layers ?? [])
      lines.push("  Validación · " + layer.name + " · " + layer.status + (layer.reason ? " · " + layer.reason : ""));
  }
  return lines;
}
