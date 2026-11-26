import type {Review} from "@/modules/design-change/ui/door-review";

/** The `ModelChange` resource of the API (H1 §4.2), as `/api/projects/{p}/model-changes` returns it. */
export type ChangeStatus="DRAFT"|"READY"|"APPLIED"|"RESTORED"|"DISCARDED";
export type ChangeOrigin="PERSON"|"AGENT";
export type IfcText={text:string}|null;

export type ChangeTypeOperation={id:string;op:"ifc.change_type";element:string;type_id:string};
export type SetPropertyOperation={id:string;op:"ifc.set_property";element:string;scope:"occurrence"|"type";pset:string;property:string;
  value:string|number|boolean;price_key?:string|null};
/** H2 material: one exterior finish for a list of pieces; `element` is the first of `elements`. */
export type SetMaterialOperation={id:string;op:"ifc.set_material";element:string;elements:string[];material:string;category:string;color:string;
  price_key?:string|null};
/** Operations of a DWG drawing: `element` is the entity's handle; the approved revision is a DXF. */
export type DwgSetTextOperation={id:string;op:"dwg.set_text";element:string;text:string};
export type DwgSetLayerOperation={id:string;op:"dwg.set_layer";element:string;layer:string};
export type DwgSetColorOperation={id:string;op:"dwg.set_color";element:string;color:number};
export type DwgMoveOperation={id:string;op:"dwg.move";element:string;dx:number;dy:number;unit:"mm"|"cm"|"m"|"in"|"ft"|"drawing"};
export type DwgAddNoteOperation={id:string;op:"dwg.add_note";element:string;text:string};
export type DwgOperation=DwgSetTextOperation|DwgSetLayerOperation|DwgSetColorOperation|DwgMoveOperation|DwgAddNoteOperation;
export type Operation=ChangeTypeOperation|SetPropertyOperation|SetMaterialOperation|DwgOperation;
export type Recipe={format:"obracota.recipe/1";operations:Operation[]};

export type FindingStatus="WARNING"|"OK"|"UNKNOWN";
export type Finding={rule:string;status:FindingStatus;explanation:string|null;source:string|null;element:string|null};
export type OperationResult={id:string|null;op:string|null;ok:boolean;element:string|null;errors:{code:string;detail:string|null}[];
  before:Record<string,unknown>|null;after:Record<string,unknown>|null;findings:Finding[]};
export type QuantitySource="UNIT"|"QTO"|"GEOMETRY";
export type QuantityLine={element:string|null;phase:"before"|"after"|null;quantity:number|null;unit:string|null;source:QuantitySource|null;
  basis:string|null;reliable:boolean};
export type DiffEntry={guid:string;class:string;name:IfcText;flags?:string[];attributes?:string[];declared?:boolean;reason?:string;reasons?:string[]};
export type Diff={changed:DiffEntry[];added:DiffEntry[];deleted:DiffEntry[];unexpected:DiffEntry[];
  /** A DWG revision: entities by handle, no openings nor IFC geometry. */
  drawing?:boolean;
  openings:{changed:DiffEntry[];added:DiffEntry[];deleted:DiffEntry[];unfilled:DiffEntry[]};
  geometry?:{elements_compared:number;elements:number;openings_compared:number;openings:number};truncated:boolean};
export type Layer={layer:number;name:string;status:"PASS"|"FAIL"|"NOT_RUN";reason?:string;issues?:unknown[];base_issues?:number;
  output_issues?:number;new_issues?:unknown[];unexpected?:string[];truncated?:boolean};
export type Validation={layers:Layer[];skipped:{layer:number;reason:string}[]};
export type Price={key:string;unit:string;currency:string;amount:number;source:string;date:string;copiedFrom:string|null};
export type EstimateLine={operation:string|null;kind:"TYPE_CHANGE"|"ADDITIONAL_COST"|"MATERIAL_FINISH";element:string|null;quantity:number|null;unit:string|null;
  quantitySource:QuantitySource|null;basis:string|null;beforeKey:string|null;before:Price|null;afterKey:string|null;after:Price|null;
  difference:number|null};
