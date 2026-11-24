import * as T from "three";
import {Capsule} from "three/addons/math/Capsule.js";
import {Octree} from "three/addons/math/Octree.js";
import type {SceneModel} from "./model-source";

const bodies=/^(IFC(WALL|SLAB|ROOF|DOOR|WINDOW|CURTAINWALL|FURNISHINGELEMENT|FURNITURE|COLUMN|BEAM|MEMBER|PLATE|STAIR|RAMP|GEOGRAPHICELEMENT|BUILDINGELEMENTPROXY|FOOTING))/;
const radius=.23,eye=1.65;
/**
 * Collision triangles the walk indexes at most. The octree is built on the main thread (with the bounding-box split
 * below, about 0.75 s for the 280 000 triangles of the Jalis sofa); a larger model keeps its biggest pieces.
 */
const TRIANGLE_BUDGET=600_000;
const movement:Record<string,string>={w:"forward",ArrowUp:"forward",s:"back",ArrowDown:"back",a:"left",ArrowLeft:"left",d:"right",ArrowRight:"right"};

class WalkOctree extends Octree {
  /**
   * three's split tests every triangle against every child with the exact box–triangle test (13 axes): 160 000
   * triangles of ReStage took 5.3 s on the main thread. A triangle goes instead into every child its own bounding
   * box overlaps: a few more triangles per leaf, the same collisions (the capsule and floor tests stay exact),
   * built in a fraction of the time.
   */
  override split(level:number){
    if(!this.box)return this;
    const half=this.box.getSize(new T.Vector3()).multiplyScalar(.5),children:WalkOctree[]=[];
    for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++){
      const min=this.box.min.clone().add(new T.Vector3(x*half.x,y*half.y,z*half.z));
      const child=new WalkOctree(new T.Box3(min,min.clone().add(half)));
      child.trianglesPerLeaf=this.trianglesPerLeaf;child.maxLevel=this.maxLevel;
      children.push(child);
    }
    let triangle:T.Triangle|undefined;
    while((triangle=this.triangles.pop())){
      const {a,b,c}=triangle;
      const x0=Math.min(a.x,b.x,c.x),x1=Math.max(a.x,b.x,c.x),y0=Math.min(a.y,b.y,c.y),y1=Math.max(a.y,b.y,c.y),z0=Math.min(a.z,b.z,c.z),z1=Math.max(a.z,b.z,c.z);
      for(const child of children){
        const {min,max}=child.box!;
        if(x1>=min.x && x0<=max.x && y1>=min.y && y0<=max.y && z1>=min.z && z0<=max.z)child.triangles.push(triangle);
      }
    }
    for(const child of children){
      const count=child.triangles.length;
      if(count>this.trianglesPerLeaf && level<this.maxLevel)child.split(level+1);
      if(count)this.subTrees.push(child);
    }
    return this;
  }

  private collect(matches:(box:T.Box3)=>boolean){
    const result=new Set<T.Triangle>(),pending=[...this.subTrees];
    while(pending.length){
      const node=pending.pop()!;
      if(!node.box || !matches(node.box))continue;
      if(node.subTrees.length){for(const child of node.subTrees)pending.push(child);}
      else for(const triangle of node.triangles)result.add(triangle);
    }
    return result;
  }

  override getCapsuleTriangles(body:Capsule,triangles:T.Triangle[]){
    for(const triangle of this.collect(box=>body.intersectsBox(box)))triangles.push(triangle);
  }

  floorAt(position:T.Vector3,distance:number){
    const end=position.clone().add(new T.Vector3(0,-distance,0));
    const clip=new T.Box3().setFromPoints([position,end]);
    const ray=new T.Ray(position,new T.Vector3(0,-1,0));
    const result=new T.Vector3(),normal=new T.Vector3();
    for(const face of this.collect(box=>box.intersectsBox(clip))){
      if(face.getNormal(normal).y>.55 && ray.intersectTriangle(face.a,face.b,face.c,true,result) &&
        result.y>=end.y)return true;
    }
    return false;
  }
}

