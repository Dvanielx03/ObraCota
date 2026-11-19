import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { type EstadoVisor, SEPARACION, type Vec } from "./coreografia";
import type { FichaModelo, Secuencia } from "./secuencia";

const ESTRUCTURALES = new Set(["cimentacion", "estructura", "losas"]);

const COLORES: Record<string, number> = {
  // Sistemas por clase IFC (modelos sin perfil de materiales).
  cimentacion: 0xa8a295,
  estructura: 0xd5dade,
  losas: 0xf2eee5,
  muros: 0xf7f4ed,
  carpinteria: 0x55616d,
  particiones: 0xfbf9f4,
  circulacion: 0xcdd1d4,
  mobiliario: 0x8c959c,
  acabados: 0xeae4d7,
  terreno: 0x16263a,
  otros: 0xbab3a5,
  // Materiales validados contra el IFC (perfil de ReStage).
  hormigon: 0xdcd8cf,
  armadura: 0x77838f,
  acero: 0x8493a2,
  uniones: 0x3b4753,
  madera: 0xd3b489,
  cubierta: 0xaab2b9,
  fachada: 0x8fa38a,
  instalaciones: 0x65717d,
  aislamiento: 0xe9e2d3,
};
const COLOR_VIDRIO = 0x9cc0d8;
const AMBAR = new THREE.Color(0xf2b25c);
const TINTA = 0x0a1522;
/** Cuánto se tiñe cada pieza del detalle: la viga y su unión mandan; el apoyo acompaña. */
const PESO_FOCO: Record<string, number> = { viga: 1, union: 1, apoyo: 0.6, columna: 0.45 };

type Cubo = {
  nivel: number;
  grupo: string;
  vidrio: boolean;
  estructural: boolean;
  destacado: string | null;
  nodo: THREE.Object3D;
  malla: THREE.Mesh | null;
  material: THREE.MeshStandardMaterial | null;
  materialLineas: THREE.LineBasicMaterial | null;
  plano: THREE.Plane;
  yMin: number;
  yMax: number;
  opacidadBase: number;
  color: THREE.Color;
  inicio: number;
  fin: number;
  /** Último conjunto de la secuencia por hitos: su resalte no tiene relevo. */
  primero: boolean;
};

export type OpcionesVisor = { sombras: boolean; pixelRatioMax: number; ancla?: Vec };

export class VisorModelo {
  private renderer: THREE.WebGLRenderer;
  private escena = new THREE.Scene();
  private camara = new THREE.PerspectiveCamera(32, 1, 0.05, 400);
  private cubos: Cubo[] = [];
  private luz: THREE.DirectionalLight;
  private relleno = new THREE.PointLight(0xfff6e8, 0, 0, 0);
  private pendiente = 0;
  private estado: EstadoVisor | null = null;
  private observador: ResizeObserver;
  private destruido = false;
  private abajo = 0;
  private sombraSuelo: THREE.ShadowMaterial | null = null;
  private lado = 0;
  private ancla = new THREE.Vector3();
  private proyeccion = new THREE.Vector3();
  private anclaPrevia = "";

