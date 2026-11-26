import { authenticated } from "@/core/http/http-client";
import type { ModelInfo } from "@/viewer/domain/viewer.port";
import type { Diff } from "@/modules/model-change/domain/model-change";
import { compareDrawings } from "@/modules/model-file/application/compare-drawings";
import type { ModelVersion, VersionRepository } from "../domain/model-version";

/** What «Comparar versiones» found: IfcDiff's answer for IFC, or the changes by handle for DWG. */
export type RevisionComparison =
  | { kind: "ifc"; diff: Diff }
  | { kind: "drawing"; changes: ReturnType<typeof compareDrawings>["changes"]; ambiguous: number };

/**
 * The revision the rail proposes to compare with: the one just before the open one, or the next one when the open one
 * is the first. Undefined when the file has a single revision.
 */
export function defaultOther(versions: readonly ModelVersion[], open: string): ModelVersion | undefined {
  const sorted = [...versions].sort((a, b) => a.revision - b.revision);
  const at = sorted.findIndex((item) => item.id === open);
  if (at < 0) return undefined;
  return sorted[at - 1] ?? sorted[at + 1];
}

/** Path of the server's diff from `base` to `version` (both of one IFC file). */
export const diffPath = (project: string, version: string, base: string) =>
  "projects/" + encodeURIComponent(project) + "/versions/" + encodeURIComponent(version) + "/diff?base=" + encodeURIComponent(base);

/**
 * Compares the open revision with `other`, from `other` to `open`. IFC asks the server (the engine's `/diff`, by
 * GlobalId); DWG reads the other original in the browser and compares texts and dimensions by handle, as Revisar does
 * with a local file. Both revisions must be of the same file and format.
 */
export async function compareRevisions({ project, open, other, model, repository, signal }: {
  project: string; open: ModelVersion; other: ModelVersion; model: ModelInfo; repository: VersionRepository; signal: AbortSignal;
}): Promise<RevisionComparison> {
  if (open.fileId !== other.fileId) throw new Error("Solo se comparan revisiones del mismo archivo.");
  const drawing = (format: string) => format === "DWG" || format === "DXF";
  // A drawing's revisions are DXF: a DWG and its DXF revision compare by handle like two DWG.
  if (open.format !== other.format && !(drawing(open.format) && drawing(other.format))) throw new Error("Las dos revisiones tienen formatos distintos.");
  if (open.format === "IFC") return { kind: "ifc", diff: await authenticated<Diff>(diffPath(project, open.id, other.id), { signal }) };
  if (drawing(open.format)) {
    if (!model.drawing) throw new Error("Abre el plano para compararlo con otra versión.");
    const { readDrawingIndex, drawingUnits } = await import("@/viewer/infrastructure/model-source");
    const file = await repository.open(project, other.id, signal);
    const index = await readDrawingIndex(file, signal);
    if (drawingUnits(index.units) !== model.drawing.units) throw new Error("Las unidades declaradas difieren. Revisa la escala antes de comparar.");
    const result = compareDrawings(index.labels, model.elements);
    return { kind: "drawing", changes: result.changes, ambiguous: result.ambiguous };
  }
  throw new Error("Comparar versiones funciona con IFC y con planos DWG o DXF.");
}
