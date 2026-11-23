import * as T from "three";
import type { ExteriorFinish, ExteriorMaterial, ExteriorPreview, ExteriorTone } from "../domain/viewer.port";

/**
 * Local preview of an exterior finish on the 3D model (Renderizar › Ver en el modelo 3D). It only swaps
 * materials and lights in the scene: the IFC, the server and the AI request stay as they are.
 */
type Envelope = "wall" | "roof";
interface Shell { walls: T.Mesh[]; roofs: T.Mesh[]; source: ExteriorPreview["source"] }
interface Library { dir: string; size: number; metalness: number; roughness: number; normal: number; gain: number }

/**
 * Poly Haven CC0 textures in /public/materials (see CREDITOS.txt). `size` is the real side of the texture in
 * metres; `gain` lifts the dark scans (wood, steel) to a mid tone, so «Medio» reads as medium.
 * There is no environment map, so steel keeps a low metalness to stay visible.
 */
const LIBRARY: Partial<Record<ExteriorMaterial, Library>> = {
  stone: { dir: "piedra", size: 2, metalness: 0, roughness: 1, normal: 1, gain: 1 },
  wood: { dir: "madera", size: 1, metalness: 0, roughness: 1, normal: 1, gain: 2.6 },
  concrete: { dir: "concreto", size: 2.71, metalness: 0, roughness: 1, normal: .8, gain: 1 },
  steel: { dir: "acero", size: 1, metalness: .35, roughness: .8, normal: .7, gain: 2.4 },
};
const TONE: Record<ExteriorTone, number> = { light: 1.3, medium: 1, dark: .62 };
const PAINT: Record<ExteriorTone, number> = { light: 0xf2eee6, medium: 0xb9b2a4, dark: 0x4f4c47 };
const GLASS: Record<ExteriorTone, [number, number]> = { light: [0xcfe6f0, .3], medium: [0x8fb8cc, .42], dark: [0x3d5866, .58] };
const DAYLIGHT = {
  morning: { sun: 0xffe2b8, sunIntensity: 2.6, direction: [8, 4, 5], sky: 0xdfeeff, ground: 0xa89880, ambient: 1.5, clear: null },
  afternoon: { sun: 0xffb46b, sunIntensity: 2.8, direction: [-8, 3.5, 6], sky: 0xffe0c0, ground: 0x8f7356, ambient: 1.2, clear: null },
  night: { sun: 0xb4caff, sunIntensity: 2, direction: [5, 9, 7], sky: 0x7d8fc4, ground: 0x2a3148, ambient: 2.2, clear: 0x0d1424 },
} as const;

/** Envelope role of a piece from its IFC class and predefined type (or the sample's own tag). */
function envelopeOf(mesh: T.Mesh): Envelope | null {
  if (mesh.userData.envelope === "wall" || mesh.userData.envelope === "roof") return mesh.userData.envelope;
  const type = String(mesh.userData.ifcType ?? ""), predefined = String(mesh.userData.predefined ?? "");
  if (/^IFC(WALL|WALLSTANDARDCASE|WALLELEMENTEDCASE|CURTAINWALL|PLATE)$/.test(type)) return "wall";
  if (type === "IFCCOVERING") return predefined === "ROOFING" ? "roof" : ["", "CLADDING", "NOTDEFINED", "USERDEFINED"].includes(predefined) ? "wall" : null;
  if (type === "IFCROOF" || (type === "IFCSLAB" && predefined === "ROOF")) return "roof";
  return null;
}

/**
 * In a model with IFC classes, only these pieces stop the view from outside: the envelope itself, its
 * openings and the slabs. Beams, railings, fasteners, pipes, furniture, the terrain and the like are seen
 * through, so a façade behind a railing or a timber frame still counts as exterior.
 */
const BLOCKS = /^IFC(WALL|WALLSTANDARDCASE|WALLELEMENTEDCASE|CURTAINWALL|PLATE|COVERING|ROOF|SLAB|SLABSTANDARDCASE|SLABELEMENTEDCASE|WINDOW|WINDOWSTANDARDCASE|DOOR|DOORSTANDARDCASE)$/;
/** Pieces whose role (wall or roof) is read from where they are seen: from above, a roof; from the sides, a wall. */
const BY_VIEW = /^IFC(PLATE|COVERING)$/;
/** Side of the square picture rendered from each direction, and the pixels a piece needs to count as seen. */
const VIEW_SIZE = 512, MIN_PIXELS = 3;

