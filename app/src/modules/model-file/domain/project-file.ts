export interface ProjectFile { id: string; projectId: string; name: string; format: "IFC" | "DWG" | "RVT" | "FBX" | "OBJ" }
export interface FileCatalog { list(projectId: string): Promise<ProjectFile[]> }
