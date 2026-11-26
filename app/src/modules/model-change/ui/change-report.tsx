import Link from "next/link";
import {DoorReview} from "@/modules/design-change/ui/door-review";
import {affectedGuids,diffCounts,flagLabels,ifcText,reportFindings,shortGuid,type DiffEntry,type ModelChange} from "../domain/model-change";

const findingTitles:Record<string,string>={HOST_LOAD_BEARING:"Anfitrión portante",OPENING_SIZE:"Medidas del hueco",
  MINIMUM_NOMINAL_WIDTH:"Ancho mínimo del proyecto",ASSIGN_TYPE_CLEARED_ATTRIBUTES:"Atributos que borra el cambio de tipo",
  PSET_UNSHARED:"Conjunto de propiedades separado",PSET_OVERRIDES_TYPE:"La pieza tendrá su propio valor",
  TYPE_SCOPE_AFFECTS:"El cambio alcanza a todas las piezas del tipo",QTO_MISMATCH:"Cantidad del IFC distinta de la geometría"};
const findingStatus={WARNING:"Aviso",OK:"Comprobado",UNKNOWN:"Sin evaluar"};
const layerStatus={PASS:"Comprobado",FAIL:"Falla",NOT_RUN:"No se ejecutó"};
const unexpectedReasons:Record<string,string>={UNDECLARED:"no lo declara ninguna operación",FLAG_NOT_ALLOWED:"cambió algo que la operación no declara",
  ADDED:"elemento añadido",DELETED:"elemento eliminado",OPENING_CHANGED:"hueco modificado",OPENING_ADDED:"hueco añadido",OPENING_DELETED:"hueco eliminado"};
const LEGACY="Registrado antes de la vista previa verificada. Previsualízalo para enviarlo a aprobación.";

const visor=(project:string,version:string,guid:string)=>"/proyectos/"+project+"/visor/"+version+"?element="+encodeURIComponent(guid);
export const proposalHref=(change:Pick<ModelChange,"project"|"id">,guid?:string)=>
  "/proyectos/"+change.project+"/cambios/"+change.id+"/vista"+(guid?"?element="+encodeURIComponent(guid):"");
const entryName=(entry:Pick<DiffEntry,"name"|"guid">)=>ifcText(entry.name)??"Sin nombre";
const diffDrawing=(change:ModelChange)=>!!change.report?.diff?.drawing||change.format==="DWG"||change.format==="DXF";

/** Section 2: the recipe in words, each operation with what the engine said about it. */
export function ChangeRecipe({change,labels}:{change:ModelChange;labels:Record<string,string>}){
  const results=new Map(change.report?.operations.map(result=>[result.id,result])??[]);
  return <section aria-label="Receta"><h3>Receta</h3>
    {!change.recipe.operations.length?<p className="change-note">Sin operaciones todavía.</p>:
    <ol className="change-recipe">{change.recipe.operations.map((operation,index)=>{
      const result=results.get(operation.id);
      return <li key={operation.id}>{index+1} · {labels[operation.id]}
        {result && !result.ok && <span className="change-fail"> · Rechazada{result.errors.length?": "+result.errors.map(error=>error.detail??error.code).join(" "):""}</span>}
      </li>;})}</ol>}
  </section>;
}

/** Section 3: the pieces the change touches, to locate them in the base or in the proposal. */
export function ChangeAffected({change}:{change:ModelChange}){
  const named=new Map(change.report?.affected?.map(item=>[item.guid,item])??[]);
  const guids=affectedGuids(change);
  if(!guids.length)return null;
  return <section aria-label="Elementos afectados"><h3>Elementos afectados</h3>
    <ul className="change-list">{guids.map(guid=>{const item=named.get(guid);
      return <li key={guid}><span>{item?item.class+" · "+(ifcText(item.name)??"Sin nombre"):"Pieza"} · <code title={guid}>{shortGuid(guid)}</code></span>
        <span className="change-links"><Link href={visor(change.project,change.baseVersion,guid)}>Localizar en la base</Link>
          {change.preview.available && change.reportCurrent && change.report?.ok && <Link href={proposalHref(change,guid)}>Ver en la propuesta</Link>}</span>
      </li>;})}</ul>
  </section>;
}

/** Section 4: design notices, open when one is a warning, as the door review shows them today. */
export function ChangeFindings({change}:{change:ModelChange}){
  if(!change.report)return change.legacyReview?<DoorReview review={change.legacyReview} project={change.project} version={change.baseVersion}/>
    :<section aria-label="Avisos de diseño"><h3>Avisos de diseño</h3><p className="change-note">Previsualiza el cambio para evaluar sus avisos.</p></section>;
  const findings=reportFindings(change.report);
  return <section aria-label="Avisos de diseño"><h3>Avisos de diseño</h3>
    {!findings.length && <p className="change-note">El motor no devolvió avisos para esta receta.</p>}
    {findings.map(item=><details key={item.rule+(item.element??"")} open={item.status==="WARNING"}>
      <summary>{findingStatus[item.status]??item.status} · {findingTitles[item.rule]??item.rule}</summary>
      {item.explanation && <p>{item.explanation}</p>}{item.source && <small>{item.source}</small>}
      {item.element && <p><Link href={visor(change.project,change.baseVersion,item.element)}>Localizar pieza</Link></p>}
    </details>)}
  </section>;
}

