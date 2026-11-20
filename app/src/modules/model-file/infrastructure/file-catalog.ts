import { authenticated } from "@/core/http/http-client";
import type { FileCatalog, ProjectFile } from "../domain/project-file";

export const fileCatalog: FileCatalog = {
  list: project => authenticated<ProjectFile[]>("projects/" + project + "/files"),
};
