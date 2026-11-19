/**
 * Caso de muestra de la landing: el Pabellón Arrayán es ficticio.
 * Las cifras salen de docs/direccion-creativa/contexto-para-diseno.md
 * y no representan un proyecto ni un cliente real.
 */

export const NAVEGACION = [
  { id: "inicio", etiqueta: "Inicio" },
  { id: "recorrido", etiqueta: "Recorrido" },
  { id: "expediente", etiqueta: "Expediente" },
  { id: "avance", etiqueta: "Avance" },
  { id: "contacto", etiqueta: "Contacto" },
] as const;

export type SeccionId = (typeof NAVEGACION)[number]["id"];

export const ESPACIOS = [
  { id: "aula-201", nombre: "Aula 201", area: 36, lamina: "ARQ-02", revision: "B" },
  { id: "aula-202", nombre: "Aula 202", area: 36, lamina: "ARQ-02", revision: "B" },
] as const;

/** Área del Aula 201 sobre la que se mide el avance, en m². */
export const AREA_AULA_201 = 36;

/** Cifras acumuladas del Aula 201 en cada fecha de corte, en m². */
export const CORTES_AVANCE = [
  { id: "2026-11-06", etiqueta: "6 nov 2026", fechaLarga: "6 de noviembre de 2026", programado: 18, ejecutado: 9 },
  { id: "2026-11-13", etiqueta: "13 nov 2026", fechaLarga: "13 de noviembre de 2026", programado: 36, ejecutado: 27 },
] as const;

export const FRASE =
  "Un detalle cambia en el plano. ObraCota muestra qué lámina lo respalda y cuánto se ejecutó a la fecha.";