function DiffList({entries}:{entries:DiffEntry[]}){
  return <ul className="change-list">{entries.map(entry=><li key={entry.guid}>
    <span>{entry.class} · {entryName(entry)} · <code title={entry.guid}>{shortGuid(entry.guid)}</code></span>
    {!!entry.flags?.length && <span className="change-flags">{flagLabels(entry).join(" · ")}</span>}
  </li>)}</ul>;
}

/** Section 6: what IfcDiff found against the base; anything out of the declared scope in the error colour. */
export function ChangeDiff({change}:{change:ModelChange}){
  const diff=change.report?.diff;
  return <section aria-label="Diferencias con la base"><h3>Diferencias con la base</h3>
    {!change.report?<p className="change-note">{change.legacyReview?LEGACY:"Previsualiza el cambio para compararlo con la base."}</p>
    :!diff?<p className="change-note">Sin comparación: una operación no superó sus comprobaciones y no se escribió la revisión.</p>:<>
      {(()=>{const counts=diffCounts(diff);return <p>{counts.changed} cambiados · {counts.added} añadidos · {counts.deleted} eliminados{diff.truncated?" · lista recortada":""}</p>;})()}
      {!!diff.changed.length && <DiffList entries={diff.changed}/>}
      {!!diff.added.length && <><p>Añadidos</p><DiffList entries={diff.added}/></>}
      {!!diff.deleted.length && <><p>Eliminados</p><DiffList entries={diff.deleted}/></>}
      {!!diff.unexpected.length && <div className="change-unexpected"><p><strong>Fuera del alcance declarado</strong></p>
        <ul className="change-list">{diff.unexpected.map(entry=><li key={entry.guid+(entry.reason??"")}>
          <span>{entry.class} · {entryName(entry)} · <code title={entry.guid}>{shortGuid(entry.guid)}</code></span>
          <span className="change-flags">{unexpectedReasons[entry.reason??""]??entry.reason}{entry.flags?.length?" · "+flagLabels(entry).join(" · "):""}</span>
        </li>)}</ul></div>}
      {!diff.drawing && (()=>{const openings=diff.openings,list=[...openings.changed,...openings.added,...openings.deleted,...openings.unfilled];
        return list.length?<><p>Huecos</p><DiffList entries={list}/></>:<p>Huecos · Sin cambios</p>;})()}
      {diff.drawing && <p className="change-note">Comparación por handle de las entidades del espacio modelo, entre el DXF de la base y la revisión DXF.</p>}
      {diff.geometry && <p className="change-note">IfcDiff comparó la geometría de {diff.geometry.elements_compared} de {diff.geometry.elements} elementos
        y de {diff.geometry.openings_compared} de {diff.geometry.openings} huecos; el resto se comparó por atributos y relaciones.</p>}
    </>}
  </section>;
}

/** Section 7: layers 1, 2 and 6 of the file validation, and the skipped ones with their reason. */
export function ChangeValidation({change}:{change:ModelChange}){
  const validation=change.report?.validation;
  return <section aria-label="Validación del archivo"><h3>Validación del archivo</h3>
    {!change.report?<p className="change-note">{change.legacyReview?LEGACY:"Previsualiza el cambio para validar el archivo."}</p>
    :!validation?<p className="change-note">El motor no devolvió la validación.</p>:<>
      <ul className="change-list">{validation.layers.map(layer=><li key={layer.layer} data-status={layer.status}>
        <span>{layer.name}{layer.layer===2 && layer.status!=="NOT_RUN"?(diffDrawing(change)?": "+(layer.new_issues?.length??0)+" diferencias de lectura"
          :": "+(layer.new_issues?.length??0)+" problemas nuevos (la base tiene "+(layer.base_issues??0)+")"):""}</span>
        <span className={layer.status==="FAIL"?"change-fail":undefined}>{layerStatus[layer.status]??layer.status}{layer.reason?" · "+layer.reason:""}</span>
      </li>)}</ul>
      {!!validation.skipped.length && <details><summary>Capas omitidas ({validation.skipped.length})</summary>
        <ul>{validation.skipped.map(item=><li key={item.layer}>Capa {item.layer} · {item.reason}</li>)}</ul></details>}
    </>}
  </section>;
}