export type Estimate={currency:string;total:number;complete:boolean;lines:EstimateLine[]};
export type Report={ok:boolean;operations:OperationResult[];findings:Finding[];quantities:QuantityLine[];
  affected?:{guid:string;class:string;name:IfcText;operations:string[]}[];diff?:Diff|null;validation?:Validation|null;
  errors?:{code:string;detail?:string|null}[];estimate:Estimate|null};
export type Person={id:string;email:string|null};
export type ActionName="edit"|"preview"|"submit"|"apply"|"restore"|"discard";
export type ModelChange={id:string;project:string;file:string;baseVersion:string;baseRevision:number;baseName:string;format:string;
  status:ChangeStatus;origin:ChangeOrigin;author:Person|null;agentRun:string|null;description:string;summary:string|null;recipe:Recipe;
  report:Report|null;reportCurrent:boolean;preview:{available:boolean;sha256:string|null;size:number|null;createdAt:string|null};
  picture:boolean;legacyReview:Review|null;appliedVersion:string|null;appliedAt:string|null;appliedBy:Person|null;
  restoredVersion:string|null;restoredAt:string|null;restoredBy:Person|null;discardedAt:string|null;
  discardedBy:{kind:ChangeOrigin;email:string|null;agentRun:string|null}|null;createdAt:string;updatedAt:string;
  actions:Record<ActionName,boolean>&{reasons:Partial<Record<ActionName,string>>}};

export interface ModelChangeRepository{
  list(project:string,signal?:AbortSignal):Promise<ModelChange[]>;
  get(project:string,change:string,signal?:AbortSignal):Promise<ModelChange>;
  create(project:string,baseVersion:string,description:string):Promise<ModelChange>;
  addOperation(project:string,change:string,operation:Omit<ChangeTypeOperation,"id">|Omit<SetPropertyOperation,"id">|Omit<SetMaterialOperation,"id">):Promise<ModelChange>;
  preview(project:string,change:string):Promise<ModelChange>;
  submit(project:string,change:string,summary?:string):Promise<ModelChange>;
  discard(project:string,change:string,reason?:string):Promise<ModelChange>;
  apply(project:string,change:string):Promise<ModelChange>;
  restore(project:string,change:string):Promise<ModelChange>;
  openPreview(project:string,change:ModelChange,signal?:AbortSignal):Promise<File>;
}

const statuses:Record<ChangeStatus,string>={DRAFT:"Borrador",READY:"Lista para aprobar",APPLIED:"Aplicada",RESTORED:"Restaurada",DISCARDED:"Descartada"};
/** Whether a change (or a version format) is of a DWG or DXF drawing: its revisions are DXF. */
export function isDwgOperation(operation:Operation):operation is DwgOperation{return operation.op.startsWith("dwg.");}
export const isDrawingFormat=(format:string|null|undefined)=>format==="DWG"||format==="DXF";

/** «Borrador», «Lista para aprobar», «Aplicada», «Restaurada» or «Descartada» (§7.2). */
export const statusLabel=(status:ChangeStatus)=>statuses[status];

/** First 8 and last 4 characters of a GlobalId, enough to tell pieces apart in a list. */
export const shortGuid=(guid:string)=>guid.length>14?guid.slice(0,8)+"…"+guid.slice(-4):guid;
export const ifcText=(value:unknown)=>value&&typeof value==="object"&&"text" in value?String((value as {text:unknown}).text):typeof value==="string"?value:null;

function shownValue(value:unknown){
  if(value===null||value===undefined)return "sin valor";
  if(typeof value==="boolean")return value?"Verdadero":"Falso";
  return ifcText(value)??String(value);
}

/**
 * One line of the recipe in words: «Cambiar tipo · {puerta} → {tipo} (Compatible)» or «Propiedad de la pieza ·
 * Pset.Prop: antes → después». Names come from the engine's `before`/`after` when the change was previewed, from the
 * migrated review otherwise, and fall back to the shortened GlobalId.
 */
