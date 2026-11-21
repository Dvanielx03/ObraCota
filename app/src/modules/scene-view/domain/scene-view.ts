import type { CameraPose } from "@/viewer/domain/viewer.port";

export const VIEW_NAME_LIMIT = 60;
export const VIEW_LIMIT = 24;

export interface SceneView extends CameraPose { id: string; name: string }

export interface SceneViewRepository {
  list(): Promise<SceneView[]>;
  save(name: string, pose: CameraPose): Promise<SceneView>;
  rename(id: string, name: string): Promise<SceneView>;
  remove(id: string): Promise<void>;
}

/** First free "Vista N" among the existing names. */
export function nextViewName(views: readonly { name: string }[]): string {
  const taken = new Set(views.map(view => view.name.trim().toLocaleLowerCase("es")));
  for (let n = views.length + 1; ; n++) if (!taken.has("vista " + n)) return "Vista " + n;
}

export function cleanViewName(value: string): string {
  const name = value.trim();
  if (!name || name.length > VIEW_NAME_LIMIT) throw new Error("Escribe un nombre de hasta " + VIEW_NAME_LIMIT + " caracteres.");
  return name;
}
