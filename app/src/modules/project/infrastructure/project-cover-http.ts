import { authenticatedResponse, HttpError } from "@/core/http/http-client";
import type { ProjectCoverSource } from "../domain/owned-project";

/**
 * GET /api/projects/{id}/cover: thumbnail of the first saved view of the latest version (DU-11 = A).
 * The endpoint belongs to the workspace track; until it exists it answers 404 and the card keeps
 * its own gradient, so a 404 is a normal answer here, not an error.
 */
export const projectCoverHttp: ProjectCoverSource = {
  async load(id, signal) {
    try {
      const response = await authenticatedResponse("projects/" + encodeURIComponent(id) + "/cover", { signal });
      const blob = await response.blob();
      return blob.size > 0 && blob.type.startsWith("image/") ? blob : null;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  },
};
