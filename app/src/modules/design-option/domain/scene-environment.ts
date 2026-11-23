import type { ExteriorFinish, ExteriorMaterial, ExteriorTone, SceneEnvironment } from "@/viewer/domain/viewer.port";
import { CROWDS, ENVIRONMENTS, GRAPHIC_STYLES, PEOPLE_STYLES, SEASONS, TIMES, WEATHERS, type EnvironmentId, type GraphicStyleId, type SeasonId, type TimeId, type WeatherId } from "./edit-globals";

/**
 * «Recorrer esta escena en 3D»: reads the scene that a request describes (the text Escena composes, a Renderizar
 * request or the request kept with a batch of options) and turns it into what the 3D viewer can build. The
 * requests are Spanish text, so the scene is read back from their words: the exact phrases of Escena first,
 * then plain words a person would write («de noche», «junto al lago»).
 */

// The viewer's scene uses the same ids as Escena; this fails to compile if one of them drifts.
const SAME_IDS: { time: TimeId; weather: WeatherId; season: SeasonId; surroundings: EnvironmentId; style: GraphicStyleId } extends
  { [K in keyof SceneEnvironment]: NonNullable<SceneEnvironment[K]> } ? true : never = true;
void SAME_IDS;

type Rule<Id extends string> = readonly [Id, RegExp];
const TIME_RULES: readonly Rule<TimeId>[] = [
  ["golden", /hora dorada|golden hour/], ["blue", /hora azul|blue hour/], ["sunrise", /amanecer|alba\b|sunrise/],
  ["sunset", /atardecer|puesta de sol|ocaso|sunset/], ["noon", /mediod[ií]a|sol alto|\bnoon\b/], ["night", /\bnoche\b|nocturn|\bnight\b/],
  ["morning", /ma[ñn]ana|morning/], ["afternoon", /\btarde\b|afternoon/],
];
const WEATHER_RULES: readonly Rule<WeatherId>[] = [
  ["fog", /niebla|neblin|bruma|\bfog/], ["rain", /lluvi|llovi|\brain/], ["snow", /\bniev|nevad|\bsnow/],
  ["overcast", /cubierto|nublado|overcast/], ["partly", /nubes y claros|parcialmente nublado/], ["clear", /despejad|soleado|\bclear sky/],
];
const SEASON_RULES: readonly Rule<SeasonId>[] = [["spring", /primavera/], ["summer", /verano/], ["autumn", /oto[ñn]o/], ["winter", /invierno/]];
const SURROUNDING_RULES: readonly Rule<EnvironmentId>[] = [
  ["none", /fondo neutro|sin entorno/], ["forest", /bosque|forest/], ["lake", /\blago\b|laguna/], ["river", /\br[ií]o\b|ribera/],
  ["coast", /costa|playa|\bmar\b|litoral/], ["desert", /des[ée]rtic|desierto/], ["tropical", /tropical|selva/],
  ["residential", /residencial|barrio|casas vecinas/], ["garden", /jard[ií]n/], ["mountain", /monta[ñn]/],
  ["city", /ciudad|urban|otros edificios/], ["countryside", /\bcampo\b|rural|terreno abierto|prader/],
];
const STYLE_RULES: readonly Rule<GraphicStyleId>[] = [
  ["white-model", /maqueta blanca/], ["model", /maqueta/], ["flat", /colores? planos?/], ["watercolor", /acuarela/], ["marker", /rotulador/],
  ["pastel", /\bpastel\b/], ["collage", /collage/], ["pencil", /boceto|l[aá]piz/], ["ink", /tinta/], ["illustration", /ilustraci/],
  ["photo", /fotorrealista|fotograf/],
];
const FINISH_WORDS: Record<string, ExteriorMaterial> = { madera: "wood", "concreto a la vista": "concrete", concreto: "concrete", acero: "steel", vidrio: "glass", piedra: "stone", pintura: "paint" };
const TONE_WORDS: Record<string, ExteriorTone> = { claro: "light", medio: "medium", oscuro: "dark" };
const CROWD_COUNTS = { none: 0, one: 1, couple: 2, few: 4, crowded: 12 } as const;

