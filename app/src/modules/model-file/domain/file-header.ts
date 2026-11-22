/**
 * The first bytes say what a file really is, whatever its extension. The server checks the same
 * headers (VolumeStorage); reading them here first lets the form name the actual problem before
 * sending megabytes, instead of a generic rejection.
 */
export const HEADER_BYTES = 16;

const KNOWN: { test: (head: string) => boolean; what: string; hint: string }[] = [
  { test: head => head.startsWith("PK"), what: "un archivo ZIP", hint: "Descomprímelo y sube el DWG o el IFC que contiene." },
  { test: head => head.startsWith("%PDF"), what: "un PDF", hint: "Sube el plano original en DWG o el modelo en IFC." },
  { test: head => head.startsWith("Rar!"), what: "un archivo RAR", hint: "Descomprímelo y sube el DWG o el IFC que contiene." },
  { test: head => /^\s*0\s*\r?\n\s*SECTION/.test(head), what: "un DXF", hint: "Guárdalo como DWG desde tu programa de dibujo y súbelo de nuevo." },
];

/** Why a file cannot be a valid IFC or DWG, or null when its header matches its extension. */
export function headerProblem(name: string, head: string): string | null {
  const extension = name.toLowerCase().split(".").pop();
  const expected = extension === "dwg" ? "DWG" : extension === "ifc" ? "IFC" : null;
  if (!expected) return "Elige un archivo .ifc o .dwg.";
  const valid = expected === "DWG" ? /^AC10\d\d/.test(head) : head.startsWith("ISO-10303-21;");
  if (valid) return null;
  const known = KNOWN.find(kind => kind.test(head));
  return known
    ? `«${name}» tiene extensión .${extension}, pero es ${known.what}. ${known.hint}`
    : `«${name}» no es un ${expected} válido: su cabecera no corresponde a ese formato.`;
}
