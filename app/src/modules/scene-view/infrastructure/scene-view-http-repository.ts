import { authenticated, authenticatedResponse } from "@/core/http/http-client";
import type { SceneView, SceneViewRepository } from "../domain/scene-view";

type Row = { id: string; name: string; position: number[]; target: number[]; span: number };
const triple = (value: number[]): [number, number, number] => [value[0], value[1], value[2]];
function toView(row: Row): SceneView {
  return { id: row.id, name: row.name, position: triple(row.position), target: triple(row.target), span: row.span };
}

export function sceneViewHttpRepository(project: string, version: string): SceneViewRepository {
  const base = "projects/" + encodeURIComponent(project) + "/versions/" + encodeURIComponent(version) + "/views";
  return {
    async list() { return (await authenticated<Row[]>(base)).map(toView); },
    async save(name, pose) {
      return toView(await authenticated<Row>(base, { method: "POST", body: JSON.stringify({ name, ...pose }) }));
    },
    async rename(id, name) {
      return toView(await authenticated<Row>(base + "/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify({ name }) }));
    },
    async remove(id) { await authenticatedResponse(base + "/" + encodeURIComponent(id), { method: "DELETE" }); },
  };
}
