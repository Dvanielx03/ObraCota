import { authenticated } from "@/core/http/http-client";

/** Stage of a conversion of a stored RVT to IFC by Autodesk Model Derivative. */
export type RevitTranslationStatus = "QUEUED" | "UPLOADING" | "TRANSLATING" | "STORING" | "DONE" | "FAILED";

export interface RevitTranslation {
  status: RevitTranslationStatus;
  message: string | null;
  /** The IFC version stored when DONE, and the sibling file that holds it. */
  resultVersion: string | null;
  resultFile: string | null;
}

export const revitTranslations = {
  available: (project: string, signal?: AbortSignal) =>
    authenticated<{ available: boolean }>(`projects/${project}/revit-translation/availability`, { signal }).then(r => r.available),
  start: (project: string, version: string) =>
    authenticated<RevitTranslation>(`projects/${project}/versions/${version}/revit-translation`, { method: "POST" }),
  /** The latest conversion of the version, or undefined when it never had one (204). */
  latest: (project: string, version: string, signal?: AbortSignal) =>
    authenticated<RevitTranslation | undefined>(`projects/${project}/versions/${version}/revit-translation`, { signal }),
};

export function translationRunning(translation: RevitTranslation | undefined) {
  return !!translation && translation.status !== "DONE" && translation.status !== "FAILED";
}
