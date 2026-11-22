/** Panel pages that belong to one project: the example (restage) or an owned project (UUID). */
const PROJECT_PATH = /^\/proyectos\/(restage|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/([^/?#]+))?\/?$/i;

export interface ProjectRoute {
  /** "restage" or the project UUID. */
  id: string;
  /** "/proyectos/{id}". */
  base: string;
  /** "" for the summary, otherwise "archivos", "cambios"… */
  section: string;
  example: boolean;
}

export function projectRoute(path: string | null | undefined): ProjectRoute | null {
  const match = path?.match(PROJECT_PATH);
  if (!match) return null;
  const id = match[1].toLowerCase();
  return { id, base: "/proyectos/" + id, section: (match[2] || "").toLowerCase(), example: id === "restage" };
}

/** Sign-in pages keep the top bar free of session controls. */
export function isAuthPath(path: string | null | undefined): boolean {
  return path === "/ingresar" || path === "/registro";
}