  constructor(
    private contenedor: HTMLElement,
    private ficha: FichaModelo,
    private secuencia: Pick<Secuencia, "real" | "tareas" | "hitos">,
    private opciones: OpcionesVisor,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opciones.pixelRatioMax));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = opciones.sombras;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    const lienzo = this.renderer.domElement;
    lienzo.setAttribute("aria-hidden", "true");
    lienzo.style.display = "block";
    lienzo.style.width = "100%";
    lienzo.style.height = "100%";
    contenedor.appendChild(lienzo);

    // El suelo de la luz ambiente es claro: así los perfiles se leen también desde abajo.
    this.escena.add(new THREE.HemisphereLight(0xf8f5ee, 0x56677a, 1.75));
    this.luz = new THREE.DirectionalLight(0xfff4e2, 2.1);
    this.luz.castShadow = opciones.sombras;
    this.escena.add(this.luz, this.luz.target, this.relleno);
    if (opciones.ancla) this.ancla.fromArray(opciones.ancla);

    this.observador = new ResizeObserver(() => this.redimensionar());
    this.observador.observe(contenedor);
    this.redimensionar();
  }

  /** Descarga el GLB y prepara mallas, materiales y aristas por nivel y sistema. */
  async cargar(url: string): Promise<void> {
    const cargador = new GLTFLoader();
    cargador.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await cargador.loadAsync(url);
    if (this.destruido) return;

    const { min, max } = this.ficha.caja;
    const centro = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const radio = Math.hypot(max[0] - min[0], max[2] - min[2]) / 2;
    const alto = max[1] - min[1];
    const estructurales = this.ficha.estructurales ? new Set(this.ficha.estructurales) : ESTRUCTURALES;
    const porClave = new Map(this.secuencia.tareas.map((t) => [t.clave, t]));
    const raiz = gltf.scene;
    raiz.updateMatrixWorld(true);
    const nodos: THREE.Object3D[] = [];
    raiz.traverse((o) => {
      if (o.userData && typeof o.userData.grupo === "string") nodos.push(o);
    });

    for (const original of nodos) {
      const { nivel, grupo, vidrio, destacado } = original.userData as { nivel: number; grupo: string; vidrio: boolean; destacado?: string };
      // La compresión deja en cada nodo su propia transformación: el despiece mueve
      // un grupo envolvente y no toca la del archivo.
      const nodo = new THREE.Group();
      nodo.name = original.name;
      original.parent?.add(nodo);
      nodo.add(original);
      let malla: THREE.Mesh | null = null;
      let lineas: THREE.LineSegments | null = null;
      nodo.traverse((o) => {
        if ((o as THREE.LineSegments).isLineSegments) lineas = o as THREE.LineSegments;
        else if ((o as THREE.Mesh).isMesh) malla = o as THREE.Mesh;
      });
      const plano = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
      const opacidadBase = vidrio ? 0.3 : 1;
      const color = new THREE.Color(vidrio ? COLOR_VIDRIO : (COLORES[grupo] ?? COLORES.otros));
      let material: THREE.MeshStandardMaterial | null = null;
      let yMin = min[1];
      let yMax = max[1];
      if (malla) {
        const m = malla as THREE.Mesh;
        const caja = new THREE.Box3().setFromObject(m);
        if (!caja.isEmpty()) {
          yMin = caja.min.y;
          yMax = caja.max.y;
        }
        material = new THREE.MeshStandardMaterial({
          clipShadows: true,
          color,
          roughness: vidrio ? 0.15 : grupo === "acero" || grupo === "uniones" ? 0.62 : 0.9,
          metalness: 0,
          flatShading: true,
          side: THREE.DoubleSide,
          transparent: vidrio,
          opacity: opacidadBase,
          depthWrite: !vidrio,
          clippingPlanes: this.secuencia.real || this.secuencia.hitos ? [] : [plano],
          emissive: AMBAR,
          emissiveIntensity: 0,
        });
        m.material = material;
        m.castShadow = this.opciones.sombras && !vidrio && grupo !== "terreno";
        m.receiveShadow = this.opciones.sombras && !vidrio;
      }
      let materialLineas: THREE.LineBasicMaterial | null = null;
      if (lineas) {
        materialLineas = new THREE.LineBasicMaterial({ color: TINTA, transparent: true, opacity: 0.42, clippingPlanes: material?.clippingPlanes ?? [] });
        (lineas as THREE.LineSegments).material = materialLineas;
      }
      const tarea = porClave.get(nodo.name);
      this.cubos.push({
        nivel,
        grupo,
        vidrio,
        estructural: estructurales.has(grupo),
        destacado: destacado ?? null,
        nodo,
        malla,
        material,
        materialLineas,
        plano,
        yMin,
        yMax,
        opacidadBase,
        color,
        inicio: tarea?.inicio ?? 0,
        fin: tarea?.fin ?? 0,
        primero: (tarea?.inicio ?? 0) <= 0,
      });
    }
    this.escena.add(raiz);

    if (this.opciones.sombras) {
      this.sombraSuelo = new THREE.ShadowMaterial({ opacity: 0.34 });
      const suelo = new THREE.Mesh(new THREE.CircleGeometry(radio * 2.4, 64), this.sombraSuelo);
      suelo.rotation.x = -Math.PI / 2;
      suelo.position.set(centro.x, 0, centro.z);
      suelo.receiveShadow = true;
      this.escena.add(suelo);
      const s = this.luz.shadow;
      s.mapSize.set(2048, 2048);
      s.bias = -0.0005;
      const alcance = radio * 1.3 + alto;
      Object.assign(s.camera, { left: -alcance, right: alcance, top: alcance, bottom: -alcance, near: 1, far: alcance * 6 });
      s.camera.updateProjectionMatrix();
    }
    this.luz.target.position.copy(centro);
    this.luz.position.set(centro.x - radio * 1.1, centro.y + alto * 2.2 + radio, centro.z + radio * 1.5);
    if (this.estado) this.aplicar(this.estado);
  }

  /**
   * Desplaza el centro de la imagen (en píxeles): hacia arriba para dejar sitio a los
   * controles de abajo y hacia la derecha para dejar sitio al texto de la izquierda.
   */
  fijarMargen(abajo: number, lado = 0) {
    this.abajo = abajo;
    this.lado = lado;
    this.redimensionar();
  }

  /** Lleva el modelo y la cámara al estado indicado y pide un cuadro nuevo. */
  aplicar(estado: EstadoVisor) {
    this.estado = estado;
    const { despiece, fantasma, velo, tiempo, foco, plano } = estado;
    if (this.sombraSuelo) this.sombraSuelo.opacity = 0.34 * (1 - plano);
    const porHitos = Boolean(this.secuencia.hitos);
    const real = this.secuencia.real;
    const pasos = this.secuencia.hitos?.length ?? 1;

    for (const c of this.cubos) {
      const elevacion = despiece * c.nivel * SEPARACION;
      c.nodo.position.y = elevacion;

      const ancho = c.fin - c.inicio;
      const hecho = ancho > 0 ? THREE.MathUtils.clamp((tiempo - c.inicio) / ancho, 0, 1) : tiempo >= c.fin ? 1 : 0;
      // Con hitos, el conjunto recién terminado sigue resaltado hasta que llega el siguiente.
      const reciente = porHitos
        ? hecho > 0
          ? 1 - THREE.MathUtils.clamp((tiempo - c.fin) * pasos, 0, 1)
          : 0
        : hecho > 0 && hecho < 1
          ? 1
          : 0;
      const solido = THREE.MathUtils.lerp(1, porHitos || real ? Math.min(1, hecho * (real ? 4 : 1)) : hecho > 0 ? 1 : 0, velo);
      // Sin fechas, la pieza crece desde su base para sugerir el orden de obra.
      c.plano.constant = !porHitos && !real && velo > 0 && hecho > 0 && hecho < 1 ? elevacion + c.yMin + (c.yMax - c.yMin) * hecho + 0.01 : 1e6;

      const atenuado = c.estructural ? 0 : fantasma;
      const resalte = Math.max(velo * reciente * (c.vidrio ? 0 : 1), c.destacado ? foco * (PESO_FOCO[c.destacado] ?? 0.5) : 0);
      const opacidadLlena = THREE.MathUtils.lerp(THREE.MathUtils.lerp(porHitos ? 0.045 : 0, c.opacidadBase, solido), c.vidrio ? 0.03 : 0.06, atenuado);
      // Como plano, el relleno desaparece y solo quedan las aristas.
      const opacidad = opacidadLlena * (1 - plano);
      c.nodo.visible = opacidadLlena > 0.004 || c.grupo === "terreno";
      if (c.malla) c.malla.visible = opacidad > 0.004;
      // Un conjunto recién terminado que queda detrás del edificio se dibuja por encima.
      const aTraves = porHitos && velo > 0.5 && reciente > 0.35 && !c.primero && solido > 0.2;
      if (c.material) {
        c.material.opacity = opacidad;
        c.material.transparent = opacidad < 0.995 || aTraves;
        c.material.depthWrite = opacidad > 0.6 && !aTraves;
        c.material.depthTest = !aTraves;
        c.material.color.copy(c.color).lerp(AMBAR, resalte * 0.88);
        c.material.emissiveIntensity = resalte * 0.3;
      }
      if (c.malla) {
        c.malla.renderOrder = aTraves ? 4 : 0;
        c.malla.castShadow = this.opciones.sombras && !c.vidrio && c.grupo !== "terreno" && opacidad > 0.5;
      }
      if (c.materialLineas) {
        c.materialLineas.opacity = THREE.MathUtils.lerp(0.42 * THREE.MathUtils.clamp(opacidadLlena / c.opacidadBase, 0.12, 1), 0.78, plano);
        c.materialLineas.depthTest = !aTraves;
      }
    }

    // Cámara: posición y punto de mira llegan resueltos; el giro manual rodea el punto de mira.
    const obj = new THREE.Vector3().fromArray(estado.obj);
    const brazo = new THREE.Vector3().fromArray(estado.pos).sub(obj);
    if (estado.giro) brazo.applyAxisAngle(THREE.Object3D.DEFAULT_UP, estado.giro);
    this.camara.position.copy(obj).add(brazo);
    this.camara.fov = estado.fov;
    this.camara.near = THREE.MathUtils.clamp(brazo.length() * 0.03, 0.05, 1);
    this.camara.far = brazo.length() + 120;
    this.camara.lookAt(obj);
    this.camara.updateProjectionMatrix();
    this.relleno.position.copy(this.camara.position);
    this.relleno.intensity = estado.relleno * 1.5;
    this.pedirCuadro();
  }

  private pedirCuadro() {
    if (this.pendiente || this.destruido) return;
    this.pendiente = requestAnimationFrame(() => {
      this.pendiente = 0;
      this.renderer.render(this.escena, this.camara);
      const datos = this.contenedor.dataset;
      // Datos de diagnóstico para las pruebas: triángulos dibujados y posición de la cámara.
      const dibujados = String(this.renderer.info.render.triangles);
      if (datos.triangulos !== dibujados) datos.triangulos = dibujados;
      const p = this.camara.position;
      datos.camara = `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
      this.publicarAncla();
    });
  }

  /** Deja en el contenedor la posición en pantalla del nudo, para anclar su etiqueta. */
  private publicarAncla() {
    if (!this.opciones.ancla) return;
    const v = this.proyeccion.copy(this.ancla).project(this.camara);
    const x = ((v.x + 1) / 2) * this.contenedor.clientWidth;
    const y = ((1 - v.y) / 2) * this.contenedor.clientHeight;
    const delante = v.z < 1 && v.z > -1;
    const texto = `${delante ? 1 : 0}|${x.toFixed(0)}|${y.toFixed(0)}`;
    if (texto === this.anclaPrevia) return;
    this.anclaPrevia = texto;
    this.contenedor.style.setProperty("--ancla-x", `${x.toFixed(1)}px`);
    this.contenedor.style.setProperty("--ancla-y", `${y.toFixed(1)}px`);
    this.contenedor.dataset.ancla = delante ? "visible" : "oculta";
  }

  redimensionar() {
    const ancho = Math.max(this.contenedor.clientWidth, 1);
    const alto = Math.max(this.contenedor.clientHeight, 1);
    this.renderer.setSize(ancho, alto, false);
    this.camara.aspect = ancho / alto;
    // La franja de controles desplaza el centro de la imagen hacia arriba.
    if (this.abajo || this.lado) this.camara.setViewOffset(ancho, alto, -this.lado, this.abajo / 2, ancho, alto);
    else this.camara.clearViewOffset();
    this.camara.updateProjectionMatrix();
    if (this.cubos.length && this.estado) this.aplicar(this.estado);
    else this.pedirCuadro();
  }

  destruir() {
    this.destruido = true;
    cancelAnimationFrame(this.pendiente);
    this.observador.disconnect();
    this.escena.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
