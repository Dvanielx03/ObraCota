import metadata from "../../../../public/models/restage.json";
import type { ProjectCatalog } from "../domain/project";

export const exampleCatalog: ProjectCatalog = {
  list: () => [{
    slug: "restage", name: "ReStage", preview: "/models/restage-vista.jpg",
    sourceFile: metadata.fuente.archivo, schema: metadata.fuente.esquema,
  }],
};
