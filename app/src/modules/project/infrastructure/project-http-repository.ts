import { authenticated } from "@/core/http/http-client";
import type { OwnedProject, OwnedProjectRepository } from "../domain/owned-project";

interface ProjectResponse { id: string; name: string; archived?: boolean; updatedAt?: string | null }
function toProject(row: ProjectResponse): OwnedProject {
  return { id: row.id, name: row.name, archived: row.archived === true, updatedAt: row.updatedAt || undefined };
}
const path = (id: string) => "projects/" + encodeURIComponent(id);

export const projectHttpRepository: OwnedProjectRepository = {
  async remove(id) { await authenticated<void>(path(id), { method: "DELETE" }); },
  async list() { return (await authenticated<ProjectResponse[]>("projects")).map(toProject); },
  async get(id) { return toProject(await authenticated<ProjectResponse>(path(id))); },
  async create(name) {
    return toProject(await authenticated<ProjectResponse>("projects", { method: "POST", body: JSON.stringify({ name }) }));
  },
  async rename(id, name) {
    return toProject(await authenticated<ProjectResponse>(path(id), { method: "PUT", body: JSON.stringify({ name }) }));
  },
  async setArchived(id, archived) {
    return toProject(await authenticated<ProjectResponse>(path(id) + "/archived", { method: "PUT", body: JSON.stringify({ archived }) }));
  },
};
