import type {ElementInfo} from "@/viewer/domain/viewer.port";

/** A saved version of a project, the only place a sheet can be linked to. */
export type SheetScope = {project:string;version:string};

/**
 * Where the open model came from, as far as technical sheets are concerned. A sheet is linked to the GlobalId of an
 * IFC element of a saved version, so it never moves to another piece or revision.
 */
export type SheetSource =
  | {kind:"saved";scope:SheetScope}
  /** A saved version in a format without IFC identities (FBX, OBJ, 3D DWG, a translated RVT preview). */
  | {kind:"saved-other";format:string}
  /** The ReStage sample, a GLB made for viewing. */
  | {kind:"sample"}
  /** A file opened from the computer: nothing is on the server yet. */
  | {kind:"local";format:string;uploadHref:string}
  /** An unpublished proposal shown over its base. */
  | {kind:"proposal"};

export type SheetAvailability =
  | {state:"ready";scope:SheetScope;element:string}
  | {state:"local"|"sample"|"identity"|"format"|"proposal";reason:string;action?:{href:string;label:string}};

/** IFC GlobalId: 22 characters of the IFC base-64 alphabet; the first one encodes two bits (0–3). */
export function isIfcGlobalId(value: string | undefined): value is string {
  return !!value && /^[0-3][0-9A-Za-z_$]{21}$/.test(value);
}

const isIfc = (format: string) => /^IFC/i.test(format);

/** Whether the selected piece can take a sheet and, when not, why and what to do next. */
export function sheetAvailability(source: SheetSource, item: ElementInfo): SheetAvailability {
  switch (source.kind) {
    case "sample": return {state:"sample",
      reason:"Este ReStage es una muestra en GLB para recorrer: sus piezas no conservan la identidad del IFC original, así que no admiten fichas. Sube el IFC original de ReStage a un proyecto y ábrelo como versión guardada para vincularlas.",
      action:{href:"/proyectos",label:"Ir a mis proyectos"}};
    case "proposal": return {state:"proposal",
      reason:"Es una vista previa sin publicar. Las fichas se vinculan a versiones guardadas: ábrela desde la versión publicada."};
    case "local": return isIfc(source.format)
      ? {state:"local",reason:"Guarda este IFC en un proyecto para vincular fichas. Abierto desde tu equipo, el modelo aún no tiene una versión en el servidor a la que ligar el PDF.",
        action:{href:source.uploadHref,label:"Subir este IFC a un proyecto"}}
      : {state:"format",reason:"Las fichas se vinculan a piezas IFC por su GlobalId. Este archivo ("+source.format.split(" ")[0]+") se abrió desde tu equipo y no declara esa identidad."};
    case "saved-other": return {state:"format",
      reason:"Las fichas se vinculan a piezas IFC por su GlobalId. Esta versión es "+source.format.split(" ")[0]+" y no declara esa identidad: sube su versión IFC para vincularlas."};
    case "saved": return isIfcGlobalId(item.guid)
      ? {state:"ready",scope:source.scope,element:item.guid}
      : {state:"identity",reason:"Esta pieza no tiene un GlobalId IFC verificable. Las fichas se vinculan por GlobalId para que no pasen a otra pieza ni a otra revisión."};
  }
}
