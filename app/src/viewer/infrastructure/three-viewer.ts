import * as T from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {PlanSheet} from "./plan-sheet";
import { loadModel, type SceneModel } from "./model-source";
import { walking, walkWorld, type WalkWorld } from "./walk";
import { batchWalkGeometry, type WalkBatches } from "./walk-batches";
import { exteriorPreview } from "./exterior-finish";
import { sceneEnvironment } from "./scene-environment";
import type { ElementInfo, GroupCaptureView, ViewerPort, ViewDirection,CameraPose} from "../domain/viewer.port";

function release(root:T.Object3D) {
  const geometry = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
  root.traverse(node => {
    if (!(node instanceof T.Mesh || node instanceof T.LineSegments || node instanceof T.Points)) return;
    geometry.add(node.geometry);
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) materials.add(m);
  });
  geometry.forEach(g=>g.dispose());
  materials.forEach(m=>{(m as T.Material & {map?:T.Texture|null}).map?.dispose();m.dispose();});
}

type EntityMark={start:number;handle:string;type:string};
/** The DWG entity whose vertices hold `index`: the last mark that starts at or before it. */
function entityAt(marks:readonly EntityMark[]|undefined,index:number){
  if(!marks?.length || !(index>=0))return undefined;
  let low=0,high=marks.length-1;
  while(low<high){const mid=(low+high+1)>>1;if(marks[mid].start<=index)low=mid;else high=mid-1;}
  return marks[low].start<=index?marks[low]:undefined;
}
const ENTITY_NAMES:Record<string,string>={INSERT:"Bloque",LINE:"Línea",LWPOLYLINE:"Polilínea",POLYLINE2D:"Polilínea",POLYLINE3D:"Polilínea 3D",
  ARC:"Arco",CIRCLE:"Círculo",ELLIPSE:"Elipse",POINT:"Punto","3DFACE":"Cara 3D",PFACE_MESH:"Malla",TEXT:"Texto",MTEXT:"Texto",DIMENSION:"Cota",
  "3DSOLID":"Sólido",BODY:"Cuerpo",REGION:"Región"};
export const entityName=(type:string,handle:string,detail?:string)=>(ENTITY_NAMES[type]??type)+" "+handle+(detail?" · "+detail:"");

/** cubic-bezier(.22, 1, .36, 1): the curve of the presentation slides (--ease-slide in theme.css). */
function slideEase(t:number){
  const cx=.66,bx=3*(.36-.22)-cx,ax=1-cx-bx,cy=3,by=-3,ay=1;
  let s=t;
  for(let i=0;i<8;i++){
    const error=((ax*s+bx)*s+cx)*s-t,slope=(3*ax*s+2*bx)*s+cx;
    if(Math.abs(error)<1e-6 || Math.abs(slope)<1e-6)break;
    s=Math.min(1,Math.max(0,s-error/slope));
  }
  return ((ay*s+by)*s+cy)*s;
}

