import * as T from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { ElementInfo } from "../domain/viewer.port";
import type { SceneModel } from "./model-source";

/**
 * Manufacturer meshes (FBX and OBJ, as BIMobject packages ship them next to the DWG) read in the page
 * with the loaders of three.js. Every mesh becomes a selectable element of the explorer; materials are
 * reduced to their colour and opacity, and textures are never fetched: every texture URL of the file
 * (embedded images included, which some FBX carry) resolves to a blank data image, so a file never
 * makes the page request anything.
 *
 * Units and orientation:
 * - FBX declares its unit in GlobalSettings.UnitScaleFactor (centimetres per unit; 0.1 is millimetres)
 *   and its axis system in UpAxis, FrontAxis and CoordAxis with their signs. The model is scaled to
 *   metres, so the walk and its eye height work as with an IFC, and turned to Y up.
 * - OBJ has no unit and no axis: it is drawn as written (Y up, the convention of most exporters) in
 *   its own unit, and the header says so. Without verifiable units there is no walk.
 */

// 1×1 transparent PNG: what every texture request of a file resolves to.
const NO_TEXTURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const UNITS: [number, string][] = [[0.1, "mm"], [1, "cm"], [2.54, "in"], [10, "dm"], [30.48, "ft"], [100, "m"], [91.44, "yd"], [100000, "km"]];
/** A neutral finish for OBJ pieces, whose colours live in a separate .mtl the upload does not carry. */
const OBJ_FINISH = 0xc4c9ce;

/** "7.4" from a binary or ASCII FBX, or undefined when the header does not say. */
export function fbxVersion(bytes: ArrayBuffer): string | undefined {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 64));
  const text = new TextDecoder().decode(head);
  if (text.startsWith("Kaydara FBX Binary  \0") && bytes.byteLength >= 27) {
    const code = new DataView(bytes).getUint32(23, true);
    return Math.floor(code / 1000) + "." + Math.floor(code % 1000 / 100);
  }
  return /; FBX (\d+)\.(\d+)/.exec(text)?.slice(1).join(".");
}

/**
 * Integer properties of FBX GlobalSettings ("UpAxis", "UnitScaleFactor"…) read from the raw file,
 * since the loader keeps its parsed tree to itself. In a binary FBX a property is a "P" record of
 * strings (name, type, label, flags) followed by the value; in ASCII, a `P: "Name", …, value` line.
 */
