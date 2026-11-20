import * as T from "three";

// Keep representative points on real strokes. Ignore isolated zero-length
// segments: a rasterizer may produce no pixels for them.
export class PlanSheet {
  private readonly samples=new Map<string,T.Vector3>();
  readonly size:T.Vector3;
  constructor(readonly bounds:T.Box3,root:T.Object3D){
    this.size=bounds.getSize(new T.Vector3());
    const cell=Math.max(this.size.x,this.size.z,0.01)/80;
    const a=new T.Vector3(),b=new T.Vector3(),p=new T.Vector3();
    const add=(point:T.Vector3)=>{
      if(!bounds.containsPoint(point))return;
      const key=Math.floor((point.x-bounds.min.x)/cell)+","+Math.floor((point.z-bounds.min.z)/cell);
      if(!this.samples.has(key))this.samples.set(key,point.clone());
    };
    root.traverse(node=>{
      if(!(node instanceof T.LineSegments || node instanceof T.Points || node instanceof T.Mesh))return;
      const positions=node.geometry.getAttribute("position"),index=node.geometry.index;
      const count=index?.count??positions.count;
      const line=node instanceof T.LineSegments;
      for(let i=0;i<count;i+=line?2:1){
        a.fromBufferAttribute(positions,index?index.getX(i):i).applyMatrix4(node.matrixWorld);
        if(line && i+1<count){
          b.fromBufferAttribute(positions,index?index.getX(i+1):i+1).applyMatrix4(node.matrixWorld);
          if(a.distanceToSquared(b)<1e-16)continue;
          const steps=Math.min(160,Math.ceil(a.distanceTo(b)/cell));
          for(let j=1;j<=steps;j++)add(p.lerpVectors(a,b,j/steps));
        }
        add(a);
      }
    });
  }
  nearest(point:T.Vector3,exclude?:T.Vector3){
    let nearest:T.Vector3|undefined,distance=Infinity;
    for(const sample of this.samples.values()){
      if(sample===exclude)continue;
      const d=sample.distanceToSquared(point);
      if(d<distance){distance=d;nearest=sample;}
    }
    return nearest;
  }
}
