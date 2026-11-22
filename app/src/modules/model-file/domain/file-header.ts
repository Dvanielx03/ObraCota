/**
 * The first bytes say what a file really is, whatever its extension. The server checks the same
 * headers (VolumeStorage.HEAD, the same window); reading them here first lets the form name the
 * actual problem before sending megabytes, instead of a generic rejection.
 */
export const HEADER_BYTES = 4096;

export const MODEL_EXTENSIONS = [".ifc", ".dwg", ".fbx", ".obj"] as const;
/** The `accept` of the file pickers that open or store a model. */
export const MODEL_ACCEPT = MODEL_EXTENSIONS.join(",");

const KNOWN: { test: (head: string) => boolean; what: string; hint: string }[] = [
  { test: head => head.startsWith("PK"), what: "un archivo ZIP", hint: "Descomprímelo y sube el DWG, IFC, FBX u OBJ que contiene." },
  { test: head => head.startsWith("%PDF"), what: "un PDF", hint: "Sube el plano original en DWG o el modelo en IFC." },
  { test: head => head.startsWith("Rar!"), what: "un archivo RAR", hint: "Descomprímelo y sube el DWG, IFC, FBX u OBJ que contiene." },
  { test: head => /^\s*0\s*\r?\n\s*SECTION/.test(head), what: "un DXF", hint: "Guárdalo como DWG desde tu programa de dibujo y súbelo de nuevo." },
  { test: head => /^\s*newmtl\s/m.test(head) && !/^\s*[vf]\s/m.test(head), what: "una biblioteca de materiales MTL", hint: "Sube el .obj que la acompaña: el visor dibuja las mallas con colores neutros." },
  { test: head => head.startsWith("Kaydara FBX Binary") || head.startsWith("; FBX"), what: "un FBX", hint: "Cámbiale la extensión a .fbx." },
];

// Statements of a Wavefront OBJ (geometry, grouping, materials and free-form curves), as the server lists them.
const OBJ_LINE = /^(#.*|(v|vt|vn|vp|f|l|p|o|g|s|mtllib|usemtl|cstype|deg|bmat|step|curv|curv2|surf|parm|trim|hole|scrv|sp|end|con|mg|bevel|c_interp|d_interp|lod|shadow_obj|trace_obj|ctech|stech|call|csh)(\s.*)?)$/;
// A vertex, texture coordinate, normal or face with its numbers: what makes the text an actual mesh.
const OBJ_GEOMETRY = /^((v|vt|vn)\s+[-+]?(\d|\.\d).*|f\s+-?\d.*)$/;

/**
 * OBJ has no signature: plain text whose complete lines (the last one may be cut) are statements or
 * comments, at least one of them a vertex or a face. Same rule as the server.
 */
export function looksLikeObj(head: string, complete: boolean): boolean {
  const text = head.replace(/^﻿/, "");
  if (!text.trim() || text.includes("\0")) return false;
  const lines = text.split(/\r?\n/);
  const judged = (complete ? lines : lines.slice(0, -1)).map(line => line.trim()).filter(Boolean);
  return judged.every(line => OBJ_LINE.test(line)) && judged.some(line => OBJ_GEOMETRY.test(line));
}

function matches(format: string, head: string, complete: boolean) {
  const text = head.replace(/^﻿/, "").trimStart();
  switch (format) {
    case "DWG": return /^AC10\d\d/.test(head);
    case "IFC": return text.startsWith("ISO-10303-21;");
    case "FBX": return head.startsWith("Kaydara FBX Binary  \0") || text.startsWith("; FBX");
    default: return looksLikeObj(head, complete);
  }
}

/**
 * Why a file cannot be a valid IFC, DWG, FBX or OBJ, or null when its header matches its extension.
 * `complete` says the head is the whole file (shorter than HEADER_BYTES, as the server decides), so its
 * last line is whole.
 */
export function headerProblem(name: string, head: string, complete = new TextEncoder().encode(head).length < HEADER_BYTES): string | null {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  const expected = ({ dwg: "DWG", ifc: "IFC", fbx: "FBX", obj: "OBJ" } as Record<string, string>)[extension];
  if (!expected) return "Elige un archivo .ifc, .dwg, .fbx u .obj.";
  if (matches(expected, head, complete)) return null;
  const known = KNOWN.find(kind => kind.test(head));
  return known
    ? `«${name}» tiene extensión .${extension}, pero es ${known.what}. ${known.hint}`
    : `«${name}» no es un ${expected} válido: su cabecera no corresponde a ese formato.`;
}
