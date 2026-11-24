import * as T from "three";
import {deinterleaveGeometry,mergeGeometries} from "three/addons/utils/BufferGeometryUtils.js";

const MIN_MESHES = 128;
const MAX_BATCH_VERTICES = 160_000;
const MAX_BATCH_BYTES = 128 * 1024 * 1024;
const MIN_INSTANCES = 8;
const INSTANCE_BYTES = 16 * Float32Array.BYTES_PER_ELEMENT;

export interface WalkBatches {
  group: T.Group;
  meshCount: number;
  sources: ReadonlySet<T.Mesh>;
  dispose(): void;
}

/** Render-only opaque batches. Source meshes still own their geometry and materials. */
export function batchWalkGeometry(root: T.Object3D): WalkBatches | null {
  const groups = new Map<string,T.Mesh[]>();
  const center = new T.Vector3();
  root.updateWorldMatrix(true,true);
  root.traverseVisible(node => {
    if (!(node instanceof T.Mesh) || node instanceof T.InstancedMesh || node instanceof T.SkinnedMesh || node instanceof T.BatchedMesh ||
      !(node.material instanceof T.MeshStandardMaterial) || !node.frustumCulled || node.children.length) return;
    const geometry: T.BufferGeometry = node.geometry;
    const material = node.material;
    const count = geometry.attributes.position?.count;
    const determinant = node.matrixWorld.determinant();
    if (!count || !material.visible || material.transparent || !material.depthWrite || material.opacity !== 1 ||
      material.clippingPlanes?.length || material.stencilWrite || material.polygonOffset ||
      (material instanceof T.MeshPhysicalMaterial && material.transmission > 0) ||
      material.onBeforeCompile !== T.Material.prototype.onBeforeCompile || node.onBeforeRender !== T.Object3D.prototype.onBeforeRender ||
      geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity || geometry.groups.length ||
      Object.keys(geometry.morphAttributes).length || !determinant ||
      (determinant < 0 && (!geometry.index || geometry.attributes.tangent))) return;
    if (count > MAX_BATCH_VERTICES) return;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    center.copy(geometry.boundingSphere!.center).applyMatrix4(node.matrixWorld);
    // Spatial groups keep frustum culling useful even when the same material covers the building.
    const cell = [center.x, center.y, center.z].map(value=>Math.floor(value / 16)).join(",");
    const layout = Object.entries(geometry.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,attr])=>{
      const array = attr instanceof T.InterleavedBufferAttribute ? attr.data.array : attr.array;
      return `${name}:${attr.itemSize}:${attr.normalized}:${array.constructor.name}`;
    }).join("|");
    const key = `${material.id}/${layout}/${!!geometry.index}/${cell}/${node.renderOrder}/${node.layers.mask}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(node);
    else groups.set(key,[node]);
  });

  const count = [...groups.values()].reduce((n,bucket)=>n+(bucket.length>1?bucket.length:0),0);
  if (count < MIN_MESHES) return null;
  const group = new T.Group();
  const hidden: T.Mesh[] = [];
  let bytes = 0;
  function dispose() {
    group.removeFromParent();
    for (const node of group.children) {
      if (node instanceof T.InstancedMesh) node.dispose();
      else if (node instanceof T.Mesh) node.geometry.dispose();
    }
    for(const mesh of hidden)mesh.visible=true;
  }
  function merge(meshes:T.Mesh[]) {
    if(meshes.length<2)return;
    const copies: T.BufferGeometry[] = [];
    try {
      for (const source of meshes) {
        const copy=source.geometry.clone();
        copies.push(copy);
        deinterleaveGeometry(copy);
        copy.applyMatrix4(source.matrixWorld);
        // Three flips the front face of reflected objects. With the transform baked in, preserve that winding.
        if (source.matrixWorld.determinant() < 0 && copy.index) {
          const index = copy.index;
          for (let i = 0; i + 2 < index.count; i += 3) {
            const second = index.getX(i + 1);
            index.setX(i + 1, index.getX(i + 2));
            index.setX(i + 2, second);
          }
        }
      }
      const geometry=mergeGeometries(copies);
      if (!geometry) return;
      const first=meshes[0];
      const merged=new T.Mesh(geometry,first.material);
      merged.renderOrder=first.renderOrder;
      merged.layers.mask=first.layers.mask;
      group.add(merged);
      hidden.push(...meshes);
    } finally {
      copies.forEach(geometry=>geometry.dispose());
    }
  }
  function instanceRepeats(bucket: T.Mesh[]) {
    const repetitions = new Map<T.BufferGeometry, T.Mesh[]>();
    for (const mesh of bucket) {
      if (mesh.matrixWorld.determinant() <= 0) continue;
      const matches = repetitions.get(mesh.geometry);
      if (matches) matches.push(mesh);
      else repetitions.set(mesh.geometry, [mesh]);
    }
    const instanced = new Set<T.Mesh>();
    for (const [geometry, sources] of repetitions) {
      if (sources.length < MIN_INSTANCES || bytes + sources.length * INSTANCE_BYTES > MAX_BATCH_BYTES) continue;
      const first = sources[0];
      const batch = new T.InstancedMesh(geometry, first.material, sources.length);
      batch.renderOrder = first.renderOrder;
      batch.layers.mask = first.layers.mask;
      sources.forEach((source, index) => {
        batch.setMatrixAt(index, source.matrixWorld);
        instanced.add(source);
      });
      batch.instanceMatrix.needsUpdate = true;
      group.add(batch);
      hidden.push(...sources);
      bytes += sources.length * INSTANCE_BYTES;
    }
    return instanced;
  }
  try {
    for(const bucket of groups.values()) {
      if(bucket.length<2)continue;
      const instanced=instanceRepeats(bucket);
      let meshes:T.Mesh[]=[], vertices=0;
      for(const mesh of bucket) {
        if(instanced.has(mesh))continue;
        const {geometry}=mesh, size=geometry.attributes.position.count;
        const used=(geometry.index?.count??0)*4+Object.values(geometry.attributes).reduce((total,attr)=>{
          const array=attr instanceof T.InterleavedBufferAttribute?attr.data.array:attr.array;
          return total+attr.count*attr.itemSize*array.BYTES_PER_ELEMENT;
        },0);
        if(bytes+used>MAX_BATCH_BYTES)break;
        if(vertices+size>MAX_BATCH_VERTICES){merge(meshes);meshes=[];vertices=0;}
        vertices+=size;bytes+=used;meshes.push(mesh);
      }
      merge(meshes);
    }
  } catch {
    dispose();
    return null;
  }
  if(!hidden.length)return null;
  hidden.forEach(mesh=>mesh.visible=false);
  return {group,meshCount:hidden.length,sources:new Set(hidden),dispose};
}
