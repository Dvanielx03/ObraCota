/**
 * Escena: the global edits of the Editar sub-bar (DU-17, 03-herramientas.md §3.3) gathered in one
 * card. Time of day, weather and season, surroundings, people and graphic style are no longer
 * exclusive tools: each is one optional category with at most one choice, and all of them combine
 * into a single request. Shortcuts by goal («Presentación al cliente», «Concurso»…) fill the
 * combination, which can be adjusted afterwards. Applying sends the composed text to the same
 * options endpoint as Renderizar, over the full framing and without a mask. Nothing is chosen by
 * default.
 */

export interface GlobalOption<Id extends string = string> { id: Id; label: string; phrase: string }

/** Momento del día, 8 options in the order of the reference. */
export const TIMES = [
  { id: "morning", label: "Mañana", phrase: "por la mañana, con luz suave" },
  { id: "afternoon", label: "Tarde", phrase: "por la tarde" },
  { id: "night", label: "Noche", phrase: "de noche, con las luces interiores y exteriores encendidas" },
  { id: "sunrise", label: "Amanecer", phrase: "al amanecer" },
  { id: "noon", label: "Mediodía", phrase: "a mediodía, con el sol alto y sombras cortas" },
  { id: "golden", label: "Hora dorada", phrase: "en la hora dorada, con luz cálida y rasante" },
  { id: "sunset", label: "Atardecer", phrase: "al atardecer, con el cielo encendido" },
  { id: "blue", label: "Hora azul", phrase: "en la hora azul, justo después de la puesta de sol" },
] as const satisfies readonly GlobalOption[];

/** Clima y estación › Clima. */
export const WEATHERS = [
  { id: "clear", label: "Despejado", phrase: "cielo despejado" },
  { id: "partly", label: "Nubes y claros", phrase: "cielo con nubes y claros" },
  { id: "overcast", label: "Cubierto", phrase: "cielo cubierto y luz difusa" },
  { id: "fog", label: "Niebla", phrase: "niebla" },
  { id: "rain", label: "Lluvia", phrase: "lluvia y el suelo mojado" },
  { id: "snow", label: "Nieve", phrase: "nieve" },
] as const satisfies readonly GlobalOption[];

/** Clima y estación › Estación. */
export const SEASONS = [
  { id: "spring", label: "Primavera", phrase: "vegetación de primavera" },
  { id: "summer", label: "Verano", phrase: "vegetación de verano" },
  { id: "autumn", label: "Otoño", phrase: "vegetación de otoño" },
  { id: "winter", label: "Invierno", phrase: "vegetación de invierno" },
] as const satisfies readonly GlobalOption[];

/** Entorno: «Sin entorno» first (technical review), then the 11 settings of the reference. */
export const ENVIRONMENTS = [
  { id: "none", label: "Sin entorno", phrase: "sobre un fondo neutro, sin entorno alrededor" },
  { id: "countryside", label: "Campo", phrase: "en el campo, rodeada de terreno abierto" },
  { id: "city", label: "Ciudad", phrase: "en la ciudad, entre otros edificios" },
  { id: "coast", label: "Costa", phrase: "en la costa, cerca del mar" },
  { id: "mountain", label: "Montaña", phrase: "en la montaña" },
  { id: "forest", label: "Bosque", phrase: "en un bosque" },
  { id: "lake", label: "Junto al lago", phrase: "junto a un lago" },
  { id: "river", label: "Junto al río", phrase: "junto a un río" },
  { id: "desert", label: "Desierto", phrase: "en un paisaje desértico" },
  { id: "tropical", label: "Tropical", phrase: "en un entorno tropical" },
  { id: "residential", label: "Residencial", phrase: "en un barrio residencial, con casas vecinas" },
  { id: "garden", label: "Jardín", phrase: "en medio de un jardín" },
] as const satisfies readonly GlobalOption[];

/** Personas › Cantidad; «Ninguna» asks for a scene without people. */
export const CROWDS = [
  { id: "none", label: "Ninguna", phrase: "ninguna persona" },
  { id: "one", label: "Una", phrase: "una persona" },
  { id: "couple", label: "Pareja", phrase: "una pareja" },
  { id: "few", label: "Pocas", phrase: "unas pocas personas" },
  { id: "crowded", label: "Concurrido", phrase: "mucha gente" },
] as const satisfies readonly GlobalOption[];

/** Personas › Estilo de las personas; Natural is chosen as soon as a quantity is. */
export const PEOPLE_STYLES = [
  { id: "natural", label: "Natural", phrase: "con aspecto natural" },
  { id: "motion", label: "Desenfoque de movimiento", phrase: "con desenfoque de movimiento" },
  { id: "silhouette", label: "Silueta", phrase: "como siluetas" },
] as const satisfies readonly GlobalOption[];

