/**
 * Largest original the IFC engine verifies a change of properties or materials on (ENGINE_DATA_PREVIEW_MAX_BYTES in
 * ifc-engine/obracota_engine/settings.py): entity by entity, without meshing the model, up to the upload limit
 * (256 MiB). The agent («Proponer cambio al modelo») and «Guardar en el modelo» only draft those, so they stay on for any
 * IFC the project can store: Schependomlaan (65 MB) or ReStage (190 MB) included.
 */
export const MODEL_CHANGE_MAX_BYTES = 268_435_456;

/**
 * Largest original the engine verifies a change of geometry on (ENGINE_PREVIEW_MAX_BYTES: 32 MiB keeps a cold IfcDiff
 * preview near 67 s). Above it the engine refuses a change of type with 422 MODEL_TOO_LARGE, and the agent refuses to
 * draft one, with the same sentence: «El modelo pesa 65 MB: el motor verifica cambios de geometría en el IFC, como el
 * cambio de tipo, hasta 32 MiB. Las propiedades y los materiales sí se cambian en este modelo.»
 */
export const GEOMETRY_CHANGE_MAX_BYTES = 33_554_432;

/** Why a file of `bytes` cannot take model changes, or undefined when it can (0 = unknown, such as the sample). */
export function changeLimitReason(bytes: number): string | undefined {
  if (!bytes || bytes <= MODEL_CHANGE_MAX_BYTES) return undefined;
  return "El modelo pesa " + Math.round(bytes / 1e6) + " MB: el motor verifica cambios en el IFC hasta "
    + MODEL_CHANGE_MAX_BYTES / 1_048_576 + " MiB. La vista previa sí se ve aquí";
}
