import {expect,test} from "@playwright/test";
import {EDIT_MARK_LIMIT,addEditMark,areaMark,canAddEditMark,editRequestText,hasEditText,markedPieces,marksToSend,nudgeArea,pieceStillMarked,pointMark,removeEditMark,setEditMarkText,type EditMark} from "../src/modules/design-option/domain/edit-marks";
import {GLOBAL_TOOLS,GRAPHIC_STYLES,TIMES,chooseGlobal,globalEditText,globalSummary,globalValue,isApplicable,withPeoplePrompt} from "../src/modules/design-option/domain/edit-globals";
import {TOOL_KEYS,shortcutFor} from "../src/modules/model-file/domain/shortcuts";

const wall={element:"m-12",guid:"2O2Fr$t4X7Zf8NOew3FLR9",name:"Muro exterior"};
const roof={element:"m-40",guid:"1kTvXnbbzCWw8lcMd1dR4o",name:"Cubierta"};

test("Las marcas de Editar se anclan a piezas, se numeran y componen el texto de la petición",()=>{
  let marks:EditMark[]=[];
  const first=pointMark(marks,wall,[1,2,3]);
  marks=addEditMark(marks,first)!;
  const zone=areaMark(marks,.2,.2,.4,.5)!;
  expect(zone.area).toEqual({x:.2,y:.2,w:.2,h:.3});
  marks=addEditMark(marks,zone)!;
  marks=addEditMark(marks,pointMark(marks,roof,[4,5,6]))!;
  marks=addEditMark(marks,pointMark(marks,wall,[1,2.5,3]))!;
  expect(marks.map(mark=>mark.id)).toEqual([1,2,3,4]);
  // A drag too short is not a zone.
  expect(areaMark(marks,.2,.2,.21,.21)).toBeNull();
  // Up to five marks, points and zones together.
  marks=addEditMark(marks,areaMark(marks,.6,.6,.8,.8)!)!;
  expect(canAddEditMark(marks)).toBe(false);
  expect(addEditMark(marks,pointMark(marks,roof,[0,0,0]))).toBeNull();
  expect(marks).toHaveLength(EDIT_MARK_LIMIT);

  expect(hasEditText(marks)).toBe(false);
  marks=setEditMarkText(marks,1,"  madera   clara ");
  marks=setEditMarkText(marks,2,"Quitar este muro.");
  marks=setEditMarkText(marks,4,"x".repeat(400));
  expect(marks[3].text).toHaveLength(300);
  expect(hasEditText(marks)).toBe(true);
  // Only marks with a note are sent; the numbers are the ones on screen.
  expect(marksToSend(marks).map(mark=>mark.id)).toEqual([1,2,4]);
  expect(editRequestText(marks.slice(0,3))).toBe("Marca 1 · Muro exterior: madera clara. Marca 2 · Zona marcada: Quitar este muro.");
  // Each piece once, in the order it was marked; a piece stays while another point holds it.
  expect(markedPieces(marks).map(piece=>piece.guid)).toEqual([wall.guid,roof.guid]);
  expect(pieceStillMarked(marks,"m-12",1)).toBe(true);
  expect(pieceStillMarked(marks,"m-40",3)).toBe(false);
  // Removing keeps the ids of the others (stable keys) and the screen numbers follow the order.
  marks=removeEditMark(marks,2);
  expect(editRequestText(marks).startsWith("Marca 1 · Muro exterior: madera clara. Marca 3 · Muro exterior: ")).toBe(true);
  // Zones move and resize inside the canvas.
  const moved=nudgeArea(zone,.9,0,false);
  expect(moved.area.x+moved.area.w).toBeLessThanOrEqual(1);
  expect(nudgeArea(zone,.02,.02,true).area).toEqual({x:.2,y:.2,w:.22,h:.32});
});

test("Las ediciones globales son excluyentes, sin opción por defecto, y escriben su texto en español",()=>{
  expect(GLOBAL_TOOLS.map(tool=>tool.label)).toEqual(["Cambiar el momento del día","Cambiar la atmósfera","Cambiar el entorno","Añadir personas","Cambiar de estilo"]);
  expect(TIMES).toHaveLength(8);
  expect(GRAPHIC_STYLES.map(style=>style.slug)).toEqual(["maqueta-blanca","maqueta","color-plano","acuarela","rotulador","pastel","collage","ilustracion","boceto-lapiz","dibujo-tinta"]);
  expect(isApplicable(null)).toBe(false);
  expect(globalEditText(null)).toBe("");

  let edit=chooseGlobal(null,"time","time","golden");
  expect(globalValue(edit,"time")).toBe("golden");
  expect(globalSummary(edit)).toBe("Hora dorada");
  expect(globalEditText(edit)).toBe("Muestra la escena en la hora dorada, con luz cálida y rasante. Conserva la geometría, las proporciones, los materiales y el encuadre del modelo.");
  // Choosing in another tool replaces the pending edit.
  edit=chooseGlobal(edit,"people","crowd","few");
  expect(globalValue(edit,"time")).toBeNull();
  expect(globalValue(edit,"people","style")).toBe("natural");
  edit=withPeoplePrompt(chooseGlobal(edit,"people","style","silhouette"),"arquitectos revisando planos");
  expect(globalEditText(edit)).toContain("Añade unas pocas personas a la escena, como siluetas, a escala con el edificio. Indicaciones: arquitectos revisando planos.");
  // A style for people means nothing before a quantity.
  expect(chooseGlobal(null,"people","style","motion")).toBeNull();
  // Atmosphere adds weather and season; one of them is enough.
  edit=chooseGlobal(edit,"atmosphere","season","autumn");
  expect(isApplicable(edit)).toBe(true);
  edit=chooseGlobal(edit,"atmosphere","weather","fog");
  expect(globalSummary(edit)).toBe("Niebla · Otoño");
  expect(globalEditText(edit).startsWith("Cambia la atmósfera de la escena: niebla y vegetación de otoño.")).toBe(true);
  // Unknown values leave the pending edit as it was; choosing the chosen one again keeps it.
  expect(chooseGlobal(edit,"style","style","oro")).toBe(edit);
  const style=chooseGlobal(edit,"style","style","watercolor");
  expect(chooseGlobal(style,"style","style","watercolor")).toEqual(style);
  expect(globalEditText(style)).not.toMatch(/Vibe|Fidelity|Lumen|HyperReal|Prisma/);
});

test("Los atajos de DU-16 nombran las herramientas de la barra",()=>{
  expect(TOOL_KEYS).toEqual({render:"R",edit:"E",review:"V",walk:"W",compare:"C",download:"D"});
  const key=(value:string)=>shortcutFor({key:value,ctrl:false,meta:false,alt:false,shift:false,repeat:false});
  expect(key("e")).toEqual({kind:"tool",tool:"edit"});
  expect(key("w")).toEqual({kind:"tool",tool:"walk"});
  expect(key("a")).toBeNull();
  expect(key("o")).toBeNull();
});
