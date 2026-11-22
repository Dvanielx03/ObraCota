/**
 * Global edits of the Editar sub-bar (DU-17, 03-herramientas.md §3.3): one change for the whole
 * view — time of day, atmosphere, surroundings, people or graphic style. They are exclusive: only
 * one can be pending at a time, and nothing is chosen by default. Applying one sends its text to
 * the same options endpoint as Renderizar, over the full framing and without a mask.
 */

export type GlobalTool = "time" | "atmosphere" | "environment" | "people" | "style";

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

/** Atmósfera › Clima. */
export const WEATHERS = [
  { id: "clear", label: "Despejado", phrase: "cielo despejado" },
  { id: "partly", label: "Nubes y claros", phrase: "cielo con nubes y claros" },
  { id: "overcast", label: "Cubierto", phrase: "cielo cubierto y luz difusa" },
  { id: "fog", label: "Niebla", phrase: "niebla" },
  { id: "rain", label: "Lluvia", phrase: "lluvia, con el suelo mojado" },
  { id: "snow", label: "Nieve", phrase: "nieve" },
] as const satisfies readonly GlobalOption[];

/** Atmósfera › Estación. */
export const SEASONS = [
  { id: "spring", label: "Primavera", phrase: "vegetación de primavera" },
  { id: "summer", label: "Verano", phrase: "vegetación de verano" },
  { id: "autumn", label: "Otoño", phrase: "vegetación de otoño" },
  { id: "winter", label: "Invierno", phrase: "vegetación de invierno" },
] as const satisfies readonly GlobalOption[];