export function operationLabel(operation:Operation,result?:OperationResult,legacy?:Review|null):string{
  const before=result?.before??null,after=result?.after??null;
  if(isDwgOperation(operation))return drawingLabel(operation,before,after);
  if(operation.op==="ifc.change_type"){
    const options=Array.isArray(before?.options)?before.options as {id:string;name:string;compatible:boolean}[]:legacy?.door.options??[];
    const option=options.find(item=>item.id===operation.type_id);
    const door=ifcText(before?.name)??legacy?.door.name??shortGuid(operation.element);
    const type=ifcText(after?.typeName)??option?.name??legacy?.proposal.name??shortGuid(operation.type_id);
    const fit=option?(option.compatible?" (Compatible)":" (No compatible)"):"";
    return "Cambiar tipo · "+door+" → "+type+fit;
  }
  if(operation.op==="ifc.set_material"){
    const pieces=operation.elements.length===1?"1 pieza":operation.elements.length+" piezas";
    const previous=Array.isArray(before?.materials)?(before.materials as {material:string;pieces:number}[]).map(item=>item.material):[];
    const from=previous.length===1?previous[0]+" → ":previous.length>1?previous.length+" materiales → ":"";
    return "Acabado exterior · "+pieces+": "+from+operation.material;
  }
  const scope=operation.scope==="type"?"Propiedad del tipo":"Propiedad de la pieza";
  const from=after&&"value_before" in after?shownValue(after.value_before)+" → ":before&&"value_before" in before?shownValue(before.value_before)+" → ":"";
  return scope+" · "+operation.pset+"."+operation.property+": "+from+shownValue(operation.value);
}

const ENTITY_NAMES:Record<string,string>={INSERT:"Bloque",LINE:"Línea",LWPOLYLINE:"Polilínea",POLYLINE:"Polilínea",ARC:"Arco",CIRCLE:"Círculo",
  ELLIPSE:"Elipse",POINT:"Punto",TEXT:"Texto",MTEXT:"Texto",ATTRIB:"Atributo",DIMENSION:"Cota",MULTILEADER:"Directriz",HATCH:"Sombreado",
  "3DSOLID":"Sólido",SPLINE:"Spline"};
const COLOR_NAMES:Record<number,string>={0:"por bloque",1:"rojo",2:"amarillo",3:"verde",4:"cian",5:"azul",6:"magenta",7:"blanco o negro",8:"gris",
  9:"gris claro",256:"por capa"};
const UNIT_NAMES:Record<string,string>={mm:"mm",cm:"cm",m:"m",in:"in",ft:"ft",drawing:"unidades del dibujo"};
/** A CAD text without its MTEXT formatting codes, as the plan shows it. */
export function cadText(raw:unknown):string{
  return String(raw??"").replace(/\\P/g," ").replace(/\\[ACFHQTWcfhp][^;]*;/g,"").replace(/\\[LlOoKk]/g,"").replace(/\\~/g," ")
    .replace(/\\([\\{}])/g,"$1").replace(/[{}]/g,"").trim();
}
const colorLabel=(value:unknown)=>typeof value==="number"?value+(COLOR_NAMES[value]?" ("+COLOR_NAMES[value]+")":""):"sin dato";
const decimal=new Intl.NumberFormat("es-CO",{maximumFractionDigits:3});
/** «Mover 500 mm a la derecha y 200 mm hacia arriba». */
function moveWords(operation:DwgMoveOperation){
  const unit=UNIT_NAMES[operation.unit]??operation.unit,parts:string[]=[];
  if(operation.dx)parts.push(decimal.format(Math.abs(operation.dx))+" "+unit+(operation.dx>0?" a la derecha":" a la izquierda"));
  if(operation.dy)parts.push(decimal.format(Math.abs(operation.dy))+" "+unit+(operation.dy>0?" hacia arriba":" hacia abajo"));
  return parts.join(" y ");
}
/** One DWG operation in words: «Texto · Texto 3465: «LIVING ROOM» → «REVISADO OBRA»». */
function drawingLabel(operation:DwgOperation,before:Record<string,unknown>|null,after:Record<string,unknown>|null):string{
  const type=typeof before?.type==="string"?before.type:"";
  const entity=(ENTITY_NAMES[type]??(type||"Entidad"))+" "+operation.element;
  switch(operation.op){
    case "dwg.set_text":{
      const from=before&&"text" in before?"«"+cadText(before.text)+"» → ":"";
      return (type==="DIMENSION"?"Texto de cota":"Texto")+" · "+entity+": "+from+"«"+operation.text+"»";
    }
    case "dwg.set_layer":return "Capa · "+entity+": "+(typeof before?.layer==="string"?before.layer+" → ":"")+operation.layer
      +(after?.created?" (capa nueva)":"");
    case "dwg.set_color":return "Color · "+entity+": "+(before&&"color" in before?colorLabel(before.color)+" → ":"")+colorLabel(operation.color);
    case "dwg.move":{
      const drawn=typeof after?.dx==="number"&&operation.unit!=="drawing"&&typeof after?.unit==="string"
        ?" ("+decimal.format(after.dx as number)+", "+decimal.format(after.dy as number)+" "+after.unit+" en el dibujo)":"";
      return "Mover · "+entity+": "+moveWords(operation)+drawn;
    }
    case "dwg.add_note":return "Nota de revisión · "+entity+": «"+operation.text+"»";
  }
}