/** Estilo: photorealistic plus the 10 graphic styles. `slug` names the picture in /public/edit-styles. */
export const GRAPHIC_STYLES = [
  { id: "photo", slug: "fotorrealista", label: "Fotorrealista", phrase: "una fotografía de arquitectura fotorrealista" },
  { id: "white-model", slug: "maqueta-blanca", label: "Maqueta blanca", phrase: "una maqueta blanca de arquitectura, sin color" },
  { id: "model", slug: "maqueta", label: "Maqueta", phrase: "una maqueta física con sus materiales" },
  { id: "flat", slug: "color-plano", label: "Color plano", phrase: "una ilustración de colores planos" },
  { id: "watercolor", slug: "acuarela", label: "Acuarela", phrase: "una acuarela" },
  { id: "marker", slug: "rotulador", label: "Rotulador", phrase: "un dibujo a rotulador" },
  { id: "pastel", slug: "pastel", label: "Pastel", phrase: "un dibujo a pastel" },
  { id: "collage", slug: "collage", label: "Collage", phrase: "un collage de recortes" },
  { id: "illustration", slug: "ilustracion", label: "Ilustración", phrase: "una ilustración" },
  { id: "pencil", slug: "boceto-lapiz", label: "Boceto a lápiz", phrase: "un boceto a lápiz" },
  { id: "ink", slug: "dibujo-tinta", label: "Dibujo a tinta", phrase: "un dibujo a tinta" },
] as const satisfies readonly (GlobalOption & { slug: string })[];

export type TimeId = (typeof TIMES)[number]["id"];
export type WeatherId = (typeof WEATHERS)[number]["id"];
export type SeasonId = (typeof SEASONS)[number]["id"];
export type EnvironmentId = (typeof ENVIRONMENTS)[number]["id"];
export type CrowdId = (typeof CROWDS)[number]["id"];
export type PeopleStyleId = (typeof PEOPLE_STYLES)[number]["id"];
export type GraphicStyleId = (typeof GRAPHIC_STYLES)[number]["id"];

export const PEOPLE_PROMPT_LIMIT = 300;

/** The scene waiting to be applied: every category is optional and holds at most one choice. */
export interface SceneEdit {
  time: TimeId | null;
  weather: WeatherId | null;
  season: SeasonId | null;
  environment: EnvironmentId | null;
  /** Quantity of people; their style and own indications only mean something with people in the scene. */
  crowd: CrowdId | null;
  peopleStyle: PeopleStyleId;
  prompt: string;
  style: GraphicStyleId | null;
}

export const EMPTY_SCENE: SceneEdit = { time: null, weather: null, season: null, environment: null, crowd: null, peopleStyle: "natural", prompt: "", style: null };

/** The fields one can choose in, each with its catalogue. */
export type SceneField = "time" | "weather" | "season" | "environment" | "crowd" | "peopleStyle" | "style";
const CATALOGUE: Record<SceneField, readonly GlobalOption[]> = {
  time: TIMES, weather: WEATHERS, season: SEASONS, environment: ENVIRONMENTS, crowd: CROWDS, peopleStyle: PEOPLE_STYLES, style: GRAPHIC_STYLES,
};

/** The five categories of the card, in the order of the request. */
export type SceneCategory = "time" | "atmosphere" | "environment" | "people" | "style";
export const SCENE_CATEGORIES: readonly { id: SceneCategory; title: string }[] = [
  { id: "time", title: "Momento del día" },
  { id: "atmosphere", title: "Clima y estación" },
  { id: "environment", title: "Entorno" },
  { id: "people", title: "Personas" },
  { id: "style", title: "Estilo" },
];

/** Shortcuts by goal: each fills the whole combination (what it does not name stays empty). */
export const SCENE_PRESETS = [
  { id: "client", label: "Presentación al cliente", scene: { time: "afternoon", weather: "clear", environment: "city", crowd: "few", style: "photo" } },
  { id: "contest", label: "Concurso", scene: { time: "sunset", environment: "countryside", crowd: "none", style: "white-model" } },
  { id: "review", label: "Revisión técnica", scene: { time: "noon", weather: "clear", environment: "none", crowd: "none", style: "white-model" } },
  { id: "night", label: "Ambiente nocturno", scene: { time: "night", environment: "city", crowd: "few" } },
] as const satisfies readonly { id: string; label: string; scene: Partial<SceneEdit> }[];
export type ScenePresetId = (typeof SCENE_PRESETS)[number]["id"];

const find = <T extends { id: string }>(list: readonly T[], id: string | null | undefined): T | undefined => list.find((item) => item.id === id);
const SAME: readonly SceneField[] = ["time", "weather", "season", "environment", "crowd", "style"];

/** The scene of a shortcut by goal, ready to be adjusted. Unknown ids leave the scene as it was. */
export function applyPreset(current: SceneEdit | null, id: string): SceneEdit | null {
  const preset = find(SCENE_PRESETS, id);
  return preset ? { ...EMPTY_SCENE, ...preset.scene } : current;
}

/** The shortcut whose combination is exactly the current one, if any (it shows as pressed). */
export function matchingPreset(current: SceneEdit | null): ScenePresetId | null {
  if (!current) return null;
  return SCENE_PRESETS.find((preset) => {
    const target: SceneEdit = { ...EMPTY_SCENE, ...preset.scene };
    return SAME.every((key) => current[key] === target[key]);
  })?.id ?? null;
}

