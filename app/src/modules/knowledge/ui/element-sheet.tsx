"use client";
import {useState} from "react";
import Link from "next/link";
import type {ElementInfo} from "@/viewer/domain/viewer.port";
import {sheetAvailability,type SheetSource} from "../domain/element-identity";
import {Specifications} from "./specifications";
import {PieceAssistant} from "./piece-assistant";

const READY=new Set(["INDEXED","TEXT_ONLY","LEGACY"]);

/**
 * «Ficha técnica» of the selected piece in Propiedades, for any IFC class: the sheets linked to its GlobalId in the
 * saved version on screen and the questions about them. Without a verifiable identity it says why and what to do.
 * The caller keys it by version and GlobalId.
 */
export function ElementSheet({source,item,locate}:{source:SheetSource;item:ElementInfo;locate:()=>void}){
  const availability=sheetAvailability(source,item);
  const [ready,setReady]=useState(false);
  return <section className="element-sheet" aria-labelledby="element-sheet-title" data-sheet={availability.state}>
    <h3 id="element-sheet-title">Ficha técnica</h3>
    {availability.state==="ready" ? <>
      <Specifications scope={availability.scope} element={availability.element}
        onDocuments={documents=>setReady(documents.some(d=>READY.has(d.status)))}/>
      <PieceAssistant scope={availability.scope} element={availability.element} ready={ready} locate={locate}/>
    </> : <>
      <p>{availability.reason}</p>
      {availability.action && <p><Link className="panel-action" href={availability.action.href}>{availability.action.label}</Link></p>}
    </>}
  </section>;
}
