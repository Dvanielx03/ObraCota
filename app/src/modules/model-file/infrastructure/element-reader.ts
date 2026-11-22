import { authenticated } from "@/core/http/http-client";
import type { ElementProperties, ElementReader } from "../domain/element-properties";

export const elementReader: ElementReader = {
  properties: (scope, guid, signal) => authenticated<ElementProperties>(
    "projects/" + scope.project + "/versions/" + scope.version + "/elements/" + encodeURIComponent(guid), { signal }),
};
