import type { ModelVersion, VersionRepository } from "../domain/model-version";

/** Lowercase hexadecimal SHA-256 of `bytes` (Web Crypto). */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The original of a published version, checked before it is handed over: its SHA-256 must be the one the server
 * recorded when the version was saved (H7 · «El archivo descargado tiene el SHA-256 de la versión publicada»). A
 * different hash throws instead of saving a file that is not the revision.
 */
export async function verifiedOriginal(repository: VersionRepository, project: string, version: string, signal: AbortSignal)
  : Promise<{ file: File; version: ModelVersion }> {
  const published = await repository.get(project, version, signal);
  const file = await repository.open(project, version, signal);
  const hash = await sha256Hex(await file.arrayBuffer());
  if (hash !== published.sha256.toLowerCase())
    throw new Error("La huella SHA-256 del archivo descargado no coincide con la de la versión publicada. Vuelve a intentarlo.");
  return { file, version: published };
}
