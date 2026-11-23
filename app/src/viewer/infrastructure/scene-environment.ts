import * as T from "three";
import type { SceneEnvironment, SceneSeason, SceneStyle, SceneSurroundings, SceneTime, SceneWeather } from "../domain/viewer.port";

/**
 * «Recorrer esta escena en 3D»: the scene that Escena or a generated option describes, built with real geometry
 * around the model so it can be walked. Sun and sky follow the time of day; fog, rain or snow the weather; the
 * ground and a few low-poly instanced trees, rocks, neighbours or water the surroundings (placed with a fixed seed
 * around the model's footprint, never on it); tone mapping and exposure the style. Nothing here touches the model,
 * its file or the server, and the viewer keeps no shadows, so none are added.
 */
interface Daylight { sun: number; intensity: number; elevation: number; azimuth: number; sky: number; ground: number; ambient: number; top: number; horizon: number }

const TIMES: Record<SceneTime, Daylight> = {
  morning: { sun: 0xffe6c4, intensity: 2.6, elevation: 24, azimuth: 105, sky: 0xdfeeff, ground: 0xa89880, ambient: 1.45, top: 0x6aa3e2, horizon: 0xdbe8f3 },
  afternoon: { sun: 0xfff0d8, intensity: 2.8, elevation: 36, azimuth: 235, sky: 0xe4efff, ground: 0x9f9078, ambient: 1.35, top: 0x5592d8, horizon: 0xd2e4f4 },
  noon: { sun: 0xffffff, intensity: 3, elevation: 72, azimuth: 180, sky: 0xeaf3ff, ground: 0xa49a88, ambient: 1.5, top: 0x3d82d6, horizon: 0xcfe2f6 },
  sunrise: { sun: 0xffbf90, intensity: 1.9, elevation: 7, azimuth: 92, sky: 0xffe4d0, ground: 0x6d5a4c, ambient: 1.15, top: 0x6a80b8, horizon: 0xffbb8c },
  golden: { sun: 0xffb45e, intensity: 2.5, elevation: 12, azimuth: 255, sky: 0xffe2bd, ground: 0x7d6650, ambient: 1.05, top: 0x7c9dd0, horizon: 0xffcf90 },
  sunset: { sun: 0xffa070, intensity: 1.7, elevation: 5, azimuth: 268, sky: 0xffe0cc, ground: 0x6e5a50, ambient: 1.15, top: 0x4a4f8f, horizon: 0xff9a5a },
  blue: { sun: 0x8fa6ff, intensity: .7, elevation: 8, azimuth: 280, sky: 0x7088c8, ground: 0x1f2638, ambient: 1.15, top: 0x1c2c5e, horizon: 0x5a78b8 },
  night: { sun: 0xb4caff, intensity: .55, elevation: 40, azimuth: 160, sky: 0x5d6fa4, ground: 0x1a2030, ambient: 1, top: 0x060b1a, horizon: 0x1b2744 },
};

/** Weather on top of the time of day: how much sun is left, how grey the sky turns and how dense the fog is (per model size). */
const WEATHER: Record<SceneWeather, { sun: number; ambient: number; grey: number; tint: number; fog: number }> = {
  clear: { sun: 1, ambient: 1, grey: 0, tint: 0xb8bec6, fog: 0 },
  partly: { sun: .8, ambient: 1.05, grey: .22, tint: 0xe8edf2, fog: 0 },
  overcast: { sun: .28, ambient: 1.3, grey: .75, tint: 0xb4bac2, fog: .06 },
  fog: { sun: .3, ambient: 1.25, grey: .9, tint: 0xc9ced3, fog: .36 },
  rain: { sun: .2, ambient: 1.15, grey: .85, tint: 0x8a939c, fog: .16 },
  snow: { sun: .6, ambient: 1.25, grey: .7, tint: 0xdfe5ea, fog: .1 },
};

/** Tone mapping and exposure of each graphic style; the walk is a real-time view, not the AI picture. */
const STYLES: Record<SceneStyle, [T.ToneMapping, number]> = {
  photo: [T.ACESFilmicToneMapping, 1.15], "white-model": [T.NeutralToneMapping, 1.2], model: [T.ACESFilmicToneMapping, 1.05],
  flat: [T.LinearToneMapping, 1.1], watercolor: [T.AgXToneMapping, 1.35], marker: [T.NeutralToneMapping, 1.3], pastel: [T.AgXToneMapping, 1.4],
  collage: [T.LinearToneMapping, 1.15], illustration: [T.LinearToneMapping, 1.1], pencil: [T.NeutralToneMapping, 1.4], ink: [T.NeutralToneMapping, 1.35],
};