const sources:Record<QuantitySource,string>={UNIT:"Por unidad",QTO:"Qto del IFC",GEOMETRY:"Calculada de la geometría"};
/** Where a quantity came from (§6.1): «Por unidad», «Qto del IFC» or «Calculada de la geometría». */
export const sourceLabel=(source:QuantitySource|null)=>source?sources[source]:"Fuente sin indicar";

/** GlobalIds the change touches: what the engine reported as affected, or the recipe's targets before a preview. */
export function affectedGuids(change:Pick<ModelChange,"report"|"recipe">):string[]{
  const listed=change.report?.affected?.map(item=>item.guid)??[];
  return [...new Set(listed.length?listed:change.recipe.operations.flatMap(operation=>operation.op==="ifc.set_material"?operation.elements:[operation.element]))];
}

/** Changed, added and deleted elements of the diff against the base. */
export function diffCounts(diff:Diff|null|undefined){
  return {changed:diff?.changed.length??0,added:diff?.added.length??0,deleted:diff?.deleted.length??0};
}

const flagNames:Record<string,string>={type_changed:"tipo",geometry_changed:"geometría",properties_changed:"propiedades",
  container_changed:"contenedor",aggregate_changed:"agregación",classification_changed:"clasificación",
  // A verification by entities (large models, ifc-engine/obracota_engine/entities.py) names these two as well.
  material_changed:"material",style_changed:"color"};
/** IfcDiff flags in words: «tipo», «propiedades», «atributos: ObjectType»… */
export function flagLabels(entry:Pick<DiffEntry,"flags"|"attributes">):string[]{
  return (entry.flags??[]).map(flag=>flag==="attributes_changed"
    ?"atributos"+(entry.attributes?.length?": "+entry.attributes.join(", "):"")
    :flagNames[flag]??flag);
}

/** Every design notice of the report, the engine's per operation and the backend's door rules, once each. */
export function reportFindings(report:Report):Finding[]{
  const all=[...report.operations.flatMap(result=>result.findings??[]),...report.findings];
  const seen=new Set<string>();
  return all.filter(item=>{const key=item.rule+"|"+(item.element??"");if(seen.has(key))return false;seen.add(key);return true;});
}

/** What the project's budget adds up: only applied changes count, with the estimate frozen at approval. */
export type ApprovedBudget={currency:string;total:number;counted:number;missing:number;otherCurrency:number};

/**
 * Sum of the frozen estimates of the applied changes (§6.3). A restored change was undone and a discarded one never
 * happened, so neither counts; an applied change whose estimate lacks a price is reported in `missing`, not guessed.
 * The total is in the currency of the first counted estimate: one in another currency is reported in
 * `otherCurrency` and left out, since adding amounts of two currencies gives a meaningless figure.
 */
export function approvedBudget(changes:readonly ModelChange[]):ApprovedBudget{
  let total=0,counted=0,missing=0,otherCurrency=0,currency="";
  for(const change of changes){
    if(change.status!=="APPLIED")continue;
    const estimate=change.report?.estimate;
    if(!estimate||!estimate.complete){missing++;continue;}
    const own=estimate.currency||"COP";
    if(!currency)currency=own;
    else if(own!==currency){otherCurrency++;continue;}
    total+=estimate.total;counted++;
  }
  return {currency:currency||"COP",total,counted,missing,otherCurrency};
}
