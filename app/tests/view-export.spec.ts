import {expect,test} from "@playwright/test";
import {strFromU8,unzipSync} from "three/addons/libs/fflate.module.js";
import {crc32,dosDateTime,storedZip} from "../src/modules/scene-view/domain/stored-zip";
import {CURRENT_FRAMING,archiveName,exportIndex,exportShots,pictureName,samePose,slug} from "../src/modules/scene-view/domain/view-export";
import {clampSlide,counterLabel,coverFacts,dotSize,slideCount,startSlide} from "../src/modules/scene-view/domain/presentation";
import {exportViews} from "../src/modules/scene-view/application/export-views";
import {shortcutFor,shortcutTitle,toolNotice} from "../src/modules/model-file/domain/shortcuts";

const bytes=(text:string)=>new TextEncoder().encode(text);
const pose=(x:number,name:string)=>({name,position:[x,4,6] as [number,number,number],target:[x,0,0] as [number,number,number],span:10});

test("El ZIP sin compresión se abre con otro lector y respeta el formato",()=>{
  expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
  const png=new Uint8Array([137,80,78,71,13,10,26,10,0,255,1,2]);
  const when=new Date(2026,10,21,14,32,46);
  const archive=storedZip([{name:"01-fachada.png",data:png},{name:"02-baño.png",data:bytes("dos")},{name:"indice.txt",data:bytes("Índice\r\n")}],when);
  const view=new DataView(archive.buffer);
  expect(view.getUint32(0,true)).toBe(0x04034b50);
  expect(view.getUint16(8,true)).toBe(0);
  const end=archive.length-22;
  expect(view.getUint32(end,true)).toBe(0x06054b50);
  expect(view.getUint16(end+10,true)).toBe(3);
  expect(view.getUint32(end+16,true)+view.getUint32(end+12,true)).toBe(end);
  const methods:Record<string,number>={};
  const files=unzipSync(archive,{filter:entry=>{methods[entry.name]=entry.compression;return true;}});
  expect(Object.keys(files)).toEqual(["01-fachada.png","02-baño.png","indice.txt"]);
  expect(Object.values(methods)).toEqual([0,0,0]);
  expect([...files["01-fachada.png"]]).toEqual([...png]);
  expect(strFromU8(files["indice.txt"])).toBe("Índice\r\n");
  // The name with "ñ" carries the UTF-8 flag; the others do not need it.
  const second=30+"01-fachada.png".length+png.length;
  expect(view.getUint16(6,true)).toBe(0);
  expect(view.getUint16(second+6,true)).toBe(0x0800);
  const stamp=dosDateTime(when);
  expect(view.getUint16(10,true)).toBe(stamp.time);
  expect(stamp.date>>9).toBe(46);
  expect((stamp.date>>5)&15).toBe(11);
  expect(stamp.date&31).toBe(21);
  expect((stamp.time>>11)).toBe(14);
  expect(()=>storedZip([{name:"../fuera.png",data:png}])).toThrow();
  expect(()=>storedZip([{name:"a.png",data:png},{name:"a.png",data:png}])).toThrow();
  expect(unzipSync(storedZip([])) ).toEqual({});
});

test("Los nombres, el índice y las tomas de la exportación",()=>{
  expect(archiveName("Duplex_A_20110907.ifc")).toBe("obracota-duplex-a-20110907-vistas.zip");
  expect(archiveName(".ifc")).toBe("obracota-modelo-vistas.zip");
  expect(pictureName(0,"Fachada Ñandú / acceso")).toBe("01-fachada-nandu-acceso.png");
  expect(pictureName(11,"¿?")).toBe("12-vista.png");
  expect(slug("  Vista   norte  ")).toBe("vista-norte");
  const text=exportIndex({project:"Dúplex Arrayán",file:"Duplex.ifc",version:"v2",exportedAt:new Date(2026,10,21,9,5),onlyCurrent:false},
    [{file:"01-vista-1.png",name:"Vista 1"},{file:"02-acceso.png",name:"Acceso"}]);
  expect(text.split("\r\n")).toEqual([
    "Vistas exportadas con ObraCota","","Proyecto: Dúplex Arrayán","Archivo: Duplex.ifc","Versión: v2",
    "Fecha de exportación: 21 nov 2026, 09:05","Contenido: todas las vistas guardadas de la versión","",
    "Imágenes (2):","01-vista-1.png   Vista 1","02-acceso.png    Acceso","",
  ]);
  const views=[pose(0,"Vista 1"),pose(5,"Acceso")];
  expect(exportShots(views,false,null).map(shot=>shot.name)).toEqual(["Vista 1","Acceso"]);
  expect(exportShots(views,true,{...views[1],position:[5.001,4,6]})).toEqual([{name:"Acceso",pose:null}]);
  expect(exportShots(views,true,pose(9,"x"))).toEqual([{name:CURRENT_FRAMING,pose:null}]);
  expect(samePose(views[0],{...views[0],span:10.5})).toBe(false);
});