/** One flat-colour material: each mesh writes its own index into the picture (set just before it is drawn). */
function idMaterial() {
  return new T.ShaderMaterial({
    uniforms: { idColor: { value: new T.Color() } },
    vertexShader: "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 idColor; void main(){ gl_FragColor = vec4(idColor, 1.0); }",
    side: T.DoubleSide,
  });
}

/**
 * Which meshes are seen from outside: the model is drawn with one flat colour per mesh into small orthographic
 * pictures from eight sides, eight high angles and from above, and every colour left in a picture is a piece
 * seen first from outside. It is one draw per direction on the GPU, so it costs the same for a 4-piece chair
 * and for a 10 000-piece building, and it needs no IFC data: DWG solids, FBX and OBJ meshes go the same way.
 */
function visibleFromOutside(renderer: T.WebGLRenderer, root: T.Object3D, blockers: T.Mesh[]) {
  const box = new T.Box3();
  for (const mesh of blockers) box.expandByObject(mesh);
  const seen = new Map<T.Mesh, { side: number; top: number }>();
  if (box.isEmpty()) return seen;
  const sphere = box.getBoundingSphere(new T.Sphere()), radius = Math.max(sphere.radius, 1e-3);
  const target = new T.WebGLRenderTarget(VIEW_SIZE, VIEW_SIZE, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: true });
  const camera = new T.OrthographicCamera(-radius, radius, radius, -radius, radius * .5, radius * 3.5);
  const material = idMaterial(), pixels = new Uint8Array(VIEW_SIZE * VIEW_SIZE * 4);
  const counts = new Uint32Array(blockers.length + 1);
  const drawn = new Set<T.Object3D>(blockers);
  // Everything else under the root (lines, points, see-through classes, helpers) is hidden while drawing.
  const hidden: T.Object3D[] = [];
  root.traverse((node) => { if (node !== root && node.visible && !drawn.has(node) && !(node instanceof T.Group) && node.type !== "Object3D") { hidden.push(node); node.visible = false; } });
  const saved = blockers.map((mesh) => [mesh.material, mesh.onBeforeRender] as const);
  blockers.forEach((mesh, index) => {
    const id = index + 1, color = new T.Color((id >> 16 & 255) / 255, (id >> 8 & 255) / 255, (id & 255) / 255);
    mesh.material = material;
    mesh.onBeforeRender = () => { material.uniforms.idColor.value.copy(color); material.uniformsNeedUpdate = true; };
  });
  const previous = { target: renderer.getRenderTarget(), clear: renderer.getClearColor(new T.Color()), alpha: renderer.getClearAlpha(), tone: renderer.toneMapping };
  const directions: [T.Vector3, "side" | "top" | "high"][] = [];
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, b = a + Math.PI / 8;
    directions.push([new T.Vector3(Math.cos(a), 0, Math.sin(a)), "side"]);
    directions.push([new T.Vector3(Math.cos(b), -.75, Math.sin(b)).normalize(), "high"]);
  }
  directions.push([new T.Vector3(0, -1, 0), "top"]);
  try {
    renderer.toneMapping = T.NoToneMapping;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    for (const [direction, kind] of directions) {
      camera.position.copy(sphere.center).addScaledVector(direction, -radius * 2);
      camera.up.set(0, 1, 0);
      if (kind === "top") camera.up.set(0, 0, -1);
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld();
      renderer.clear();
      renderer.render(root, camera);
      renderer.readRenderTargetPixels(target, 0, 0, VIEW_SIZE, VIEW_SIZE, pixels);
      counts.fill(0);
      for (let i = 0; i < pixels.length; i += 4) {
        const id = pixels[i] << 16 | pixels[i + 1] << 8 | pixels[i + 2];
        if (id && id <= blockers.length) counts[id]++;
      }
      counts.forEach((count, id) => {
        if (!count) return;
        const mesh = blockers[id - 1], entry = seen.get(mesh) ?? { side: 0, top: 0 };
        if (kind === "side") entry.side += count;
        else if (kind === "top") entry.top += count;
        else { entry.side += count / 4; entry.top += count / 4; }
        seen.set(mesh, entry);
      });
    }
  } finally {
    renderer.setRenderTarget(previous.target);
    renderer.setClearColor(previous.clear, previous.alpha);
    renderer.toneMapping = previous.tone;
    blockers.forEach((mesh, index) => { mesh.material = saved[index][0]; mesh.onBeforeRender = saved[index][1]; });
    for (const node of hidden) node.visible = true;
    target.dispose(); material.dispose();
  }
  for (const [mesh, entry] of seen) if (entry.side + entry.top < MIN_PIXELS) seen.delete(mesh);
  return seen;
}

