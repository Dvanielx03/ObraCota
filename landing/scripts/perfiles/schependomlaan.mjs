// Perfil de conversión del conjunto de datos Schependomlaan (Nimega, Países Bajos).
//
// El IFC «as planned» se exportó desde Synchro, que dejó un único nivel y nombres de
// elemento en neerlandés. Este perfil recupera los niveles por cota de base y agrupa
// los elementos por sistema constructivo según su nombre.

/** Cotas de base de cada nivel, en metros del modelo convertido (planta baja = -6,02). */
const niveles = [
  { nombre: "Cimentación", desde: -Infinity },
  { nombre: "Nivel +0,00", desde: -6.45 },
  { nombre: "Nivel +3,00", desde: -3.4 },
  { nombre: "Nivel +6,00", desde: -0.45 },
  { nombre: "Nivel +9,00", desde: 2.6 },
  { nombre: "Cubierta", desde: 5.45 },
];

// Nombre en neerlandés -> sistema. El orden importa: gana la primera regla que coincide.
const REGLAS = [
  // Cimentación: zapatas corridas, sobrecimiento, foso del ascensor y arranque de muros.
  [/^(fund_|liftputwand|opgaand werk|kantplank)/, "cimentacion"],
  [/^(dakvloer)/, "losas"],
  // Cubierta: estructura de pares, cubiertas planas, zinc, tejas, canales y buhardillas.
  [/(sporenkap|scharnierkap|plat dak|dakvloer|dak dakkapel|dakisolatie|dakschroot|dakpan|dakopstand|dakkoepel|dakrand|zinkwerk|boeideel|goot|zijwang dakk|knieschot|velux|nokvorst|dakbeschot)/, "cubierta"],
  // Circulación: escaleras, descansos y barandas.
  [/(trap|bordes|leuning|afscheiding|doorvalregel|baluster|hek)/, "circulacion"],
  // Acero estructural y dinteles.
  [/^(hea|heb|ipe|unp|k\d|stripstaal|staal|geveldrager|hoeklijn|betonlatei|staallatei|kolom)/, "estructura"],
  // Losas: alveolares de planta baja y prelosas de los pisos.
  [/^(vloer_|vloerveld|breedplaat|kanaalplaat)/, "losas"],
  // Muros portantes de ladrillo silicocalcáreo y muros del ascensor.
  [/^(binnenblad|binnenwand|liftwand|woningscheidende)/, "muros"],
  // Particiones ligeras.
  [/^(separatiewand|metalstudwand|voorzetwand)/, "particiones"],
  // Fachada: hoja exterior de ladrillo, aislamiento, remates y antepechos.
  [/^(hsb-element|buitenblad|gevelisolatie|afdekker|waterslag|betonband|balkonopstand|kantafwerking|gevel)/, "fachada"],
  // Instalaciones visibles: bajantes de aguas lluvias y rejillas de ventilación.
  [/^(hwa|vent)/, "instalaciones"],
  // Acabados: afinado de piso, enchapes y remates interiores.
  [/^(dekvloer|wandtegelwerk|vloertegelwerk|betontegels|vensterbank|aftimmering|plafond)/, "acabados"],
  [/^(brievenbus)/, "mobiliario"],
];

const perfil = {
  niveles,
  /** En este edificio la estructura es de muros portantes, losas prefabricadas y algo de acero. */
  estructurales: ["cimentacion", "muros", "losas", "estructura"],
  /** «Afbouw» (acabados) abarca todo el edificio: solo fecha a los elementos sin otra tarea. */
  tareasGenerales: ["ST01260"],
  /** «ROOT nulpunt» es el cubo que marca el punto cero del modelador: no es parte del edificio. */
  excluir(tipo, nombre) {
    return /nulpunt/i.test(nombre);
  },
  grupoDe(tipo, nombre, tareas = []) {
    const n = nombre.toLowerCase();
    for (const [patron, grupo] of REGLAS) if (patron.test(n)) return grupo;
    if (/^IFC(WINDOW|DOOR)/.test(tipo)) return "carpinteria";
    // Piezas sin nombre (capas que ArchiCAD exporta sueltas): se agrupan por la tarea
    // de obra a la que están asignadas en la programación.
    const t = tareas.join(" ").toLowerCase();
    if (/(scharnierkap|dak|zink|goot)/.test(t)) return "cubierta";
    if (/(kozijn)/.test(t)) return "carpinteria";
    if (/(betonband|metselwerk|gevel)/.test(t)) return "fachada";
    if (/^IFC(BUILDINGELEMENTPART|COVERING)/.test(tipo)) return "acabados";
    return undefined;
  },
};

export default perfil;
