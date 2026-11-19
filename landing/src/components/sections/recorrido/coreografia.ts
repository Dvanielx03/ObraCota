/**
 * Coreografía del recorrido: una sola función convierte el avance del scroll (0 a 1) en
 * todo lo que el visor necesita. Cámara, punto de mira, separación de niveles,
 * transparencia y línea de tiempo salen del mismo número, así que al volver atrás se
 * recorren exactamente los mismos encuadres.
 *
 * Las posiciones están en metros del modelo convertido de ReStage. El edificio ocupa
 * x 15,7–24,3 · y 0–8,1 · z 45,1–56,2; la cara abierta del pórtico de acero mira a +z.
 */

export type Vec = [number, number, number];

/** Todo lo que el visor dibuja en un instante. */
export type EstadoVisor = {
  pos: Vec;
  obj: Vec;
  fov: number;
  /** 0 = edificio armado, 1 = plantas separadas. */
  despiece: number;
  /** 0 = todo sólido, 1 = lo no estructural queda en transparencia. */
  fantasma: number;
  /** 0 = edificio completo; 1 = solo se ve sólido lo que la línea de tiempo ya terminó. */
  velo: number;
  /** Línea de tiempo por hitos, de 0 (ninguno) a 1 (todos). */
  tiempo: number;
  /** Intensidad del resalte del detalle protagonista. */
  foco: number;
  /** Luz de relleno junto a la cámara, para las vistas interiores. */
  relleno: number;
  /** Giro añadido por la persona alrededor del punto de mira, en radianes. */
  giro: number;
  /** 1 = el modelo se ve como plano, solo en líneas; 0 = modelo relleno. */
  plano: number;
};

export type Encuadre = {
  /** ancho / alto del lienzo. */
  aspecto: number;
  /** Parte del alto que queda libre de controles (1 = todo). */
  util: number;
  vertical: boolean;
};

export const FASES = [
  { id: "reconocer", numero: "01", titulo: "Reconocer", desde: 0, reposo: 0.02 },
  { id: "separar", numero: "02", titulo: "Separar", desde: 0.2, reposo: 0.4 },
  { id: "entrar", numero: "03", titulo: "Entrar", desde: 0.42, reposo: 0.63 },
  { id: "estructura", numero: "04", titulo: "Comprender la estructura", desde: 0.66, reposo: 0.83 },
  { id: "tiempo", numero: "05", titulo: "Reconstruir en el tiempo", desde: 0.9, reposo: 1 },
] as const;
export type FaseId = (typeof FASES)[number]["id"];

export const faseDe = (p: number): FaseId => {
  let actual: FaseId = FASES[0].id;
  for (const f of FASES) if (p >= f.desde) actual = f.id;
  return actual;
};

/** A partir de aquí la línea de tiempo queda libre para moverla a mano. */
export const AVANCE_LIBRE = 0.992;
/** Tramos en los que la cámara está quieta junto al detalle y cabe una etiqueta. */
export const etiquetaVisible = (p: number) => (p >= 0.612 && p <= 0.662) || (p >= 0.812 && p <= 0.852);

const CENTRO: Vec = [20, 3.75, 50.6];
const RADIO = 8.1;
/** Metros que se separa cada planta de la anterior en el despiece. */
export const SEPARACION = 1.7;
const NIVELES = 4;