export function fbxSetting(bytes: ArrayBuffer, name: string): number | undefined {
  const data = new Uint8Array(bytes);
  if (new TextDecoder().decode(data.subarray(0, 21)) === "Kaydara FBX Binary  \0") {
    const needle = new Uint8Array(5 + name.length);
    needle[0] = 0x53; new DataView(needle.buffer).setUint32(1, name.length, true);
    for (let i = 0; i < name.length; i++) needle[5 + i] = name.charCodeAt(i);
    const at = indexOf(data, needle);
    if (at < 0) return undefined;
    const view = new DataView(bytes);
    let p = at + needle.length;
    for (let i = 0; i < 3 && data[p] === 0x53 && p + 5 <= data.length; i++) p += 5 + view.getUint32(p + 1, true);
    if (p + 9 > data.length) return undefined;
    const type = String.fromCharCode(data[p]);
    return type === "I" ? view.getInt32(p + 1, true) : type === "D" ? view.getFloat64(p + 1, true)
      : type === "F" ? view.getFloat32(p + 1, true) : type === "L" ? Number(view.getBigInt64(p + 1, true)) : undefined;
  }
  const text = new TextDecoder().decode(data.subarray(0, Math.min(data.length, 1 << 20)));
  const match = new RegExp('P:\\s*"' + name + '"\\s*,[^\\n]*?,\\s*(-?[\\d.]+(?:[eE][-+]?\\d+)?)\\s*$', "m").exec(text);
  return match ? Number(match[1]) : undefined;
}
function indexOf(data: Uint8Array, needle: Uint8Array) {
  const first = needle[0];
  outer: for (let i = data.indexOf(first); i >= 0 && i <= data.length - needle.length; i = data.indexOf(first, i + 1)) {
    for (let k = 1; k < needle.length; k++) if (data[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

/** "mm" for 0.1, or "0,5 cm" for an unusual factor. */
export function unitLabel(centimetres: number) {
  const known = UNITS.find(([factor]) => Math.abs(factor - centimetres) <= factor * 1e-6);
  return known ? known[1] : centimetres.toLocaleString("es-CO", { maximumFractionDigits: 6 }) + " cm";
}

/**
 * The change of basis from the file's axes to three.js (X right, Y up, Z front), from the
 * GlobalSettings axis system: UpAxis/UpAxisSign, FrontAxis/FrontAxisSign and CoordAxis/CoordAxisSign
 * (0 = X, 1 = Y, 2 = Z; sign ±1). Its rows are the file's right, up and front directions, so a file vector
 * v lands at (right·v, up·v, front·v). When the file omits the front and right axes, the usual
 * companions of its up axis are assumed (Y up: Z front, X right; Z up: −Y front, X right, as 3ds Max
 * and Revit write them). `verified` is false when the axis system is missing, incomplete or not a basis.
 */
export function fbxAxes(bytes: ArrayBuffer): {matrix: T.Matrix4; verified: boolean} {
  const up = fbxSetting(bytes, "UpAxis"), upSign = fbxSetting(bytes, "UpAxisSign") ?? 1;
  const defaults: Record<number, [number, number, number, number]> = {1: [2, 1, 0, 1], 2: [1, -1, 0, 1]};
  const companion = up === undefined ? undefined : defaults[up];
  const front = fbxSetting(bytes, "FrontAxis") ?? companion?.[0], frontSign = fbxSetting(bytes, "FrontAxisSign") ?? companion?.[1] ?? 1;
  const coord = fbxSetting(bytes, "CoordAxis") ?? companion?.[2], coordSign = fbxSetting(bytes, "CoordAxisSign") ?? companion?.[3] ?? 1;
  const axes = [coord, up, front], signs = [coordSign, upSign, frontSign];
  const basis = axes.every(a => a === 0 || a === 1 || a === 2) && new Set(axes).size === 3 && signs.every(s => s === 1 || s === -1);
  if (!basis) return {matrix: new T.Matrix4(), verified: false};
  const [r, u, f] = axes.map((axis, row) => [0, 1, 2].map(column => column === axis ? signs[row] : 0));
  const matrix = new T.Matrix4().set(r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, f[0], f[1], f[2], 0, 0, 0, 0, 1);
  return {matrix, verified: true};
}

/**
 * The loader turns a Z-up file by overwriting the rotation of its top node. When the file has a single
 * top model (3ds Max exports, PK60), that node had a rotation of its own, which is lost: the table ends
 * up on its side. Rebuild the node's rotation (pre-rotation · rotation · post-rotation⁻¹, as the loader
 * does), so the whole axis change can be applied on a parent instead.
 */
function undoLoaderTurn(scene: T.Group) {
  const data = scene.userData.transformData as {eulerOrder?: string; preRotation?: number[]; rotation?: number[]; postRotation?: number[]} | undefined;
  if (data) {
    const euler = (degrees: number[], order: string) => new T.Matrix4().makeRotationFromEuler(
      new T.Euler(...degrees.map(T.MathUtils.degToRad) as [number, number, number], order as T.EulerOrder));
    const local = new T.Matrix4();
    if (data.preRotation) local.multiply(euler(data.preRotation, "ZYX"));
    if (data.rotation) local.multiply(euler(data.rotation, data.eulerOrder || "ZYX"));
    if (data.postRotation) local.multiply(euler(data.postRotation, "ZYX").invert());
    scene.quaternion.setFromRotationMatrix(local);
  } else scene.rotation.set(0, 0, 0);
}

/**
 * FBXLoader turns every embedded texture into a blob URL that nothing revokes (the URL modifier then
 * sends its request to NO_TEXTURE, so the blob is never even read). Record the URLs created while `run`
 * parses and revoke them all afterwards, so opening a file with embedded images does not keep them in
 * memory until the page closes.
 */
function revokingBlobs<R>(run: () => R): R {
  const original = URL.createObjectURL;
  const created: string[] = [];
  URL.createObjectURL = (object: Blob | MediaSource) => { const url = original.call(URL, object); created.push(url); return url; };
  try { return run(); }
  finally {
    URL.createObjectURL = original;
    for (const url of created) URL.revokeObjectURL(url);
  }
}

/**
 * Explorer ids that survive a new revision of the same product: the path of node names from the top
 * of the file down to the mesh (BIMobject names each piece "L_<uuid>_I<n>"), with an occurrence count
 * when a path repeats. Notes, review evidence and the walk's comparison are keyed by these ids, so a
 * piece added or reordered by the manufacturer never takes over another piece's observation. Only a
 * mesh with no name on its whole path falls back to its position.
 */
export function meshIds(meshes: T.Object3D[], top: T.Object3D): string[] {
  const seen = new Map<string, number>();
  return meshes.map((mesh, index) => {
    const names: string[] = [];
    for (let node: T.Object3D | null = mesh; node && node !== top; node = node.parent) if (node.name.trim()) names.unshift(node.name.trim());
    if (!names.length) return "mesh:" + index;
    const path = names.join("/").replace(/[^\w.\-/]+/g, "_");
    const count = seen.get(path) ?? 0;
    seen.set(path, count + 1);
    return "mesh:" + path + (count ? "#" + count : "");
  });
}

/**
 * Whether a model in metres has a floor to walk on: at least 1 m × 1 m in plan and 0.5 m² of horizontal
 * faces at its base, within 5 cm of its lowest point (a rug, a deck, a room). A lamp or a chair has
 * neither, and a table's top is not at its base: the walk would only ask for a floor that is not there.
 */
export function walkableFloor(root: T.Object3D, meshes: T.Mesh[]): boolean {
  root.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3());
  if (size.x < 1 || size.z < 1) return false;
  const base = box.min.y + 0.05;
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3();
  let area = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position as T.BufferAttribute | undefined;
    if (!position) continue;
    const index = mesh.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const at = (k: number) => index ? index.getX(i + k) : i + k;
      a.fromBufferAttribute(position, at(0)).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, at(1)).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, at(2)).applyMatrix4(mesh.matrixWorld);
      if (a.y > base || b.y > base || c.y > base) continue;
      n.crossVectors(b.sub(a), c.sub(a));
      const twice = n.length();
      // Double-sided pieces: a face looking straight down is a floor seen from below.
      if (twice > 0 && Math.abs(n.y) / twice > 0.55) area += twice / 2;
      if (area >= 0.5) return true;
    }
  }
  return false;
}

