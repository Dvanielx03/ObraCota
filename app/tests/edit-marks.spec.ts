import {expect,test} from "@playwright/test";
import {EDIT_MARK_LIMIT,addEditMark,areaMark,canAddEditMark,editRequestText,hasEditText,markedPieces,marksToSend,nudgeArea,pieceStillMarked,pointMark,removeEditMark,setEditMarkText,type EditMark} from "../src/modules/design-option/domain/edit-marks";
import {GRAPHIC_STYLES,SCENE_CATEGORIES,SCENE_PRESETS,TIMES,applyPreset,chooseScene,clearCategory,globalEditText,globalSummary,isApplicable,matchingPreset,sceneValue,withPeoplePrompt} from "../src/modules/design-option/domain/edit-globals";
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

test("La escena combina las ediciones globales, sin opción por defecto, en una sola petición en español",()=>{
  expect(SCENE_CATEGORIES.map(category=>category.title)).toEqual(["Momento del día","Clima y estación","Entorno","Personas","Estilo"]);
  expect(SCENE_PRESETS.map(preset=>preset.label)).toEqual(["Presentación al cliente","Concurso","Revisión técnica","Ambiente nocturno"]);
  expect(TIMES).toHaveLength(8);
  // The existing style pictures stay; photorealistic is added first.
  expect(GRAPHIC_STYLES.map(style=>style.slug)).toEqual(["fotorrealista","maqueta-blanca","maqueta","color-plano","acuarela","rotulador","pastel","collage","ilustracion","boceto-lapiz","dibujo-tinta"]);
  expect(isApplicable(null)).toBe(false);
  expect(globalEditText(null)).toBe("");

  // One category alone still reads as before.
  let scene=chooseScene(null,"time","golden");
  expect(sceneValue(scene,"time")).toBe("golden");
  expect(globalSummary(scene)).toBe("Hora dorada");
  expect(globalEditText(scene)).toBe("Muestra la escena en la hora dorada, con luz cálida y rasante. Conserva la geometría, las proporciones, los materiales y el encuadre del modelo.");
  // Choosing in another category adds to the scene instead of replacing it (they used to be exclusive).
  scene=chooseScene(scene,"crowd","few");
  expect(sceneValue(scene,"time")).toBe("golden");
  expect(sceneValue(scene,"peopleStyle")).toBe("natural");
  scene=withPeoplePrompt(chooseScene(scene,"peopleStyle","silhouette"),"arquitectos revisando planos");
  scene=chooseScene(chooseScene(scene,"season","autumn"),"weather","fog");
  scene=chooseScene(chooseScene(scene,"environment","forest"),"style","watercolor");
  expect(globalSummary(scene)).toBe("Hora dorada · Niebla · Otoño · Bosque · Pocas · Silueta · Acuarela");
  expect(globalEditText(scene)).toBe("Muestra la escena en la hora dorada, con luz cálida y rasante, con niebla y vegetación de otoño."
    +" Sitúa la edificación en un bosque."
    +" Añade unas pocas personas a la escena, como siluetas, a escala con el edificio. Indicaciones para las personas: arquitectos revisando planos."
    +" Representa la imagen como una acuarela."
    +" Conserva la geometría, las proporciones, los materiales y el encuadre del modelo.");
  // One value per category: a new time replaces the time only.
  const later=chooseScene(scene,"time","night");
  expect(sceneValue(later,"time")).toBe("night");
  expect(sceneValue(later,"style")).toBe("watercolor");
  // Weather or season alone is enough.
  expect(globalEditText(chooseScene(null,"season","winter")).startsWith("Muestra la escena con vegetación de invierno.")).toBe(true);
  // A people style means nothing before people; «Ninguna» asks for an empty scene and drops the prompt.
  expect(chooseScene(null,"peopleStyle","motion")).toBeNull();
  const empty=withPeoplePrompt(chooseScene(scene,"crowd","none"),"no se usa");
  expect(sceneValue(empty,"peopleStyle")).toBeNull();
  expect(globalEditText(empty)).toContain("No incluyas personas en la escena.");
  expect(globalEditText(empty)).not.toContain("Indicaciones");
  // Clearing one category keeps the others; clearing the last leaves nothing to apply.
  const noStyle=clearCategory(scene,"style");
  expect(sceneValue(noStyle,"style")).toBeNull();
  expect(sceneValue(noStyle,"environment")).toBe("forest");
  expect(clearCategory(chooseScene(null,"style","ink"),"style")).toBeNull();
  // Unknown values leave the scene as it was.
  expect(chooseScene(scene,"style","oro")).toBe(scene);
  expect(globalEditText(scene)).not.toMatch(/Vibe|Fidelity|Lumen|HyperReal|Prisma/);
});

test("Los accesos rápidos por objetivo rellenan la escena y se pueden ajustar después",()=>{
  const client=applyPreset(null,"client");
  expect(matchingPreset(client)).toBe("client");
  expect(globalSummary(client)).toBe("Tarde · Despejado · Ciudad · Pocas · Natural · Fotorrealista");
  expect(globalEditText(client)).toBe("Muestra la escena por la tarde, con cielo despejado. Sitúa la edificación en la ciudad, entre otros edificios."
    +" Añade unas pocas personas a la escena, con aspecto natural, a escala con el edificio. Representa la imagen como una fotografía de arquitectura fotorrealista."
    +" Conserva la geometría, las proporciones, los materiales y el encuadre del modelo.");
  // A shortcut replaces the whole combination, including what it does not name.
  const review=applyPreset(chooseScene(client,"season","autumn"),"review");
  expect(globalSummary(review)).toBe("Mediodía · Despejado · Sin entorno · Sin personas · Maqueta blanca");
  expect(globalEditText(review)).toContain("Sitúa la edificación sobre un fondo neutro, sin entorno alrededor. No incluyas personas en la escena. Representa la imagen como una maqueta blanca");
  expect(globalSummary(applyPreset(null,"contest"))).toBe("Atardecer · Campo · Sin personas · Maqueta blanca");
  expect(globalSummary(applyPreset(null,"night"))).toBe("Noche · Ciudad · Pocas · Natural");
  // Adjusting after a shortcut keeps the rest and the shortcut stops being the current one.
  const adjusted=chooseScene(applyPreset(null,"contest"),"style","watercolor");
  expect(matchingPreset(adjusted)).toBeNull();
  expect(sceneValue(adjusted,"time")).toBe("sunset");
  expect(applyPreset(adjusted,"desconocido")).toBe(adjusted);
});

test("Los atajos de DU-16 nombran las herramientas de la barra",()=>{
  expect(TOOL_KEYS).toEqual({render:"R",edit:"E",review:"V",walk:"W",compare:"C",download:"D"});
  const key=(value:string)=>shortcutFor({key:value,ctrl:false,meta:false,alt:false,shift:false,repeat:false});
  expect(key("e")).toEqual({kind:"tool",tool:"edit"});
  expect(key("w")).toEqual({kind:"tool",tool:"walk"});
  expect(key("a")).toBeNull();
  expect(key("o")).toBeNull();
});