export function walkWorld(model:SceneModel){
  if(!model.coordination)throw new Error("El recorrido requiere escala y coordenadas IFC verificables.");
  const start=performance.now(),meshes=new T.Group();
  let triangles=0;
  model.root.updateMatrixWorld(true);
  // IFC pieces collide by class; a mesh without one (DWG solids, a scaled 3D drawing) is a body as it is.
  const candidates:{node:T.Mesh;count:number;size:number}[]=[];
  const box=new T.Box3();
  model.root.traverse(node=>{
    if(!(node instanceof T.Mesh)||!node.visible||(node.userData.ifcType!==undefined && !bodies.test(String(node.userData.ifcType))))return;
    const count=(node.geometry.index?.count??node.geometry.attributes.position.count)/3;
    candidates.push({node,count,size:box.setFromObject(node).getSize(new T.Vector3()).length()});
  });
  // A large model keeps its biggest pieces (slabs, walls, stairs) within the collision budget: the small,
  // dense details (bolts, profiles) are what goes when it does not fit.
  if(candidates.reduce((sum,item)=>sum+item.count,0)>TRIANGLE_BUDGET)candidates.sort((a,b)=>b.size-a.size);
  for(const {node,count} of candidates){
    if(triangles+count>TRIANGLE_BUDGET)continue;
    triangles+=count;
    const proxy=node.clone(false);
    proxy.matrixAutoUpdate=false;
    proxy.matrix.copy(node.matrixWorld);
    meshes.add(proxy);
  }
  if(!triangles)throw new Error("El modelo carece de superficies utilizables para recorrer.");
  const tree=new WalkOctree();
  // Long slabs or repeated faces can occupy many children. Bound subdivision for IFC meshes.
  tree.maxLevel=6;
  tree.trianglesPerLeaf=32;
  tree.fromGraphNode(meshes);
  performance.measure("obracota:walk-index",{start,end:performance.now(),detail:{triangles,pieces:meshes.children.length,of:candidates.length}});
  return {tree,coordination:new T.Matrix4().fromArray(model.coordination)};
}
export type WalkWorld=ReturnType<typeof walkWorld>;

/**
 * `ground`, when given, is the height of the scene's ground around the model («Recorrer esta escena en 3D»): an
 * endless floor at that level, so the walk can leave the building and go around it. Read on every step.
 */