/** Entorno, 11 options. */
export const ENVIRONMENTS = [
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

/** Añadir personas › Cantidad. */
export const CROWDS = [
  { id: "one", label: "Una", phrase: "una persona" },
  { id: "couple", label: "Pareja", phrase: "una pareja" },
  { id: "few", label: "Pocas", phrase: "unas pocas personas" },
  { id: "crowded", label: "Concurrido", phrase: "mucha gente" },
] as const satisfies readonly GlobalOption[];

/** Añadir personas › Estilo de las personas; Natural is chosen as soon as a quantity is. */
export const PEOPLE_STYLES = [
  { id: "natural", label: "Natural", phrase: "con aspecto natural" },
  { id: "motion", label: "Desenfoque de movimiento", phrase: "con desenfoque de movimiento" },
  { id: "silhouette", label: "Silueta", phrase: "como siluetas" },
] as const satisfies readonly GlobalOption[];

/** Estilo, 10 graphic styles. `slug` names the picture in /public/edit-styles. */
export const GRAPHIC_STYLES = [
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

/** The one global edit waiting to be applied. */
export type GlobalEdit =
  | { tool: "time"; time: TimeId }
  | { tool: "atmosphere"; weather: WeatherId | null; season: SeasonId | null }
  | { tool: "environment"; environment: EnvironmentId }
  | { tool: "people"; crowd: CrowdId; style: PeopleStyleId; prompt: string }
  | { tool: "style"; style: GraphicStyleId };

/** Sub-bar names (aria-label and title are the same, as in the reference). */
export const GLOBAL_TOOLS: readonly { id: GlobalTool; label: string; title: string }[] = [
  { id: "time", label: "Cambiar el momento del día", title: "Momento del día" },
  { id: "atmosphere", label: "Cambiar la atmósfera", title: "Atmósfera" },
  { id: "environment", label: "Cambiar el entorno", title: "Entorno" },
  { id: "people", label: "Añadir personas", title: "Añadir personas" },
  { id: "style", label: "Cambiar de estilo", title: "Estilo" },
];

const find = <T extends { id: string }>(list: readonly T[], id: string | null | undefined): T | undefined => list.find((item) => item.id === id);

/**
 * The pending edit after a choice in `tool`. Choosing in another tool replaces what was pending
 * (the edits are exclusive); within Atmósfera, weather and season add up. Choosing the chosen
 * option again keeps it, as the reference does: «Restablecer ediciones» is what clears it.
 */
export function chooseGlobal(current: GlobalEdit | null, tool: GlobalTool, field: string, value: string): GlobalEdit | null {
  const same = current?.tool === tool ? current : null;
  switch (tool) {
    case "time": return find(TIMES, value) ? { tool, time: value as TimeId } : current;
    case "environment": return find(ENVIRONMENTS, value) ? { tool, environment: value as EnvironmentId } : current;
    case "style": return find(GRAPHIC_STYLES, value) ? { tool, style: value as GraphicStyleId } : current;
    case "atmosphere": {
      const base = same?.tool === "atmosphere" ? same : { tool, weather: null, season: null } as const;
      if (field === "weather" && find(WEATHERS, value)) return { ...base, weather: value as WeatherId };
      if (field === "season" && find(SEASONS, value)) return { ...base, season: value as SeasonId };
      return current;
    }
    case "people": {
      const base = same?.tool === "people" ? same : null;
      if (field === "crowd" && find(CROWDS, value)) return { tool, crowd: value as CrowdId, style: base?.style ?? "natural", prompt: base?.prompt ?? "" };
      if (field === "style" && base && find(PEOPLE_STYLES, value)) return { ...base, style: value as PeopleStyleId };
      return current;
    }
  }
}

/** The people edit with its own words, cut to the limit. Without a quantity there is nothing to write on. */
export function withPeoplePrompt(current: GlobalEdit | null, prompt: string): GlobalEdit | null {
  return current?.tool === "people" ? { ...current, prompt: prompt.slice(0, PEOPLE_PROMPT_LIMIT) } : current;
}

/** The value chosen for one field of a tool, or null (no default anywhere). */
export function globalValue(current: GlobalEdit | null, tool: GlobalTool, field?: string): string | null {
  if (!current || current.tool !== tool) return null;
  switch (current.tool) {
    case "time": return current.time;
    case "environment": return current.environment;
    case "style": return current.style;
    case "atmosphere": return field === "season" ? current.season : current.weather;
    case "people": return field === "style" ? current.style : current.crowd;
  }
}

/** True when the edit says something: Atmósfera needs a weather or a season. */
export function isApplicable(edit: GlobalEdit | null): edit is GlobalEdit {
  if (!edit) return false;
  return edit.tool !== "atmosphere" || edit.weather !== null || edit.season !== null;
}

/** Short Spanish label of the pending edit, for the tooltip of its button («Hora dorada», «Nublado · Otoño»). */
export function globalSummary(edit: GlobalEdit | null): string | undefined {
  if (!isApplicable(edit)) return undefined;
  switch (edit.tool) {
    case "time": return find(TIMES, edit.time)?.label;
    case "environment": return find(ENVIRONMENTS, edit.environment)?.label;
    case "style": return find(GRAPHIC_STYLES, edit.style)?.label;
    case "atmosphere": return [find(WEATHERS, edit.weather)?.label, find(SEASONS, edit.season)?.label].filter(Boolean).join(" · ");
    case "people": return [find(CROWDS, edit.crowd)?.label, find(PEOPLE_STYLES, edit.style)?.label].filter(Boolean).join(" · ");
  }
}

const KEEP = "Conserva la geometría, las proporciones, los materiales y el encuadre del modelo.";

/** Exact text sent to the image model for a global edit (Spanish, no product names). Empty when nothing is chosen. */
export function globalEditText(edit: GlobalEdit | null): string {
  if (!isApplicable(edit)) return "";
  let change = "";
  switch (edit.tool) {
    case "time": change = "Muestra la escena " + find(TIMES, edit.time)!.phrase + "."; break;
    case "environment": change = "Sitúa la edificación " + find(ENVIRONMENTS, edit.environment)!.phrase + "."; break;
    case "style": change = "Representa la imagen como " + find(GRAPHIC_STYLES, edit.style)!.phrase + "."; break;
    case "atmosphere": {
      const parts = [find(WEATHERS, edit.weather)?.phrase, find(SEASONS, edit.season)?.phrase].filter(Boolean);
      change = "Cambia la atmósfera de la escena: " + parts.join(" y ") + ".";
      break;
    }
    case "people": {
      const prompt = edit.prompt.trim().replace(/\s+/g, " ");
      change = "Añade " + find(CROWDS, edit.crowd)!.phrase + " a la escena, " + find(PEOPLE_STYLES, edit.style)!.phrase + ", a escala con el edificio."
        + (prompt ? " Indicaciones: " + (/[.!?…]$/.test(prompt) ? prompt : prompt + ".") : "");
      break;
    }
  }
  return change + " " + KEEP;
}