const GRASS = [0x5d8a3c, 0x6f9a48, 0x4c7a33];
const GROUND: Record<Exclude<SceneSurroundings, "none">, number[]> = {
  countryside: GRASS, forest: [0x4a6a2f, 0x5a7a38, 0x3d5a28], garden: [0x64a043, 0x74ae4e, 0x579238], tropical: [0x4e9a3a, 0x5aa845, 0x3f8a30],
  residential: GRASS, lake: GRASS, river: GRASS, city: [0x6b6d70, 0x5c5e61, 0x77797c], coast: [0xd8c08e, 0xcdb27c, 0xe2cc9c],
  desert: [0xd6b98a, 0xcaa874, 0xe0c79a], mountain: [0x6d7a4a, 0x7a7a5a, 0x5a6a3e],
};
const SEASON_GROUND: Partial<Record<SceneSeason, number[]>> = { autumn: [0x8a8a3c, 0x9a8a44, 0x7a7a34], winter: [0x8a8f6a, 0x9a9a7a, 0x7d8460] };
const SNOW = [0xf2f5f8, 0xe6ebf0, 0xffffff];
const CROWNS: Record<SceneSeason | "default", number[]> = {
  default: [0x4f8a3a, 0x5f9a45, 0x3f7a35], spring: [0x8cc65a, 0x9ed46a, 0x7ab84c], summer: [0x4f8a3a, 0x427d30, 0x5a9540],
  autumn: [0xc8742b, 0xd9a13b, 0x9c4a23], winter: [0x6e5a46, 0x7a6450, 0x5e4c3c],
};

/** Mulberry32: the same scene always places the same trees. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(text: string) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }

const SKY_VERTEX = "varying vec3 vDir;\nvoid main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const SKY_FRAGMENT = `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
void main(){
  float h = normalize(vDir).y;
  vec3 color = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.7)) : mix(horizon, bottom, min(-h * 5.0, 1.0));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;

export interface EnvironmentHost {
  scene: T.Scene;
  renderer: T.WebGLRenderer;
  hemisphere: T.HemisphereLight;
  sun: T.DirectionalLight;
  /** Bounds of the open model (world units, metres for an IFC). */
  bounds: () => T.Box3;
  redraw: () => void;
  /** Test-readable state of the scene shown, null when neutral. */
  mark: (state: string | null) => void;
}

