import {expect,test,type Locator,type Page} from "@playwright/test";
import {createHash} from "node:crypto";
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import * as T from "three";
import {walking,walkWorld} from "../src/viewer/infrastructure/walk";
import {MODELS,newProject,registerByApi,toolbar,uploadByApi,waitViewer} from "./auditoria-26-11/support";
import {MODEL_ONLY} from "./support/visor";

/**
 * Renderizar → Guardar en el modelo → aprobar → la versión nueva y su recorrido muestran el acabado como en la vista previa.
 * Modelos nunca usados antes en estas pruebas: Lantern Hollow y Sports Complex (Revit imperial, con topografía).
 * Las pruebas de la marcha (correr, borde del modelo, caída) usan un mundo geométrico en Node, sin navegador.
 * Con TEST_HARDWARE_GPU=1 se exige además más de 60 fps caminando.
 */
const EVIDENCE=resolve(__dirname,"../../docs/auditoria-manual/evidencia/acabado-recorrido");
mkdirSync(EVIDENCE,{recursive:true});
const LOG=resolve(EVIDENCE,"diario.log");
function log(line:string){appendFileSync(LOG,line+"\n");console.log(line);}
const GPU=process.env.TEST_HARDWARE_GPU==="1";
/** Muro exterior de ladrillo del garaje de Lantern: la primera pieza exterior que toma «Guardar en el modelo». */
const WALL="0Gp_XTJQjDQuWNrHB4z_QF";
const CANVAS_ONLY={style:MODEL_ONLY+"#explorer,[role=dialog]{visibility:hidden!important}"};

async function shot(page:Page,name:string){await page.screenshot({path:resolve(EVIDENCE,name+".png")}).catch(()=>undefined);}
async function diff(page:Page,a:Buffer,b:Buffer){
  return page.evaluate(async([x,y])=>{
    async function px(d:string){const i=new Image();i.src="data:image/png;base64,"+d;await i.decode();const c=document.createElement("canvas");c.width=i.width;c.height=i.height;const g=c.getContext("2d")!;g.drawImage(i,0,0);return g.getImageData(0,0,i.width,i.height).data;}
    const [p,q]=await Promise.all([px(x),px(y)]);if(p.length!==q.length)return 1;
    let n=0;for(let i=0;i<p.length;i+=4)if(Math.abs(p[i]-q[i])+Math.abs(p[i+1]-q[i+1])+Math.abs(p[i+2]-q[i+2])>24)n++;return n/(p.length/4);
  },[a.toString("base64"),b.toString("base64")] as const);
}
/** Mean colour of the top band of a canvas picture (the sky while walking). */
async function topColour(page:Page,png:Buffer){
  return page.evaluate(async data=>{
    const i=new Image();i.src="data:image/png;base64,"+data;await i.decode();
    const c=document.createElement("canvas");c.width=i.width;c.height=i.height;const g=c.getContext("2d")!;g.drawImage(i,0,0);
    const band=g.getImageData(0,Math.round(i.height*.1),i.width,Math.max(1,Math.round(i.height*.05))).data;
    const sum=[0,0,0];for(let k=0;k<band.length;k+=4){sum[0]+=band[k];sum[1]+=band[k+1];sum[2]+=band[k+2];}
    return sum.map(v=>Math.round(v/(band.length/4)));
  },png.toString("base64"));
}
const mark=(page:Page,name:string)=>page.evaluate(n=>(performance.getEntriesByName(n).at(-1) as PerformanceMark|undefined)?.detail??null,name);
const digest=(b:Buffer)=>createHash("sha1").update(b).digest("hex").slice(0,10);
async function look(page:Page,dx:number,dy=0){
  const c=(await page.locator(".view canvas").boundingBox())!;
  await page.mouse.move(c.x+c.width/2,c.y+c.height/2);await page.mouse.down();
  await page.mouse.move(c.x+c.width/2+dx,c.y+c.height/2+dy,{steps:16});await page.mouse.up();
}
/** Deselects the located piece without moving the camera: zoom out, click the empty background, zoom back in. */
async function deselect(page:Page){
  const out=page.getByRole("button",{name:"Alejar"}),inn=page.getByRole("button",{name:"Acercar"});
  for(let i=0;i<40;i++)await out.click();
  const canvas=page.locator(".view canvas"),box=(await canvas.boundingBox())!;
  await canvas.click({position:{x:Math.round(box.width*.78),y:Math.round(box.height*.3)}});
  for(let i=0;i<40;i++)await inn.click();
  await page.waitForTimeout(1200);
}
/** Holds `keys` for `ms` and returns the last walk measure (fps, speed in m/s, running). */
async function hold(page:Page,keys:string[],ms:number){
  await page.locator(".view canvas").focus();
  for(const key of keys)await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  const measure=await mark(page,"obracota:walk-fps") as {fps:number;speed:number;running:boolean}|null;
  for(const key of [...keys].reverse())await page.keyboard.up(key);
  await page.waitForTimeout(300);
  return measure;
}
/** Clicks candidate floor points until the walk starts; `accept` may refuse a start (then it leaves and re-enters). */
async function startWalk(page:Page,points:[number,number][],accept:(start:{ifcType:string|null})=>boolean=()=>true){
  const controls=page.getByRole("toolbar",{name:"Controles del recorrido"}),canvas=page.locator(".view canvas");
  for(const [x,y] of points){
    if(!(await controls.isVisible()))await toolbar(page).getByRole("button",{name:"Recorrido",exact:true}).click();
    await expect(controls).toBeVisible({timeout:60_000});
    const box=(await canvas.boundingBox())!;
    // Mouse at page coordinates: a point never waits on an overlay (the points stay clear of the bars).
    await page.mouse.click(box.x+Math.round(box.width*x),box.y+Math.round(box.height*y));
    await page.waitForTimeout(1200);
    const hint=await page.locator(".walk-hint").innerText().catch(()=>"");
    if(!/Arrastra para mirar/.test(hint)){log(`  clic (${x},${y}): ${hint}`);continue;}
    const start=await mark(page,"obracota:walk-start") as {ifcType:string|null;height:number};
    log(`  clic (${x},${y}): recorrido sobre ${start?.ifcType} a ${start?.height} m`);
    if(accept(start))return {start,hint};
    await page.keyboard.press("Escape");await expect(controls).toBeHidden();
  }
  return null;
}
async function pressed(button:Locator){await expect(button).toHaveAttribute("aria-pressed","true",{timeout:300_000});}

