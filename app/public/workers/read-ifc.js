import { IfcAPI, IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELASSOCIATESMATERIAL } from "../ifc/web-ifc-api.js";

import {fileVersion} from "./file-version.js";
// This worker owns the WASM heap. Only JavaScript-owned buffers cross the boundary.
self.onmessage = async ({data: file}) => {
  const api = new IfcAPI();
  let model = -1;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!new TextDecoder().decode(bytes.subarray(0, 256)).includes("ISO-10303-21")) {
      throw new Error("El archivo no contiene una cabecera IFC STEP válida.");
    }
    api.SetWasmPath(new URL("../ifc/", self.location.href).href, true);
    await api.Init();
    model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
    if (model < 0) throw new Error("No se pudo leer el esquema IFC.");
    const schema = api.GetModelSchema(model);
    self.postMessage({ status: "Leyendo niveles y materiales…" });
    function relationMap(type, field, resolve) {
      const map = new Map();
      const ids = api.GetLineIDsWithType(model, type);
      for (let i = 0; i < ids.size(); i++) {
        const rel = api.GetLine(model, ids.get(i));
        const label = resolve(api.GetLine(model, rel[field].value));
        if (label) for (const ref of rel.RelatedElements ?? rel.RelatedObjects ?? []) map.set(ref.value, label);
      }
      return map;
    }
    const levels = relationMap(IFCRELCONTAINEDINSPATIALSTRUCTURE, "RelatingStructure", item => item?.Name?.value);
    const materials = relationMap(IFCRELASSOCIATESMATERIAL, "RelatingMaterial", item => item?.Name?.value);
    const geometry = new Map();
    const elements = [];
    const buffers = [];
    self.postMessage({status: "Preparando geometría…"});
    api.StreamAllMeshes(model, mesh => {
      const parts = [];
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const part = mesh.geometries.get(i);
        const key = part.geometryExpressID;
        if (!geometry.has(key)) {
          const source = api.GetGeometry(model, key);
          try {
            const vertices = api.GetVertexArray(source.GetVertexData(), source.GetVertexDataSize()).slice();
            const indices = api.GetIndexArray(source.GetIndexData(), source.GetIndexDataSize()).slice();
            geometry.set(key, {vertices, indices});
            buffers.push(vertices.buffer, indices.buffer);
          } finally { source.delete(); }
        }
        if (geometry.get(key).indices.length) {
          const {x,y,z,w} = part.color;
          parts.push({key, matrix: part.flatTransformation, color: [x,y,z,w]});
        }
      }
      if (!parts.length) return;
      const id = mesh.expressID;
      const line = api.GetLine(model,id);
      const type = api.GetNameFromTypeCode(line.type);
      elements.push({id: String(id), guid: line.GlobalId?.value, name: line.Name?.value || type + " #" + id,
        type, level: levels.get(id) || "Sin nivel directo", material: materials.get(id), parts});
    });
    if (!elements.length) throw new Error("El IFC no contiene geometría visible.");
    self.postMessage({schema, geometry, elements,versionId:await fileVersion(bytes)}, buffers);
  } catch (error) {
    self.postMessage({error: error instanceof Error ? error.message : "No se pudo procesar el IFC."});
  } finally {
    if (model >= 0) api.CloseModel(model);
  }
};