function first<Id extends string>(text: string, rules: readonly Rule<Id>[]): Id | null {
  return rules.find(([, rule]) => rule.test(text))?.[0] ?? null;
}

/** The phrase of an Escena option, when the request carries it word for word. */
function exact<Id extends string>(text: string, options: readonly { id: Id; phrase: string }[]): Id | null {
  return options.find((option) => text.includes(option.phrase.toLowerCase()))?.id ?? null;
}

export interface RequestScene { environment: SceneEnvironment; finish: ExteriorFinish | null }

/**
 * The scene a request text describes. What it does not say gets a calm default (afternoon, clear sky, open
 * countryside), so a request about a finish alone can still be walked around.
 */
export function readScene(request: string): RequestScene {
  const text = request.toLowerCase();
  // «Conservar … el entorno» is a safeguard of Renderizar, not a setting: it is left out before reading.
  const scene = text.replace(/conservar[^.]*\./g, " ").replace(/conserva la geometr[^.]*\./g, " ");
  const time = exact(scene, TIMES) ?? first(scene, TIME_RULES);
  const weather = exact(scene, WEATHERS) ?? first(scene, WEATHER_RULES);
  const season = exact(scene, SEASONS) ?? first(scene, SEASON_RULES);
  const surroundings = exact(scene, ENVIRONMENTS) ?? first(scene, SURROUNDING_RULES);
  const style = exact(scene, GRAPHIC_STYLES) ?? first(scene, STYLE_RULES);
  const crowd = /(?:no incluyas|sin) personas/.test(scene) ? "none" : exact(scene, CROWDS);
  const count = CROWD_COUNTS[crowd ?? "none"];
  const finishMatch = /acabado:\s*([a-záéíóúñ ]+?)(?:\s+en tono\s+(claro|medio|oscuro))?\./.exec(text);
  const toneMatch = /tono:\s*(claro|medio|oscuro)/.exec(text);
  const material = finishMatch ? FINISH_WORDS[finishMatch[1].trim()] ?? null : null;
  const tone = finishMatch?.[2] ? TONE_WORDS[finishMatch[2]] : toneMatch ? TONE_WORDS[toneMatch[1]] : null;
  return {
    environment: { time: time ?? "afternoon", weather: weather ?? "clear", season, surroundings: surroundings ?? "countryside", style,
      ...(count > 0 && { people: { count, silhouette: exact(scene, PEOPLE_STYLES) === "silhouette" } }) },
    finish: material ? { material, tone: tone ?? "medium", light: null } : null,
  };
}

const label = <Id extends string>(options: readonly { id: Id; label: string }[], id: Id | null) => options.find((option) => option.id === id)?.label;

/** «Tarde · Despejado · Ciudad · Fotorrealista»: the scene in the words of Escena. */
export function environmentLabel(environment: SceneEnvironment): string {
  return [label(TIMES, environment.time), label(WEATHERS, environment.weather), label(SEASONS, environment.season),
    label(ENVIRONMENTS, environment.surroundings), label(GRAPHIC_STYLES, environment.style)].filter(Boolean).join(" · ");
}

/** The scene as plain Spanish for the panorama request (the server adds the 360° instructions). */
export function environmentText(environment: SceneEnvironment): string {
  const phrase = <Id extends string>(options: readonly { id: Id; phrase: string }[], id: Id | null) => options.find((option) => option.id === id)?.phrase;
  return [phrase(TIMES, environment.time), phrase(WEATHERS, environment.weather), phrase(SEASONS, environment.season),
    phrase(ENVIRONMENTS, environment.surroundings), phrase(GRAPHIC_STYLES, environment.style)].filter(Boolean).join("; ");
}
