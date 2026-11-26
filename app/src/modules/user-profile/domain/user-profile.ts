/** Answers given during the first-run onboarding. Everything here is plain data. */
export const ROLES = [
  { id: "site-engineer", label: "Ingeniera o ingeniero constructor" },
  { id: "architect", label: "Arquitecta o arquitecto" },
  { id: "designer", label: "Diseñadora o diseñador" },
  { id: "site-resident", label: "Residente de obra" },
  { id: "other", label: "Otro" },
] as const;

export const FIRST_REVIEWS = [
  { id: "model", label: "Modelo 3D", hint: "Un IFC: seleccionas piezas, propones cambios y lo recorres." },
  { id: "drawing", label: "Plano", hint: "Un DWG: buscas textos, ubicas detalles y dejas observaciones." },
] as const;

export const STARTS = [
  { id: "sample", label: "Proyecto de muestra", hint: "ReStage, un edificio real publicado como dato abierto. Es un modelo 3D." },
  { id: "own", label: "Mi archivo", hint: "Creas un proyecto y subes tu IFC, DWG, RVT, FBX u OBJ." },
] as const;

export type Role = (typeof ROLES)[number]["id"];
export type FirstReview = (typeof FIRST_REVIEWS)[number]["id"];
export type Start = (typeof STARTS)[number]["id"];

export type OnboardingAnswers = { role: Role | null; firstReview: FirstReview | null; start: Start | null };

export type UserProfile = OnboardingAnswers & {
  /** ISO date of the moment the onboarding was finished or skipped. */
  completedAt: string;
  skipped: boolean;
};

export const EMPTY_ANSWERS: OnboardingAnswers = { role: null, firstReview: null, start: null };
export const STEP_COUNT = 3;

/** Where the person lands once the onboarding ends. */
export function destinationFor(answers: OnboardingAnswers): string {
  // The sample opens with the quick tour already running on the real controls.
  // «Mi archivo» creates the first project and opens its upload page.
  return answers.start === "sample" ? "/proyectos/restage/visor?guia=rapida" : answers.start === "own" ? "/proyectos?nuevo=1" : "/proyectos";
}

const ids = <T extends readonly { id: string }[]>(list: T) => list.map((item) => item.id);

/** Accepts only a profile whose values are still part of the current catalog. */
export function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  const optional = (field: unknown, allowed: string[]) => field === null || (typeof field === "string" && allowed.includes(field));
  return (
    typeof p.completedAt === "string" &&
    typeof p.skipped === "boolean" &&
    optional(p.role, ids(ROLES)) &&
    optional(p.firstReview, ids(FIRST_REVIEWS)) &&
    optional(p.start, ids(STARTS))
  );
}
