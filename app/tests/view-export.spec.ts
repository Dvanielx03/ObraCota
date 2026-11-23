import {expect,test,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {strFromU8,unzipSync} from "three/addons/libs/fflate.module.js";
import {crc32,dosDateTime,storedZip} from "../src/modules/scene-view/domain/stored-zip";
import {fitText,pdfString,storedPdf} from "../src/modules/scene-view/domain/stored-pdf";
import {CURRENT_FRAMING,archiveName,documentName,documentPages,exportIndex,exportShots,pictureName,samePose,slug} from "../src/modules/scene-view/domain/view-export";
import {clampSlide,counterLabel,coverFacts,dotSize,slideCount,startSlide} from "../src/modules/scene-view/domain/presentation";
import {exportViews,exportViewsDocument} from "../src/modules/scene-view/application/export-views";
import {exportReviewPackage} from "../src/modules/scene-view/application/review-package";
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

/** A PDF read the way a strict reader does: header, trailer, and every xref offset landing on its object. */
function readPdf(bytes:Uint8Array){
  const text=Buffer.from(bytes).toString("latin1");
  expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const start=Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  expect(text.slice(start,start+4)).toBe("xref");
  const [,first,count]=/^xref\n(\d+) (\d+)\n/.exec(text.slice(start))!;
  expect(Number(first)).toBe(0);
  const rows=text.slice(start).split("\n").slice(3,2+Number(count));
  rows.forEach((row,index)=>{
    const offset=Number(row.slice(0,10));
    expect(text.slice(offset,offset+String(index+1).length+6)).toBe((index+1)+" 0 obj");
  });
  const pages=Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text)![1]);
  // Each stream declares its exact length.
  for(const match of text.matchAll(/\/Length (\d+) >>\nstream\n/g)){
    const from=match.index!+match[0].length;
    expect(text.slice(from+Number(match[1]),from+Number(match[1])+10)).toBe("\nendstream");
  }
  return {text,pages,images:(text.match(/\/Subtype \/Image/g)??[]).length};
}

// A tiny baseline JPEG header: enough for the writer, which never decodes pictures.
const JPEG=Uint8Array.from([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,0xff,0xd9]);
const latin=(text:string)=>[...Buffer.from(text,"latin1")];

test("El PDF de vistas se escribe con offsets exactos, texto en WinAnsi y una página por vista",()=>{
  expect(pdfString("Baño (v2) \\ «Acceso» · 2,5 m — ok €")).toEqual(latin("(Ba\xf1o \\(v2\\) \\\\ \xabAcceso\xbb \xb7 2,5 m \x97 ok \x80)"));
  expect(pdfString("日本")).toEqual(latin("(??)"));
  expect(fitText("Fachada norte",10,1000)).toBe("Fachada norte");
  expect(fitText("Una vista con un nombre muy largo",10,60)).toBe("Una vista…");
  expect(documentName("Duplex_A_20110907.ifc")).toBe("obracota-duplex-a-20110907-vistas.pdf");
  const source={project:"Dúplex Arrayán",file:"Duplex.ifc",version:"v2",exportedAt:new Date(2026,10,21,9,5),onlyCurrent:false};
  const pages=documentPages(source,[{name:"Fachada norte",jpeg:JPEG,width:1600,height:900},{name:"Acceso",jpeg:JPEG,width:900,height:1600}]);
  expect(pages).toHaveLength(3);
  expect(pages[0].texts.map(text=>text.text)).toEqual(expect.arrayContaining(["Dúplex Arrayán","Duplex.ifc · v2 · 21 nov 2026, 09:05",
    "Contenido · 2 vistas guardadas","01  Fachada norte","pág. 2","02  Acceso","pág. 3","ObraCota · Duplex.ifc · Página 1 de 3"]));
  expect(pages[1].texts[0].text).toBe("01 · Fachada norte");
  // The picture keeps its proportion and stays inside the page margins.
  for(const page of pages.slice(1)){
    const [image]=page.images;
    expect(image.width/image.height).toBeCloseTo(image.pixelWidth/image.pixelHeight,5);
    expect(image.x).toBeGreaterThanOrEqual(40);expect(image.x+image.width).toBeLessThanOrEqual(842-40+1e-6);
    expect(image.y).toBeGreaterThanOrEqual(40);expect(image.y+image.height).toBeLessThanOrEqual(595-84+1e-6);
  }
  const pdf=readPdf(storedPdf(pages,"Vistas · Dúplex Arrayán · Duplex.ifc",new Date(2026,10,21,9,5,7)));
  expect(pdf.pages).toBe(3);
  expect(pdf.images).toBe(2);
  expect(pdf.text).toContain("/Title (Vistas \xb7 D\xfaplex Array\xe1n \xb7 Duplex.ifc)");
  expect(pdf.text).toContain("/CreationDate (D:20261121090507)");
  expect(pdf.text).toContain("(01 \xb7 Fachada norte) Tj");
  expect(()=>storedPdf([],"x")).toThrow();
});