export function walking(canvas:HTMLCanvasElement,world:WalkWorld,foot:T.Vector3,heading:T.Vector3,render:(camera:T.Camera)=>void,ground?:()=>number|null){
  const camera=new T.PerspectiveCamera(65,1,.035,2000);
  camera.rotation.order="YXZ";
  function capsule(point:T.Vector3){
    return new Capsule(point.clone().add(new T.Vector3(0,radius+.004,0)),point.clone().add(new T.Vector3(0,eye,0)),radius);
  }
  let body=capsule(foot),current=world;
  const down=new T.Vector3(0,-1,0);
  function onGround(position:T.Vector3){
    const level=ground?.();
    return level!==null && level!==undefined && position.y>=level-.05 && position.y-level<=.4;
  }
  function grounded(tree:WalkOctree,position:T.Vector3){
    return tree.floorAt(position.clone().add(new T.Vector3(0,.12,0)),.28) || onGround(position);
  }
  function room(tree:Octree,player:Capsule){
    const hit=tree.capsuleIntersect(player);
    return !hit || hit.depth<.008;
  }
  if(!grounded(world.tree,foot)||!room(world.tree,body))
    throw new Error("Elige una superficie de piso libre, con espacio para caminar.");
  let safe=body.clone();
  const keys=new Set<string>(),vector=new T.Vector3(),step=new T.Vector3(),lift=new T.Vector3();
  let frame=0,previous=performance.now(),velocity=0,standing=true,needsDraw=true;
  // Frames drawn while walking, per second of movement (KNOWN_ISSUES #4): the last measure is kept as a mark.
  let measureFrom=0,measured=0;
  let pointer:{id:number;x:number;y:number}|undefined;
  camera.position.copy(body.end);camera.lookAt(camera.position.clone().add(heading));
  function move(key:string,held:boolean){if(held)keys.add(key);else keys.delete(key);}
  function keyboard(event:KeyboardEvent){
    if(event.type==="keydown" && event.target!==canvas && (event.target as HTMLElement)?.closest("input,textarea,select,button,a"))return;
    const key=movement[event.key]??movement[event.key.toLowerCase()];
    if(key){event.preventDefault();move(key,event.type==="keydown");}
  }
  function pointerDown(event:PointerEvent){
    if(event.button!==0)return;
    canvas.focus();canvas.setPointerCapture(event.pointerId);
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY};
  }
  function pointerMove(event:PointerEvent){
    if(pointer?.id!==event.pointerId)return;
    camera.rotation.y-=(event.clientX-pointer.x)*.004;
    camera.rotation.x=T.MathUtils.clamp(camera.rotation.x-(event.clientY-pointer.y)*.004,-1.42,1.42);
    pointer.x=event.clientX;pointer.y=event.clientY;needsDraw=true;
  }
  function pointerEnd(event:PointerEvent){if(pointer?.id===event.pointerId)pointer=undefined;}
  function resetInputs(){keys.clear();pointer=undefined;}
  function tick(now:number){
    const delta=Math.min(.05,(now-previous)/1000);previous=now;
    frame=requestAnimationFrame(tick);
    const aspect=canvas.clientWidth/Math.max(1,canvas.clientHeight);
    if(camera.aspect!==aspect){camera.aspect=aspect;camera.updateProjectionMatrix();needsDraw=true;}
    vector.set(Number(keys.has("right"))-Number(keys.has("left")),0,Number(keys.has("back"))-Number(keys.has("forward")));
    if(!vector.lengthSq() && standing){
      if(needsDraw){render(camera);needsDraw=false;}
      measureFrom=0;
      return;
    }
    if(!measureFrom){measureFrom=now;measured=0;}
    else if(now-measureFrom>=1000){
      performance.clearMarks("obracota:walk-fps");
      performance.mark("obracota:walk-fps",{detail:{fps:Math.round(measured*10000/(now-measureFrom))/10}});
      measureFrom=now;measured=0;
    }
    measured++;
    vector.normalize().applyAxisAngle(T.Object3D.DEFAULT_UP,camera.rotation.y);
    standing=false;
    for(let i=0;i<4;i++){
      const dt=delta/4;
      velocity=Math.max(-8,velocity-9.81*dt);
      step.copy(vector).multiplyScalar(1.5*dt);step.y=velocity*dt;
      const before=body.clone();
      body.translate(step);
      for(let attempt=0;attempt<4;attempt++){
        const hit=current.tree.capsuleIntersect(body);
        if(!hit || hit.depth<=1e-6)break;
        if(hit.normal.y>.55 && velocity<0){velocity=0;standing=true;}
        if(hit.normal.y<-.55 && velocity>0)velocity=0;
        body.translate(hit.normal.multiplyScalar(hit.depth+.00001));
      }
      if(!room(current.tree,body)){body=before;velocity=0;}
      const level=ground?.();
      if(level!==null && level!==undefined){
        const below=level-(body.start.y-radius);
        if(below>0){body.translate(lift.set(0,below+.00001,0));if(velocity<0){velocity=0;standing=true;}}
      }
    }
    const feet=body.start.clone().addScaledVector(down,radius);
    if(standing && grounded(current.tree,feet))safe=body.clone();
    if(body.end.y<current.tree.bounds.min.y-2){body=safe.clone();velocity=0;standing=true;}
    camera.position.copy(body.end);render(camera);needsDraw=false;
  }
  window.addEventListener("keydown",keyboard);window.addEventListener("keyup",keyboard);
  window.addEventListener("blur",resetInputs);
  canvas.addEventListener("pointerdown",pointerDown);canvas.addEventListener("pointermove",pointerMove);
  canvas.addEventListener("pointerup",pointerEnd);canvas.addEventListener("pointercancel",pointerEnd);canvas.addEventListener("lostpointercapture",pointerEnd);
  canvas.focus();frame=requestAnimationFrame(tick);
  return {
    move,
    /** The walker's eye, for pictures taken during the walk. */
    camera,
    /** Draws the next frame again (the scene around the walk changed). */
    redraw(){needsDraw=true;},
    switch(next:WalkWorld){
      const align=new T.Matrix4().multiplyMatrices(next.coordination,current.coordination.clone().invert());
      const point=body.start.clone().addScaledVector(down,radius+.004).applyMatrix4(align);
      const nextBody=capsule(point);
      if(!room(next.tree,nextBody)||!grounded(next.tree,point))
        throw new Error("Ese punto está ocupado o queda sin piso en la otra versión. Camina a un punto libre y vuelve a comparar.");
      const direction=camera.getWorldDirection(new T.Vector3()).transformDirection(align);
      const alignedPosition=camera.position.clone().applyMatrix4(align);
      current=next;body=nextBody;safe=body.clone();velocity=0;standing=true;needsDraw=true;
      camera.position.copy(body.end);camera.lookAt(camera.position.clone().add(direction));
      performance.clearMarks("obracota:walk-switch");
      performance.mark("obracota:walk-switch",{detail:{
        distance:camera.position.distanceTo(alignedPosition),
        angle:camera.getWorldDirection(new T.Vector3()).angleTo(direction),
      }});
      canvas.focus();
    },
    dispose(){
      resetInputs();cancelAnimationFrame(frame);
      window.removeEventListener("keydown",keyboard);window.removeEventListener("keyup",keyboard);window.removeEventListener("blur",resetInputs);
      canvas.removeEventListener("pointerdown",pointerDown);canvas.removeEventListener("pointermove",pointerMove);
      canvas.removeEventListener("pointerup",pointerEnd);canvas.removeEventListener("pointercancel",pointerEnd);canvas.removeEventListener("lostpointercapture",pointerEnd);
    },
  };
}