test("La exportación aplica cada vista, devuelve el encuadre y empaqueta un PNG por vista",async()=>{
  const views=[pose(0,"Vista 1"),pose(5,"Acceso")];
  const screen=pose(9,"pantalla");
  let camera=screen as {position:[number,number,number]};
  const applied:number[]=[],steps:string[]=[];
  const result=await exportViews(views,{project:"P",file:"Duplex.ifc",version:"v2",onlyCurrent:false},{
    pose:()=>({...screen,position:camera.position}),
    apply:next=>{camera=next;applied.push(next.position[0]);},
    picture:async()=>bytes("png@"+camera.position[0]),
    settle:async()=>undefined,
  },(done,total)=>steps.push(done+"/"+total),undefined,()=>new Date(2026,10,21,12,0));
  expect(steps).toEqual(["1/2","2/2"]);
  expect(applied).toEqual([0,5,9]);
  expect(result.name).toBe("obracota-duplex-vistas.zip");
  expect(result.count).toBe(2);
  const files=unzipSync(result.bytes);
  expect(Object.keys(files)).toEqual(["01-vista-1.png","02-acceso.png","indice.txt"]);
  expect(strFromU8(files["02-acceso.png"])).toBe("png@5");
  expect(strFromU8(files["indice.txt"])).toContain("02-acceso.png");
  // Only the current view: no camera move at all.
  applied.length=0;
  const single=await exportViews(views,{file:"Duplex.ifc",onlyCurrent:true},{
    pose:()=>views[1],apply:next=>applied.push(next.position[0]),picture:async()=>bytes("x"),settle:async()=>undefined,
  },()=>undefined);
  expect(Object.keys(unzipSync(single.bytes))).toEqual(["01-acceso.png","indice.txt"]);
  expect(applied).toEqual([5]);
});

test("La presentación y los atajos",()=>{
  expect(slideCount(5)).toBe(6);
  expect(counterLabel(2,6)).toBe("03 / 06");
  expect(startSlide([{id:"a"},{id:"b"}],"b")).toBe(2);
  expect(startSlide([{id:"a"}],"")).toBe(0);
  expect(clampSlide(9,6)).toBe(5);
  expect(clampSlide(-1,6)).toBe(0);
  expect(dotSize(25)).toEqual({dot:4,active:12,gap:5});
  expect(coverFacts({version:"v2",views:1,date:"2026-11-21T10:00:00Z"})).toEqual(["v2","1 vista","noviembre de 2026"]);
  const press=(key:string,extra:Partial<{ctrl:boolean;meta:boolean;alt:boolean;shift:boolean;repeat:boolean}>={})=>
    shortcutFor({key,ctrl:false,meta:false,alt:false,shift:false,repeat:false,...extra});
  expect(press("r")).toEqual({kind:"tool",tool:"render"});
  expect(press("R")).toEqual({kind:"tool",tool:"render"});
  expect(press("e")).toEqual({kind:"tool",tool:"edit"});
  expect(press("v")).toEqual({kind:"tool",tool:"review"});
  expect(press("w")).toEqual({kind:"tool",tool:"walk"});
  expect(press("o")).toBeNull();
  expect(press("a")).toBeNull();
  expect(press("r",{shift:true})).toBeNull();
  expect(press("r",{ctrl:true})).toBeNull();
  expect(press("?",{shift:true})).toEqual({kind:"help"});
  expect(press("3")).toEqual({kind:"version",position:3});
  expect(press("0")).toBeNull();
  expect(press("ArrowDown")).toEqual({kind:"view",step:1});
  expect(press("ArrowDown",{repeat:true})).toBeNull();
  expect(press("x")).toBeNull();
  expect(press("Home")).toEqual({kind:"home"});
  expect(toolNotice("render","Elige una pieza primero")).toBe("Renderizar: elige una pieza primero");
  expect(shortcutTitle("Renderizar","R")).toBe("Renderizar · R");
  expect(shortcutTitle("Renderizar","R","Elige una pieza primero")).toBe("Renderizar · R\nElige una pieza primero");
});