test("La exportación en PDF aplica cada vista, devuelve el encuadre y pone una página por vista",async()=>{
  const views=[pose(0,"Vista 1"),pose(5,"Acceso")];
  const screen=pose(9,"pantalla");
  let camera=screen as {position:[number,number,number]};
  const applied:number[]=[];
  const result=await exportViewsDocument(views,{project:"P",file:"Duplex.ifc",version:"v2",onlyCurrent:false},{
    pose:()=>({...screen,position:camera.position}),
    apply:next=>{camera=next;applied.push(next.position[0]);},
    picture:async()=>({jpeg:JPEG,width:640,height:360}),
    settle:async()=>undefined,
  },()=>undefined,undefined,()=>new Date(2026,10,21,12,0));
  expect(applied).toEqual([0,5,9]);
  expect(result).toMatchObject({name:"obracota-duplex-vistas.pdf",count:2});
  const pdf=readPdf(result.bytes);
  expect(pdf.pages).toBe(3);
  expect(pdf.text).toContain("(02 \xb7 Acceso) Tj");
});

/** Registers, creates a project and uploads the IFC by API. */
async function storedIfc(page:Page,ifc:string,name:string){
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  expect(auth.ok()).toBeTruthy();
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const {id}=await (await page.request.post("/api/projects",{headers,data:{name}})).json();
  const base="/api/projects/"+id;
  const upload=await page.request.post(base+"/uploads",{headers:{...headers,"Content-Type":"application/octet-stream"},params:{name:"Duplex_A.ifc"},data:readFileSync(ifc)});
  expect(upload.status()).toBe(201);
  return {id,base,headers,version:(await upload.json()).id as string};
}

test("Exportar › Documento (PDF) descarga la portada y una página por vista guardada",async({page})=>{
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc,"Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(240_000);
  await page.setViewportSize({width:1366,height:768});
  const {id,base,headers,version}=await storedIfc(page,ifc!,"Prueba de exportación PDF");
  try{
    // Two saved views by API, so the export has something to lay out.
    for(const [name,x] of [["Fachada sur",20],["Planta alta",-20]] as const)
      expect((await page.request.post(base+"/versions/"+version+"/views",{headers,data:{name,position:[x,15,25],target:[0,3,0],span:12}})).status()).toBe(201);
    await page.goto("/proyectos/"+id+"/visor/"+version);
    await expect(page.locator(".view[data-ready]")).toBeVisible({timeout:180_000});
    await expect(page.getByRole("region",{name:"Vistas guardadas"}).getByText("Planta alta")).toBeVisible();
    await page.getByRole("button",{name:"Exportar",exact:true}).click();
    const item=page.getByRole("menuitem",{name:"Documento (PDF)"});
    await expect(item).not.toHaveAttribute("aria-disabled","true");
    const downloading=page.waitForEvent("download");
    await item.click();
    const download=await downloading;
    expect(download.suggestedFilename()).toBe("obracota-duplex-a-vistas.pdf");
    const pdf=readPdf(new Uint8Array(readFileSync(await download.path())));
    expect(pdf.pages).toBe(3);
    expect(pdf.images).toBe(2);
    expect(pdf.text).toContain("(01 \xb7 Fachada sur) Tj");
    expect(pdf.text).toContain("(02 \xb7 Planta alta) Tj");
    expect(pdf.text).toContain("(Prueba de exportaci\xf3n PDF) Tj");
    // Every picture is a JPEG drawn from the canvas.
    expect(pdf.text.match(/\/Filter \/DCTDecode/g)).toHaveLength(2);
    expect(pdf.text).toContain("\xff\xd8\xff");
    await expect(page.getByRole("status").filter({hasText:"Descargado obracota-duplex-a-vistas.pdf · portada y 2 páginas de vistas."})).toBeAttached();
    if(process.env.KEEP_EXPORT)await download.saveAs(process.env.KEEP_EXPORT);
  }finally{
    await page.request.delete(base,{headers});
  }
});