const mezcla = (a: number, b: number, t: number) => a + (b - a) * t;
const mezclaVec = (a: Vec, b: Vec, t: number): Vec => [mezcla(a[0], b[0], t), mezcla(a[1], b[1], t), mezcla(a[2], b[2], t)];
const limitar = (x: number) => Math.min(1, Math.max(0, x));
/** Avance de 0 a 1 entre dos puntos del recorrido, con arranque y llegada suaves. */
const tramo = (p: number, desde: number, hasta: number) => {
  const t = limitar((p - desde) / (hasta - desde));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const grados = (g: number) => (g * Math.PI) / 180;

type Toma = { pos: Vec; obj: Vec; fov: number };

/** Vista exterior: gira alrededor del edificio y se aleja lo justo para que quepa. */
function exterior(e: Encuadre, azimut: number, polar: number, margen: number, despiece = 0): Toma {
  const fov = 32;
  const extra = despiece * SEPARACION * (NIVELES - 1);
  const radio = Math.hypot(RADIO, extra / 2) * margen;
  const mitadV = Math.atan(Math.tan(grados(fov) / 2) * e.util);
  const mitadH = Math.atan(Math.tan(grados(fov) / 2) * e.aspecto);
  const distancia = radio / Math.sin(Math.min(mitadV, mitadH));
  const obj: Vec = [CENTRO[0], CENTRO[1] + extra / 2, CENTRO[2]];
  const a = grados(azimut), f = grados(polar);
  return {
    pos: [obj[0] + distancia * Math.sin(f) * Math.sin(a), obj[1] + distancia * Math.cos(f), obj[2] + distancia * Math.sin(f) * Math.cos(a)],
    obj,
    fov,
  };
}

/** Encuadres fijos junto al detalle. En vertical la cámara se acerca más de frente. */
function tomas(e: Encuadre) {
  const v = e.vertical;
  return {
    inicio: exterior(e, -52, 78, v ? 0.8 : 0.74),
    lateral: exterior(e, -33, 78, v ? 0.8 : 0.74),
    abierto: exterior(e, -25, 74, v ? 0.82 : 0.8, 1),
    // Justo antes de entrar: fuera del pórtico, a un metro y medio de la viga.
    junto: v
      ? { pos: [16.7, 4.75, 55.3] as Vec, obj: [18.45, 5.02, 53.05] as Vec, fov: 40 }
      : { pos: [15.6, 4.9, 56.6] as Vec, obj: [18.7, 5.0, 53.05] as Vec, fov: 32 },
    // Justo después: dentro, bajo la viga, mirando el nudo desde abajo.
    dentro: v
      ? { pos: [17.75, 4.05, 52.3] as Vec, obj: [18.9, 5.12, 53.02] as Vec, fov: 58 }
      : { pos: [17.45, 4.2, 52.32] as Vec, obj: [19.0, 5.22, 53.02] as Vec, fov: 46 },
    // El mismo nudo desde el otro lado de la columna, tras recorrer la crujía.
    otroLado: v
      ? { pos: [20.2, 4.05, 52.3] as Vec, obj: [19.05, 5.12, 53.0] as Vec, fov: 58 }
      : { pos: [20.55, 4.25, 52.32] as Vec, obj: [19.02, 5.2, 53.0] as Vec, fov: 46 },
    // Salida por el vano libre entre dos montantes de la fachada.
    salida: { pos: [20.57, 4.5, 54.4] as Vec, obj: [19.6, 4.6, 52.2] as Vec, fov: 40 },
    final: exterior(e, 44, 70, v ? 0.84 : 0.8),
  };
}

function entre(a: Toma, b: Toma, t: number): Toma {
  return { pos: mezclaVec(a.pos, b.pos, t), obj: mezclaVec(a.obj, b.obj, t), fov: mezcla(a.fov, b.fov, t) };
}

/** Estado completo del visor para un avance del recorrido. */
export function estadoEn(p: number, e: Encuadre): EstadoVisor {
  const t = tomas(e);
  let camara: Toma;
  if (p < 0.2) camara = entre(t.inicio, t.lateral, tramo(p, 0, 0.2));
  else if (p < 0.42) camara = entre(t.lateral, t.abierto, tramo(p, 0.2, 0.38));
  else if (p < 0.545) camara = entre(t.abierto, t.junto, tramo(p, 0.42, 0.545));
  else if (p < 0.66) camara = entre(t.junto, t.dentro, tramo(p, 0.545, 0.61));
  else if (p < 0.855) camara = entre(t.dentro, t.otroLado, tramo(p, 0.665, 0.81));
  else if (p < 0.875) camara = entre(t.otroLado, t.salida, tramo(p, 0.855, 0.875));
  else camara = entre(t.salida, t.final, tramo(p, 0.875, 0.915));

  return {
    ...camara,
    despiece: tramo(p, 0.21, 0.36) - tramo(p, 0.42, 0.5),
    fantasma: tramo(p, 0.665, 0.72) - tramo(p, 0.86, 0.9),
    velo: tramo(p, 0.9, 0.922),
    tiempo: p < 0.925 ? 0 : limitar((p - 0.925) / (0.99 - 0.925)),
    foco: tramo(p, 0.05, 0.13) - tramo(p, 0.86, 0.9),
    relleno: tramo(p, 0.5, 0.6) - tramo(p, 0.86, 0.9),
    giro: 0,
    plano: 0,
  };
}

/** Vista libre del final: edificio completo, sin velo, para moverlo a mano. */
export function estadoFinal(e: Encuadre, tiempo: number, giro: number): EstadoVisor {
  return { ...estadoEn(1, e), velo: 1, tiempo, giro };
}
