import type { ExteriorMaterial, ExteriorTone } from "@/viewer/domain/viewer.port";
import { FINISHES, TONES } from "./option-request";

/**
 * The IFC material a Renderizar finish becomes when it is saved in the model (H2 material): its name («Piedra ·
 * claro»), its category (the chip's label) and an approximate colour of the tone, for the surface style other
 * viewers show. The colours follow the local preview (`exterior-finish.ts`): they are a reference, not a product.
 */
const COLORS: Record<ExteriorMaterial, Record<ExteriorTone, string>> = {
  stone: { light: "#cdc3b0", medium: "#a39a8a", dark: "#5e5850" },
  wood: { light: "#c9a27a", medium: "#9a6b43", dark: "#5b3a22" },
  concrete: { light: "#c8c6c0", medium: "#9e9c97", dark: "#6b6a66" },
  steel: { light: "#b8bcc0", medium: "#8a8f94", dark: "#4d5257" },
  glass: { light: "#cfe6f0", medium: "#8fb8cc", dark: "#3d5866" },
  paint: { light: "#f2eee6", medium: "#b9b2a4", dark: "#4f4c47" },
};

export interface FinishMaterial { material: string; category: string; color: string }

export function finishMaterial(material: ExteriorMaterial, tone: ExteriorTone | null): FinishMaterial {
  const shade = tone ?? "medium";
  const category = FINISHES.find((item) => item.id === material)?.label ?? material;
  const toneLabel = (TONES.find((item) => item.id === shade)?.label ?? shade).toLowerCase();
  return { material: category + " · " + toneLabel, category, color: COLORS[material][shade] };
}
