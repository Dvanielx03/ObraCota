export interface ProjectFile { id: string; projectId: string; name: string; format: "IFC" | "DWG" | "FBX" | "OBJ" }
export interface FileCatalog { list(projectId: string): Promise<ProjectFile[]> }