function friendlyName(raw: string, index: number) {
  // BIMobject exports name each piece "L_<uuid>_I<n>".
  const piece = /^L_[0-9a-f]{8}(?:_[0-9a-f]{4}){3}_[0-9a-f]{12}_I(\d+)$/i.exec(raw);
  if (piece) return "Pieza " + piece[1];
  return raw.trim() || "Malla " + (index + 1);
}

async function sha256(bytes: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export async function readMesh(file: File, signal: AbortSignal, status: (s: string) => void): Promise<SceneModel> {
  const format = /\.fbx$/i.test(file.name) ? "FBX" : "OBJ";
  status("Leyendo mallas " + format + "…");
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  // Let the wait show the phase before the parser takes the main thread.
  await new Promise(resolve => setTimeout(resolve, 0));
  signal.throwIfAborted();
  const manager = new T.LoadingManager();
  manager.setURLModifier(() => NO_TEXTURE);
  let scene: T.Group, unit: number | undefined, version: string | undefined;
  let top: T.Object3D, axesVerified = true;
  try {
    if (format === "FBX") {
      version = fbxVersion(bytes);
      if (!version) throw new Error("La cabecera no corresponde a un FBX binario ni ASCII.");
      scene = revokingBlobs(() => new FBXLoader(manager).parse(bytes, ""));
      const factor = Number(scene.userData.unitScaleFactor ?? fbxSetting(bytes, "UnitScaleFactor"));
      unit = Number.isFinite(factor) && factor > 0 ? factor : undefined;
      const axes = fbxAxes(bytes);
      axesVerified = axes.verified;
      if (axes.verified) {
        // The whole axis system (any up axis and sign), on a parent; the loader's own Z-up turn is undone.
        if (fbxSetting(bytes, "UpAxis") === 2 && Math.abs(scene.rotation.x + Math.PI / 2) < 1e-6) undoLoaderTurn(scene);
        const holder = new T.Group();
        holder.applyMatrix4(axes.matrix);
        holder.add(scene);
        top = holder;
      } else top = scene;
    } else {
      scene = new OBJLoader(manager).parse(new TextDecoder().decode(bytes));
      top = scene;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const old = /FileVersion: (\d+)/.exec(detail);
    if (old) throw new Error("Este FBX es de la versión " + old[1] + ", anterior a FBX 7.0 (2011). Expórtalo de nuevo como FBX 2011 o posterior.");
    throw new Error("No se pudo leer el " + format + ": " + (detail.replace(/^THREE\.\w+:\s*/, "") || "el archivo está dañado o incompleto."));
  }
  signal.throwIfAborted();
  status("Preparando piezas…");
  const root = new T.Group();
  // Metres when the FBX declares its unit; the OBJ keeps its own.
  if (unit) root.scale.setScalar(unit / 100);
  root.add(top);
  const metric = !!unit && axesVerified;
  const discard: T.Object3D[] = [];
  const meshes: T.Mesh[] = [];
  top.traverse(node => {
    if (node instanceof T.Mesh) meshes.push(node);
    else if (node instanceof T.Light || node instanceof T.Camera || node instanceof T.Line || node instanceof T.Points) discard.push(node);
  });
  for (const node of discard) node.removeFromParent();
  if (!meshes.length) throw new Error("El " + format + " no contiene mallas que dibujar.");
  const stem = file.name.replace(/\.[^.]+$/, "");
  const finishes = new Map<string, T.MeshStandardMaterial>();
  function finish(source: T.Material) {
    const phong = source as T.Material & {color?: T.Color};
    const color = format === "OBJ" ? new T.Color(OBJ_FINISH) : phong.color instanceof T.Color ? phong.color.clone() : new T.Color(OBJ_FINISH);
    const opacity = T.MathUtils.clamp(source.opacity ?? 1, .25, 1);
    const key = color.getHexString() + ":" + opacity.toFixed(2);
    let material = finishes.get(key);
    if (!material) {
      material = new T.MeshStandardMaterial({color, roughness: .72, metalness: 0, side: T.DoubleSide,
        transparent: opacity < 1, opacity, depthWrite: opacity >= 1});
      finishes.set(key, material);
    }
    return material;
  }
  const ids = meshIds(meshes, top);
  const elements: ElementInfo[] = meshes.map((mesh, index) => {
    const sources = ([] as T.Material[]).concat(mesh.material);
    const names = [...new Set(sources.map(m => m.name.trim()).filter(Boolean))];
    const simple = sources.map(finish);
    mesh.material = Array.isArray(mesh.material) ? simple : simple[0];
    for (const source of sources) {
      for (const value of Object.values(source)) if (value instanceof T.Texture) value.dispose();
      source.dispose();
    }
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    const id = ids[index];
    mesh.userData.elementId = id;
    // The walk collides with furniture-like bodies; only a model in verified metres can be walked.
    if (metric) mesh.userData.ifcType = "IFCFURNISHINGELEMENT";
    const parent = mesh.parent && mesh.parent !== top && mesh.parent.name ? mesh.parent.name : top.name || stem;
    return {id, name: friendlyName(mesh.name, index), level: parent || stem, type: "Malla " + format,
      material: names.join(", ") || undefined};
  });
  const versionId = await sha256(bytes);
  signal.throwIfAborted();
  // The walk needs verified metres and axes, and a floor: most manufacturer pieces are a lamp or a chair.
  const floor = metric && walkableFloor(root, meshes);
  const schema = format === "FBX"
    ? "FBX " + version + " · " + (unit ? unitLabel(unit) + ", convertido a metros" : "unidad no declarada")
      + (axesVerified ? "" : " · ejes no verificados") + (metric && !floor ? " · sin piso para recorrer" : "")
    : "OBJ · sin unidades declaradas";
  return {root, elements, name: file.name, schema, sample: false, versionId,
    walk: floor, coordination: metric ? Array.from(new T.Matrix4().elements) : undefined};
}
