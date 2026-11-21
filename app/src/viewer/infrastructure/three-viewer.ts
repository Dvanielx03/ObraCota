import * as T from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {PlanSheet} from "./plan-sheet";
import { loadModel, type SceneModel } from "./model-source";
import { walking, walkWorld, type WalkWorld } from "./walk";
import type { ElementInfo, GroupCaptureView, ViewerPort, ViewDirection } from "../domain/viewer.port";

function release(root:T.Object3D) {
  const geometry = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
  root.traverse(node => {
    if (!(node instanceof T.Mesh || node instanceof T.LineSegments || node instanceof T.Points)) return;
    geometry.add(node.geometry);
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) materials.add(m);
  });
  geometry.forEach(g=>g.dispose());
  materials.forEach(m=>m.dispose());
}

export function createViewer(container: HTMLElement, onPick:(id:string|null)=>void, onLost:()=>void, onWindowEnd:()=>void): ViewerPort {
  const renderer = new T.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label","Vista tridimensional del modelo. Usa el explorador para seleccionar con teclado.");
  container.appendChild(canvas);
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xffffff,0x9f9685,2));
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
  let selectedForWalk:string|null=null;
  const walkModels=new Map<File,{model:SceneModel;world:WalkWorld}>();
  const originals = new Map<T.Mesh|T.LineSegments|T.Points,T.Material|T.Material[]>();
  const highlightedLines=new T.LineBasicMaterial({color:0xff6900});
  const highlightedPoints=new T.PointsMaterial({color:0xff6900,size:4,sizeAttenuation:false});
  const highlight = new T.MeshStandardMaterial({color:0xff6900,side:T.DoubleSide,emissive:0x3b2003});
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
  function fit(reset=true,region?:T.Box3,from?:T.Vector3) {
    if(plan && !region)region=initialPlanBounds;
    if (!root) return;
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
    baseWidth = Math.max(projected.x,0.01)*1.08;
    baseHeight = Math.max(projected.y,0.01)*1.08;
    fitting=true;controls.update();fitting=false;resize();
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
    if(!copy){copy=source.clone() as ColoredMaterial;tinted.set(source,copy);}
    return copy;
  }
  function pulsePreference(){
    if(!pulseActive)return;
    window.clearTimeout(pulseTimer);
    originals.forEach((_material,node)=>{
      node.material=node instanceof T.Mesh?highlight:node instanceof T.Points?highlightedPoints:highlightedLines;
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
  function select(id:string|null, group?:Set<string>,color?:string) {
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
        mesh.material = mesh instanceof T.Mesh ? (color?previewMaterial:highlight) : mesh instanceof T.Points ? highlightedPoints : highlightedLines;
      }
    });
    draw();
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
    if(!region.isEmpty()){fit(false,region);pulseActive=true;pulsePreference();}
  }
  function hitAt(x:number,y:number) {
    if (!root) return;
    const rect = canvas.getBoundingClientRect(), ray = new T.Raycaster();
    ray.params.Line.threshold = (camera.top-camera.bottom)/camera.zoom/rect.height*3;
    ray.params.Points.threshold=ray.params.Line.threshold;
    ray.setFromCamera(new T.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);
    return ray.intersectObject(root,true).find(hit=>hit.object.userData.elementId);
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
  function orient(view:ViewDirection) {
    if(plan)return;
    const distance = camera.position.distanceTo(controls.target);
    camera.position.copy(controls.target).addScaledVector(new T.Vector3().fromArray(directions[view]).normalize(),distance);
    controls.update();draw();
  }
  let pointer:T.Vector2|null = null;
  let windowMode=false, corner:T.Vector2|null=null, lastMiddle:{time:number;x:number;y:number}|null=null;
  const box = document.createElement("div");box.className="zoom-rectangle";box.hidden=true;container.append(box);
  function exitWindow() {windowMode=false;corner=null;box.hidden=true;canvas.style.cursor="";onWindowEnd();}
  function point(e:PointerEvent) {
    const r=canvas.getBoundingClientRect();
    return new T.Vector2(T.MathUtils.clamp(e.clientX-r.left,0,r.width),T.MathUtils.clamp(e.clientY-r.top,0,r.height));
  }
  function down(e:PointerEvent) {
    canvas.focus({preventScroll:true});
    if (windowMode && e.button===0) {
      e.stopImmediatePropagation();canvas.setPointerCapture(e.pointerId);corner=point(e);return;
    }
    if (e.button===1) {
      e.preventDefault();
      if(lastMiddle && performance.now()-lastMiddle.time<350 && Math.hypot(e.clientX-lastMiddle.x,e.clientY-lastMiddle.y)<5){
        lastMiddle=null;e.stopImmediatePropagation();fit(false);return;
      }
      lastMiddle={time:performance.now(),x:e.clientX,y:e.clientY};
    }
    if (!plan && ((e.button===1 && e.shiftKey) || (e.button===0 && !e.shiftKey && controls.mouseButtons.LEFT===T.MOUSE.ROTATE))) {
      const hit=hitAt(e.clientX,e.clientY);if(hit)pivotAt(hit.point);
    }
  }
  function move(e:PointerEvent) {
    if(pointer && Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>4)pointer=null;
    if(lastMiddle && Math.hypot(e.clientX-lastMiddle.x,e.clientY-lastMiddle.y)>5)lastMiddle=null;
    if(!corner)return;
    const p=point(e);box.hidden=false;
    Object.assign(box.style,{left:Math.min(p.x,corner.x)+"px",top:Math.min(p.y,corner.y)+"px",width:Math.abs(p.x-corner.x)+"px",height:Math.abs(p.y-corner.y)+"px"});
  }
  function finishWindow(e:PointerEvent) {
    if(!corner)return;
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
  const start = (e:PointerEvent)=>{pointer = !walk && e.isPrimary && e.button === 0 ? new T.Vector2(e.clientX,e.clientY):null;};
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
    if(!notify || !activeModel || !originalFile)return;
    const hit=hitAt(x,y);
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
      walk=walking(canvas,entry.world,hit.point,heading.normalize(),view=>renderer.render(scene,view));
    }catch(error){
      notify(error instanceof Error?error.message:"No se pudo iniciar el recorrido.");
      return;
    }
    marker.hidden=true;span.visible=false;
    markFloor=undefined;canvas.style.cursor="grab";notify(null);
  }
  const lose = (event:Event)=>{event.preventDefault();onLost();};
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  controls.addEventListener("change",draw);
  canvas.addEventListener("pointerdown",start); canvas.addEventListener("pointerup",end);
  canvas.addEventListener("webglcontextlost",lose);
  function snapshot(background:string) {
      renderer.render(scene,camera);
      const image=document.createElement("canvas");
      const scale=Math.min(1,1280/Math.max(canvas.width,canvas.height));
      image.width=Math.max(1,Math.round(canvas.width*scale));
      image.height=Math.max(1,Math.round(canvas.height*scale));
      const ctx=image.getContext("2d")!;
      ctx.fillStyle=background;ctx.fillRect(0,0,image.width,image.height);
      ctx.drawImage(canvas,0,0,image.width,image.height);
      return image;
  }
  function groupBounds(selection:Set<string>){
    const area=new T.Box3();
    root?.traverse(node=>{if(node instanceof T.Mesh && selection.has(node.userData.elementId))area.expandByObject(node);});
    return area;
  }
  function captureGroup(ids:string[],format:"png"|"jpeg"="jpeg",view:GroupCaptureView="current"){
      const materials=new Map<T.Mesh,T.Material|T.Material[]>(),temporary:T.Material[]=[];
      const hidden:T.Object3D[]=[];
      function flat(value:number){
        const m=new T.MeshBasicMaterial({color:value,side:T.DoubleSide,toneMapped:false});
        temporary.push(m);return m;
      }
      const black=flat(0), colors=new Map(ids.map((id,i)=>[id,((i+1)*0x73a9ef)&0xffffff]));
      const masks=new Map([...colors].map(([id,c])=>[id,flat(c)]));
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
        if(area && !area.isEmpty())fit(false,area);
        root?.traverse(node=>{
          if(view==="isolated" && node.visible && (node instanceof T.LineSegments || node instanceof T.Points ||
             (node instanceof T.Mesh && !masks.has(node.userData.elementId)))){
            hidden.push(node);node.visible=false;
          }
          if(node instanceof T.Mesh){materials.set(node,node.material);node.material=masks.get(node.userData.elementId)??black;}
        });
        let coverage=readMask();
        if(area && !area.isEmpty() && coverage.missing){
          const direction=camera.getWorldDirection(new T.Vector3()).negate();
          let best=direction;
          const up=new T.Vector3(0,1,0);
          const candidates=[Math.PI,Math.PI/2,-Math.PI/2].map(angle=>direction.clone().applyAxisAngle(up,angle));
          candidates.push(new T.Vector3(0.15,1,0.18).normalize(),new T.Vector3(-0.8,0.58,-1).normalize());
          for(const angle of candidates){
            fit(false,area,angle);
            const next=readMask();
            if(next.missing<coverage.missing){coverage=next;best=angle;}
            if(!coverage.missing)break;
          }
          fit(false,area,best);
        }
        materials.forEach((material,node)=>{node.material=originals.get(node)??material;});
        const reference=snapshot("#f1ede4");
        const {mask,missing}=coverage;
        return {image:reference.toDataURL("image/"+format,0.9),mask:mask.toDataURL("image/"+format,0.95),missing,width:mask.width,height:mask.height};
      }finally{
        materials.forEach((material,node)=>{node.material=material;});
        hidden.forEach(node=>{node.visible=true;});
        temporary.forEach(material=>material.dispose());
        draw();
      }
  }
  function cancelWalk(){
    if(!walk && !markFloor && !walkModels.size)return;
    markFloor=undefined;walk?.dispose();walk=undefined;
    if(activeModel && root!==activeModel.root){
      if(root)scene.remove(root);
      root=activeModel.root;scene.add(root);
    }
    for(const {model} of walkModels.values())if(model!==activeModel)release(model.root);
    walkModels.clear();
    controls.enabled=true;canvas.style.cursor="";draw();
  }
  return {
    capture(format="jpeg"){return snapshot("#f1ede4").toDataURL("image/"+format,0.9);},
    previewGroup(ids,color){select(null,new Set(ids),color);canvas.toggleAttribute("data-group-preview",ids.length>0);},
    frameGroup(ids){
      const area=groupBounds(new Set(ids));
      if(!area.isEmpty())fit(false,area);
    },
    captureGroup,
    enterWalk(mark){
      if(!activeModel?.coordination || !originalFile || plan){mark("Abre un IFC 3D con unidades verificables.");return;}
      if(windowMode)exitWindow();
      endPulse();
      markFloor=mark;controls.enabled=false;canvas.style.cursor="crosshair";canvas.focus();
    },
    cancelWalk,
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
        if(root)scene.remove(root);
        root=entry.model.root;scene.add(root);
      }
    },
    walkMove(key,held){walk?.move(key,held);},
    async open(file,signal,status) {
      const next = await loadModel(file,signal,status);
      if (disposed || signal.aborted) {release(next.root);throw new DOMException("Cancelado","AbortError");}
      cancelWalk();select(null);
      if (root) {scene.remove(root);release(root);}
      root = next.root; scene.add(root);activeModel=next;originalFile=file;
      annotations=new Map(next.elements.filter(item=>item.annotation).map(item=>[item.id,item]));
      if(windowMode)exitWindow();
      bounds.setFromObject(root,true);
      const size=bounds.getSize(new T.Vector3());
      const depth=next.drawing?.depth??size.y;
      // Allow floating point noise but retain shallow, genuinely spatial models.
      plan=!bounds.isEmpty() && depth<=Math.max(size.x,size.z,1)*1e-10;
      initialPlanBounds=undefined;sheet=undefined;
      controls.minZoom=plan?1:.0001;controls.maxZoom=plan?128:1e7;
      controls.enableRotate=!plan;
      controls.mouseButtons.LEFT=plan?T.MOUSE.PAN:T.MOUSE.ROTATE;
      controls.touches.ONE=plan?T.TOUCH.PAN:T.TOUCH.ROTATE;
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
      return {environment:plan?"plan":"model",name:next.name,schema:next.schema,sample:next.sample,elements:next.elements,drawing:next.drawing,versionId:next.versionId,walk:!!next.coordination && !plan};
    },
      fit,select(id){canvas.removeAttribute("data-group-preview");select(id);},locate,orient,extents:()=>fit(false),
    windowZoom(){if(windowMode)exitWindow();else{windowMode=true;canvas.style.cursor="crosshair";canvas.focus();}},
    clear() {
      cancelWalk();activeModel=undefined;originalFile=null;
      if(windowMode)exitWindow();
      select(null);
      sheet=undefined;annotations.clear();
      if (root) {scene.remove(root);release(root);root=null;}
      draw();
    },
    zoom(factor) {camera.zoom = T.MathUtils.clamp(camera.zoom*factor,controls.minZoom,controls.maxZoom);camera.updateProjectionMatrix();draw();},
    pan(enabled) {if(plan)return;controls.mouseButtons.LEFT = enabled ? T.MOUSE.PAN : T.MOUSE.ROTATE; controls.touches.ONE = enabled ? T.TOUCH.PAN : T.TOUCH.ROTATE;},
    dispose() {
      cancelWalk();
      endPulse();motion.removeEventListener("change",pulsePreference);
      document.removeEventListener("visibilitychange",pulsePreference);
      disposed = true; observer.disconnect(); controls.dispose();
      canvas.removeEventListener("pointerdown",start);canvas.removeEventListener("pointerup",end);
      canvas.removeEventListener("webglcontextlost",lose);
      originals.forEach((mat,m)=>{m.material=mat;}); if (root) release(root);
      span.geometry.dispose();span.material.dispose();previewMaterial.dispose();
      hint.remove();marker.remove();box.remove();highlightedLines.dispose();highlightedPoints.dispose();highlight.dispose();renderer.dispose();canvas.remove();
    }
  };
}
