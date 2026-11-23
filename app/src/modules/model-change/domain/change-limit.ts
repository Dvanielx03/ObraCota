/**
 * Largest original the IFC engine previews and verifies a model change on (ENGINE_PREVIEW_MAX_BYTES in
 * ifc-engine/obracota_engine/settings.py: 32 MiB keeps a cold preview near 67 s and 2.1 GB of memory). Above it the
 * engine answers 422 MODEL_TOO_LARGE, so the agent and «Guardar en el modelo» say so before anything is sent.
 */
export const MODEL_CHANGE_MAX_BYTES = 33_554_432;

/** Why a file of `bytes` cannot take model changes, or undefined when it can (0 = unknown, such as the sample). */
export function changeLimitReason(bytes: number): string | undefined {
  if (!bytes || bytes <= MODEL_CHANGE_MAX_BYTES) return undefined;
  return "El modelo pesa " + Math.round(bytes / 1e6) + " MB: el motor verifica cambios en el IFC hasta "
    + MODEL_CHANGE_MAX_BYTES / 1_048_576 + " MiB. La vista previa sí se ve aquí";
}
