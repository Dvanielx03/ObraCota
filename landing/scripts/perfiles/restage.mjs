// Perfil de conversión de ReStage, el demostrador construido en el campus Melaten de
// RWTH Aachen (Zenodo 21470658, CC BY 4.0).
//
// El IFC reparte el edificio en 12 IfcBuildingStorey que en realidad son paquetes por
// material y módulo (Concrete_00, Steel_01, Timber_02…), varios a la misma cota. Este
// perfil recupera las plantas físicas por la cota de base de cada pieza y agrupa las
// piezas por material, validado contra el material declarado en el archivo.

/** Cotas de base de cada planta física, en metros del modelo convertido. */
const niveles = [
  { nombre: "Cimentación", desde: -Infinity },
  { nombre: "Planta baja", desde: 0.3 },
  { nombre: "Planta alta", desde: 2.72 },
  { nombre: "Cubierta", desde: 5.1 },
];

const MADERA = /(hbw-CLT|NH C24|NH Douglasie|GL24h|KVH|LIGNO|3S-BC|Holz)/i;
const HORMIGON = /^C\d\d\/\d\d/;
const ACERO = /(STEEL|^Steel$|^Stahl|^8\.8$|^10\.9$|^gvz$|^LOCH$)/i;

const perfil = {
  niveles,
  /** Columnas con sus tramos soldados, y cada conjunto de taller, se mueven como una sola pieza. */
  nivelPorConjunto: true,
  /** Estructura portante: hormigón, acero, madera y sus uniones. */
  estructurales: ["hormigon", "acero", "madera", "uniones"],
  /** La malla de refuerzo y la tornillería son muy densas: no se les dibujan aristas. */
  sinAristas: ["armadura", "uniones"],
  /** Las únicas piezas translúcidas del archivo son marcas de taladro, no vidrio. */
  sinVidrio: true,
  simplificar: {
    armadura: { razon: 0.08, error: 0.004 },
    uniones: { razon: 0.45, error: 0.0015 },
    instalaciones: { razon: 0.2, error: 0.004 },
    fachada: { razon: 0.5, error: 0.002 },
    cubierta: { razon: 0.5, error: 0.002 },
  },
  /**
   * Se omite el entorno del campus: terreno, cerca perimetral, contenedores de obra,
   * dos escaleras exteriores y dos toldos. Son los 41 objetos del archivo que no
   * pertenecen a ningún nivel ni tienen tarea asignada.
   */
  excluir(tipo, nombre, ctx) {
    return !ctx.nivel && !ctx.conTarea;
  },
  /**
   * Detalle protagonista del recorrido: el nudo superior del pórtico posterior (módulo 3).
   * Una viga HEB llega a la columna continua por medio de un tramo corto soldado a ella y
   * una unión atornillada con placas de testa. Se localiza por su posición en el modelo;
   * la ficha guarda el GlobalId de cada pieza para poder comprobarlo en el IFC.
   */
  destacar(tipo, nombre, ctx) {
    const dentro = (min, max) => [0, 1, 2].every((k) => ctx.min[k] >= min[k] && ctx.max[k] <= max[k]);
    if (!/^Steel1_/.test(ctx.nivel)) return undefined;
    if (tipo === "IFCBEAM") {
      if (dentro([16.88, 5.14, 52.96], [18.83, 5.32, 53.15])) return "viga";
      if (dentro([18.8, 5.14, 52.96], [19.08, 5.32, 53.15])) return "apoyo";
      if (dentro([18.96, 0.3, 52.96], [19.14, 5.32, 53.15])) return "columna";
      return undefined;
    }
    if (/^IFC(PLATE|MECHANICALFASTENER|FASTENER)/.test(tipo) && dentro([18.72, 5.1, 52.93], [18.92, 5.36, 53.18])) return "union";
    return undefined;
  },
  grupoDe(tipo, nombre, tareas, ctx) {
    const m = ctx.material;
    const paquete = ctx.nivel;
    if (/^IFCREINFORCING/.test(tipo)) return "armadura";
    if (/^IFC(MECHANICALFASTENER|FASTENER)/.test(tipo)) return "uniones";
    if (/^IFC(TANK|PIPE|CABLE|OUTLET|SENSOR|ELECTRIC|SOLAR)/.test(tipo) || /SOL-|CAB-/.test(nombre)) return "instalaciones";
    if (/^IFCROOF/.test(tipo) || /PUR/.test(nombre)) return "cubierta";
    if (/^EA-FAC|FAC-HPL/.test(nombre)) return "fachada";
    if (/^IFCDISCRETEACCESSORY/.test(tipo) && /Insulation/.test(m)) return "aislamiento";
    if (MADERA.test(m)) return "madera";
    if (HORMIGON.test(m)) return "hormigon";
    if (ACERO.test(m)) return "acero";
    // Sin material declarado: decide el paquete del modelo al que pertenece la pieza.
    if (/^Timber/.test(paquete)) return "madera";
    if (/^Concrete/.test(paquete)) return /BRAC|VOID/.test(nombre) ? "acero" : "hormigon";
    if (/^Steel/.test(paquete)) return "acero";
    return "otros";
  },
};

export default perfil;