test("El paquete de revisión reúne el original, las vistas y los cambios aplicados a la versión",async()=>{
  const views=[pose(0,"Vista 1"),pose(5,"Acceso")];
  let camera=pose(9,"pantalla") as {position:[number,number,number]};
  const change=(id:string,status:string,baseVersion:string,appliedVersion:string|null)=>({id,status,baseVersion,appliedVersion,baseRevision:1,
    description:"Cambiar puerta "+id,summary:null,origin:"PERSON",author:{id:"u",email:"a@example.test"},createdAt:"2026-11-20T10:00:00Z",
    appliedAt:appliedVersion?"2026-11-21T10:00:00Z":null,appliedBy:null,legacyReview:null,
    recipe:{format:"obracota.recipe/1",operations:[{id:"op1",op:"ifc.set_property",element:"G1",scope:"occurrence",pset:"Pset_DoorCommon",property:"FireRating",value:"EI 60"}]},
    report:{ok:true,operations:[],findings:[{rule:"r",status:"WARNING",explanation:"Revisar la evacuación",source:null,element:null}],quantities:[],
      estimate:{currency:"COP",total:1250000,complete:true,lines:[]}}});
  const changes=[change("a","APPLIED","v1-id","v2-id"),change("b","DISCARDED","v2-id",null),change("c","APPLIED","v0-id","v1-id")];
  const result=await exportReviewPackage(views,{project:"Dúplex Arrayán",version:"v2-id"},{
    pose:()=>({...pose(9,"pantalla"),position:camera.position}),apply:next=>{camera=next;},
    picture:async()=>bytes("png@"+camera.position[0]),settle:async()=>undefined,
    version:async()=>({id:"v2-id",fileId:"f",revision:2,name:"Duplex_A.ifc",format:"IFC",byteSize:3,sha256:"abc",uploadedAt:"2026-11-21T10:00:00Z",uploadedBy:"u",uploaderEmail:"a@example.test"}),
    original:async()=>new File([bytes("IFC")],"Duplex_A.ifc"),
    changes:async()=>changes as never,
  },()=>undefined,undefined,()=>new Date(2026,10,22,9,0));
  expect(result.name).toBe("ObraCota-paquete-duplex-arrayan-v2.zip");
  expect(result.changes).toBe(1);
  const files=unzipSync(result.bytes);
  expect(Object.keys(files)).toEqual(["original/Duplex_A.ifc","vistas/01-vista-1.png","vistas/02-acceso.png","vistas/indice.txt",
    "cambios/01-cambiar-puerta-a.json","RESUMEN.md"]);
  expect(strFromU8(files["original/Duplex_A.ifc"])).toBe("IFC");
  const record=JSON.parse(strFromU8(files["cambios/01-cambiar-puerta-a.json"]));
  expect(record).toMatchObject({id:"a",relacion:"produjo esta versión",receta:{format:"obracota.recipe/1"},costo:{total:1250000}});
  expect(record.informe.estimate).toBeUndefined();
  const summary=strFromU8(files["RESUMEN.md"]);
  expect(summary).toContain("# Paquete de revisión · Dúplex Arrayán · v2");
  expect(summary).toContain("Propiedad de la pieza · Pset_DoorCommon.FireRating: EI 60");
  expect(summary).toContain("Revisar la evacuación");
  expect(summary).toMatch(/Costo estimado:\*\* \$\s?1\.250\.000/);
});

test("Exportar › Paquete de revisión (ZIP) descarga el original, las vistas y el resumen",async({page})=>{
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc,"Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(240_000);
  await page.setViewportSize({width:1366,height:768});
  const {id,base,headers,version}=await storedIfc(page,ifc!,"Paquete de revisión");
  try{
    expect((await page.request.post(base+"/versions/"+version+"/views",{headers,data:{name:"Fachada sur",position:[20,15,25],target:[0,3,0],span:12}})).status()).toBe(201);
    await page.goto("/proyectos/"+id+"/visor/"+version);
    await expect(page.locator(".view[data-ready]")).toBeVisible({timeout:180_000});
    // The disabled «Compartir» left the header (R6/P-09).
    await expect(page.locator(".viewer-header").getByRole("button",{name:"Compartir"})).toHaveCount(0);
    await page.getByRole("button",{name:"Exportar",exact:true}).click();
    const item=page.getByRole("menuitem",{name:"Paquete de revisión (ZIP)"});
    await expect(item).not.toHaveAttribute("aria-disabled","true");
    const downloading=page.waitForEvent("download");
    await item.click();
    const download=await downloading;
    expect(download.suggestedFilename()).toBe("ObraCota-paquete-paquete-de-revision-v1.zip");
    const files=unzipSync(new Uint8Array(readFileSync(await download.path())));
    expect(Object.keys(files)).toEqual(["original/Duplex_A.ifc","vistas/01-fachada-sur.png","vistas/indice.txt","RESUMEN.md"]);
    expect(files["original/Duplex_A.ifc"].length).toBe(readFileSync(ifc!).length);
    expect([...files["vistas/01-fachada-sur.png"].subarray(0,4)]).toEqual([137,80,78,71]);
    expect(strFromU8(files["RESUMEN.md"])).toContain("Ninguna propuesta de cambio aplicada");
  }finally{
    await page.request.delete(base,{headers});
  }
});
