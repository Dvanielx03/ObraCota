/**
 * Entering the viewer from the project panel always shows the preparing screen for at least
 * this long, even when the model is already loaded: a steady, unhurried start reads as
 * reliable, and it gives the scene time to settle (camera, materials, floating controls).
 * When loading takes longer, the same screen simply stays until the model is ready.
 */
export const ENTRY_HOLD_MS = 5000;

/** Text shown once the model is loaded but the minimum time has not passed yet. */
export const ENTRY_SETTLING_PHASE = "Ajustando el entorno…";

/** Milliseconds still to wait, never negative. */
export function remainingHold(startedAt: number, now: number, minimum = ENTRY_HOLD_MS): number {
  return Math.max(0, minimum - Math.max(0, now - startedAt));
}
