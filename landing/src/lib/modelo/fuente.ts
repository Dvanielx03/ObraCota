/** Origen y licencia del modelo 3D del recorrido. Se muestra junto al visor. */
export const URL_MODELO = "/modelos/restage.glb";

export const FUENTE_MODELO = {
  nombre: "ReStage, demostrador construido en el campus Melaten de RWTH Aachen (Alemania)",
  autores: "Chu Han Wu, Görkem Can Ertemli, Martin von Hilchen, Sigrid Brell-Cokcan y Marit Zöcklein",
  enlace: "Ver el modelo en Zenodo",
  url: "https://zenodo.org/records/21470658",
  licencia: "CC BY 4.0",
  urlLicencia: "https://creativecommons.org/licenses/by/4.0/",
  cambios:
    "Cambios: convertido de IFC a GLB con web-ifc; se omitió el entorno del campus (terreno, cerca y contenedores), se simplificaron la malla de refuerzo, la tornillería y las instalaciones, y los colores son de ObraCota.",
} as const;

/**
 * Detalle protagonista del recorrido. Cada dato sale del IFC: clase, nombre, material
 * y fecha de terminación de las piezas que el perfil marcó como «viga», «apoyo»,
 * «columna» y «union» (ver `destacados` en la ficha del modelo).
 */
export const DETALLE = {
  titulo: "Viga HEB · acero S235JR",
  texto:
    "Mide 1,90 m y llega a la columna con dos placas de testa de acero S355J2+N y tornillería de 12 mm, grado 10.9.",
  enArchivo: "STL1-01-BEAM-HEB",
  /** Punto del nudo en coordenadas del modelo, donde se ancla la etiqueta. */
  ancla: [18.81, 5.23, 53.05] as [number, number, number],
} as const;