export function createViewer(container: HTMLElement, onPick:(id:string|null)=>void, onLost:()=>void, onWindowEnd:()=>void): ViewerPort {
  const renderer = new T.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label","Vista tridimensional del modelo. Usa el explorador para seleccionar con teclado.");
  container.appendChild(canvas);
  const scene = new T.Scene();
  const sky=new T.HemisphereLight(0xffffff,0x9f9685,2);
  scene.add(sky);
  const sun = new T.DirectionalLight(0xfff4db,2.1);
  sun.position.set(6,10,7);
  scene.add(sun);
  const camera = new T.OrthographicCamera(-1,1,1,-1,0.01,1000);
  const controls = new OrbitControls(camera,canvas);
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.mouseButtons.MIDDLE = T.MOUSE.PAN;
  controls.minZoom = 0.0001;
  controls.maxZoom = 1e7;
  canvas.tabIndex = 0;
  controls.listenToKeyEvents(canvas);
  let offsetX = 0, offsetY = 0;
  let root:T.Group|null = null, disposed = false, baseHeight = 1, baseWidth = 1;
  let activeModel:SceneModel|undefined, originalFile:File|null=null;
  let walk:ReturnType<typeof walking>|undefined, markFloor:((result:string|null)=>void)|undefined;
  let walkBatches: WalkBatches | null = null;
  let walkModel: SceneModel | undefined;
  let walkSelection: string | null = null;
  let walkOrbitSelection: string | null = null;
  let selectedForWalk:string|null=null;
  // Keyed by the file on screen; null is the ReStage sample, which is opened without one.
  const walkModels=new Map<File|null,{model:SceneModel;world:WalkWorld}>();
  const originals = new Map<T.Mesh|T.LineSegments|T.Points,T.Material|T.Material[]>();
  const highlightedLines=new T.LineBasicMaterial({color:0xff6900});
  const highlightedPoints=new T.PointsMaterial({color:0xff6900,size:4,sizeAttenuation:false});
  // A selection is an annotation colour. Imported normals and scene lighting must not tint it.
  const highlight = new T.MeshBasicMaterial({color:0xff6900,side:T.DoubleSide,toneMapped:false});
  const bounds = new T.Box3();
  const cssAxes = new T.Matrix4().makeScale(1,-1,1);
  const cubeRotation = new T.Matrix4();
  const drawingAxes=[new T.Vector3(1,0,0),new T.Vector3(0,0,-1),new T.Vector3(0,1,0)];
  const axis=new T.Vector3();
  let annotations=new Map<string,ElementInfo>();
  const span=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:0xff6900,depthTest:false}));
  span.renderOrder=10;span.visible=false;scene.add(span);
  const selectedOrder=new Map<T.Object3D,number>();
  let anchor:T.Vector3|null=null;
  const marker=document.createElement("div");
  marker.className="note-marker";marker.hidden=true;marker.setAttribute("aria-hidden","true");
  container.appendChild(marker);
  let sheet:PlanSheet|undefined;
  let fitting=false;
  // Overlays anchored to the model (Editar marks) follow every frame drawn.
  const frameListeners=new Set<()=>void>();
  // Editar › Seleccionar: the left button draws marks instead of orbiting or picking.
  let marking=false,panning=false;
  const hint=document.createElement("div");
  hint.className="plan-location-hint";hint.setAttribute("role","status");hint.hidden=true;
  container.appendChild(hint);
  function constrainPlan(){
    if(!sheet)return;
    const target=controls.target,box=sheet.bounds;
    const width=(camera.right-camera.left)/camera.zoom,height=(camera.top-camera.bottom)/camera.zoom;
    const x=T.MathUtils.clamp(target.x,box.min.x,box.max.x);
    const z=T.MathUtils.clamp(target.z,box.min.z,box.max.z);
    const stroke=sheet.nearest(new T.Vector3(x,target.y,z));
    const dx=(stroke?T.MathUtils.clamp(x,stroke.x-width*.38,stroke.x+width*.38):x)-target.x;
    const dz=(stroke?T.MathUtils.clamp(z,stroke.z-height*.38,stroke.z+height*.38):z)-target.z;
    target.x+=dx;target.z+=dz;camera.position.x+=dx;camera.position.z+=dz;
    camera.updateMatrixWorld();
  }
  function draw() {
    if (disposed || fitting || walk) return;
    constrainPlan();
    controls.rotateSpeed = T.MathUtils.clamp(1/Math.sqrt(camera.zoom),0.15,1.4);
    cubeRotation.makeRotationFromQuaternion(camera.quaternion).transpose().premultiply(cssAxes).multiply(cssAxes);
    container.parentElement?.style.setProperty("--cube-pose","matrix3d("+cubeRotation.elements.join(",")+")");
    container.parentElement?.querySelectorAll<SVGGElement>("[data-axis]").forEach((g,i)=>{
      axis.copy(drawingAxes[i]).transformDirection(camera.matrixWorldInverse);
      const line=g.firstElementChild!,label=g.lastElementChild!;
      line.setAttribute("x2",String(34+axis.x*17));line.setAttribute("y2",String(28-axis.y*17));
      label.setAttribute("x",String(34+axis.x*24));label.setAttribute("y",String(28-axis.y*24));
    });
    renderer.render(scene,camera);
    if(anchor){
      const point=anchor.clone().project(camera);
      marker.hidden=Math.abs(point.x)>1 || Math.abs(point.y)>1 || Math.abs(point.z)>1;
      marker.style.left=(point.x+1)*50+"%";marker.style.top=(1-point.y)*50+"%";
    }
    frameListeners.forEach(listener=>listener());
  }
  function resize() {
    const width = Math.max(container.clientWidth,1), height = Math.max(container.clientHeight,1);
    const aspect = width / height, span = Math.max(baseHeight,baseWidth/aspect);
    camera.left = offsetX-span*aspect/2; camera.right = offsetX+span*aspect/2;
    camera.top = offsetY+span/2; camera.bottom = offsetY-span/2;
    camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
    draw();
  }
  let plan=false;
  let initialPlanBounds:T.Box3|undefined;
  /** The building without a site topography far larger than it (see open), framed first; undefined = everything. */
  let initialModelBounds:T.Box3|undefined;
  function fit(reset=true,region?:T.Box3,from?:T.Vector3,useRoom=true) {
    if(plan && !region)region=initialPlanBounds;
    if(!plan && !region && reset)region=initialModelBounds;
    if (!root) return;
    stopTween();
    const center = (region??bounds).getCenter(new T.Vector3());
    const radius = Math.max(bounds.getSize(new T.Vector3()).length(),0.1);
    const direction = plan ? new T.Vector3(0,1,0.000001).normalize() : from ?? (reset ? new T.Vector3(1,0.65,1.45).normalize() : camera.getWorldDirection(new T.Vector3()).negate());
    offsetX=0;offsetY=0;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction,radius*2);
    camera.near = radius/10000; camera.far = radius*12; camera.zoom = 1;
    camera.lookAt(center); camera.updateMatrixWorld();
    // Frame the projected corners in the actual canvas, including portrait aspect ratios.
    const planeBounds = new T.Box3(), transform = new T.Matrix4();
    if(region)planeBounds.copy(region).applyMatrix4(camera.matrixWorldInverse);
    else root.traverse(node=>{
      if (!(node instanceof T.Mesh || node instanceof T.LineSegments || node instanceof T.Points)) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      transform.multiplyMatrices(camera.matrixWorldInverse,node.matrixWorld);
      planeBounds.union(node.geometry.boundingBox.clone().applyMatrix4(transform));
    });
    const projected = planeBounds.getSize(new T.Vector3());
    const offset = planeBounds.getCenter(new T.Vector3());offset.z=0;
    offset.applyQuaternion(camera.quaternion);camera.position.add(offset);controls.target.add(offset);
    // A 3D model is framed inside the room the floating panels leave free; a 2D sheet and the
    // reference pictures taken for Editar's piece selection use the whole canvas.
    const width=Math.max(container.clientWidth,1),height=Math.max(container.clientHeight,1);
    const room=plan || !useRoom?{top:0,right:0,bottom:0,left:0}:frameInsets(width,height);
    const innerWidth=width-room.left-room.right,innerHeight=height-room.top-room.bottom;
    baseWidth = Math.max(projected.x,0.01)*1.08*width/innerWidth;
    baseHeight = Math.max(projected.y,0.01)*1.08*height/innerHeight;
    // Shift the frustum so the model sits in the middle of that room (offsets are in world units).
    const unit=Math.max(baseHeight,baseWidth/(width/height))/height;
    offsetX=(room.right-room.left)/2*unit;
    offsetY=(room.top-room.bottom)/2*unit;
    fitting=true;controls.update();fitting=false;resize();
  }
  /**
   * Space kept free around a framed model, read from the --fit-top/right/bottom/left custom properties
   * (plain px values) that the workspace sets. Each axis keeps at least half of the canvas.
   */
  function frameInsets(width:number,height:number){
    const style=getComputedStyle(container);
    const read=(name:string)=>Math.max(0,parseFloat(style.getPropertyValue(name))||0);
    const room={top:read("--fit-top"),right:read("--fit-right"),bottom:read("--fit-bottom"),left:read("--fit-left")};
    const across=room.left+room.right,down=room.top+room.bottom;
    if(across>width/2){const k=width/2/across;room.left*=k;room.right*=k;}
    if(down>height/2){const k=height/2/down;room.top*=k;room.bottom*=k;}
    return room;
  }
  const motion=window.matchMedia("(prefers-reduced-motion: reduce)");
  const orange=new T.Color(0xff6900),annotationInk=new T.Color(0x35404a);
  type ColoredMaterial=T.Material & {color:T.Color};
  const tinted=new Map<T.Material,ColoredMaterial>();
  let pulseTimer:number|undefined,pulseActive=false;
  function endPulse(){
    window.clearTimeout(pulseTimer);
    for(const material of tinted.values())material.dispose();
    tinted.clear();pulseActive=false;
    marker.style.removeProperty("--selection-color");
    span.material.color.copy(orange);
  }
  function pulseMaterial(source:T.Material){
    if(!("color" in source) || !(source.color instanceof T.Color))return source;
    let copy=tinted.get(source);
    if(!copy){
      copy=source.clone() as ColoredMaterial;
      // clone() leaves out the shader hooks: an approved finish keeps its textures while it pulses.
      copy.onBeforeCompile=source.onBeforeCompile;copy.customProgramCacheKey=source.customProgramCacheKey;
      tinted.set(source,copy);
    }
    return copy;
  }
  function pulsePreference(){
    if(!pulseActive)return;
    window.clearTimeout(pulseTimer);
    originals.forEach((source,node)=>{
      // A text of a plan keeps its letters: its own texture tinted orange, never a solid block.
      node.material=node instanceof T.Mesh?(node.userData.label && !Array.isArray(source)?labelHighlight(source):highlight)
        :node instanceof T.Points?highlightedPoints:highlightedLines;
    });
    marker.style.removeProperty("--selection-color");span.material.color.copy(orange);
    renderer.render(scene,camera);
    if(motion.matches || document.hidden)return;
    pulseTimer=window.setTimeout(()=>{
      originals.forEach((source,node)=>{
        node.material=Array.isArray(source)?source.map(pulseMaterial):pulseMaterial(source);
      });
      const start=performance.now();
      function tick(){
        // A slow fade with a brief hold at each end, one cycle every two seconds.
        const weight=T.MathUtils.clamp(.5+.65*Math.cos((performance.now()-start)*Math.PI/1000),0,1);
        tinted.forEach((copy,source)=>copy.color.copy((source as ColoredMaterial).color).lerp(orange,weight));
        span.material.color.copy(annotationInk).lerp(orange,weight);
        marker.style.setProperty("--selection-color","#"+span.material.color.getHexString());
        if(tinted.size || span.visible)renderer.render(scene,camera);
        pulseTimer=window.setTimeout(tick,50);
      }
      tick();
    },3000);
  }
  motion.addEventListener("change",pulsePreference);
  document.addEventListener("visibilitychange",pulsePreference);
  const previewMaterial=new T.MeshStandardMaterial({side:T.DoubleSide});
  // A selected text of a plan stays legible: its own texture, tinted orange (one copy per text, freed with the model).
  const labelHighlights=new Map<T.Material,T.Material>();
  function labelHighlight(source:T.Material){
    let copy=labelHighlights.get(source);
    if(!copy){copy=source.clone();(copy as T.MeshBasicMaterial).color.set(0xff6900);labelHighlights.set(source,copy);}
    return copy;
  }
  function clearLabelHighlights(){labelHighlights.forEach(material=>material.dispose());labelHighlights.clear();}
  /**
   * Pieces taken out of the view because they stood between the camera and a located piece (see locate): out of the
   * camera's and the raycaster's layer, so they are neither drawn nor picked. A camera gesture, a picture, the walk or
   * the next framing brings them back; another model drops them.
   */
  const veiled:[T.Object3D,number][]=[];
  function unveil(){
    if(!veiled.length)return;
    for(const [node,mask] of veiled.splice(0))node.layers.mask=mask;
    draw();
  }
  function select(id:string|null, group?:Set<string>,color?:string) {
    // The veil stays while the camera stays: a mark placed on the located piece must not end up behind the
    // pieces that come back (marks hide when their piece is out of sight). Moving the camera lifts it.
    endPulse();
    selectedForWalk=id??(group?.size===1?group.values().next().value??null:null);
    hint.hidden=true;
    const note=id?annotations.get(id):undefined;
    anchor=note?.annotation?new T.Vector3(...note.annotation.anchor):null;
    span.visible=!!(anchor && note?.dimension);
    if(span.visible && anchor && note?.dimension && note.annotation){
      const [x,y,z]=note.annotation.position;
      const p=note.dimension.endpoints;
      const points=[0,3].map(i=>anchor!.clone().add(new T.Vector3(p[i]-x,p[i+2]-z,y-p[i+1])));
      span.geometry.setFromPoints(points);span.geometry.computeBoundingSphere();
    }
    marker.dataset.label=note?.name??"";
    marker.hidden=!anchor;
    originals.forEach((material,mesh)=>{mesh.material = material;});
    selectedOrder.forEach((order,node)=>{node.renderOrder=order;});selectedOrder.clear();
    originals.clear();
    if(color)previewMaterial.color.set(color);
    if (id || group?.size) root?.traverse(mesh=>{
      if ((mesh instanceof T.Mesh || mesh instanceof T.LineSegments || mesh instanceof T.Points) && (group?group.has(mesh.userData.elementId):mesh.userData.elementId === id)) {
        originals.set(mesh,mesh.material);
        if(plan){selectedOrder.set(mesh,mesh.renderOrder);mesh.renderOrder=5;}
        mesh.material = mesh instanceof T.Mesh ? (mesh.userData.label?labelHighlight(mesh.material as T.Material):color?previewMaterial:highlight)
          : mesh instanceof T.Points ? highlightedPoints : highlightedLines;
      }
    });
    draw();
  }
  // Renderizar › Ver en el modelo 3D: a selected piece keeps its highlight; the finish waits in `originals`.
  const exterior=exteriorPreview(scene,renderer,sky,sun,{
    get:mesh=>originals.has(mesh)?originals.get(mesh)!:mesh.material,
    set:(mesh,material)=>{if(originals.has(mesh))originals.set(mesh,material);else mesh.material=material;},
    redraw:()=>draw(),
  });
  // «Recorrer esta escena en 3D»: sky, ground, trees and weather around the model, kept during the walk.
  const environment=sceneEnvironment({scene,renderer,hemisphere:sky,sun,bounds:()=>bounds,
    redraw:()=>{if(walk)walk.redraw();else draw();},
    mark:state=>{
      const stage=container.closest<HTMLElement>(".stage")??container;
      if(state)stage.dataset.environment=state;else delete stage.dataset.environment;
    }});
  // The walk's sky: a gradient dome around the walker instead of the canvas dot grid. A scene with surroundings
  // («Recorrer esta escena en 3D») brings its own sky, and then this one stays hidden.
  const walkSky=new T.Mesh(new T.SphereGeometry(1,32,16),new T.ShaderMaterial({
    uniforms:{top:{value:new T.Color(0x6f9fd8)},horizon:{value:new T.Color(0xe4edf5)},bottom:{value:new T.Color(0xd2ccc0)}},
    vertexShader:"varying vec3 vDir;\nvoid main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader:`uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
void main(){
  float h = normalize(vDir).y;
  vec3 color = h > 0.0 ? mix(horizon, top, pow(min(h * 1.4, 1.0), 0.8)) : mix(horizon, bottom, min(-h * 6.0, 1.0));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`,side:T.BackSide,depthWrite:false,depthTest:false,fog:false,toneMapped:false}));
  walkSky.name="obracota-walk-sky";walkSky.renderOrder=-20;walkSky.frustumCulled=false;walkSky.visible=false;
  // Centred on the eye and inside the far plane, so it is always behind the model and never clipped.
  walkSky.onBeforeRender=(_renderer,_scene,view)=>{
    walkSky.position.copy(view.position);walkSky.scale.setScalar((view as T.PerspectiveCamera).far*.5||500);walkSky.updateMatrixWorld();
  };
  scene.add(walkSky);
  function renderWalk(view:T.Camera){
    const surroundings=environment.current();
    walkSky.visible=!surroundings || surroundings.surroundings==="none";
    renderer.render(scene,view);
  }
  function locateOnPlan(id:string) {
    const forward=camera.getWorldDirection(new T.Vector3());
    // The cursor zoom can shift the frustum away from the OrbitControls target.
    const center=new T.Vector3(0,0,0).unproject(camera);
    center.addScaledVector(forward,controls.target.clone().sub(center).dot(forward));
    const destination=new T.Vector3();
    const previousZoom=camera.zoom;
    const note=annotations.get(id)?.annotation;
    if(note){
      destination.fromArray(note.anchor);
      const detailSpan=Math.max(note.height*36,0.02)*1.08;
      const detailZoom=Math.min(camera.right-camera.left,camera.top-camera.bottom)/detailSpan;
      camera.zoom=Math.max(camera.zoom,Math.min(controls.maxZoom,detailZoom));
    }else{
      // A DWG row may group disconnected geometry. Its bounding-box centre
      // can lie kilometres from any line. Find an actual point near the reader.
      const a=new T.Vector3(),b=new T.Vector3(),candidate=new T.Vector3();
      const segment=new T.Line3(a,b);
      let best=Infinity;
      root?.traverse(node=>{
        if(node.userData.elementId!==id || !(node instanceof T.LineSegments || node instanceof T.Points || node instanceof T.Mesh))return;
        const positions=node.geometry.getAttribute("position"),index=node.geometry.index;
        const count=index?.count??positions.count;
        const lines=node instanceof T.LineSegments;
        for(let i=0;i<count;i+=lines?2:1){
          a.fromBufferAttribute(positions,index?index.getX(i):i).applyMatrix4(node.matrixWorld);
          if(lines && i+1<count){
            b.fromBufferAttribute(positions,index?index.getX(i+1):i+1).applyMatrix4(node.matrixWorld);
            if(!a.equals(b))segment.closestPointToPoint(center,true,candidate);
            else continue;
          }else candidate.copy(a);
          const distance=candidate.distanceToSquared(center);
          if(distance<best){best=distance;destination.copy(candidate);}
        }
      });
      if(!Number.isFinite(best)){
        hint.textContent="La capa carece de trazos visibles para localizar. Se conserva la vista.";hint.hidden=false;return;
      }
    }
    if(sheet){
      const stroke=sheet.nearest(destination);
      if(!sheet.bounds.clone().expandByScalar(Math.max(sheet.size.x,sheet.size.z)*.025).containsPoint(destination)){
        camera.zoom=previousZoom;
        hint.textContent="Referencia fuera del área principal. Se conserva la vista de trabajo.";
        hint.hidden=false;
        camera.updateProjectionMatrix();draw();return;
      }
      if(stroke){
        // For annotations include a second nearby stroke sample so an isolated
        // point or a short segment cannot be the only visible drawing context.
        const context=note?(sheet.nearest(destination,stroke)??stroke):stroke;
        const contextZoom=Math.min(
          (camera.right-camera.left)/Math.max(2.8*Math.max(Math.abs(context.x-destination.x),Math.abs(stroke.x-destination.x)),.00001),
          (camera.top-camera.bottom)/Math.max(2.8*Math.max(Math.abs(context.z-destination.z),Math.abs(stroke.z-destination.z)),.00001));
        camera.zoom=T.MathUtils.clamp(Math.min(camera.zoom,contextZoom),controls.minZoom,controls.maxZoom);
      }
    }
    if(!note){
      anchor=destination.clone();marker.dataset.label=id.split("/")[0];
    }
    const delta=destination.sub(center);
    delta.addScaledVector(forward,-delta.dot(forward));
    camera.position.add(delta);controls.target.add(delta);
    camera.updateProjectionMatrix();controls.update();draw();
  }
  function locate(id:string){
    if(plan){
      locateOnPlan(id);pulseActive=hint.hidden && (!!anchor || originals.size>0);pulsePreference();return;
    }
    const note=annotations.get(id)?.annotation;
    const region=new T.Box3();
    if(note){
      const center=new T.Vector3(...note.anchor);
      region.set(center.clone(),center.clone()).expandByScalar(Math.max(note.height*18,0.01));
    } else {
      root?.traverse(node=>{if(node.userData.elementId===id)region.expandByObject(node);});
    }
    if(region.isEmpty())return;
    if(note)fit(false,region);else frameInSight(region,new Set([id]));
    pulseActive=true;pulsePreference();
  }
  /**
   * A piece inside the building (a door, an interior wall) is often behind a roof or a facade from the current
   * direction. Keep the direction when it sees the pieces; otherwise frame them from the side that sees them best,
   * and take out of the view whatever still stands in front (unveil brings it back).
   */
  function frameInSight(region:T.Box3,ids:Set<string>){
    unveil();
    if(!root){fit(false,region);return;}
    const center=region.getCenter(new T.Vector3());
    const samples=[center,...[0,1,2,3,4,5,6,7].map(k=>new T.Vector3(k&1?region.max.x:region.min.x,k&2?region.max.y:region.min.y,k&4?region.max.z:region.min.z).lerp(center,.3))];
    const reach=bounds.getSize(new T.Vector3()).length()*2+1,ray=new T.Raycaster(),model=root;
    function sight(direction:T.Vector3){
      let seen=0;const occluders=new Set<T.Object3D>();
      for(const point of samples){
        ray.set(point.clone().addScaledVector(direction,reach),direction.clone().negate());ray.far=reach*2;
        const before:T.Object3D[]=[];
        for(const hit of ray.intersectObject(model,true)){
          if(!(hit.object instanceof T.Mesh))continue;
          if(ids.has(hit.object.userData.elementId)){seen++;for(const node of before)occluders.add(node);break;}
          before.push(hit.object);
        }
      }
      return {seen,occluders};
    }
    const directions=[camera.getWorldDirection(new T.Vector3()).negate(),new T.Vector3(1,.65,1.45).normalize(),
      ...[0,1,2,3].map(k=>new T.Vector3(Math.cos(k*Math.PI/2),.45,Math.sin(k*Math.PI/2)).normalize()),new T.Vector3(.05,1,.08).normalize()];
    let best=directions[0],view=sight(best);
    for(const direction of directions.slice(1)){
      if(view.seen===samples.length && !view.occluders.size)break;
      const next=sight(direction);
      if(next.seen>view.seen || next.seen===view.seen && next.occluders.size<view.occluders.size){best=direction;view=next;}
    }
    fit(false,region,best);
    for(const node of view.occluders){veiled.push([node,node.layers.mask]);node.layers.mask=0;}
    if(view.occluders.size)draw();
  }
  /**
   * Editar on a plan: the text under the click, else a dimension or text whose anchor is within a few pixels (dimensions
   * are listed, not drawn), else the entity of the stroke under it (an INSERT stands for its whole block).
   */
  function planProbe(x:number,y:number){
    if(!root)return null;
    const rect=canvas.getBoundingClientRect(),ray=new T.Raycaster();
    ray.params.Line.threshold=(camera.top-camera.bottom)/camera.zoom/rect.height*4;
    ray.params.Points.threshold=ray.params.Line.threshold;
    ray.setFromCamera(new T.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);
    const hits=ray.intersectObject(root,true).filter(item=>typeof item.object.userData.elementId==="string");
    const label=hits.find(item=>item.object.userData.label);
    const point=(value:T.Vector3):[number,number,number]=>[value.x,value.y,value.z];
    const annotation=(id:string,at:T.Vector3)=>{
      const item=annotations.get(id),note=item?.annotation;
      if(!item || !note?.handle)return null;
      return {id,point:point(at),entity:{handle:note.handle,type:item.type,name:entityName(item.type,note.handle,item.name.slice(0,60))}};
    };
    if(label){const found=annotation(label.object.userData.elementId,label.point);if(found)return found;}
    let near:{id:string;distance:number;at:T.Vector3}|null=null;
    const projected=new T.Vector3();
    for(const [id,item] of annotations){
      const note=item.annotation;
      if(!note)continue;
      projected.set(note.anchor[0],note.anchor[1],note.anchor[2]).project(camera);
      const distance=Math.hypot((projected.x+1)/2*rect.width+rect.left-x,(1-projected.y)/2*rect.height+rect.top-y);
      if(distance<=12 && (!near || distance<near.distance))near={id,distance,at:new T.Vector3(...note.anchor)};
    }
    if(near){const found=annotation(near.id,near.at);if(found)return found;}
    const hit=hits[0];
    if(!hit)return null;
    const object=hit.object,id=object.userData.elementId as string;
    const index=object instanceof T.Mesh?(hit.face?.a??-1):(hit.index??-1);
    const mark=entityAt(object.userData.entities,index);
    return {id,point:point(hit.point),...(mark?{entity:{handle:mark.handle,type:mark.type,name:entityName(mark.type,mark.handle,object.userData.layer)}}:{})};
  }
  function hitAt(x:number,y:number) {
    if (!root) return;
    const rect = canvas.getBoundingClientRect(), ray = new T.Raycaster();
    ray.params.Line.threshold = (camera.top-camera.bottom)/camera.zoom/rect.height*3;
    ray.params.Points.threshold=ray.params.Line.threshold;
    ray.setFromCamera(new T.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);
    return ray.intersectObject(root,true).find(hit=>hit.object.userData.elementId);
  }
  function groundAt(x:number,y:number){
    const ground=environment.ground();
    if(!ground)return;
    const rect=canvas.getBoundingClientRect(),ray=new T.Raycaster();
    ray.setFromCamera(new T.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);
    return ray.intersectObject(ground,false)[0];
  }
  function pivotAt(point:T.Vector3) {
    // OrbitControls looks at its target. Shift the orthographic frustum in the
    // opposite direction so placing a pivot off-centre preserves every pixel.
    const delta = point.clone().sub(controls.target);
    const local = delta.clone().applyQuaternion(camera.quaternion.clone().invert());
    offsetX -= local.x; offsetY -= local.y;
    controls.target.copy(point);camera.position.add(delta);
    controls.update();resize();
  }
  const directions:Record<ViewDirection,number[]> = {front:[0,0,1],back:[0,0,-1],right:[1,0,0],left:[-1,0,0],top:[0,1,0.000001],bottom:[0,-1,0.000001],iso:[1,1,1]};
  function viewSpan(){
    const width=Math.max(container.clientWidth,1),height=Math.max(container.clientHeight,1);
    return Math.max(baseHeight,baseWidth/(width/height));
  }
  function pose():CameraPose|null {
    if(plan || walk || !root)return null;
    // Cursor zoom leaves the frustum off-centre; fold that shift into the saved position.
    const shift=new T.Vector3(offsetX,offsetY,0).applyQuaternion(camera.quaternion);
    const position=camera.position.clone().add(shift),target=controls.target.clone().add(shift);
    return {position:[position.x,position.y,position.z],target:[target.x,target.y,target.z],span:viewSpan()/camera.zoom};
  }
  function setPose(position:T.Vector3,target:T.Vector3,height:number) {
    offsetX=0;offsetY=0;
    camera.position.copy(position);controls.target.copy(target);
    camera.lookAt(controls.target);
    camera.zoom=T.MathUtils.clamp(viewSpan()/height,controls.minZoom,controls.maxZoom);
    fitting=true;controls.update();fitting=false;resize();
  }
  // Camera moves between saved views (presentation, ↑/↓): one at a time, cancelled by any other camera action.
  let tween:number|undefined;
  function stopTween(){if(tween!==undefined){cancelAnimationFrame(tween);tween=undefined;}}
  controls.addEventListener("start",()=>{stopTween();unveil();});
  function applyPose(next:CameraPose,duration=0) {
    if(plan || walk || !root || !(next.span>0))return;
    stopTween();
    const endPosition=new T.Vector3().fromArray(next.position),endTarget=new T.Vector3().fromArray(next.target);
    const from=pose();
    if(!(duration>0) || motion.matches || !from || !(from.span>0)){setPose(endPosition,endTarget,next.span);return;}
    // The target travels in a straight line; the eye turns around it (no cut through the model)
    // and the visible height changes on a log scale, so zooming in and out feel alike.
    const startTarget=new T.Vector3().fromArray(from.target);
    const startOffset=new T.Vector3().fromArray(from.position).sub(startTarget),endOffset=endPosition.clone().sub(endTarget);
    const startLength=startOffset.length(),endLength=endOffset.length();
    if(!(startLength>0) || !(endLength>0)){setPose(endPosition,endTarget,next.span);return;}
    const startDirection=startOffset.clone().divideScalar(startLength);
    const turn=new T.Quaternion().setFromUnitVectors(startDirection,endOffset.clone().divideScalar(endLength));
    const still=new T.Quaternion(),step=new T.Quaternion(),target=new T.Vector3(),eye=new T.Vector3();
    const fromSpan=Math.log(from.span),toSpan=Math.log(next.span),begin=performance.now();
    const frame=(now:number)=>{
      const t=Math.min(1,(now-begin)/duration),k=slideEase(t);
      if(t>=1){tween=undefined;setPose(endPosition,endTarget,next.span);return;}
      step.copy(still).slerp(turn,k);
      target.copy(startTarget).lerp(endTarget,k);
      eye.copy(startDirection).applyQuaternion(step).multiplyScalar(T.MathUtils.lerp(startLength,endLength,k)).add(target);
      setPose(eye,target,Math.exp(T.MathUtils.lerp(fromSpan,toSpan,k)));
      tween=requestAnimationFrame(frame);
    };
    tween=requestAnimationFrame(frame);
  }
  function orient(view:ViewDirection) {
    if(plan)return;
    stopTween();
    const distance = camera.position.distanceTo(controls.target);
    camera.position.copy(controls.target).addScaledVector(new T.Vector3().fromArray(directions[view]).normalize(),distance);
    controls.update();draw();
  }
  let pointer:T.Vector2|null = null;
  let windowMode=false, corner:T.Vector2|null=null, windowPointer:number|undefined;
  let lastMiddle:{time:number;x:number;y:number}|null=null;
  const box = document.createElement("div");box.className="zoom-rectangle";box.hidden=true;container.append(box);
  function exitWindow() {
    if(windowPointer!==undefined && canvas.hasPointerCapture(windowPointer))canvas.releasePointerCapture(windowPointer);
    windowMode=false;corner=null;windowPointer=undefined;box.hidden=true;canvas.style.cursor="";onWindowEnd();
  }
  function point(e:PointerEvent) {
    const r=canvas.getBoundingClientRect();
    return new T.Vector2(T.MathUtils.clamp(e.clientX-r.left,0,r.width),T.MathUtils.clamp(e.clientY-r.top,0,r.height));
  }
  function down(e:PointerEvent) {
    canvas.focus({preventScroll:true});
    if (windowMode && e.button===0) {
      e.stopImmediatePropagation();canvas.setPointerCapture(e.pointerId);windowPointer=e.pointerId;corner=point(e);return;
    }
    if (e.button===1) {
      e.preventDefault();
      if(lastMiddle && performance.now()-lastMiddle.time<350 && Math.hypot(e.clientX-lastMiddle.x,e.clientY-lastMiddle.y)<5){
        lastMiddle=null;e.stopImmediatePropagation();fit(false);return;
      }
      lastMiddle={time:performance.now(),x:e.clientX,y:e.clientY};
    }
    const orbitButton=(e.button===0 && controls.mouseButtons.LEFT===T.MOUSE.ROTATE) || (e.button===2 && controls.mouseButtons.RIGHT===T.MOUSE.ROTATE);
    if (!plan && ((e.button===1 && e.shiftKey) || (orbitButton && !e.shiftKey))) {
      const hit=hitAt(e.clientX,e.clientY);if(hit)pivotAt(hit.point);
    }
  }
  function move(e:PointerEvent) {
    if(pointer && Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>4)pointer=null;
    if(lastMiddle && Math.hypot(e.clientX-lastMiddle.x,e.clientY-lastMiddle.y)>5)lastMiddle=null;
    if(!corner || e.pointerId!==windowPointer)return;
    const p=point(e);box.hidden=false;
    Object.assign(box.style,{left:Math.min(p.x,corner.x)+"px",top:Math.min(p.y,corner.y)+"px",width:Math.abs(p.x-corner.x)+"px",height:Math.abs(p.y-corner.y)+"px"});
  }
  function finishWindow(e:PointerEvent) {
    if(!corner || e.pointerId!==windowPointer)return;
    e.stopImmediatePropagation();
    const p=point(e), width=Math.abs(p.x-corner.x), height=Math.abs(p.y-corner.y);
    if(width>4 && height>4){
      const r=canvas.getBoundingClientRect();
      const center=new T.Vector3((p.x+corner.x)/r.width-1,1-(p.y+corner.y)/r.height,0).unproject(camera);
      const delta=center.sub(new T.Vector3(0,0,0).unproject(camera));
      camera.position.add(delta);controls.target.add(delta);
      camera.zoom=T.MathUtils.clamp(camera.zoom*Math.min(r.width/width,r.height/height),controls.minZoom,controls.maxZoom);
      camera.updateProjectionMatrix();controls.update();draw();
    }
    exitWindow();
  }
  const cancel=()=>{if(windowMode)exitWindow();pointer=null;};
  const key=(e:KeyboardEvent)=>{
    if(e.key==="Escape")cancel();
    if(e.key==="Home" && !walk){e.preventDefault();fit();}
    if(e.key==="Enter" && markFloor){
      e.preventDefault();
      const rect=canvas.getBoundingClientRect();
      walkAt(rect.left+rect.width/2,rect.top+rect.height/2);
    }
  };
  canvas.addEventListener("keydown",key);canvas.addEventListener("pointerdown",down,true);
  canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerup",finishWindow,true);
  canvas.addEventListener("pointercancel",cancel);
  const start = (e:PointerEvent)=>{pointer = !walk && !marking && e.isPrimary && e.button === 0 ? new T.Vector2(e.clientX,e.clientY):null;};
  const end = (e:PointerEvent)=>{
    if (!root || !pointer || pointer.distanceTo(new T.Vector2(e.clientX,e.clientY))>4) return;
    pointer = null;
    if(markFloor){walkAt(e.clientX,e.clientY);return;}
    const hit = hitAt(e.clientX,e.clientY);
    const id=hit?.object.userData.elementId??null;
    onPick(id);
    if(hit && id && originals.size && !canvas.hasAttribute("data-group-preview")){
      if(plan){
        anchor=hit.point.clone();
        marker.dataset.label=id.split("/")[0];
        draw();
      }
      pulseActive=true;pulsePreference();
    }
  };
  function walkAt(x:number,y:number){
    const notify=markFloor;
    if(!notify || !activeModel)return;
    unveil();
    // With a scene around the model its ground counts as floor too: the walk can start outside and go around.
    const hit=hitAt(x,y)??groundAt(x,y);
    if(!hit){notify("Selecciona un punto visible en el piso.");return;}
    try{
      let entry=walkModels.get(originalFile);
      if(!entry){entry={model:activeModel,world:walkWorld(activeModel)};walkModels.set(originalFile,entry);}
      const heading=camera.getWorldDirection(new T.Vector3()).setY(0);
      if(heading.lengthSq()<.001){
        const target=selectedForWalk?groupBounds(new Set([selectedForWalk])):bounds;
        target.getCenter(heading).sub(hit.point).setY(0);
        if(heading.lengthSq()<.001)heading.set(0,0,-1);
      }
      // A click a few centimetres off a free spot (next to a column, a railing, a stud) still starts the walk:
      // try the point, then rings around it up to 0.9 m on the same floor height.
      const start=(point:T.Vector3)=>walking(canvas,entry!.world,point,heading.clone().normalize(),renderWalk,()=>environment.groundLevel());
      let failure:unknown;
      outer: for(const radius of [0,.2,.4,.6,.9]){
        for(let k=0;k<(radius?8:1);k++){
          const angle=k*Math.PI/4;
          const point=hit.point.clone().add(new T.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius));
          try{walk=start(point);failure=undefined;break outer;}catch(error){failure=error;}
        }
      }
      if(failure)throw failure;
    }catch(error){
      notify(error instanceof Error?error.message:"No se pudo iniciar el recorrido.");
      return;
    }
    // Test-readable: the surface the walk started on (IFCSITE for a Revit topography, null for a scene's ground).
    performance.clearMarks("obracota:walk-start");
    performance.mark("obracota:walk-start",{detail:{ifcType:hit.object.userData.ifcType??null,element:hit.object.userData.elementId??null,
      height:Math.round(hit.point.y*100)/100}});
    walkModel=activeModel;
    walkOrbitSelection=selectedForWalk;
    startWalkBatches();
    marker.hidden=true;span.visible=false;
    markFloor=undefined;canvas.style.cursor="grab";notify(null);
  }
  function startWalkBatches(){
    if(!root || exterior.active())return;
    const start=performance.now();
    walkBatches=batchWalkGeometry(root);
    if(!walkBatches)return;
    scene.add(walkBatches.group);
    performance.measure("obracota:walk-batches",{start,end:performance.now(),detail:{
      sources:walkBatches.meshCount,batches:walkBatches.group.children.length,
    }});
  }
  function releaseWalkBatches(){
    walkBatches?.dispose();walkBatches=null;
  }
  function walkTarget(): ElementInfo | null {
    if(!walk || !walkModel || !root)return null;
    walk.camera.updateMatrixWorld();
    root.updateWorldMatrix(true,true);
    const ray=new T.Raycaster();
    ray.near=walk.camera.near;ray.far=walk.camera.far;
    ray.setFromCamera(new T.Vector2(),walk.camera);
    const hit=ray.intersectObject(root,true).find(({object})=>{
      if(!(object instanceof T.Mesh))return false;
      const displayed=Array.isArray(object.material)?object.material.some(material=>material.visible):object.material.visible;
      if(!displayed)return false;
      for(let node:T.Object3D|null=object;node;node=node.parent){
        if(!node.visible && !(node===object && walkBatches?.sources.has(object)))return false;
      }
      return true;
    });
    return walkModel.elements.find(piece=>piece.id===hit?.object.userData.elementId)??null;
  }
  function walkHighlight(id:string|null,color?:string){
    if(!walk || (!walkSelection && !id))return;
    if(!walkSelection)releaseWalkBatches();
    walkSelection=id;
    select(id,undefined,color);
    if(!id)startWalkBatches();
    walk.redraw();
  }
  const lose = (event:Event)=>{event.preventDefault();onLost();};
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  controls.addEventListener("change",draw);
  canvas.addEventListener("pointerdown",start); canvas.addEventListener("pointerup",end);
  canvas.addEventListener("webglcontextlost",lose);
  // Captures keep a light background in both colour modes; the value comes from the --capture-bg token.
  function captureBackground(){return getComputedStyle(container).getPropertyValue("--capture-bg").trim()||"#F3F2F1";}
  function snapshot(background:string,maxSide=1280) {
    unveil();
      // A picture larger than the canvas (exports) is rendered once at a higher pixel ratio, then the
      // canvas goes back to its own ratio within the same task, so nothing different is ever painted.
      const width=Math.max(container.clientWidth,1),height=Math.max(container.clientHeight,1);
      const ratio=renderer.getPixelRatio(),sharper=Math.min(3,maxSide/Math.max(width,height));
      const boost=sharper>ratio*1.05;
      if(boost){renderer.setPixelRatio(sharper);renderer.setSize(width,height,false);}
      try{
        // During the walk the picture is what the walker sees («Panorama 360° con IA» sends it as reference).
        renderer.render(scene,walk?.camera??camera);
        const image=document.createElement("canvas");
        const scale=Math.min(1,maxSide/Math.max(canvas.width,canvas.height));
        image.width=Math.max(1,Math.round(canvas.width*scale));
        image.height=Math.max(1,Math.round(canvas.height*scale));
        const ctx=image.getContext("2d")!;
        ctx.fillStyle=background;ctx.fillRect(0,0,image.width,image.height);
        ctx.drawImage(canvas,0,0,image.width,image.height);
        return image;
      }finally{
        if(boost){renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);renderer.render(scene,walk?.camera??camera);}
      }
  }
  function groupBounds(selection:Set<string>){
    const area=new T.Box3();
    root?.traverse(node=>{if(node instanceof T.Mesh && selection.has(node.userData.elementId))area.expandByObject(node);});
    return area;
  }
  function captureGroup(ids:string[],format:"png"|"jpeg"="jpeg",view:GroupCaptureView="current"){
      const materials=new Map<T.Mesh|T.LineSegments|T.Points,T.Material|T.Material[]>(),temporary:T.Material[]=[];
      const hidden:T.Object3D[]=[];
      function flat(value:number){
        const m=new T.MeshBasicMaterial({color:value,side:T.DoubleSide,toneMapped:false});
        temporary.push(m);return m;
      }
      const black=flat(0), colors=new Map(ids.map((id,i)=>[id,((i+1)*0x73a9ef)&0xffffff]));
      const masks=new Map([...colors].map(([id,c])=>[id,flat(c)]));
      // A plan is strokes: they paint the mask too (black, or the colour of a marked layer).
      const strokes=new Map<number,T.LineBasicMaterial>();
      function stroke(value:number){
        let m=strokes.get(value);
        if(!m){m=new T.LineBasicMaterial({color:value,toneMapped:false});strokes.set(value,m);temporary.push(m);}
        return m;
      }
      function readMask(){
        const mask=snapshot("#000000"),ctx=mask.getContext("2d")!;
        const pixels=ctx.getImageData(0,0,mask.width,mask.height),seen=new Set<number>(),allowed=new Set(colors.values());
        for(let i=0;i<pixels.data.length;i+=4){
          const p=pixels.data,c=(p[i]<<16)|(p[i+1]<<8)|p[i+2];
          const selected=allowed.has(c);
          if(selected)seen.add(c);
          p[i]=p[i+1]=p[i+2]=selected?255:0;
        }
        ctx.putImageData(pixels,0,0);
        return {mask,missing:colors.size-seen.size};
      }
      try{
        const area=view==="current"?null:groupBounds(new Set(ids));
        if(area && !area.isEmpty())fit(false,area,undefined,false);
        root?.traverse(node=>{
          if(view==="isolated" && node.visible && (node instanceof T.LineSegments || node instanceof T.Points ||
             (node instanceof T.Mesh && !masks.has(node.userData.elementId)))){
            hidden.push(node);node.visible=false;
          }
          if(node instanceof T.Mesh){materials.set(node,node.material);node.material=masks.get(node.userData.elementId)??black;}
          else if(plan && (node instanceof T.LineSegments || node instanceof T.Points)){
            materials.set(node,node.material);node.material=stroke(colors.get(node.userData.elementId)??0);
          }
        });
        let coverage=readMask();
        if(area && !area.isEmpty() && coverage.missing){
          const direction=camera.getWorldDirection(new T.Vector3()).negate();
          let best=direction;
          const up=new T.Vector3(0,1,0);
          const candidates=[Math.PI,Math.PI/2,-Math.PI/2].map(angle=>direction.clone().applyAxisAngle(up,angle));
          candidates.push(new T.Vector3(0.15,1,0.18).normalize(),new T.Vector3(-0.8,0.58,-1).normalize());
          for(const angle of candidates){
            fit(false,area,angle,false);
            const next=readMask();
            if(next.missing<coverage.missing){coverage=next;best=angle;}
            if(!coverage.missing)break;
          }
          fit(false,area,best,false);
        }
        materials.forEach((material,node)=>{node.material=originals.get(node)??material;});
        const reference=snapshot(captureBackground());
        const {mask,missing}=coverage;
        return {image:reference.toDataURL("image/"+format,0.9),mask:mask.toDataURL("image/"+format,0.95),missing,width:mask.width,height:mask.height};
      }finally{
        materials.forEach((material,node)=>{node.material=material;});
        hidden.forEach(node=>{node.visible=true;});
        temporary.forEach(material=>material.dispose());
        draw();
      }
  }
  function applyButtons(){
    if(plan){
      // On a plan the left button pans; in Editar › Seleccionar it marks, and the right and middle buttons pan.
      controls.mouseButtons.LEFT=marking?(-1 as T.MOUSE):T.MOUSE.PAN;controls.mouseButtons.RIGHT=T.MOUSE.PAN;controls.touches.ONE=T.TOUCH.PAN;
      return;
    }
    controls.mouseButtons.LEFT=marking?(-1 as T.MOUSE):panning?T.MOUSE.PAN:T.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT=marking?T.MOUSE.ROTATE:T.MOUSE.PAN;
    controls.touches.ONE=panning?T.TOUCH.PAN:T.TOUCH.ROTATE;
  }
  function setMarking(on:boolean){
    if(on && windowMode)exitWindow();
    marking=on;
    pointer=null;
    applyButtons();
    canvas.toggleAttribute("data-marking",on);
  }
  const projected=new T.Vector3(),toPoint=new T.Vector3(),viewDirection=new T.Vector3();
  function project(points:readonly (readonly [number,number,number])[],owners?:readonly (string|undefined)[]){
    if(!root || walk)return points.map(()=>null);
    const rect=canvas.getBoundingClientRect();
    if(!rect.width || !rect.height)return points.map(()=>null);
    camera.getWorldDirection(viewDirection);
    // Depth slack: a point on the surface it was taken from must not hide behind that same surface.
    const slack=bounds.isEmpty()?1e-3:bounds.getSize(new T.Vector3()).length()*2e-3;
    return points.map((point,index)=>{
      projected.set(point[0],point[1],point[2]).project(camera);
      if(Math.abs(projected.x)>1 || Math.abs(projected.y)>1 || projected.z<-1 || projected.z>1)return null;
      const x=(projected.x+1)/2*rect.width,y=(1-projected.y)/2*rect.height;
      const hit=hitAt(rect.left+x,rect.top+y);
      if(hit && hit.object.userData.elementId!==owners?.[index]){
        const depth=toPoint.set(point[0],point[1],point[2]).sub(hit.point).dot(viewDirection);
        if(depth>slack)return null;
      }
      return {x,y};
    });
  }
  function cancelWalk(){
    if(!walk && !markFloor && !walkModels.size)return;
    if(walkSelection){select(null);walkSelection=null;}
    markFloor=undefined;walk?.dispose();walk=undefined;
    walkModel=undefined;walkSky.visible=false;
    releaseWalkBatches();
    if(activeModel && root!==activeModel.root){
      if(root)scene.remove(root);
      root=activeModel.root;scene.add(root);
    }
    for(const {model} of walkModels.values())if(model!==activeModel)release(model.root);
    walkModels.clear();
    if(walkOrbitSelection)select(walkOrbitSelection);
    walkOrbitSelection=null;
    controls.enabled=true;canvas.style.cursor="";draw();
  }
  return {
    capture(format="jpeg",maxSide){return snapshot(captureBackground(),maxSide).toDataURL("image/"+format,0.9);},
    previewExteriorFinish(finish){
      if(!finish){exterior.reset();draw();return {pieces:0,source:"none"};}
      return exterior.apply(plan || walk?null:activeModel?.root??root,finish);
    },
    previewEnvironment(next){
      if(plan || !root || bounds.isEmpty())return false;
      return environment.apply(next);
    },
    clearEnvironment(){environment.reset();},
    currentEnvironment(){return environment.current();},
    previewGroup(ids,color){select(null,new Set(ids),color);canvas.toggleAttribute("data-group-preview",ids.length>0);},
    frameGroup(ids){
      const area=groupBounds(new Set(ids));
      if(!area.isEmpty())frameInSight(area,new Set(ids));
    },
    captureGroup,
    enterWalk(mark){
      if(!activeModel?.coordination || plan){mark("Abre un modelo 3D con unidades verificables: IFC, DWG 3D o FBX.");return;}
      // A manufacturer piece in metres without a floor at its base (a lamp, a chair) has nowhere to stand,
      // unless a scene around it («Recorrer esta escena en 3D») gives it a ground.
      if(activeModel.walk===false && environment.groundLevel()===null){mark("Este modelo no tiene un piso para recorrer.");return;}
      if(windowMode)exitWindow();
      setMarking(false);
      endPulse();stopTween();
      markFloor=mark;controls.enabled=false;canvas.style.cursor="crosshair";canvas.focus();
    },
    cancelWalk,walkTarget,walkHighlight,
    stream(fps){
      try{return typeof canvas.captureStream==="function"?canvas.captureStream(fps):null;}catch{return null;}
    },
    async switchWalk(file,signal,status){
      const session=walk;
      if(!session)throw new Error("Inicia el recorrido antes de comparar.");
      let entry=walkModels.get(file);
      if(!entry){
        const model=await loadModel(file,signal,status);
        try{
          if(signal.aborted || session!==walk)throw new DOMException("Cancelado","AbortError");
          entry={model,world:walkWorld(model)};
        }catch(error){release(model.root);throw error;}
        walkModels.set(file,entry);
      }
      if(signal.aborted || session!==walk)throw new DOMException("Cancelado","AbortError");
      session.switch(entry.world);
      if(root!==entry.model.root){
        if(walkSelection){select(null);walkSelection=null;}
        releaseWalkBatches();
        if(root)scene.remove(root);
        root=entry.model.root;scene.add(root);
        startWalkBatches();
      }
      walkModel=entry.model;
    },
    walkMove(key,held){walk?.move(key,held);},
    async open(file,signal,status,source) {
      const next = await loadModel(file,signal,status,source);
      if (disposed || signal.aborted) {release(next.root);throw new DOMException("Cancelado","AbortError");}
      cancelWalk();select(null);veiled.length=0;exterior.reset();environment.reset();clearLabelHighlights();
      if (root) {scene.remove(root);release(root);}
      root = next.root; scene.add(root);activeModel=next;originalFile=file;
      annotations=new Map(next.elements.filter(item=>item.annotation).map(item=>[item.id,item]));
      if(windowMode)exitWindow();
      bounds.setFromObject(root,true);
      const size=bounds.getSize(new T.Vector3());
      const depth=next.drawing?.depth??size.y;
      // Allow floating point noise but retain shallow, genuinely spatial models.
      plan=!bounds.isEmpty() && depth<=Math.max(size.x,size.z,1)*1e-10;
      initialPlanBounds=undefined;sheet=undefined;initialModelBounds=undefined;
      if(!plan){
        // A Revit topography or a road exported with the model (as IfcSite, a proxy or a geographic element) can be
        // hundreds of metres wide: the first frame and «Home» show the building, and «Extensión completa» still
        // shows everything. A piece counts as surroundings when it alone spans more than half the model.
        const whole=bounds.getSize(new T.Vector3()).length(),building=new T.Box3(),piece=new T.Box3();
        let surroundings=false;
        root.traverse(node=>{
          if(!(node instanceof T.Mesh))return;
          piece.setFromObject(node,true);
          if(piece.getSize(new T.Vector3()).length()>whole*.5)surroundings=true;
          else building.union(piece);
        });
        if(surroundings && !building.isEmpty() && building.getSize(new T.Vector3()).length()<whole*.5)initialModelBounds=building.clone();
      }
      controls.minZoom=plan?1:.0001;controls.maxZoom=plan?128:1e7;
      controls.enableRotate=!plan;
      panning=false;
      setMarking(false);
      if(plan){controls.mouseButtons.LEFT=T.MOUSE.PAN;controls.mouseButtons.RIGHT=T.MOUSE.PAN;controls.touches.ONE=T.TOUCH.PAN;}
      canvas.setAttribute("aria-label",plan?"Plano 2D. Arrastra para desplazar y usa la rueda para acercar.":"Vista tridimensional del modelo. Usa el explorador para seleccionar con teclado.");
      if(plan){
        // Survey drawings may contain distant reference marks. Sample proportionally
        // to vertex count; use a detail frame only when extents would hide the work.
        const xs:number[]=[],zs:number[]=[];
        const geometries=root.children.filter((node):node is T.LineSegments=>node instanceof T.LineSegments);
        const step=Math.max(1,Math.ceil(geometries.reduce((n,line)=>n+line.geometry.attributes.position.count,0)/10000));
        for(const g of geometries){
          const p=g.geometry.attributes.position;
          for(let i=0;i<p.count;i+=step){xs.push(p.getX(i));zs.push(p.getZ(i));}
        }
        let detail:T.Box3|undefined;
        if(xs.length>200){
          function primaryInterval(values:number[]) {
            values.sort((a,b)=>a-b);
            const last=values.length-1, span=values[last]-values[0];
            for(let i=1;i<=last;i++){
              if(values[i]-values[i-1]<=span*.5)continue;
              if(i<values.length*.3)return [values[i],values[last]];
              if(i>values.length*.7)return [values[0],values[i-1]];
            }
            return [values[0],values[last]];
          }
          const [left,right]=primaryInterval(xs),[front,back]=primaryInterval(zs);
          const area=new T.Box3(new T.Vector3(left,bounds.min.y,front),new T.Vector3(right,bounds.max.y,back));
          const size=area.getSize(new T.Vector3()).length();
          if(size>0 && size<bounds.getSize(new T.Vector3()).length()*.45)detail=area;
        }
        initialPlanBounds=detail??bounds.clone();
        sheet=new PlanSheet(initialPlanBounds,root);
      }
      fit();
      return {environment:plan?"plan":"model",name:next.name,schema:next.schema,sample:next.sample,elements:next.elements,drawing:next.drawing,versionId:next.versionId,walk:next.walk!==false && !!next.coordination && !plan,sceneWalk:!!next.coordination && !plan};
    },
      fit,select(id){canvas.removeAttribute("data-group-preview");select(id);},locate,orient,pose,applyPose,extents:()=>fit(false),
    windowZoom(){stopTween();if(windowMode)exitWindow();else{windowMode=true;canvas.style.cursor="crosshair";canvas.focus();}},
    clear() {
      stopTween();cancelWalk();activeModel=undefined;originalFile=null;
      if(windowMode)exitWindow();
      setMarking(false);
      select(null);exterior.reset();environment.reset();clearLabelHighlights();
      sheet=undefined;annotations.clear();
      if (root) {scene.remove(root);release(root);root=null;}
      draw();
    },
    zoom(factor) {stopTween();camera.zoom =T.MathUtils.clamp(camera.zoom*factor,controls.minZoom,controls.maxZoom);camera.updateProjectionMatrix();draw();},
    pan(enabled) {if(plan)return;panning=enabled;applyButtons();},
    probe(x,y){
      if(walk || !root)return null;
      if(plan)return planProbe(x,y);
      const hit=hitAt(x,y),id=hit?.object.userData.elementId;
      if(!hit || typeof id!=="string")return null;
      // A 3D DWG: the solid under the click, by the triangle ranges of its bodies.
      const body=hit.faceIndex!=null?entityAt(hit.object.userData.entities,hit.faceIndex):undefined;
      return {id,point:[hit.point.x,hit.point.y,hit.point.z],...(body?{entity:{handle:body.handle,type:body.type,
        name:entityName(body.type,body.handle,hit.object.userData.layer)}}:{})};
    },
    locateHandle(handle){
      if(!root || !handle)return null;
      const note=[...annotations.values()].find(item=>item.annotation?.handle===handle);
      if(note){locate(note.id);return note.id;}
      let found:string|null=null;
      root.traverse(node=>{
        if(found || !Array.isArray(node.userData.entities))return;
        if((node.userData.entities as EntityMark[]).some(mark=>mark.handle===handle))found=node.userData.elementId;
      });
      if(found)locate(found);
      return found;
    },
    project,
    onFrame(listener){frameListeners.add(listener);return ()=>{frameListeners.delete(listener);};},
    setMarking,
    dispose() {
      stopTween();cancelWalk();
      endPulse();motion.removeEventListener("change",pulsePreference);
      document.removeEventListener("visibilitychange",pulsePreference);
      disposed = true; observer.disconnect(); controls.dispose();
      canvas.removeEventListener("pointerdown",start);canvas.removeEventListener("pointerup",end);
      canvas.removeEventListener("webglcontextlost",lose);
      originals.forEach((mat,m)=>{m.material=mat;}); exterior.reset(); environment.reset(); if (root) release(root);
      span.geometry.dispose();span.material.dispose();previewMaterial.dispose();walkSky.geometry.dispose();walkSky.material.dispose();
      hint.remove();marker.remove();box.remove();highlightedLines.dispose();highlightedPoints.dispose();highlight.dispose();renderer.dispose();canvas.remove();
    }
  };
}
