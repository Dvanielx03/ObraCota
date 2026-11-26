import * as T from "three";
import { authenticatedResponse } from "@/core/http/http-client";
import type { ElementInfo } from "../domain/viewer.port";

/** A stored version on the server: the solids of its DWG are tessellated there (ACIS-LECTOR §5). */
export interface StoredSource { project: string; version: string }

interface SolidBody {
  handle: string; type: string; layer: string; instance: number;
  first_vertex: number; vertex_count: number; first_triangle: number; triangle_count: number;
  bbox_mm: { min: number[]; max: number[] };
}
export interface SolidHeader {
  format?: string; tessellator: string; dwg_version?: string;
  units: { insunits: number; name: string; to_mm: number };
  origin_mm: number[]; bbox_mm: { min: number[]; max: number[] };
  vertex_count: number; triangle_count: number;
  bodies: SolidBody[];
  failed: { handle: string; layer: string; reason: string }[];
  skipped: Record<string, number>;
}
export interface SolidMesh { header: SolidHeader; positions: Float32Array; indices: Uint32Array }

const MAGIC = "OCSOLID1";

/**
 * `obracota.dwg-solids/1`: gzip of "OCSOLID1", the length of a JSON header (uint32 LE, multiple of 4), the header,
 * float32 positions in mm relative to `origin_mm` (Z up) and uint32 triangle indices.
 */
export async function decodeSolids(body: ArrayBuffer): Promise<SolidMesh> {
  let bytes = new Uint8Array(body);
  // The server sends the gzip as stored; a proxy that already decoded it leaves the raw mesh.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) throw new Error("La malla de sólidos del servidor no tiene el formato esperado.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + size))) as SolidHeader;
  const start = 12 + size, v = header.vertex_count, t = header.triangle_count;
  if (start + 12 * v + 12 * t > bytes.length) throw new Error("La malla de sólidos del servidor está incompleta.");
  // Copy into aligned buffers: the decompressed view may start at any offset.
  const positions = new Float32Array(bytes.slice(start, start + 12 * v).buffer);
  const indices = new Uint32Array(bytes.slice(start + 12 * v, start + 12 * v + 12 * t).buffer);
  return { header, positions, indices };
}

/** Fetches and decodes the solids of a stored DWG version; the error message is the server's reason. */
export async function fetchSolids(source: StoredSource, signal: AbortSignal): Promise<SolidMesh> {
  const response = await authenticatedResponse(`projects/${source.project}/versions/${source.version}/solids`, { signal });
  return decodeSolids(await response.arrayBuffer());
}

export interface SolidGroups {
  nodes: T.Mesh[];
  elements: ElementInfo[];
  /** Height of the solids in drawing units, so a flat plan with 3D solids opens in «Vista 3D». */
  depth: number;
  /** What the server could not draw, in the «omissions» format of the DWG reader ("type (n)"). */
  omissions: string[];
}

/**
 * The bodies as one mesh of faces per layer, in the viewer's frame of the DWG: drawing units relative to
 * `origin` (drawing coordinates), with (x, y, z) → (x, z, −y) as `read-dwg.js` does for the lines.
 */
export function solidGroups(mesh: SolidMesh, origin: number[] | null, colors: Record<string, number | undefined>): SolidGroups {
  const { header, positions, indices } = mesh;
  const scale = 1 / (header.units.to_mm || 1);
  const base = header.origin_mm.map(value => value * scale);
  const [ox, oy, oz] = origin ?? base;
  const shift = [base[0] - ox, base[1] - oy, base[2] - oz];
  const layers = new Map<string, SolidBody[]>();
  for (const body of header.bodies) {
    if (!body.vertex_count || !body.triangle_count) continue;
    const list = layers.get(body.layer) ?? [];
    list.push(body); layers.set(body.layer, list);
  }
  const nodes: T.Mesh[] = [], elements: ElementInfo[] = [];
  for (const [layer, bodies] of layers) {
    const vertexTotal = bodies.reduce((n, b) => n + b.vertex_count, 0);
    const triangleTotal = bodies.reduce((n, b) => n + b.triangle_count, 0);
    const out = new Float32Array(vertexTotal * 3), index = new Uint32Array(triangleTotal * 3);
    const types: Record<string, number> = {};
    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    let v = 0, t = 0;
    // Triangle ranges of each body, so a click on a solid names its DWG handle (Editar, model changes).
    const entities: { start: number; handle: string; type: string }[] = [];
    for (const body of bodies) {
      entities.push({ start: t, handle: body.handle, type: body.type });
      for (let i = 0; i < body.vertex_count; i++) {
        const from = (body.first_vertex + i) * 3, to = (v + i) * 3;
        const x = positions[from] * scale + shift[0], y = positions[from + 1] * scale + shift[1], z = positions[from + 2] * scale + shift[2];
        out[to] = x; out[to + 1] = z; out[to + 2] = -y;
      }
      for (let i = 0; i < body.triangle_count * 3; i++) index[t * 3 + i] = indices[body.first_triangle * 3 + i] - body.first_vertex + v;
      v += body.vertex_count; t += body.triangle_count;
      types[body.type] = (types[body.type] ?? 0) + 1;
      min[0] = Math.min(min[0], body.bbox_mm.min[0] * scale); min[1] = Math.min(min[1], body.bbox_mm.min[1] * scale);
      max[0] = Math.max(max[0], body.bbox_mm.max[0] * scale); max[1] = Math.max(max[1], body.bbox_mm.max[1] * scale);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(out, 3));
    geometry.setIndex(new T.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    const declared = colors[layer];
    const color = declared === 0xffffff || declared === 0 || declared == null ? 0xb9bfc6 : declared;
    const node = new T.Mesh(geometry, new T.MeshStandardMaterial({ color, side: T.DoubleSide, roughness: .6, metalness: .05 }));
    const id = layer + "/solids";
    node.userData.elementId = id;
    node.userData.entities = entities;
    node.userData.layer = layer;
    nodes.push(node);
    elements.push({ id, name: "Sólidos · " + layer, level: layer, type: "Sólidos ACIS", count: bodies.length, cad: { types, min, max } });
  }
  const depth = (header.bbox_mm.max[2] - header.bbox_mm.min[2]) * scale;
  const omissions: string[] = [];
  if (header.failed.length) omissions.push("Sólidos ACIS sin teselar (" + header.failed.length + ")");
  for (const [type, n] of Object.entries(header.skipped ?? {})) if (n) omissions.push(type + " (" + n + ")");
  return { nodes, elements, depth: Number.isFinite(depth) ? depth : 0, omissions };
}
