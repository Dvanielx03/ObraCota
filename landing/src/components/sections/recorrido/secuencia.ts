import { TAREAS_ES } from "@/lib/modelo/tareas-es";

/** Tarea de la programación de obra leída del IFC. */
export type TareaPrograma = {
  codigo: string;
  nombre: string;
  grupo: string;
  inicio: string;
  fin: string;
  elementos: number;
  /** Abarca todo el edificio (por ejemplo, acabados) y no fecha elementos concretos. */
  general: boolean;
};

/** Conjunto de elementos con una fecha real de terminación en el IFC. */
export type HitoObra = {
  i: number;
  codigo: string;
  nombre: string;
  alias: { codigo: string; nombre: string }[];
  fecha: string;
  grupo: string;
  elementos: number;
};

/** Ficha que escribe scripts/ifc-a-glb.mjs junto al GLB. */
export type FichaModelo = {
  fuente: { archivo: string; esquema: string; aplicacion: string; bytesIfc: number; excluidos?: string[] };
  caja: { min: number[]; max: number[] };
  niveles: { i: number; nombre: string; y: number; elementos: number }[];
  grupos: { id: string; elementos: number }[];
  /** Sistemas que cuentan como estructura en este edificio. */
  estructurales?: string[];
  cubos: {
    clave: string;
    nivel: number;
    grupo: string;
    vidrio: boolean;
    elementos: number;
    inicio?: string;
    fin?: string;
    general?: boolean;
    hito?: number;
    destacado?: string;
  }[];
  programa?: { inicio: string; fin: string; tareasTotales: number; tareas: TareaPrograma[] } | null;
  /** Hitos: conjuntos con fecha real de terminación, sin comienzo ni duración. */
  hitos?: {
    lista: HitoObra[];
    sinFecha: { codigo: string; nombre: string; elementos: number }[];
    elementosSinHito: number;
    tareasTotales: number;
  } | null;
  /** Piezas que el perfil del edificio separó para poder señalarlas. */
  destacados?: {
    clave: string;
    min: number[];
    max: number[];
    piezas: { guid: string; clase: string; nombre: string; material: string; nivel: string }[];
  }[];
  totales: { elementos: number; triangulosIfc: number; triangulosGlb: number; aristas: number; bytesGlb: number };
};

/** Ventana de una malla del modelo en la línea de tiempo, de 0 a 1. */
export type Tarea = {
  clave: string;
  nivel: number;
  grupo: string;
  inicio: number;
  fin: number;
};

/** Texto de la línea de tiempo en un instante. */
export type Rotulo = {
  titulo: string;
  /** Nombre original de la tarea en el archivo, cuando el título es una traducción. */
  original?: string;
  fecha?: string;
  /** Otras tareas que corren el mismo día. */
  otras: number;
};

export type Secuencia = {
  /** true si las ventanas salen de la programación real del archivo. */
  real: boolean;
  /** Hitos de terminación, cuando el archivo solo trae fechas de cierre. */
  hitos?: HitoObra[];
  tareas: Tarea[];
  rotular: (tiempo: number) => Rotulo;
};

export const NOMBRE_GRUPO: Record<string, string> = {
  terreno: "Terreno",
  cimentacion: "Cimentación",
  estructura: "Columnas y vigas",
  losas: "Losas",
  muros: "Muros",
  particiones: "Particiones",
  carpinteria: "Puertas y ventanas",
  circulacion: "Escaleras y barandas",
  fachada: "Fachada",
  cubierta: "Cubierta",
  instalaciones: "Instalaciones",
  acabados: "Acabados",
  mobiliario: "Mobiliario",
  otros: "Otros elementos",
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIA = 86_400_000;
const aDias = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d) / DIA;
};
const aTexto = (dias: number) => {
  const f = new Date(dias * DIA);
  return `${f.getUTCDate()} ${MESES[f.getUTCMonth()]} ${f.getUTCFullYear()}`;
};
const aIso = (dias: number) => new Date(dias * DIA).toISOString().slice(0, 10);

/** Programación real: cada malla aparece el día en que empieza su primera tarea. */
function secuenciaReal(ficha: FichaModelo, programa: NonNullable<FichaModelo["programa"]>): Secuencia {
  const d0 = aDias(programa.inicio);
  const total = aDias(programa.fin) + 1 - d0;
  const tareas: Tarea[] = ficha.cubos.map((c) => ({
    clave: c.clave,
    nivel: c.nivel,
    grupo: c.grupo,
    inicio: c.inicio ? (aDias(c.inicio) - d0) / total : 0,
    fin: c.fin ? (aDias(c.fin) + 1 - d0) / total : 0,
  }));
  // Las tareas resumen (en mayúsculas y sin elementos) no describen un trabajo concreto.
  const rotulables = programa.tareas.filter((t) => t.elementos > 0 || t.nombre !== t.nombre.toUpperCase());

  const rotular = (tiempo: number): Rotulo => {
    const dia = Math.min(d0 + Math.floor(tiempo * total), d0 + total - 1);
    const fecha = aTexto(dia);
    if (tiempo >= 1) return { titulo: "Edificio terminado", fecha: aTexto(d0 + total - 1), otras: 0 };
    const iso = aIso(dia);
    let activas = rotulables.filter((t) => t.inicio <= iso && iso <= t.fin);
    if (!activas.length) {
      // Fines de semana y pausas: sigue en pantalla la última tarea, si terminó hace poco.
      const hace = aIso(dia - 4);
      const recientes = rotulables.filter((t) => t.fin < iso && t.fin >= hace).sort((a, b) => b.fin.localeCompare(a.fin));
      if (recientes.length) activas = [recientes[0]];
    }
    if (!activas.length) return { titulo: tiempo <= 0 ? "Inicio de la obra" : "Sin tareas programadas este día", fecha, otras: 0 };
    const propias = activas.filter((t) => !t.general);
    const candidatas = propias.length ? propias : activas;
    const principal = [...candidatas].sort((a, b) => b.elementos - a.elementos || b.inicio.localeCompare(a.inicio))[0];
    const traducida = TAREAS_ES[principal.nombre];
    return {
      titulo: traducida ?? principal.nombre,
      original: traducida ? principal.nombre : undefined,
      fecha,
      otras: candidatas.length - 1,
    };
  };
  return { real: true, tareas, rotular };
}