/**
 * The scene after choosing `value` in `field`. Every category keeps one value and choosing in one
 * never touches the others. Unknown values, or a people style without people, change nothing.
 */
export function chooseScene(current: SceneEdit | null, field: SceneField, value: string): SceneEdit | null {
  if (!find(CATALOGUE[field], value)) return current;
  const base = current ?? EMPTY_SCENE;
  if (field === "peopleStyle" && (!base.crowd || base.crowd === "none")) return current;
  return { ...base, [field]: value };
}

/** Empties one category; the scene goes back to null when nothing is left. */
export function clearCategory(current: SceneEdit | null, category: SceneCategory): SceneEdit | null {
  if (!current) return null;
  const next: SceneEdit = { ...current };
  if (category === "time") next.time = null;
  if (category === "atmosphere") { next.weather = null; next.season = null; }
  if (category === "environment") next.environment = null;
  if (category === "people") { next.crowd = null; next.peopleStyle = "natural"; next.prompt = ""; }
  if (category === "style") next.style = null;
  return isApplicable(next) ? next : null;
}

/** The people's own words, cut to the limit. Without people in the scene there is nothing to write on. */
export function withPeoplePrompt(current: SceneEdit | null, prompt: string): SceneEdit | null {
  return current?.crowd && current.crowd !== "none" ? { ...current, prompt: prompt.slice(0, PEOPLE_PROMPT_LIMIT) } : current;
}

/** The value chosen in one field, or null (no default anywhere). */
export function sceneValue(current: SceneEdit | null, field: SceneField): string | null {
  if (!current) return null;
  if (field === "peopleStyle") return current.crowd && current.crowd !== "none" ? current.peopleStyle : null;
  return current[field];
}

/** True when the scene asks for something: at least one category is chosen. */
export function isApplicable(edit: SceneEdit | null): edit is SceneEdit {
  return !!edit && !!(edit.time || edit.weather || edit.season || edit.environment || edit.crowd || edit.style);
}

/** Short label of one category («Niebla · Otoño», «Pocas · Silueta»), or undefined when it is empty. */
export function categorySummary(edit: SceneEdit | null, category: SceneCategory): string | undefined {
  if (!edit) return undefined;
  const join = (...labels: (string | undefined)[]) => labels.filter(Boolean).join(" · ") || undefined;
  switch (category) {
    case "time": return find(TIMES, edit.time)?.label;
    case "atmosphere": return join(find(WEATHERS, edit.weather)?.label, find(SEASONS, edit.season)?.label);
    case "environment": return find(ENVIRONMENTS, edit.environment)?.label;
    case "people": return edit.crowd === "none" ? "Sin personas" : edit.crowd ? join(find(CROWDS, edit.crowd)?.label, find(PEOPLE_STYLES, edit.peopleStyle)?.label) : undefined;
    case "style": return find(GRAPHIC_STYLES, edit.style)?.label;
  }
}

/** The whole combination in short, for the tooltip of the Escena button («Tarde · Despejado · Ciudad»). */
export function globalSummary(edit: SceneEdit | null): string | undefined {
  if (!isApplicable(edit)) return undefined;
  return SCENE_CATEGORIES.map((category) => categorySummary(edit, category.id)).filter(Boolean).join(" · ");
}

const KEEP = "Conserva la geometría, las proporciones, los materiales y el encuadre del modelo.";
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : text + ".");

/**
 * Exact text sent to the image model for the scene (Spanish, no product names): one sentence per
 * chosen category, always in the same order, so the combination reads as a single request. Empty
 * when nothing is chosen.
 */
export function globalEditText(edit: SceneEdit | null): string {
  if (!isApplicable(edit)) return "";
  const parts: string[] = [];
  const time = find(TIMES, edit.time)?.phrase;
  const atmosphere = [find(WEATHERS, edit.weather)?.phrase, find(SEASONS, edit.season)?.phrase].filter(Boolean).join(" y ");
  if (time) parts.push("Muestra la escena " + time + (atmosphere ? ", con " + atmosphere : "") + ".");
  else if (atmosphere) parts.push("Muestra la escena con " + atmosphere + ".");
  const environment = find(ENVIRONMENTS, edit.environment)?.phrase;
  if (environment) parts.push("Sitúa la edificación " + environment + ".");
  if (edit.crowd === "none") parts.push("No incluyas personas en la escena.");
  else if (edit.crowd) {
    const prompt = edit.prompt.trim().replace(/\s+/g, " ");
    parts.push("Añade " + find(CROWDS, edit.crowd)!.phrase + " a la escena, " + find(PEOPLE_STYLES, edit.peopleStyle)!.phrase + ", a escala con el edificio."
      + (prompt ? " Indicaciones para las personas: " + sentence(prompt) : ""));
  }
  const style = find(GRAPHIC_STYLES, edit.style)?.phrase;
  if (style) parts.push("Representa la imagen como " + style + ".");
  return parts.join(" ") + " " + KEEP;
}
