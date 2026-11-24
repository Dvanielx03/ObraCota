import {expect,test} from "@playwright/test";
import * as T from "three";
import {walking,walkWorld} from "../src/viewer/infrastructure/walk";

for(const [label,ifcType,height] of [["un muro","IFCWALL",3],["un mueble","IFCFURNITURE",.7]] as const){
test(`La cápsula avanza, se detiene ante ${label} y conserva los ojos a escala`,()=>{
  const root=new T.Group();
  const slab=new T.Mesh(new T.BoxGeometry(8,.2,8));
  slab.userData.ifcType="IFCSLAB";
  slab.position.y=-.1;
  root.add(slab);
  const obstacle=new T.Mesh(new T.BoxGeometry(8,height,.2));
  obstacle.userData.ifcType=ifcType;
  obstacle.position.set(0,height/2,-2);
  root.add(obstacle);
  const world=walkWorld({root,name:"Ensayo geométrico",schema:"IFC4",sample:false,elements:[],coordination:new T.Matrix4().elements});
  class Canvas extends EventTarget {
    clientWidth=640;
    clientHeight=480;
    focus(){}
  }
  const originals={window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  let nextFrame:FrameRequestCallback|undefined;
  Object.assign(globalThis,{
    window:new EventTarget(),
    requestAnimationFrame:(callback:FrameRequestCallback)=>{nextFrame=callback;return 1;},
    cancelAnimationFrame:()=>{nextFrame=undefined;},
  });
  try{
    const eye=new T.Vector3();
    const route=walking(new Canvas() as unknown as HTMLCanvasElement,world,new T.Vector3(),new T.Vector3(0,0,-1),camera=>eye.copy(camera.position));
    let now=performance.now();
    route.move("forward",true);
    for(let i=0;i<180;i++){now+=16.67;nextFrame?.(now);}
    expect(eye.z).toBeCloseTo(-1.67,2);
    expect(eye.y).toBeCloseTo(1.65,2);
    route.move("forward",false);
    route.move("back",true);
    for(let i=0;i<30;i++){now+=16.67;nextFrame?.(now);}
    expect(eye.z).toBeGreaterThan(-1.4);
    route.dispose();
  }finally{
    Object.assign(globalThis,originals);
    slab.geometry.dispose();obstacle.geometry.dispose();
  }
});
}