test.describe("Marcha del recorrido (mundo geométrico)",()=>{
  class FakeWindow extends EventTarget {closest(){return null;}}
  class KeyEvent extends Event {constructor(type:string,readonly key:string,readonly shiftKey=false){super(type);}}
  class Canvas extends EventTarget {clientWidth=640;clientHeight=480;focus(){}}
  function world(...boxes:[number,number,number,number,number,number,string][]){
    const root=new T.Group();
    for(const [w,h,d,x,y,z,type] of boxes){const mesh=new T.Mesh(new T.BoxGeometry(w,h,d));mesh.position.set(x,y,z);mesh.userData.ifcType=type;root.add(mesh);}
    return walkWorld({root,name:"Ensayo",schema:"IFC4",sample:false,elements:[],coordination:new T.Matrix4().elements});
  }
  function run(built:ReturnType<typeof world>,start:T.Vector3,steps:(walk:{key:(type:string,key:string,shift?:boolean)=>void;frames:(n:number)=>void;eye:T.Vector3})=>void){
    const originals={window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
    let next:FrameRequestCallback|undefined;
    const fake=new FakeWindow();
    Object.assign(globalThis,{window:fake,requestAnimationFrame:(callback:FrameRequestCallback)=>{next=callback;return 1;},cancelAnimationFrame:()=>{next=undefined;}});
    try{
      const eye=new T.Vector3();
      const route=walking(new Canvas() as unknown as HTMLCanvasElement,built,start,new T.Vector3(0,0,-1),camera=>eye.copy(camera.position));
      let now=performance.now();
      steps({eye,key:(type,key,shift=false)=>fake.dispatchEvent(new KeyEvent(type,key,shift)),frames:n=>{for(let i=0;i<n;i++){now+=16.67;next?.(now);}}});
      route.dispose();
    }finally{Object.assign(globalThis,originals);}
  }

  test("Mayús corre a tres veces la velocidad de caminar",()=>{
    run(world([60,.2,60,0,-.1,0,"IFCSLAB"]),new T.Vector3(),({key,frames,eye})=>{
      key("keydown","w");frames(60);
      const walked=-eye.z;
      key("keydown","Shift",true);frames(60);
      const ran=-eye.z-walked;
      key("keyup","Shift");key("keyup","w");
      log(`marcha: 1 s caminando ${walked.toFixed(2)} m, 1 s corriendo ${ran.toFixed(2)} m`);
      expect(walked).toBeCloseTo(1.5,1);
      expect(ran/walked).toBeGreaterThan(2.8);
      expect(ran/walked).toBeLessThan(3.2);
    });
  });

  test("El borde del modelo detiene al caminante sin dejarlo caer al vacío",()=>{
    run(world([8,.2,8,0,-.1,0,"IFCSITE"]),new T.Vector3(),({key,frames,eye})=>{
      key("keydown","w");frames(300);key("keyup","w");
      log(`borde: tras 5 s hacia el borde, ojo en z=${eye.z.toFixed(2)} y=${eye.y.toFixed(2)}`);
      expect(eye.z).toBeGreaterThan(-4.3);
      expect(eye.z).toBeLessThan(-3.6);
      expect(eye.y).toBeCloseTo(1.65,1);
      // Still free to walk back.
      key("keydown","s");frames(60);key("keyup","s");
      expect(eye.z).toBeGreaterThan(-3);
    });
  });

  test("Bajar de una plataforma cae al piso inferior y sigue caminando",()=>{
    run(world([4,.2,4,0,2.9,0,"IFCSLAB"],[40,.2,40,0,-.1,0,"IFCSITE"]),new T.Vector3(0,3,0),({key,frames,eye})=>{
      key("keydown","w");frames(240);key("keyup","w");
      log(`caída: tras 4 s, ojo en z=${eye.z.toFixed(2)} y=${eye.y.toFixed(2)}`);
      expect(eye.y).toBeCloseTo(1.65,1);
      expect(eye.z).toBeLessThan(-4);
    });
  });

  test("Una caída larga vuelve al último piso firme en lugar de congelarse",()=>{
    // A terrace 60 m above the lowest floor: stepping off it starts a fall that would last seconds; the walker is put back.
    run(world([4,.2,4,0,-.1,0,"IFCSLAB"],[40,.2,40,0,-60.1,0,"IFCSITE"]),new T.Vector3(),({key,frames,eye})=>{
      key("keydown","w");frames(100);key("keyup","w");
      const falling=eye.y;
      frames(300);
      log(`caída larga: al soltar W y=${falling.toFixed(2)}; 5 s después z=${eye.z.toFixed(2)} y=${eye.y.toFixed(2)}`);
      expect(falling).toBeLessThan(1.6);
      expect(eye.y).toBeCloseTo(1.65,1);
      expect(eye.z).toBeGreaterThan(-2.4);
      // And it walks again from there.
      key("keydown","s");frames(60);key("keyup","s");
      expect(eye.z).toBeGreaterThan(-1.2);
    });
  });
});

test.describe("Acabado aprobado y recorrido en modelos Revit con topografía",()=>{
  test.use({viewport:{width:1440,height:900},actionTimeout:30_000});

  test("Lantern Hollow: Madera · claro se ve como en la vista previa, en Propiedades y en el recorrido",async({page})=>{
    test.setTimeout(2_400_000);
    log(`\n# Lantern · ${new Date().toISOString()} · GPU=${GPU}`);
    page.on("pageerror",e=>log("[pageerror] "+String(e).slice(0,300)));
    await page.emulateMedia({reducedMotion:"reduce"});
    const state=resolve(tmpdir(),"obracota-acabado-recorrido.json");
    let project:{id:string;api:string;headers:Record<string,string>},v1:string,v2="";
    const reuse=process.env.ACABADO_REUSE==="1" && existsSync(state)?JSON.parse(readFileSync(state,"utf8")):null;
    if(reuse){
      const login=await page.request.post("/api/auth/login",{headers:{"X-ObraCota-Client":"web"},data:{email:reuse.email,password:reuse.password}});
      expect(login.ok()).toBeTruthy();
      project={id:reuse.project,api:"/api/projects/"+reuse.project,headers:{Authorization:"Bearer "+(await login.json()).accessToken}};
      v1=reuse.v1;v2=reuse.v2??"";
      log("reutiliza el proyecto "+project.id);
    }else{
      const account=await registerByApi(page);
      const created=await page.request.post("/api/projects",{headers:account.headers,data:{name:"Acabado y recorrido Lantern"}});
      expect(created.ok()).toBeTruthy();
      const id=(await created.json()).id as string;
      project={id,api:"/api/projects/"+id,headers:account.headers};
      v1=(await uploadByApi(page,project,MODELS.lantern)).id;
      writeFileSync(state,JSON.stringify({email:account.email,password:account.password,project:id,v1}));
    }
    const canvas=page.locator(".view canvas");
    const panel=page.getByRole("dialog",{name:"Renderizar opciones visuales"});
    const live=panel.getByRole("button",{name:"Ver en el modelo 3D"});

    // v1: el muro, su material por capas (M3) y la vista base con el mismo encuadre que se usará en la v2.
    await page.goto(`/proyectos/${project.id}/visor/${v1}?element=${WALL}`);
    await waitViewer(page);await page.waitForTimeout(2500);
    const v1Properties=await page.locator("#pane-properties").innerText();
    const v1Material=v1Properties.match(/Material\s*\n?\s*([^\n]*)/)?.[1]??"";
    log("v1 Propiedades › Material: "+v1Material);
    expect(v1Material).toContain("Brick - Existing");
    await shot(page,"01-v1-propiedades");
    await deselect(page);
    const base=await canvas.screenshot(CANVAS_ONLY);
    await shot(page,"02-v1-base");

    // Renderizar › Madera · Claro › Ver en el modelo 3D: la vista previa con el mismo encuadre.
    await toolbar(page).getByRole("button",{name:"Renderizar opciones visuales"}).click();
    await expect(panel).toBeVisible();
    if(await live.getAttribute("aria-pressed")!=="true")await live.click();
    await panel.getByRole("radio",{name:"Madera"}).click();
    await panel.getByRole("radio",{name:"Claro"}).click();
    await expect(panel.locator(".exterior-preview [role=status]")).toContainText(/Acabado en \d+ piezas/,{timeout:60_000});
    log("vista previa: "+await panel.locator(".exterior-preview [role=status]").innerText());
    await page.waitForTimeout(2500);
    const preview=await canvas.screenshot(CANVAS_ONLY);
    await shot(page,"03-v1-vista-previa-madera-claro");
    log("vista previa contra base: "+(await diff(page,base,preview)).toFixed(4));

    if(!v2){
      // Guardar en el modelo → tarjeta READY → Aprobar → Abrir nueva versión.
      const save=panel.getByRole("button",{name:"Guardar en el modelo"});
      await expect(save).toBeEnabled();
      const created=page.waitForResponse(r=>/\/model-changes$/.test(r.url())&&r.request().method()==="POST",{timeout:120_000});
      const started=Date.now();
      await save.click();
      const change=(await (await created).json()).id as string;
      await page.waitForURL(/\/cambios#/,{timeout:900_000});
      const card=page.locator(`article[id="${change}"]`);
      await expect(card).toBeVisible({timeout:60_000});
      const approve=card.getByRole("button",{name:"Aprobar y aplicar cambio"});
      await expect(approve).toBeEnabled({timeout:900_000});
      const body=await (await page.request.get(`${project.api}/model-changes/${change}`,{headers:project.headers})).json();
      const pieces:string[]=body.recipe?.operations?.[0]?.elements??[];
      log(`tarjeta READY en ${((Date.now()-started)/1000).toFixed(0)} s: estado=${body.status} material=${body.recipe?.operations?.[0]?.material} piezas=${pieces.length} incluye el muro=${pieces.includes(WALL)}`);
      expect(body.status).toBe("READY");
      expect(body.recipe.operations[0].material).toBe("Madera · claro");
      await shot(page,"04-tarjeta-lista");
      await approve.click();
      const opened=card.getByRole("link",{name:"Abrir nueva versión"});
      await expect(opened).toBeVisible({timeout:300_000});
      const href=(await opened.getAttribute("href"))!;
      v2=href.split("?")[0].split("/").pop()!;
      log("v2="+v2+" enlace="+href);
      writeFileSync(state,JSON.stringify({...JSON.parse(readFileSync(state,"utf8")),v2}));
      await opened.click();
    }else await page.goto(`/proyectos/${project.id}/visor/${v2}?element=${WALL}&anterior=${v1}`);

    // v2: material texturado (userData/material), Propiedades › Material y el mismo encuadre contra v1 y la vista previa.
    await waitViewer(page);await page.waitForTimeout(2500);
    const finishes=await mark(page,"obracota:approved-finishes") as {finishes:string[];pieces:number;meshes:number;textured:boolean;guids:string[]};
    log("v2 acabados aprobados: "+JSON.stringify({...finishes,guids:finishes?.guids.length}));
    expect(finishes.finishes).toEqual(["Madera · claro"]);
    expect(finishes.textured).toBe(true);
    expect(finishes.pieces).toBeGreaterThan(10);
    expect(finishes.guids).toContain(WALL);
    if(!page.url().includes("element="+WALL)){
      await page.goto(`/proyectos/${project.id}/visor/${v2}?element=${WALL}&anterior=${v1}`);
      await waitViewer(page);await page.waitForTimeout(2500);
    }
    const v2Properties=await page.locator("#pane-properties").innerText();
    const v2Material=v2Properties.match(/Material\s*\n?\s*([^\n]*)/)?.[1]??"";
    log("v2 Propiedades › Material: "+v2Material);
    expect(v2Material).toContain("Madera · claro");
    await shot(page,"05-v2-propiedades");
    await deselect(page);
    const approved=await canvas.screenshot(CANVAS_ONLY);
    await shot(page,"06-v2-acabado-aprobado");
    const changed=await diff(page,base,approved),likePreview=await diff(page,preview,approved);
    log(`vista normal: v1↔v2 ${changed.toFixed(4)} · vista previa↔v2 ${likePreview.toFixed(4)}`);
    expect(changed).toBeGreaterThan(.06);
    expect(likePreview).toBeLessThan(changed/4);

    // Recorrido desde el frente del muro (encuadre actual): Anterior/Nueva desde el mismo punto.
    const controls=page.getByRole("toolbar",{name:"Controles del recorrido"});
    const front=await startWalk(page,[[.5,.85],[.45,.85],[.55,.85],[.5,.78],[.4,.8],[.6,.8],[.35,.87],[.65,.87],[.5,.7],[.3,.75],[.7,.75]]);
    expect(front,"el recorrido no arrancó frente al muro").not.toBeNull();
    await expect(page.locator(".walk-hint")).toContainText("Mayús para correr");
    await page.waitForTimeout(800);
    const nueva=await canvas.screenshot();
    await shot(page,"07-recorrido-nueva");
    const sky=await topColour(page,nueva);
    log("color de la franja superior en el recorrido: "+sky.join(","));
    const older=controls.getByRole("button",{name:"Anterior"}),newer=controls.getByRole("button",{name:"Nueva"});
    await older.click();await pressed(older);
    await expect(page.locator(".walk-hint")).toContainText("Arrastra para mirar",{timeout:300_000});
    await page.waitForTimeout(1500);
    const anterior=await canvas.screenshot();
    await shot(page,"08-recorrido-anterior");
    const walkDiff=await diff(page,nueva,anterior);
    log(`recorrido Anterior↔Nueva desde el mismo punto: ${walkDiff.toFixed(4)} · alineación ${JSON.stringify(await mark(page,"obracota:walk-switch"))}`);
    const previousFinishes=await mark(page,"obracota:approved-finishes") as {pieces:number};
    expect(previousFinishes.pieces).toBe(0);
    await newer.click();await pressed(newer);
    await expect(page.locator(".walk-hint")).toContainText("Arrastra para mirar",{timeout:300_000});
    expect(walkDiff).toBeGreaterThan(.05);

    // Caminar y correr de espaldas al muro.
    await look(page,785);await page.waitForTimeout(500);
    const before=digest(await canvas.screenshot());
    const walked=await hold(page,["w"],2600);
    const ran=await hold(page,["Shift","w"],2600);
    const after=digest(await canvas.screenshot());
    log(`marcha en Lantern: caminando ${JSON.stringify(walked)} · corriendo ${JSON.stringify(ran)} · vista cambió=${before!==after}`);
    await shot(page,"09-recorrido-tras-correr");
    expect(before).not.toBe(after);
    expect(ran?.running).toBe(true);
    if(walked && ran && walked.speed>.5)expect(ran.speed/walked.speed).toBeGreaterThan(2);
    if(GPU)expect(Math.min(walked?.fps??0,ran?.fps??0)).toBeGreaterThan(60);
    // Sigue respondiendo (sin congelarse) tras la carrera.
    const still=digest(await canvas.screenshot());
    await hold(page,["s"],1200);
    expect(digest(await canvas.screenshot())).not.toBe(still);
    await page.keyboard.press("Escape");await expect(controls).toBeHidden();

    // El recorrido empieza sobre la topografía (IfcSite) desde la vista superior.
    await page.getByRole("combobox",{name:"Cambiar orientación"}).selectOption("top");await page.waitForTimeout(1500);
    await shot(page,"10-vista-superior");
    const ring:[number,number][]=[];
    for(const r of [.12,.2,.28,.36])for(let k=0;k<8;k++)ring.push([.5+Math.cos(k*Math.PI/4)*r*.6,.5+Math.sin(k*Math.PI/4)*r]);
    let terrain=await startWalk(page,ring,start=>start.ifcType==="IFCSITE");
    if(!terrain){
      // Too close to the house: the whole model from above (Inicio), then the same ring.
      if(await controls.isVisible()){await page.keyboard.press("Escape");await expect(controls).toBeHidden();}
      await canvas.focus();await page.keyboard.press("Home");
      await page.getByRole("combobox",{name:"Cambiar orientación"}).selectOption("top");await page.waitForTimeout(1500);
      terrain=await startWalk(page,ring,start=>start.ifcType==="IFCSITE");
    }
    expect(terrain,"el recorrido no arrancó sobre el terreno").not.toBeNull();
    await page.waitForTimeout(800);
    const onTerrain=await canvas.screenshot();
    await shot(page,"11-recorrido-sobre-terreno");
    const terrainSky=await topColour(page,onTerrain);
    log("cielo sobre el terreno: "+terrainSky.join(","));
    const move=await hold(page,["Shift","w"],2600);
    log("carrera sobre el terreno: "+JSON.stringify(move));
    await shot(page,"12-terreno-tras-correr");
    if(GPU)expect(move?.fps??0).toBeGreaterThan(60);
    // El cielo reemplaza la retícula: la franja superior es azulada, no el gris claro de la página.
    expect(terrainSky[2]-terrainSky[0]).toBeGreaterThan(12);
    await page.keyboard.press("Escape");
  });

  test("Sports Complex: el recorrido empieza sobre la topografía, corre con Mayús y se mantiene fluido",async({page})=>{
    test.setTimeout(900_000);
    log(`\n# Sports Complex · ${new Date().toISOString()} · GPU=${GPU}`);
    page.on("pageerror",e=>log("[pageerror] "+String(e).slice(0,300)));
    const project=await newProject(page,"Recorrido Sports Complex");
    const v1=await uploadByApi(page,project,MODELS.sports);
    await page.goto(`/proyectos/${project.id}/visor/${v1.id}`);
    await waitViewer(page);await page.waitForTimeout(2000);
    await page.getByRole("combobox",{name:"Cambiar orientación"}).selectOption("top");await page.waitForTimeout(1500);
    await shot(page,"20-sports-superior");
    const ring:[number,number][]=[];
    for(const r of [.1,.18,.26,.34])for(let k=0;k<8;k++)ring.push([.5+Math.cos(k*Math.PI/4)*r*.6,.5+Math.sin(k*Math.PI/4)*r]);
    const start=await startWalk(page,ring,s=>s.ifcType==="IFCSITE");
    expect(start,"el recorrido no arrancó sobre el terreno").not.toBeNull();
    const canvas=page.locator(".view canvas");
    await page.waitForTimeout(800);
    await shot(page,"21-sports-inicio-frente-al-edificio");
    // The walk starts facing the building; turn around to the open terrain.
    await look(page,785,40);await page.waitForTimeout(800);
    const first=await canvas.screenshot();
    await shot(page,"21-sports-sobre-terreno");
    const sky=await topColour(page,first);
    log("cielo en Sports Complex: "+sky.join(","));
    const walked=await hold(page,["w"],2600);
    const ran=await hold(page,["Shift","w"],2600);
    log(`marcha en Sports Complex: caminando ${JSON.stringify(walked)} · corriendo ${JSON.stringify(ran)}`);
    await shot(page,"22-sports-tras-correr");
    expect(ran?.running).toBe(true);
    if(walked && ran && walked.speed>.5)expect(ran.speed/walked.speed).toBeGreaterThan(2);
    if(GPU)expect(Math.min(walked?.fps??0,ran?.fps??0)).toBeGreaterThan(60);
    expect(sky[2]-sky[0]).toBeGreaterThan(12);
    // Mirar alrededor y seguir caminando: nada se congela.
    await look(page,500,-60);
    const still=digest(await canvas.screenshot());
    await hold(page,["d"],1200);
    expect(digest(await canvas.screenshot())).not.toBe(still);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("toolbar",{name:"Controles del recorrido"})).toBeHidden();
  });
});
