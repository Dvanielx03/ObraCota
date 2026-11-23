"""ifc.set_material: one exterior finish for a list of pieces (H2 material).

The synthetic IFC4 model covers each starting point (no material, a single IfcMaterial, a layer set shared with
a piece outside the list, a profile set) and the Duplex (IFC2X3, Revit) the real case: its 23 exterior walls
with IfcMaterialLayerSetUsage, where only layer 1 (brick, the exterior face) changes.
"""
import ifcopenshell
import ifcopenshell.api.material
import ifcopenshell.util.element
import pytest
from fastapi.testclient import TestClient

import engine
from conftest import build_revision, preview, recipe_of, report_layer
from obracota_engine import recipe, store
from obracota_engine.operations import set_material

STONE = {"material": "Piedra · claro", "category": "Piedra", "color": "#cbbfa8"}


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def op(*elements, op_id="op-1", **extra) -> dict:
    return {"id": op_id, "op": "ifc.set_material", "element": elements[0], "elements": list(elements),
            **STONE, **extra}


def checks(client, ref, *operations) -> dict:
    response = client.post("/preview", json={**ref.params(), "checks_only": True, "recipe": recipe_of(*operations)})
    assert response.status_code == 200, response.text
    return response.json()


def reopened(content: bytes, tmp_path) -> ifcopenshell.file:
    path = tmp_path / "revision.ifc"
    path.write_bytes(content)
    return ifcopenshell.open(str(path))


def layered(synthetic):
    """W2 and W3 share one layer set (brick outside, block inside); W4 gets a profile set."""
    model = synthetic.file
    api = ifcopenshell.api.material
    layer_set = api.add_material_set(model, name="Muro ladrillo", set_type="IfcMaterialLayerSet")
    for name, thickness in (("Ladrillo", 0.09), ("Bloque", 0.08)):
        api.add_layer(model, layer_set=layer_set, material=api.add_material(model, name=name)).LayerThickness = thickness
    api.assign_material(model, products=[synthetic["W2"], synthetic["W3"]], type="IfcMaterialLayerSetUsage",
                        material=layer_set)
    profiles = api.add_material_set(model, name="Perfiles", set_type="IfcMaterialProfileSet")
    api.assign_material(model, products=[synthetic["W4"]], type="IfcMaterialProfileSet", material=profiles)
    return synthetic


def layers_of(element) -> list:
    usage = ifcopenshell.util.element.get_material(element, should_skip_usage=False)
    return [(layer.Material.Name, round(layer.LayerThickness, 6)) for layer in usage.ForLayerSet.MaterialLayers]


def surface_colour(element):
    for shape in element.Representation.Representations:
        for item in shape.Items:
            for styled in item.StyledByItem:
                for style in styled.Styles:
                    styles = style.Styles if style.is_a("IfcPresentationStyleAssignment") else [style]
                    for surface in styles:
                        if surface.is_a("IfcSurfaceStyle"):
                            return surface.Name
    return None


def test_recipe_shape():
    good = recipe.parse_recipe(recipe_of(op("0" * 22, "1" * 22)))
    assert good.operations[0].elements == ["0" * 22, "1" * 22]
    for broken in (op("0" * 22, color="cbbfa8"), {**op("0" * 22), "element": "1" * 22},
                   op("0" * 22, "0" * 22), {**op("0" * 22), "elements": []}, op("0" * 22, material=" "),
                   {**op("0" * 22), "extra": 1}):
        with pytest.raises(recipe.EngineError) as error:
            recipe.parse_recipe(recipe_of(broken))
        assert error.value.code == "RECIPE_INVALID"


def test_checks(client, originals, synthetic):
    layered(synthetic)
    ref = originals.add_model(synthetic.file)
    wall, opening, profiles = synthetic["W1"].GlobalId, synthetic["H1"].GlobalId, synthetic["W4"].GlobalId
    result = checks(client, ref, op(wall), op("0" * 22, op_id="op-2"), op(opening, op_id="op-3"),
                    op(profiles, op_id="op-4"), op(synthetic["W5"].GlobalId, wall, op_id="op-5"))
    codes = [[error["code"] for error in item["errors"]] for item in result["operations"]]
    assert codes == [["MATERIAL_TARGET_REPEATED"], ["ELEMENT_NOT_FOUND"], ["NOT_AN_ELEMENT"],
                     ["MATERIAL_NOT_SUPPORTED"], ["MATERIAL_TARGET_REPEATED"]]
    assert checks(client, ref, op(wall, synthetic["W2"].GlobalId))["ok"] is True


