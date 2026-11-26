import { IfcAPI, IFCPROJECT, IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELASSOCIATESMATERIAL, IFCRELDEFINESBYPROPERTIES, IFCRELDEFINESBYTYPE } from "../ifc/web-ifc-api.js";

import {fileVersion} from "./file-version.js";
import {readDoorEvidence} from "./door-evidence.js";

/** A STEP string with its \X2\…\X0\, \X\hh and \S\ escapes decoded (a no-op when web-ifc already decoded it). */
function decodeStep(text) {
  if (typeof text !== "string" || !text.includes("\\")) return text;
  return text
    .replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/gi, (_, hex) => String.fromCharCode(...hex.match(/.{4}/g).map(h => parseInt(h, 16))))
    .replace(/\\X4\\((?:[0-9A-F]{8})+)\\X0\\/gi, (_, hex) => String.fromCodePoint(...hex.match(/.{8}/g).map(h => parseInt(h, 16))))
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c) => String.fromCharCode(c.charCodeAt(0) + 128))
    .replace(/\\\\/g, "\\");
}

/**
 * Material names of every piece, by express id: an IfcMaterial, each layer of a layer set (usage) in order, the
 * constituents, profiles or list, so Propiedades › Material names what a Revit wall is made of, an approved finish on
 * its exterior layer included. A piece without its own association takes its type's. Unique names, in file order.
 */
function readMaterials(api, model) {
  const cache = new Map();
  const line = ref => ref?.value != null ? api.GetLine(model, ref.value) : null;
  const nameOf = item => { const name = decodeStep(item?.Name?.value); return typeof name === "string" && name.trim() ? name.trim() : null; };
  function names(id, depth = 0) {
    if (id == null || depth > 4) return [];
    if (cache.has(id)) return cache.get(id);
    let found = [];
    try {
      const item = api.GetLine(model, id);
      const kind = api.GetNameFromTypeCode(item.type).toUpperCase();
      const parts = list => (list ?? []).flatMap(ref => names(ref?.value, depth + 1));
      const owned = list => (list ?? []).map(line).map(part => nameOf(line(part?.Material)));
      if (kind === "IFCMATERIAL") found = [nameOf(item)];
      else if (kind === "IFCMATERIALLAYERSETUSAGE") found = names(item.ForLayerSet?.value, depth + 1);
      else if (kind === "IFCMATERIALPROFILESETUSAGE" || kind === "IFCMATERIALPROFILESETUSAGETAPERING") found = names(item.ForProfileSet?.value, depth + 1);
      else if (kind === "IFCMATERIALLAYERSET") found = owned(item.MaterialLayers);
      else if (kind === "IFCMATERIALCONSTITUENTSET") found = owned(item.MaterialConstituents);
      else if (kind === "IFCMATERIALPROFILESET") found = owned(item.MaterialProfiles);
      else if (kind === "IFCMATERIALLIST") found = parts(item.Materials);
      else if (kind === "IFCMATERIALLAYER" || kind === "IFCMATERIALCONSTITUENT" || kind === "IFCMATERIALPROFILE") found = [nameOf(line(item.Material))];
    } catch { /* a malformed material does not stop the read */ }
    found = [...new Set(found.filter(Boolean))];
    cache.set(id, found);
    return found;
  }
  const byElement = new Map();
  const associations = api.GetLineIDsWithType(model, IFCRELASSOCIATESMATERIAL);
  for (let i = 0; i < associations.size(); i++) {
    try {
      const rel = api.GetLine(model, associations.get(i));
      const found = names(rel.RelatingMaterial?.value);
      if (found.length) for (const ref of rel.RelatedObjects ?? []) byElement.set(ref.value, found);
    } catch { /* idem */ }
  }
  const typed = api.GetLineIDsWithType(model, IFCRELDEFINESBYTYPE);
  for (let i = 0; i < typed.size(); i++) {
    try {
      const rel = api.GetLine(model, typed.get(i));
      const found = byElement.get(rel.RelatingType?.value);
      if (found) for (const ref of rel.RelatedObjects ?? []) if (!byElement.has(ref.value)) byElement.set(ref.value, found);
    } catch { /* idem */ }
  }
  return byElement;
}
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
    const materials = readMaterials(api, model);
    // Pset_*Common.IsExternal, so the viewer can tell the envelope apart (exterior finish preview).
    const external = new Map();
    const definitions = api.GetLineIDsWithType(model, IFCRELDEFINESBYPROPERTIES);
    for (let i = 0; i < definitions.size(); i++) {
      try {
        const rel = api.GetLine(model, definitions.get(i));
        const set = api.GetLine(model, rel.RelatingPropertyDefinition?.value);
        if (!/^Pset_.*Common$/.test(set?.Name?.value ?? "")) continue;
        for (const ref of set.HasProperties ?? []) {
          const property = api.GetLine(model, ref.value);
          if (property?.Name?.value !== "IsExternal") continue;
          const value = property.NominalValue?.value;
          const flag = value === true || value === "T" || value === ".T." || value === "TRUE";
          for (const object of rel.RelatedObjects ?? []) external.set(object.value, flag);
        }
      } catch { /* a malformed property set does not stop the read */ }
    }
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
      const names = materials.get(id);
      elements.push({id: String(id), guid: line.GlobalId?.value, name: line.Name?.value || type + " #" + id,
        type, level: levels.get(id) || "Sin nivel directo", material: names?.join(" / "), materials: names, parts,
        external: external.get(id), predefined: typeof line.PredefinedType?.value === "string" ? line.PredefinedType.value : undefined});
    });
    if (!elements.length) throw new Error("El IFC no contiene geometría visible.");
    readDoorEvidence(api,model,elements.filter(element=>element.type.toUpperCase()==="IFCDOOR"),geometry);
    const projects=api.GetLineIDsWithType(model,IFCPROJECT);
    const project=projects.size()===1?api.GetLine(model,projects.get(0)):null;
    const units=project?.UnitsInContext?api.GetLine(model,project.UnitsInContext.value)?.Units??[]:[];
    const length=units.map(ref=>api.GetLine(model,ref.value)).filter(unit=>unit?.UnitType?.value==="LENGTHUNIT");
    // StreamAllMeshes applies the model's linear scaling factor, so the geometry arrives in metres whether the file
    // declares a prefixed metre or an imperial conversion unit (a Revit export in feet or inches).
    const name=typeof length[0]?.Name?.value==="string"?length[0].Name.value.toUpperCase():"";
    const metric=length.length===1 && (name==="METRE" && [undefined,null,"MILLI","CENTI","DECI","KILO"].includes(length[0].Prefix?.value)
      || ["FOOT","FEET","INCH","YARD"].includes(name));
    self.postMessage({schema, geometry, elements,walk:metric?Array.from(api.GetCoordinationMatrix(model)):undefined,versionId:await fileVersion(bytes)}, buffers);
  } catch (error) {
    self.postMessage({error: error instanceof Error ? error.message : "No se pudo procesar el IFC."});
  } finally {
    if (model >= 0) api.CloseModel(model);
  }
};
