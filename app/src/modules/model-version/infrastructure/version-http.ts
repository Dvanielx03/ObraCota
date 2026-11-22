import { authenticated, authenticatedResponse } from "@/core/http/http-client";
import type { ModelVersion, VersionNotes, VersionRepository } from "../domain/model-version";

export const versionRepository: VersionRepository = {
  list: (project,file,signal) => authenticated<ModelVersion[]>(`projects/${project}/files/${file}/versions`,{ signal }),
  get: (project,version,signal) => authenticated<ModelVersion>(`projects/${project}/versions/${version}`,{ signal }),
  upload(project, file, fileId) {
    const query = new URLSearchParams({ name: file.name });
    if (fileId) query.set("file", fileId);
    return authenticated<ModelVersion>(`projects/${project}/uploads?${query}`, {
      method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" },
    });
  },
  async open(project,id,signal) {
    const base = `projects/${project}/versions/${id}`;
    const version = await authenticated<ModelVersion>(base,{ signal });
    const response = await authenticatedResponse(base + "/original",{ signal });
    const blob = await response.blob();
    if (blob.size !== version.byteSize) throw new Error("La descarga del original está incompleta.");
    return new File([blob], version.name, { lastModified: Date.parse(version.uploadedAt) });
  },
};

export function remoteNotes(project: string, id: string): VersionNotes {
  const path = `projects/${project}/versions/${id}/notes`;
  return {
    load: () => authenticated<Record<string,string>>(path),
    save: (key,text,onlyIfAbsent=false) => authenticated<void>(path,{method:"PUT", body:JSON.stringify({key,text,onlyIfAbsent})}),
  };
}
