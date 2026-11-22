// Checks that explorer ids of manufacturer meshes (meshIds in src/viewer/infrastructure/mesh-source.ts,
// run by Node's type stripping) belong to the piece, not to its position: a revision that adds or
// reorders pieces keeps every other piece's id. Prints the ids of each case as JSON for fbx-obj.spec.ts.
import * as T from "three";

console.warn = () => {};
const { meshIds } = await import(new URL("../../src/viewer/infrastructure/mesh-source.ts", import.meta.url).href);

function model(names) {
  const top = new T.Group();
  const product = new T.Group();
  product.name = "Furniture_Tables_Fritz-Hansen_Stub";
  top.add(product);
  const meshes = names.map(name => {
    const mesh = new T.Mesh();
    mesh.name = name;
    product.add(mesh);
    return mesh;
  });
  return meshIds(meshes, top);
}

const pieces = ["L_b4050213_aaaa_bbbb_cccc_000000000001_I1", "L_b4050213_aaaa_bbbb_cccc_000000000002_I2", "Leg", "Leg"];
const unnamed = new T.Group(), loose = [new T.Mesh(), new T.Mesh()];
unnamed.add(...loose);
process.stdout.write(JSON.stringify({
  first: model(pieces),
  again: model(pieces),
  // Revision 2: the manufacturer adds a piece at the start and reorders the two named ones.
  revised: model(["L_b4050213_aaaa_bbbb_cccc_000000000009_I9", pieces[1], pieces[0], "Leg", "Leg"]),
  unnamed: meshIds(loose, unnamed),
}));
