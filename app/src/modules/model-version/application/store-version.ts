import { MAX_ORIGINAL_BYTES, type VersionRepository } from "../domain/model-version";

export function storeVersion(repository: VersionRepository, project: string, file: File, fileId?: string) {
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error("El archivo supera los 256 MiB.");
  if (!file.size || !/\.(ifc|dwg|dxf|rvt|fbx|obj)$/i.test(file.name)) throw new Error("Elige un IFC, DWG, DXF, RVT, FBX u OBJ con contenido.");
  return repository.upload(project,file,fileId);
}
