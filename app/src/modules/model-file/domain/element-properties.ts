/** IFC text as the engine sends it: wrapped as data (`{"text": …}`), never as a bare string (§4.4). */
export type IfcText={text:string};
type Scalar=IfcText|number|boolean|null;
/** One property as the engine reads it: its value as stored and the IFC type of that value (§4.4, §7.6). */
export type PropertyEntry={name:string;value:Scalar|Scalar[];ifc_type:string|null};
/** A property set of the piece («occurrence») or of its type («type»), read without inheritance. */
export type PropertySet={name:string;source:"occurrence"|"type";shared_by:number;properties:PropertyEntry[]};
/** The part of `GET /versions/{v}/elements/{guid}` that the explorer shows. */
export type ElementProperties={guid:string;class:string;psets:PropertySet[]};

export interface ElementReader{
  properties(scope:{project:string;version:string},guid:string,signal?:AbortSignal):Promise<ElementProperties>;
}

export const SOURCE_LABELS:Record<PropertySet["source"],string>={occurrence:"de la pieza",type:"del tipo"};

/** Shows a stored value without inventing a unit: the IFC type is shown beside it. */
export function propertyText(value:unknown):string{
  if(value===null||value===undefined)return "Sin valor";
  if(Array.isArray(value))return value.length?value.map(propertyText).join(", "):"Sin valor";
  if(typeof value==="boolean")return value?"Verdadero":"Falso";
  if(typeof value==="number")return value.toLocaleString("es-CO",{maximumFractionDigits:6});
  if(typeof value==="string")return value;
  if(typeof value==="object"&&"text" in value){
    const text=String((value as IfcText).text);
    return text.trim()?text:"Texto vacío";
  }
  return "Sin valor legible";
}
