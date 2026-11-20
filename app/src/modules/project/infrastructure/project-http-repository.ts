import { authenticated } from "@/core/http/http-client";
import type { OwnedProject, OwnedProjectRepository } from "../domain/owned-project";

interface ProjectResponse { id: string; name: string }
function toProject(row: ProjectResponse): OwnedProject { return { id: row.id, name: row.name }; }

export const projectHttpRepository: OwnedProjectRepository = {
  async list() { return (await authenticated<ProjectResponse[]>("projects")).map(toProject); },
  async get(id) { return toProject(await authenticated<ProjectResponse>("projects/" + encodeURIComponent(id))); },
  async create(name) {
    return toProject(await authenticated<ProjectResponse>("projects", { method: "POST", body: JSON.stringify({ name }) }));
  },
};
