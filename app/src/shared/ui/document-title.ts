"use client";
import { useEffect } from "react";

/** "Dúplex · v2 · ObraCota": the parts that are known, then the brand. */
export function documentTitle(...parts: readonly (string | undefined | null)[]): string {
  return [...parts.filter((part): part is string => !!part && !!part.trim()), "ObraCota"].join(" · ");
}

/**
 * Title of the browser tab for pages whose name is only known in the browser (a project, a stored
 * version). Server pages keep their static metadata; nothing is written while `title` is null.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
