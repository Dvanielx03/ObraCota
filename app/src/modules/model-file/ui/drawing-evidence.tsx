import {useState} from "react";
import type {ElementInfo} from "@/viewer/domain/viewer.port";
import {Specifications} from "@/modules/knowledge/ui/specifications";

const decimal=new Intl.NumberFormat("es-CO",{maximumFractionDigits:6,useGrouping:false});
function xy(point:number[],offset=0){
  return "X "+decimal.format(point[offset])+" · Y "+decimal.format(point[offset+1]);
}
export function DrawingEvidence({item,units,scope}:{item:ElementInfo;units:string;scope?:{project:string;version:string}}){
  const [documents,showDocuments]=useState(false);
  const {annotation,dimension,cad}=item;
  const label=annotation?.raw??"";
  return <section aria-label="Información del plano">
    <dl>
      {dimension ? <>
        <dt>Puntos de la cota ({units})</dt><dd>{xy(dimension.endpoints)}<br/>{xy(dimension.endpoints,3)}</dd>
        <dt>Texto de cota del DWG</dt><dd>{label===" "?"Texto oculto en el plano":!label||label==="<>"?"Valor automático según el estilo CAD":label.replaceAll("<>","[medida de la cota]")}</dd>
      </> : annotation && <><dt>Inserción del texto ({units})</dt><dd>{xy(annotation.position)}</dd></>}
      {cad && <>
        <dt>Entidades por tipo CAD</dt><dd>{Object.entries(cad.types).map(([kind,n])=><div key={kind}>{kind} · {n}</div>)}</dd>
        <dt>Extensión de los trazos visibles ({units})</dt><dd>{xy(cad.min)}<br/>{xy(cad.max)}</dd>
      </>}
    </dl>
    <details onToggle={e=>showDocuments(e.currentTarget.open)}><summary>Documentos de la selección</summary>
      {documents && (scope ? <Specifications scope={scope} element={item.id} drawing initialQuery={annotation && !dimension?item.name.slice(0,160):""}/>
        : <p>Abre el plano desde Archivos y versiones para vincular una especificación a esta selección.</p>)}
    </details>
  </section>;
}