/**
 * Exterior pieces, for every model the viewer opens. Pset_*Common.IsExternal decides a piece when it is
 * declared (true keeps it, false leaves it out) and the sample's façade and roof tags are trusted; any piece
 * without a declaration is decided by what is seen from outside. With IFC classes, walls and roofs keep their
 * class (plates and coverings take the role of where they are seen); without them (DWG, FBX, OBJ), every
 * piece seen from outside takes the finish.
 */
function findShell(root: T.Object3D, renderer: T.WebGLRenderer): Shell {
  const meshes: T.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((node) => { if (node instanceof T.Mesh && node.visible && node.userData.elementId && !(node instanceof T.InstancedMesh)) meshes.push(node); });
  const walls = new Set<T.Mesh>(), roofs = new Set<T.Mesh>();
  let declared = 0, measured = 0;
  const pending: T.Mesh[] = [];
  for (const mesh of meshes) {
    const role = envelopeOf(mesh);
    if (mesh.userData.envelope || (role && mesh.userData.external === true)) {
      (role === "roof" ? roofs : walls).add(mesh); declared++;
    } else if (mesh.userData.external !== false) pending.push(mesh);
  }
  const typed = meshes.some((mesh) => mesh.userData.ifcType && BLOCKS.test(String(mesh.userData.ifcType)));
  function classify(blockers: T.Mesh[], typedRoles: boolean) {
    const seen = visibleFromOutside(renderer, root, blockers);
    let added = 0;
    for (const [mesh, entry] of seen) {
      if (mesh.userData.external === false || walls.has(mesh) || roofs.has(mesh)) continue;
      const type = String(mesh.userData.ifcType ?? ""), fromAbove = entry.top > entry.side;
      let role: Envelope | null;
      // Without classes nothing tells a roof from a wall (a sofa, a table, a scanned façade): every piece seen takes the finish.
      if (!typedRoles) role = "wall";
      else if (BY_VIEW.test(type) && mesh.userData.predefined !== "ROOFING") role = fromAbove ? "roof" : "wall";
      else if (/^IFCSLAB/.test(type) && mesh.userData.predefined !== "ROOF") role = fromAbove ? "roof" : null;
      else role = envelopeOf(mesh);
      if (!role) continue;
      (role === "roof" ? roofs : walls).add(mesh); added++;
    }
    return added;
  }
  // The sample tags its whole envelope: nothing is left to measure there.
  const tagged = meshes.some((mesh) => mesh.userData.envelope);
  if (pending.length && !tagged) {
    if (typed) {
      // The envelope classes stop the view; the rest of the model is looked through.
      measured = classify(meshes.filter((mesh) => BLOCKS.test(String(mesh.userData.ifcType ?? ""))), true);
      // A model whose IFC classes leave no envelope (all proxies, say) is read by its shapes alone.
      if (!measured && !declared) measured = classify(meshes, false);
    } else measured = classify(meshes, false);
  }
  const source: ExteriorPreview["source"] = !walls.size && !roofs.size ? "none" : measured ? "perimeter" : "pset";
  return { walls: [...walls], roofs: [...roofs], source };
}

/**
 * Box (triplanar) projection in world coordinates, so the meshes need no UVs and pieces sharing one
 * geometry still get a continuous texture at real scale. The blend uses the face normal from screen
 * derivatives; the normal map is blended with the «whiteout» method and drives the lighting normal.
 */