export function sceneEnvironment(host: EnvironmentHost) {
  const { scene, renderer, hemisphere, sun } = host;
  let group: T.Group | null = null;
  let current: SceneEnvironment | null = null;
  let groundMesh: T.Mesh | null = null;
  const owned: { dispose(): void }[] = [];
  let saved: {
    hemi: [T.Color, T.Color, number]; sun: [T.Color, number, T.Vector3]; clear: [T.Color, number];
    fog: T.Fog | T.FogExp2 | null; background: T.Scene["background"]; tone: T.ToneMapping; exposure: number;
  } | null = null;

  function keep<V extends { dispose(): void }>(value: V) { owned.push(value); return value; }
  function noise(colors: number[], seed: number) {
    const size = 128, canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d")!, rand = random(seed);
    context.fillStyle = "#" + new T.Color(colors[0]).getHexString(); context.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
      context.globalAlpha = .25 + rand() * .45;
      context.fillStyle = "#" + new T.Color(colors[1 + Math.floor(rand() * (colors.length - 1))]).getHexString();
      const s = 1 + rand() * 4;
      context.fillRect(rand() * size, rand() * size, s, s);
    }
    const map = keep(new T.CanvasTexture(canvas));
    map.wrapS = map.wrapT = T.RepeatWrapping; map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return map;
  }
  /** Opaque centre fading out at the rim, so the ground meets the sky without a hard edge. */
  function rim() {
    const size = 256, canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d")!, gradient = context.createRadialGradient(size / 2, size / 2, size * .3, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "#fff"); gradient.addColorStop(1, "#000");
    context.fillStyle = gradient; context.fillRect(0, 0, size, size);
    return keep(new T.CanvasTexture(canvas));
  }

  function restore() {
    if (group) { scene.remove(group); group = null; }
    groundMesh = null;
    owned.splice(0).forEach((item) => item.dispose());
    if (!saved) return;
    hemisphere.color.copy(saved.hemi[0]); hemisphere.groundColor.copy(saved.hemi[1]); hemisphere.intensity = saved.hemi[2];
    sun.color.copy(saved.sun[0]); sun.intensity = saved.sun[1]; sun.position.copy(saved.sun[2]);
    renderer.setClearColor(saved.clear[0], saved.clear[1]);
    scene.fog = saved.fog; scene.background = saved.background;
    renderer.toneMapping = saved.tone; renderer.toneMappingExposure = saved.exposure;
    saved = null;
  }

  function apply(environment: SceneEnvironment): boolean {
    const box = host.bounds();
    restore();
    current = null;
    if (box.isEmpty()) { host.mark(null); host.redraw(); return false; }
    saved = {
      hemi: [hemisphere.color.clone(), hemisphere.groundColor.clone(), hemisphere.intensity],
      sun: [sun.color.clone(), sun.intensity, sun.position.clone()],
      clear: [renderer.getClearColor(new T.Color()), renderer.getClearAlpha()],
      fog: scene.fog, background: scene.background, tone: renderer.toneMapping, exposure: renderer.toneMappingExposure,
    };
    const size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    const D = Math.max(size.length(), 1);
    // Trees and houses are in metres; a small piece (a lamp, a chair) gets a scaled-down setting.
    const unit = D > 8 ? 1 : D / 30;
    const rand = random(seedOf(JSON.stringify(environment)));
    const weather = WEATHER[environment.weather ?? "clear"];
    const light = TIMES[environment.time ?? "afternoon"];
    const surroundings = environment.surroundings;

    // Light: sun direction from elevation and azimuth (0° = north, -Z), colours, then the weather on top.
    const elevation = T.MathUtils.degToRad(light.elevation), azimuth = T.MathUtils.degToRad(light.azimuth);
    sun.position.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation)).multiplyScalar(12);
    sun.color.set(light.sun); sun.intensity = light.intensity * weather.sun;
    hemisphere.color.set(light.sky).lerp(new T.Color(weather.tint), weather.grey * .5);
    hemisphere.groundColor.set(light.ground); hemisphere.intensity = light.ambient * weather.ambient;
    const top = new T.Color(light.top).lerp(new T.Color(weather.tint), weather.grey);
    const horizon = new T.Color(light.horizon).lerp(new T.Color(weather.tint), weather.grey);
    if (environment.style) { const [tone, exposure] = STYLES[environment.style]; renderer.toneMapping = tone; renderer.toneMappingExposure = exposure; }
    if (weather.fog > 0) scene.fog = new T.FogExp2(horizon.getHex(), weather.fog / D);

    group = new T.Group();
    group.name = "obracota-scene-environment";
    group.userData.environment = true;
    const skyRadius = Math.min(6 * D, 1500), groundY = box.min.y - .002 * D;
    const snowy = environment.weather === "snow";
    const groundColors = snowy ? SNOW : surroundings && surroundings !== "none" ? (environment.season && SEASON_GROUND[environment.season] && GROUND[surroundings] === GRASS ? SEASON_GROUND[environment.season]! : GROUND[surroundings]) : null;

    if (surroundings !== "none") {
      const sky = new T.Mesh(keep(new T.SphereGeometry(skyRadius, 32, 16)), keep(new T.ShaderMaterial({
        uniforms: { top: { value: top }, horizon: { value: horizon }, bottom: { value: new T.Color(groundColors?.[0] ?? light.ground).lerp(horizon, .5) } },
        vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: T.BackSide, depthWrite: false, fog: false, toneMapped: false,
      })));
      sky.position.copy(center); sky.renderOrder = -10; sky.frustumCulled = false;
      group.add(sky);
      renderer.setClearColor(horizon, 1);
    }
    if (groundColors) {
      const radius = skyRadius * .85;
      const map = noise(groundColors, 7), tile = 4 * unit;
      map.repeat.set(radius * 2 / tile, radius * 2 / tile);
      const wet = environment.weather === "rain";
      const ground = new T.Mesh(keep(new T.CircleGeometry(radius, 72)), keep(new T.MeshStandardMaterial({
        map, alphaMap: rim(), transparent: true, roughness: wet ? .35 : 1, metalness: 0, color: wet ? 0xb0b0b0 : 0xffffff,
      })));
      ground.rotation.x = -Math.PI / 2; ground.position.set(center.x, groundY, center.z); ground.renderOrder = -5;
      ground.updateMatrixWorld();
      group.add(ground);
      groundMesh = ground;
    }

    // Keep-out zone: the footprint plus a margin, so nothing grows inside or against the building.
    const margin = Math.max(3 * unit, .06 * D);
    const keepOut = new T.Box2(new T.Vector2(box.min.x - margin, box.min.z - margin), new T.Vector2(box.max.x + margin, box.max.z + margin));
    const water: ((x: number, z: number) => boolean)[] = [];
    const angle = rand() * Math.PI * 2, side = new T.Vector2(Math.cos(angle), Math.sin(angle));
    function addWater(geometry: T.BufferGeometry, x: number, z: number, rotation: number) {
      const mesh = new T.Mesh(keep(geometry), keep(new T.MeshStandardMaterial({ color: environment.time === "night" || environment.time === "blue" ? 0x1c3450 : 0x3a6f8f, roughness: .12, metalness: .2 })));
      mesh.rotation.set(-Math.PI / 2, 0, rotation); mesh.position.set(x, groundY + .01 * unit + .0005 * D, z);
      group!.add(mesh);
    }
    const halfFoot = Math.max(size.x, size.z) / 2;
    if (surroundings === "lake") {
      const r = Math.max(.8 * D, 12 * unit), d = halfFoot + margin + r * 1.1, x = center.x + side.x * d, z = center.z + side.y * d;
      addWater(new T.CircleGeometry(r, 48), x, z, 0);
      water.push((px, pz) => Math.hypot(px - x, pz - z) < r * 1.1);
    }
    if (surroundings === "river") {
      const width = Math.max(.3 * D, 8 * unit), d = halfFoot + margin + width;
      const x = center.x + side.x * d, z = center.z + side.y * d;
      addWater(new T.PlaneGeometry(skyRadius * 1.6, width), x, z, -angle + Math.PI / 2);
      water.push((px, pz) => Math.abs((px - x) * side.x + (pz - z) * side.y) < width * .8);
    }
    if (surroundings === "coast") {
      const d = halfFoot + margin + Math.max(.5 * D, 10 * unit), depth = skyRadius;
      const x = center.x + side.x * (d + depth / 2), z = center.z + side.y * (d + depth / 2);
      addWater(new T.PlaneGeometry(skyRadius * 2, depth), x, z, -angle + Math.PI / 2);
      water.push((px, pz) => (px - center.x) * side.x + (pz - center.z) * side.y > d - 2 * unit);
    }

    // The viewer's default view looks from +X +Z (three-viewer.ts `fit`): tall things stay out of that sector, so
    // neighbours never stand between the camera and the model.
    const front = Math.atan2(1.45, 1);
    function spots(count: number, near: number, far: number, clearFront = false) {
      const list: T.Vector2[] = [];
      for (let attempt = 0; list.length < count && attempt < count * 40; attempt++) {
        const a = rand() * Math.PI * 2, r = near + Math.sqrt(rand()) * (far - near);
        if (clearFront && Math.abs(Math.atan2(Math.sin(a - front), Math.cos(a - front))) < Math.PI / 4) continue;
        const p = new T.Vector2(center.x + Math.cos(a) * r, center.z + Math.sin(a) * r);
        if (keepOut.containsPoint(p) || water.some((wet) => wet(p.x, p.y))) continue;
        if (list.some((other) => other.distanceTo(p) < 2.2 * unit)) continue;
        list.push(p);
      }
      return list;
    }
    const matrix = new T.Matrix4(), quaternion = new T.Quaternion(), scale = new T.Vector3(), position = new T.Vector3(), color = new T.Color();
    function instanced(geometry: T.BufferGeometry, items: { x: number; y: number; z: number; sx: number; sy: number; sz: number; turn?: number; color: number }[], flat = true) {
      if (!items.length) return;
      const mesh = new T.InstancedMesh(keep(geometry), keep(new T.MeshStandardMaterial({ roughness: .9, metalness: 0, flatShading: flat })), items.length);
      items.forEach((item, i) => {
        quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), item.turn ?? 0);
        matrix.compose(position.set(item.x, item.y, item.z), quaternion, scale.set(item.sx, item.sy, item.sz));
        mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, color.set(item.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group!.add(mesh);
    }
    const pick = (list: number[]) => list[Math.floor(rand() * list.length)];
    const crowns = snowy ? [0xe8eef2, 0xdfe7ec, 0xf2f6f8] : CROWNS[environment.season ?? "default"];
    const conifer = snowy ? [0xdfe8ec, 0xcfdde2] : [0x2f5a3a, 0x355f3c, 0x29503a];
    const trunks: Parameters<typeof instanced>[1] = [], round: Parameters<typeof instanced>[1] = [], cones: Parameters<typeof instanced>[1] = [];
    const palms: Parameters<typeof instanced>[1] = [], blocks: Parameters<typeof instanced>[1] = [], rocks: Parameters<typeof instanced>[1] = [];
    const peaks: Parameters<typeof instanced>[1] = [];
    const bare = environment.season === "winter" && !snowy;
    function tree(p: T.Vector2, kind: "round" | "cone" | "palm" | "shrub") {
      const h = (kind === "shrub" ? 1 + rand() * .8 : kind === "palm" ? 7 + rand() * 4 : 5 + rand() * 4.5) * unit;
      if (kind === "shrub") { round.push({ x: p.x, y: groundY + h * .4, z: p.y, sx: h * .8, sy: h * .55, sz: h * .8, color: pick(crowns === CROWNS.winter ? CROWNS.default : crowns) }); return; }
      const trunk = kind === "palm" ? .9 : kind === "cone" ? .3 : .45;
      trunks.push({ x: p.x, y: groundY + h * trunk / 2, z: p.y, sx: .18 * unit * (kind === "palm" ? 1.2 : 1.6), sy: h * trunk, sz: .18 * unit * (kind === "palm" ? 1.2 : 1.6), color: 0x6b4f36 });
      if (kind === "cone") cones.push({ x: p.x, y: groundY + h * .3 + h * .35, z: p.y, sx: h * .32, sy: h * .7, sz: h * .32, turn: rand() * 6, color: pick(conifer) });
      else if (kind === "palm") palms.push({ x: p.x, y: groundY + h * .92, z: p.y, sx: h * .38, sy: h * .1, sz: h * .38, turn: rand() * 6, color: pick([0x3f8a30, 0x4e9a3a, 0x5aa845]) });
      else if (!bare) round.push({ x: p.x, y: groundY + h * .62, z: p.y, sx: h * .36, sy: h * .34, sz: h * .36, turn: rand() * 6, color: pick(crowns) });
    }
    const R = (k: number) => halfFoot + margin + k * D;
    switch (surroundings) {
      case "countryside": spots(26, R(.06), R(1.8)).forEach((p) => tree(p, rand() < .2 ? "cone" : "round")); break;
      case "forest": spots(110, R(.05), R(2.4), true).forEach((p) => tree(p, rand() < .6 ? "cone" : "round")); break;
      case "garden":
        spots(34, R(0), R(.6)).forEach((p) => tree(p, "shrub"));
        spots(12, R(.15), R(1.2)).forEach((p) => tree(p, "round")); break;
      case "tropical": spots(28, R(.05), R(1.8)).forEach((p) => tree(p, rand() < .75 ? "palm" : "shrub")); break;
      case "lake": case "river": case "coast":
        spots(surroundings === "coast" ? 10 : 18, R(.1), R(1.8)).forEach((p) => tree(p, surroundings === "coast" ? "palm" : rand() < .3 ? "cone" : "round")); break;
      case "mountain":
        for (let i = 0; i < 8; i++) {
          const a = rand() * Math.PI * 2, d = skyRadius * (.55 + rand() * .2), h = (.35 + rand() * .45) * skyRadius * .35;
          peaks.push({ x: center.x + Math.cos(a) * d, y: groundY + h / 2, z: center.z + Math.sin(a) * d, sx: h * 1.6, sy: h, sz: h * 1.6, turn: rand() * 6, color: snowy ? 0xe6ecef : pick([0x6a7360, 0x7a7d6a, 0x5d6656]) });
        }
        spots(40, R(.1), R(2)).forEach((p) => tree(p, "cone")); break;
      case "desert":
        spots(16, R(.1), R(2.2)).forEach((p) => { const s = (.6 + rand() * 1.8) * unit; rocks.push({ x: p.x, y: groundY + s * .3, z: p.y, sx: s * 1.3, sy: s * .8, sz: s, turn: rand() * 6, color: pick([0xb08a62, 0x9c7a56, 0xc39a6c]) }); });
        spots(9, R(.2), R(1.6)).forEach((p) => { const h = (1.8 + rand() * 1.6) * unit; trunks.push({ x: p.x, y: groundY + h / 2, z: p.y, sx: .45 * unit, sy: h, sz: .45 * unit, color: 0x5f8a4a }); }); break;
      case "city": case "residential": {
        const city = surroundings === "city";
        spots(city ? 18 : 12, R(city ? .45 : .3), R(city ? 2 : 1.6), true).forEach((p) => {
          const w = (city ? 10 + rand() * 12 : 7 + rand() * 4) * unit, h = (city ? 9 + rand() * 30 : 4 + rand() * 3) * unit;
          blocks.push({ x: p.x, y: groundY + h / 2, z: p.y, sx: w, sy: h, sz: w * (.7 + rand() * .5), turn: Math.round(rand() * 4) * Math.PI / 2 + (rand() - .5) * .2,
            color: pick(city ? [0x9aa0a6, 0xb4b0a8, 0x7f868d, 0xc2bdb3] : [0xd9cbb4, 0xe6e0d4, 0xc9b79c, 0xb98f72]) });
        });
        spots(city ? 8 : 18, R(.05), R(1.2)).forEach((p) => tree(p, "round"));
        break;
      }
      default: break;
    }
    instanced(keep(new T.CylinderGeometry(.5, .6, 1, 6)), trunks);
    instanced(keep(new T.IcosahedronGeometry(1, 0)), round);
    instanced(keep(new T.ConeGeometry(1, 1, 7)), cones);
    instanced(keep(new T.ConeGeometry(1, 1, 8, 1, true)), palms);
    instanced(keep(new T.BoxGeometry(1, 1, 1)), blocks);
    instanced(keep(new T.ConeGeometry(1, 1, 9)), peaks);
    instanced(keep(new T.DodecahedronGeometry(.5, 0)), rocks);

    // Rain streaks and snow flakes: one static draw call each, in a cylinder around the model.
    if (environment.weather === "rain" || snowy) {
      const count = snowy ? 2600 : 2400, radius = 1.6 * D, height = Math.max(size.y * 2.2, 18 * unit);
      const points = new Float32Array(count * (snowy ? 3 : 6));
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius, x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r, y = groundY + rand() * height;
        if (snowy) points.set([x, y, z], i * 3);
        else points.set([x, y, z, x + .08 * unit, y - .7 * unit, z + .04 * unit], i * 6);
      }
      const geometry = keep(new T.BufferGeometry());
      geometry.setAttribute("position", new T.BufferAttribute(points, 3));
      const drops = snowy
        ? new T.Points(geometry, keep(new T.PointsMaterial({ color: 0xffffff, size: 2.6, sizeAttenuation: false, transparent: true, opacity: .9, depthWrite: false })))
        : new T.LineSegments(geometry, keep(new T.LineBasicMaterial({ color: 0xc4d0dc, transparent: true, opacity: .5, depthWrite: false })));
      drops.frustumCulled = false;
      group.add(drops);
    }
    scene.add(group);
    current = { ...environment };
    host.mark([environment.time ?? "-", environment.weather ?? "-", environment.season ?? "-", surroundings ?? "-", environment.style ?? "-"].join(" "));
    host.redraw();
    return true;
  }
  return {
    apply,
    reset() { const was = !!saved || !!group; restore(); current = null; host.mark(null); if (was) host.redraw(); },
    current: () => current,
    /** The scene's ground, where the walk can start and go around the model; null without surroundings. */
    ground: () => groundMesh,
    groundLevel: () => groundMesh?.position.y ?? null,
  };
}