/** Orden de obra dentro de un nivel. La cubierta va al final de todo el edificio. */
const ORDEN_EN_NIVEL = ["estructura", "muros", "losas", "circulacion", "fachada", "carpinteria", "particiones", "instalaciones", "acabados", "mobiliario", "otros"];

/**
 * Secuencia ILUSTRATIVA para modelos sin programación: ordena la geometría de abajo
 * hacia arriba y por sistema. No es un cronograma; solo usa el número de elementos de
 * cada tramo para repartir el tiempo.
 */
function secuenciaIlustrativa(ficha: FichaModelo): Secuencia {
  const pasos: { claves: FichaModelo["cubos"]; peso: number }[] = [];
  const cubos = ficha.cubos.filter((c) => c.grupo !== "terreno");
  const tomar = (filtro: (c: FichaModelo["cubos"][number]) => boolean) => {
    const claves = cubos.filter(filtro);
    if (!claves.length) return;
    const elementos = claves.reduce((s, c) => s + c.elementos, 0);
    pasos.push({ claves, peso: 1 + Math.sqrt(elementos) });
  };

  tomar((c) => c.grupo === "cimentacion");
  for (const nivel of ficha.niveles) {
    for (const grupo of ORDEN_EN_NIVEL) tomar((c) => c.nivel === nivel.i && c.grupo === grupo);
  }
  tomar((c) => c.grupo === "cubierta");

  const total = pasos.reduce((s, p) => s + p.peso, 0) || 1;
  const tareas: Tarea[] = [];
  let acumulado = 0;
  for (const paso of pasos) {
    const inicio = acumulado / total;
    acumulado += paso.peso;
    const fin = acumulado / total;
    for (const c of paso.claves) tareas.push({ clave: c.clave, nivel: c.nivel, grupo: c.grupo, inicio, fin });
  }
  for (const c of ficha.cubos.filter((x) => x.grupo === "terreno")) {
    tareas.push({ clave: c.clave, nivel: c.nivel, grupo: c.grupo, inicio: 0, fin: 0 });
  }

  const rotular = (tiempo: number): Rotulo => {
    if (tiempo >= 1) return { titulo: "Edificio completo", otras: 0 };
    if (tiempo <= 0) return { titulo: "Terreno listo", otras: 0 };
    const t = tareas.find((x) => x.fin > x.inicio && tiempo >= x.inicio && tiempo < x.fin);
    if (!t) return { titulo: "En obra", otras: 0 };
    const nivel = ficha.niveles.find((n) => n.i === t.nivel)?.nombre;
    const conNivel = t.grupo !== "cimentacion" && t.grupo !== "cubierta" && nivel;
    return { titulo: `${NOMBRE_GRUPO[t.grupo] ?? t.grupo}${conNivel ? ` · ${nivel}` : ""}`, otras: 0 };
  };
  return { real: false, tareas, rotular };
}

/** Nombres de los hitos de ReStage, traducidos del inglés. El original se muestra siempre. */
const HITOS_ES: Record<string, string> = {
  ConstructionPhase_01: "Fase de construcción 1",
  ConstructionPhase_03: "Fase de construcción 3",
  ConstructionPhase_04: "Fase de construcción 4",
  SolarPanel: "Paneles solares",
  "Concrete Slab Floor": "Losa de piso de concreto",
  "Underground Water Tank": "Tanque de agua enterrado",
  "Green Facade": "Fachada verde",
  "3D-Printed Concrete Wall": "Muro de concreto impreso en 3D",
};
export const nombreHito = (h: HitoObra) => HITOS_ES[h.nombre] ?? h.nombre;
export const fechaHito = (h: HitoObra) => aTexto(aDias(h.fecha));

/**
 * Hitos reales: el archivo dice qué día quedó terminado cada conjunto y nada más.
 * La línea de tiempo avanza de hito en hito (no es una escala de días) y cada conjunto
 * aparece al llegar a su fecha. No se interpola comienzo, duración ni porcentaje.
 */
function secuenciaPorHitos(ficha: FichaModelo, hitos: HitoObra[]): Secuencia {
  const n = hitos.length;
  const tareas: Tarea[] = ficha.cubos.map((c) => {
    const i = c.hito ?? 0;
    return { clave: c.clave, nivel: c.nivel, grupo: c.grupo, inicio: i / n, fin: (i + 1) / n };
  });
  const rotular = (tiempo: number): Rotulo => {
    const hechos = Math.min(n, Math.floor(tiempo * n + 1e-6));
    if (hechos <= 0) return { titulo: "Antes del primer hito", otras: 0 };
    const h = hitos[hechos - 1];
    return { titulo: nombreHito(h), original: h.nombre, fecha: fechaHito(h), otras: 0 };
  };
  return { real: false, hitos, tareas, rotular };
}

export function construirSecuencia(ficha: FichaModelo): Secuencia {
  if (ficha.programa) return secuenciaReal(ficha, ficha.programa);
  if (ficha.hitos?.lista.length) return secuenciaPorHitos(ficha, ficha.hitos.lista);
  return secuenciaIlustrativa(ficha);
}