def test_synthetic_preview_and_build(client, originals, synthetic, tmp_path):
    layered(synthetic)
    ref = originals.add_model(synthetic.file)
    pieces = [synthetic[name].GlobalId for name in ("W1", "W2", "slab")]
    operation = op(*pieces, price_key="item:Piedra · claro")
    report = preview(client, ref, operation)
    assert report["ok"] is True, report["errors"]
    assert report_layer(report, 1)["status"] == "PASS"
    assert report_layer(report, 6)["status"] == "PASS"
    result = report["operations"][0]
    assert result["after"]["pieces"] == 3 and result["after"]["layered"] == 1
    assert {"material": "Muro ladrillo (capa 1: Ladrillo)", "pieces": 1} in result["before"]["materials"]
    rules = {item["rule"] for item in report["findings"]}
    assert {"MATERIAL_EXTERIOR_LAYER", "STYLE_WHOLE_BODY"} <= rules
    assert sorted(item["guid"] for item in report["affected"]) == sorted(pieces)

    built = build_revision(client, ref, [operation], report["artifact"]["id"])
    assert built.status_code == 200
    revised = reopened(built.content, tmp_path)
    w1, w2, w3, slab = (revised.by_guid(synthetic[name].GlobalId) for name in ("W1", "W2", "W3", "slab"))
    assert ifcopenshell.util.element.get_material(w1).Name == "Piedra · claro"
    assert ifcopenshell.util.element.get_material(slab).Name == "Piedra · claro"
    assert ifcopenshell.util.element.get_material(slab).Category == "Piedra"
    assert layers_of(w2) == [("Piedra · claro", 0.09), ("Bloque", 0.08)]
    # W3 shared the layer set and is not in the list: it keeps its brick.
    assert layers_of(w3) == [("Ladrillo", 0.09), ("Bloque", 0.08)]
    assert surface_colour(w1) == "Piedra · claro" and surface_colour(w3) is None
    assert len(revised.by_type("IfcRelAssociatesMaterial")) >= 3
    # The other pieces keep their materials (concrete is still there for nobody else, untouched).
    assert ifcopenshell.util.element.get_material(revised.by_guid(synthetic["W4"].GlobalId)).is_a("IfcMaterialProfileSet")


def test_verify_detects_out_of_scope(originals, synthetic, tmp_path):
    layered(synthetic)
    base = synthetic.file
    path = tmp_path / "base.ifc"
    base.write(str(path))
    work = ifcopenshell.open(str(path))
    parsed = recipe.parse_recipe(recipe_of(op(synthetic["W1"].GlobalId))).operations[0]
    set_material.apply(work, parsed)
    # Something the recipe did not ask: W3's shared brick becomes stone.
    usage = ifcopenshell.util.element.get_material(work.by_guid(synthetic["W3"].GlobalId), should_skip_usage=False)
    usage.ForLayerSet.MaterialLayers[0].Material = work.by_type("IfcMaterial")[-1]
    work.write(str(tmp_path / "out.ifc"))
    issues = set_material.verify(base, ifcopenshell.open(str(tmp_path / "out.ifc")), parsed, (parsed,))
    assert {item["code"] for item in issues} == {"MATERIAL_OUT_OF_SCOPE"}


def test_duplex_exterior_walls(client, duplex, tmp_path):
    model = ifcopenshell.open(str(duplex.path))
    walls = [wall for wall in model.by_type("IfcWall")
             if any(values.get("IsExternal") for name, values in ifcopenshell.util.element.get_psets(wall).items()
                    if name.endswith("Common"))]
    assert len(walls) == 23
    guids = [wall.GlobalId for wall in walls]
    before = {guid: layers_of(model.by_guid(guid)) for guid in guids}
    operation = op(*guids)
    report = preview(client, duplex, operation)
    assert report["ok"] is True, (report["errors"], report_layer(report, 1))
    assert report_layer(report, 2)["status"] == "PASS"
    assert report["operations"][0]["after"]["layered"] == 23
    built = build_revision(client, duplex, [operation], report["artifact"]["id"])
    revised = reopened(built.content, tmp_path)
    for guid in guids:
        after = layers_of(revised.by_guid(guid))
        assert after[0] == ("Piedra · claro", before[guid][0][1])
        assert after[1:] == before[guid][1:]
        assert surface_colour(revised.by_guid(guid)) == "Piedra · claro"
    # Interior walls of the same family keep their layers and colours.
    for wall in model.by_type("IfcWall"):
        if wall.GlobalId not in guids:
            other = revised.by_guid(wall.GlobalId)
            if ifcopenshell.util.element.get_material(wall, should_skip_usage=False) is not None:
                assert layers_of(other) == layers_of(wall)
            assert surface_colour(other) == surface_colour(wall)
