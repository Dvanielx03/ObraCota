import Link from "next/link";

export type DoorType={id:string;name:string;width:number;height:number;compatible:boolean};
export type Door={element:string;name:string;typeId:string|null;typeName:string|null;width:number|null;height:number|null;options:DoorType[]};
export type Price={typeId:string;amount:number;source:string;date:string};
export type Review={door:Door;proposal:DoorType;findings:{rule:string;status:"WARNING"|"OK"|"UNKNOWN";explanation:string;source:string;element:string}[];
  estimate:{beforeQuantity:number;afterQuantity:number;before:Price|null;after:Price|null;difference:number|null}};
export type Change={id:string;version:string;description:string;review:Review;applied:string|null;restored:string|null;picture:boolean};
export const endpoints=(project:string)=>"projects/"+project+"/design-changes";
const titles:Record<string,string>={HOST_LOAD_BEARING:"Anfitrión portante",OPENING_SIZE:"Medidas del hueco",MINIMUM_NOMINAL_WIDTH:"Ancho mínimo del proyecto"};
const status={WARNING:"Aviso",OK:"Comprobado",UNKNOWN:"Sin evaluar"};
const money=new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP"});
const dimensions=(w:number|null,h:number|null)=>w===null||h===null?"Medida sin verificar":Math.round(w*1000)+" × "+Math.round(h*1000)+" mm";

export function DoorEstimate({review}:{review:Review}){
  const {estimate,door,proposal}=review;
  return <section aria-label="Estimación del cambio"><h3>Estimación en COP</h3>
    <ul><li>Antes · {door.typeName} · {estimate.beforeQuantity} unidad. {estimate.before?
      <>{money.format(estimate.before.amount)} por unidad · {estimate.before.source} · {estimate.before.date}</>:"Falta el precio del tipo actual."}</li>
    <li>Después · {proposal.name} · {estimate.afterQuantity} unidad. {estimate.after?
      <>{money.format(estimate.after.amount)} por unidad · {estimate.after.source} · {estimate.after.date}</>:"Falta el precio del tipo propuesto."}</li></ul>
    {estimate.difference!==null && <p><strong>Diferencia estimada</strong> {money.format(estimate.difference)}</p>}
  </section>;
}

export function DoorReview({review,project,version}:{review:Review;project:string;version:string}){
  return <><p>Actual · {dimensions(review.door.width,review.door.height)}<br/>Propuesta · {dimensions(review.proposal.width,review.proposal.height)}</p>
    <section aria-label="Avisos de diseño"><h3>Avisos de diseño</h3>
      {review.findings.map(item=><details key={item.rule} open={item.status==="WARNING"}>
        <summary>{status[item.status]} · {titles[item.rule]}</summary>
        <p>{item.explanation}</p><small>{item.source}</small>
        <p><Link href={"/proyectos/"+project+"/visor/"+version+"?element="+encodeURIComponent(item.element)}>Localizar pieza</Link></p>
      </details>)}
    </section><DoorEstimate review={review}/></>;
}
