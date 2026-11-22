import {DoorEstimate} from "@/modules/design-change/ui/door-review";
import {sourceLabel,type EstimateLine,type ModelChange,type Price} from "../domain/model-change";

const money=new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP"});
const day=new Intl.DateTimeFormat("es-CO",{day:"numeric",month:"short",year:"numeric"});
const units:Record<string,[string,string]>={UNIT:["unidad","unidades"],M:["m","m"],M2:["m²","m²"],M3:["m³","m³"]};
export const formatDay=(iso:string|null)=>{const date=iso?new Date(iso):null;return date&&!Number.isNaN(date.getTime())?day.format(date).replace(/\./g,""):"";};
const amount=(value:number|null)=>value===null?"—":money.format(value);

function quantity(line:EstimateLine){
  if(line.quantity===null)return "Cantidad sin calcular";
  const [one,many]=units[line.unit??"UNIT"]??[line.unit??"",line.unit??""];
  return line.quantity.toLocaleString("es-CO")+" "+(line.quantity===1?one:many);
}
/** A price with its source and date, or why it is missing (the source is the engineer's, §6.2). */
function PriceText({price,missing}:{price:Price|null;missing:string}){
  return price?<>{money.format(price.amount)} por {units[price.unit]?.[0]??price.unit} · {price.source} · {price.date}
    {price.copiedFrom && <small> · copiado de la revisión anterior</small>}</>
    :<span className="change-missing">{missing}</span>;
}

/**
 * «Estimación del cambio» (§6.3, §7.2 section 5): one line per priced operation, each quantity with its source and each
 * price with its source and date. While the change is a draft or ready it is computed from the base's current prices;
 * once applied it is the estimate frozen at approval. A migrated change without a report keeps today's door estimate.
 */
export function ChangeEstimate({change,labels}:{change:ModelChange;labels:Record<string,string>}){
  const estimate=change.report?.estimate??null;
  if(!change.report && change.legacyReview)return <DoorEstimate review={change.legacyReview}/>;
  const frozen=change.status==="APPLIED"||change.status==="RESTORED";
  return <section aria-label="Estimación del cambio" className="change-estimate"><h3>Estimación en COP</h3>
    {!estimate && <p className="change-note">Previsualiza el cambio para estimar su costo con las cantidades del modelo.</p>}
    {estimate && frozen && <p className="change-note">Estimación congelada al aprobar{change.appliedAt?" el "+formatDay(change.appliedAt):""}.</p>}
    {estimate && !estimate.lines.length && <p>Sin costo directo. Si la propiedad cambia el producto, registra su precio por unidad.</p>}
    {estimate && !!estimate.lines.length && <ul className="change-lines">{estimate.lines.map((line,index)=><li key={(line.operation??"")+index}>
      <p><strong>{line.operation?labels[line.operation]??line.operation:"Línea "+(index+1)}</strong></p>
      <p>{line.kind==="ADDITIONAL_COST"?"Costo adicional":"Cantidad"} · {quantity(line)} · {sourceLabel(line.quantitySource)}
        {line.basis && <small className="change-basis"> · {line.basis}</small>}</p>
      {line.kind==="TYPE_CHANGE"?<>
        <p>Antes · <PriceText price={line.before} missing="Falta el precio del tipo actual."/></p>
        <p>Después · <PriceText price={line.after} missing="Falta el precio del tipo propuesto."/></p>
      </>:<p>Precio · <PriceText price={line.after??line.before} missing={"Falta el precio de "+(line.afterKey??line.beforeKey??"la clave")+"."}/></p>}
      <p>Diferencia de la línea · {line.difference===null?"sin calcular":amount(line.difference)}</p>
    </li>)}</ul>}
    {estimate && !!estimate.lines.length && (estimate.complete
      ?<p className="change-total"><strong>Diferencia estimada</strong> {money.format(estimate.total)}</p>
      :<p className="change-total change-missing">Faltan precios para estimar el total.</p>)}
  </section>;
}
