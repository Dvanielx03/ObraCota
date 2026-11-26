"use client";
import Link from "next/link";
import type {ElementInfo} from "@/viewer/domain/viewer.port";
import {sheetAvailability,type SheetSource} from "../domain/element-identity";
import {Specifications} from "./specifications";

/**
 * «Ficha técnica» of the selected piece in Propiedades, for any IFC class: the sheets linked to its GlobalId in the
 * saved version on screen. Without a verifiable identity it says why and what to do.
 * The caller keys it by version and GlobalId.
 */
export function ElementSheet({source,item}:{source:SheetSource;item:ElementInfo}){
  const availability=sheetAvailability(source,item);
  return <section className="element-sheet" aria-labelledby="element-sheet-title" data-sheet={availability.state}>
    <h3 id="element-sheet-title">Ficha técnica</h3>
    {availability.state==="ready" ? <>
      <Specifications scope={availability.scope} element={availability.element}/>
      <Link className="panel-action" href={{pathname:"/proyectos/"+availability.scope.project+"/asistente",
        query:{version:availability.scope.version,element:availability.element}}}>Preguntar en el asistente del proyecto</Link>
    </> : <>
      <p>{availability.reason}</p>
      {availability.action && <p><Link className="panel-action" href={availability.action.href}>{availability.action.label}</Link></p>}
    </>}
  </section>;
}
