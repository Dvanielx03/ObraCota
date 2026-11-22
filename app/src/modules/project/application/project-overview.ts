import type { FileCatalog } from "@/modules/model-file/domain/project-file";
import type { ModelVersion, VersionRepository } from "@/modules/model-version/domain/model-version";
import { latestVersion } from "../domain/project-card";

export interface ProjectOverview { files: number; versions: number; latest?: ModelVersion }

/** Files of a project and its newest stored version, which the "Visor" tab opens. */
export async function projectOverview(files: FileCatalog, versions: VersionRepository, project: string): Promise<ProjectOverview> {
  const list = await files.list(project);
  const all = (await Promise.all(list.map(file => versions.list(project, file.id)))).flat();
  return { files: list.length, versions: all.length, latest: latestVersion(all) };
}
