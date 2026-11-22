import { useCallback } from "react";
import { GuidedPointer, type Stop } from "./visual-tour";

/** First-visit tour: the product idea in three real controls, then where the full guides live. */
export type QuickStep = "select" | "options" | "walk" | "done";
export const QUICK_STEPS: readonly QuickStep[] = ["select", "options", "walk", "done"];

function point(selector: string, title: string, action: string): Stop | null {
  const node = document.querySelector<HTMLElement>(selector);
  return node && node.getClientRects().length ? { node, title, action } : null;
}

function target(step: QuickStep): Stop | null {
  if (step === "select") {
    if (document.getElementById("explorer")?.hidden)
      return point(".scene-explorer", "Abre el explorador", "Despliega el panel para ver las piezas del modelo.")
        ?? point(".stagebar > .explorer-toggle", "Abre el explorador", "Despliega el panel para ver las piezas del modelo.");
    if (document.getElementById("pane-reading")?.hidden)
      return point("#tab-reading", "Vuelve a Lectura", "Ahí está la lista de piezas del modelo.");
    return (
      point(".entry", "1 de 3 · Elige una pieza", "Pulsa una pieza de la lista o tócala en el modelo. Verás su clase, su nivel y su material.") ??
      point(".level", "1 de 3 · Abre un grupo", "Despliega un nivel para elegir una de sus piezas.")
    );
  }
  if (step === "options")
    return point(
      '[data-prisma-tour="open"]',
      "2 de 3 · Edita la pieza",
      "Con Editar marcas piezas o zonas del modelo y describes el cambio; antes de enviarlo ves su costo. Púlsalo para abrirlo.",
    );
  if (step === "walk")
    return point(".walk-trigger:not([aria-disabled=true])", "3 de 3 · Recórrelo por dentro", "Camina por el modelo en primera persona para anticipar problemas antes de la obra.");
  // The sample cannot be walked: say where that control appears instead of skipping it silently.
  const walkable = !!document.querySelector(".walk-trigger:not([aria-disabled=true])");
  return point(
    ".help-icon",
    "Listo: ya conoces lo esencial",
    (walkable ? "" : "El recorrido en primera persona aparece al abrir un IFC guardado en uno de tus proyectos. ") +
      "Desde este botón puedes repetir esta guía o practicar una revisión de entrega y la edición de piezas con Editar.",
  );
}

export function QuickTour({ step, paused, onPause, onBack, onRestart, onExit }: {
  step: QuickStep; paused: boolean; onPause: () => void; onBack?: () => void; onRestart: () => void; onExit: () => void;
}) {
  const resolve = useCallback(() => target(step), [step]);
  return (
    <GuidedPointer resolve={resolve} id="quick-instruction" label="Recorrido rápido" paused={paused} pause={onPause}
      back={onBack} restart={onRestart} exit={onExit} completed={step === "done"} />
  );
}
