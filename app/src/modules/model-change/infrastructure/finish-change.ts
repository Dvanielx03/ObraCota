import type { ModelChange } from "../domain/model-change";
import { modelChangeRepository } from "./model-change-http";

/** The largest list of pieces one `ifc.set_material` takes (the engine and the backend refuse more). */
export const FINISH_PIECES_LIMIT = 500;

/**
 * «Guardar en el modelo» (H2 material): a draft change with one `ifc.set_material` for `elements` (GlobalIds), previewed
 * by the engine. When the preview passes it is sent, so the owner finds it «Lista para aprobar» on its card; when it
 * does not, it stays a draft with the engine's report, which the card explains. Nothing is applied here.
 */
export async function saveFinishChange(project: string, version: string, finish: { material: string; category: string; color: string },
  elements: string[]): Promise<ModelChange> {
  if (!elements.length) throw new Error("No hay piezas exteriores con GlobalId para guardar el acabado.");
  if (elements.length > FINISH_PIECES_LIMIT) throw new Error("Hay más de " + FINISH_PIECES_LIMIT + " piezas exteriores: el cambio no cabe en una operación.");
  const pieces = elements.length === 1 ? "1 pieza exterior" : elements.length + " piezas exteriores";
  const draft = await modelChangeRepository.create(project, version, "Acabado exterior «" + finish.material + "» en " + pieces + ", elegido en Renderizar.");
  await modelChangeRepository.addOperation(project, draft.id, { op: "ifc.set_material", element: elements[0], elements, ...finish });
  const previewed = await modelChangeRepository.preview(project, draft.id);
  if (!previewed.report?.ok || !previewed.actions.submit) return previewed;
  return modelChangeRepository.submit(project, draft.id);
}
