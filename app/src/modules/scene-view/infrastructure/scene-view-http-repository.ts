import { authenticated, authenticatedResponse } from "@/core/http/http-client";
import type { SceneView, SceneViewRepository } from "../domain/scene-view";

type Row = { id: string; name: string; position: number[]; target: number[]; span: number; hasThumbnail?: boolean };
const triple = (value: number[]): [number, number, number] => [value[0], value[1], value[2]];
function toView(row: Row): SceneView {
  return { id: row.id, name: row.name, position: triple(row.position), target: triple(row.target), span: row.span, hasThumbnail: row.hasThumbnail === true };
}

export function sceneViewHttpRepository(project: string, version: string): SceneViewRepository {
  const base = "projects/" + encodeURIComponent(project) + "/versions/" + encodeURIComponent(version) + "/views";
  const one = (id: string) => base + "/" + encodeURIComponent(id);
  return {
    async list() { return (await authenticated<Row[]>(base)).map(toView); },
    async save(name, pose, thumbnail) {
      const body = { name, position: pose.position, target: pose.target, span: pose.span, ...(thumbnail ? { thumbnail } : {}) };
      return toView(await authenticated<Row>(base, { method: "POST", body: JSON.stringify(body) }));
    },
    async rename(id, name) {
      return toView(await authenticated<Row>(one(id), { method: "PUT", body: JSON.stringify({ name }) }));
    },
    async remove(id) { await authenticatedResponse(one(id), { method: "DELETE" }); },
    async thumbnail(id, signal) { return (await authenticatedResponse(one(id) + "/thumbnail", { signal })).blob(); },
  };
}