function triplanar(material: T.MeshStandardMaterial, maps: { color: T.Texture; normal: T.Texture; rough: T.Texture }, scale: number, normal: number) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tpColor = { value: maps.color };
    shader.uniforms.tpNormal = { value: maps.normal };
    shader.uniforms.tpRough = { value: maps.rough };
    shader.uniforms.tpScale = { value: scale };
    shader.uniforms.tpNormalScale = { value: normal };
    shader.vertexShader = "varying vec3 vTpWorld;\n" + shader.vertexShader.replace("#include <project_vertex>",
      "#include <project_vertex>\n  vTpWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = "varying vec3 vTpWorld;\nuniform sampler2D tpColor;\nuniform sampler2D tpNormal;\nuniform sampler2D tpRough;\nuniform float tpScale;\nuniform float tpNormalScale;\n"
      + shader.fragmentShader
        .replace("#include <map_fragment>", `
  vec3 tpN = normalize(cross(dFdx(vTpWorld), dFdy(vTpWorld)));
  if ((viewMatrix * vec4(tpN, 0.0)).z < 0.0) tpN = -tpN;
  vec3 tpW = pow(abs(tpN), vec3(4.0)); tpW /= max(tpW.x + tpW.y + tpW.z, 1e-5);
  vec2 tpUvX = vTpWorld.zy * tpScale, tpUvY = vTpWorld.xz * tpScale, tpUvZ = vTpWorld.xy * tpScale;
  diffuseColor.rgb *= (texture2D(tpColor, tpUvX) * tpW.x + texture2D(tpColor, tpUvY) * tpW.y + texture2D(tpColor, tpUvZ) * tpW.z).rgb;`)
        .replace("#include <roughnessmap_fragment>", `
  float roughnessFactor = roughness * (texture2D(tpRough, tpUvX).g * tpW.x + texture2D(tpRough, tpUvY).g * tpW.y + texture2D(tpRough, tpUvZ).g * tpW.z);`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  {
    vec3 tnX = texture2D(tpNormal, tpUvX).xyz * 2.0 - 1.0, tnY = texture2D(tpNormal, tpUvY).xyz * 2.0 - 1.0, tnZ = texture2D(tpNormal, tpUvZ).xyz * 2.0 - 1.0;
    tnX.xy *= tpNormalScale; tnY.xy *= tpNormalScale; tnZ.xy *= tpNormalScale;
    tnX = vec3(tnX.xy + tpN.zy, abs(tnX.z) * tpN.x);
    tnY = vec3(tnY.xy + tpN.xz, abs(tnY.z) * tpN.y);
    tnZ = vec3(tnZ.xy + tpN.xy, abs(tnZ.z) * tpN.z);
    vec3 tpWorldNormal = normalize(tnX.zyx * tpW.x + tnY.xzy * tpW.y + tnZ.xyz * tpW.z);
    normal = normalize((viewMatrix * vec4(tpWorldNormal, 0.0)).xyz);
  }`);
  };
  material.customProgramCacheKey = () => "obracota-triplanar";
}

export function exteriorPreview(scene: T.Scene, renderer: T.WebGLRenderer, hemisphere: T.HemisphereLight, sun: T.DirectionalLight, slot: {
  get: (mesh: T.Mesh) => T.Material | T.Material[];
  set: (mesh: T.Mesh, material: T.Material | T.Material[]) => void;
  redraw: () => void;
}) {
  const textures = new Map<string, T.Texture>();
  const loader = new T.TextureLoader();
  const originals = new Map<T.Mesh, T.Material | T.Material[]>();
  const shells = new WeakMap<T.Object3D, Shell>();
  let materials: T.Material[] = [];
  let lights: { hemi: [T.Color, T.Color, number]; sun: [T.Color, number, T.Vector3]; clear: [T.Color, number] } | null = null;

  function texture(path: string, color: boolean) {
    let map = textures.get(path);
    if (!map) {
      map = loader.load(path, () => slot.redraw());
      map.wrapS = map.wrapT = T.RepeatWrapping;
      map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (color) map.colorSpace = T.SRGBColorSpace;
      textures.set(path, map);
    }
    return map;
  }
  function build(kind: ExteriorMaterial, tone: ExteriorTone) {
    if (kind === "glass") {
      const [color, opacity] = GLASS[tone];
      return new T.MeshPhysicalMaterial({ color, metalness: 0, roughness: .06, transparent: true, opacity, depthWrite: false, side: T.DoubleSide, specularIntensity: 1, clearcoat: .6 });
    }
    if (kind === "paint") return new T.MeshStandardMaterial({ color: PAINT[tone], roughness: .88, metalness: 0, side: T.DoubleSide });
    const spec = LIBRARY[kind]!;
    const material = new T.MeshStandardMaterial({ color: new T.Color(1, 1, 1).multiplyScalar(TONE[tone] * spec.gain), metalness: spec.metalness, roughness: spec.roughness, side: T.DoubleSide });
    const base = "/materials/" + spec.dir + "/";
    triplanar(material, { color: texture(base + "color.webp", true), normal: texture(base + "normal.webp", false), rough: texture(base + "rugosidad.webp", false) }, 1 / spec.size, spec.normal);
    return material;
  }
  function restoreMaterials() {
    originals.forEach((material, mesh) => slot.set(mesh, material));
    originals.clear();
    materials.forEach((material) => material.dispose());
    materials = [];
  }
  function restoreLights() {
    if (!lights) return;
    hemisphere.color.copy(lights.hemi[0]); hemisphere.groundColor.copy(lights.hemi[1]); hemisphere.intensity = lights.hemi[2];
    sun.color.copy(lights.sun[0]); sun.intensity = lights.sun[1]; sun.position.copy(lights.sun[2]);
    renderer.setClearColor(lights.clear[0], lights.clear[1]);
    lights = null;
  }
  function apply(root: T.Object3D | null, finish: ExteriorFinish | null): ExteriorPreview {
    restoreMaterials();
    if (!finish || !root) { restoreLights(); slot.redraw(); return { pieces: 0, source: "none" }; }
    let pieces = 0, source: ExteriorPreview["source"] = "none", ids: string[] = [];
    if (finish.material) {
      let shell = shells.get(root);
      if (!shell) {
        const start = performance.now();
        shell = findShell(root, renderer); shells.set(root, shell);
        performance.measure("obracota:exterior-shell", { start, end: performance.now(), detail: { walls: shell.walls.length, roofs: shell.roofs.length, source: shell.source } });
      }
      source = shell.source;
      const material = build(finish.material, finish.tone ?? "medium");
      if (!material.transparent && shell.walls.some(mesh => mesh.userData.ifcType)) {
        // Some IFCs contain a second coplanar proxy over the wall. Resolve the depth tie for this preview only.
        material.polygonOffset = true;
        material.polygonOffsetFactor = -2;
        material.polygonOffsetUnits = -2;
      }
      materials.push(material);
      const targets = finish.material === "concrete" || finish.material === "paint" ? [...shell.walls, ...shell.roofs] : shell.walls;
      for (const mesh of targets) { originals.set(mesh, slot.get(mesh)); slot.set(mesh, material); }
      ids = [...new Set(targets.map((mesh) => String(mesh.userData.elementId)))];
      pieces = ids.length;
    }
    if (finish.light) {
      lights ??= {
        hemi: [hemisphere.color.clone(), hemisphere.groundColor.clone(), hemisphere.intensity],
        sun: [sun.color.clone(), sun.intensity, sun.position.clone()],
        clear: [renderer.getClearColor(new T.Color()), renderer.getClearAlpha()],
      };
      const preset = DAYLIGHT[finish.light];
      hemisphere.color.set(preset.sky); hemisphere.groundColor.set(preset.ground); hemisphere.intensity = preset.ambient;
      sun.color.set(preset.sun); sun.intensity = preset.sunIntensity; sun.position.fromArray(preset.direction);
      if (preset.clear === null) renderer.setClearColor(lights.clear[0], lights.clear[1]);
      else renderer.setClearColor(preset.clear, 1);
    } else restoreLights();
    slot.redraw();
    return { pieces, source, ids };
  }
  return {
    apply,
    /** Back to the model's own materials and light; textures are released (the next use reloads them). */
    reset() {
      restoreMaterials(); restoreLights();
      textures.forEach((map) => map.dispose()); textures.clear();
    },
    active: () => originals.size > 0 || lights !== null,
  };
}
