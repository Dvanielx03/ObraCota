"""Verification by entities of the recipes that change no geometry (``entities.py``), the path of large models.

Every test here lowers ``ENGINE_ENTITY_VERIFY_MIN_BYTES`` to one byte, so the synthetic model (and the Duplex) take
the path that Schependomlaan or ReStage take: the snapshot of the base, the comparison by ``#id``, the audit of
layer 6 and the schema of the changed entities. What it must keep from H1:

- a property or a material on the declared pieces passes, and the artifact holds the change;
- what an operation touches outside its declaration is caught: an attribute of another element, a property or a
  material of another element, a material on a piece that only declared a property, geometry, an opening;
- a new schema problem fails layer 2;
- the report says how it was verified (``diff.method``, ``diff.entities``) and that no mesh was compared (layer 7).

The snapshot of a base is written once (in a child process) and reused; a failed preview leaves nothing half written.
"""
import dataclasses
import os
import time
from pathlib import Path

import ifcopenshell
import ifcopenshell.api.geometry
import ifcopenshell.api.material
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.util.element
import pytest
from fastapi.testclient import TestClient

import engine
from conftest import DUPLEX_DOOR, build_revision, preview, report_layer
from obracota_engine import entities, settings, store
from obracota_engine.errors import EngineError
from obracota_engine.operations import REGISTRY


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(autouse=True)
def by_entities(monkeypatch):
    monkeypatch.setattr(settings, "ENGINE_ENTITY_VERIFY_MIN_BYTES", 1)


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def set_property(element, prop="FireRating", value="EI 60", op_id="op-1", pset="Pset_DoorCommon", scope="occurrence"):
    return {"id": op_id, "op": "ifc.set_property", "element": element, "scope": scope, "pset": pset,
            "property": prop, "value": value}


def set_material(*elements, op_id="op-1") -> dict:
    return {"id": op_id, "op": "ifc.set_material", "element": elements[0], "elements": list(elements),
            "material": "Piedra · claro", "category": "stone", "color": "#d8d2c4"}


def patch_apply(monkeypatch, op_name: str, extra):
    original = REGISTRY[op_name]

    def apply(model, op):
        applied = original.apply(model, op)
        extra(model)
        return applied

    monkeypatch.setitem(REGISTRY, op_name, dataclasses.replace(original, apply=apply))


def by_entity(report: dict) -> None:
    """The report of a verification by entities: its method, its counts and the layers that say what was skipped."""
    assert report["diff"]["method"] == "entities"
    assert {"compared", "changed", "added", "removed", "geometry", "snapshot"} <= set(report["diff"]["entities"])
    assert "geometry" not in report["diff"]  # IfcDiff's count of meshes compared: none here
    [seven] = [item for item in report["validation"]["skipped"] if item["layer"] == 7]
    assert seven["reason"].startswith("La receta no cambia geometría") and "IfcDiff" in seven["reason"]
    assert report_layer(report, 2)["reason"].startswith("Se validaron las ")
    assert report_layer(report, 6)["reason"].startswith("Comparación entidad por entidad con la base (")


def reasons(report: dict) -> set:
    return {(item["guid"], item["reason"]) for item in report["diff"]["unexpected"]}


def reopened(content: bytes, tmp_path) -> ifcopenshell.file:
    path = tmp_path / "built.ifc"
    path.write_bytes(content)
    return ifcopenshell.open(str(path))


# --- What passes ---------------------------------------------------------------------------------------------

def test_property_on_a_shared_set(client, originals, synthetic, tmp_path, no_temporaries):
    """D1 and D2 share Pset_DoorCommon: D1 gets its own copy. Only D1 changed, by its properties; the artifact
    holds the value and D2 keeps its own."""
    ref = originals.add_model(synthetic.file)
    door = synthetic["D1"].GlobalId
    report = preview(client, ref, set_property(door))
    assert report["ok"] is True, (report["errors"], report["diff"]["unexpected"])
    by_entity(report)
    assert [(entry["guid"], entry["flags"], entry["declared"]) for entry in report["diff"]["changed"]] == [
        (door, ["properties_changed"], True)]
    assert report["diff"]["unexpected"] == [] and report["diff"]["added"] == report["diff"]["deleted"] == []
    assert [layer["status"] for layer in report["validation"]["layers"]] == ["PASS", "PASS", "PASS"]
    assert report["diff"]["entities"]["geometry"] == 0 and report["diff"]["entities"]["snapshot"] == "written"
    assert report["timings_ms"]["snapshot"] >= 0 and "compare" in report["timings_ms"]

    response = build_revision(client, ref, [set_property(door)], report["artifact"]["id"])
    assert response.status_code == 200 and response.headers["X-ObraCota-Rebuilt"] == "false"
    built = reopened(response.content, tmp_path)
    assert ifcopenshell.util.element.get_psets(built.by_guid(door))["Pset_DoorCommon"]["FireRating"] == "EI 60"
    other = ifcopenshell.util.element.get_psets(built.by_guid(synthetic["D2"].GlobalId))["Pset_DoorCommon"]
    assert other["FireRating"] == ifcopenshell.util.element.get_psets(synthetic["D2"])["Pset_DoorCommon"]["FireRating"]


def test_property_of_a_type(client, originals, synthetic):
    """``scope=type`` changes the set of type P90: the type changed by its properties, which the recipe allows."""
    report = preview(client, originals.add_model(synthetic.file),
                     set_property(synthetic["D1"].GlobalId, "AcousticRating", "35 dB", scope="type"))
    assert report["ok"] is True, report["diff"]["unexpected"]
    by_entity(report)
    changed = {entry["guid"]: entry for entry in report["diff"]["changed"]}
    assert changed[synthetic["P90"].GlobalId]["flags"] == ["properties_changed"]
    assert all(entry["declared"] for entry in changed.values())


def test_material_on_two_walls(client, originals, synthetic):
    walls = [synthetic["W1"].GlobalId, synthetic["W2"].GlobalId]
    report = preview(client, originals.add_model(synthetic.file), set_material(*walls))
    assert report["ok"] is True, (report["errors"], report["diff"]["unexpected"])
    by_entity(report)
    changed = {entry["guid"]: entry for entry in report["diff"]["changed"]}
    assert set(changed) == set(walls)
    assert all(set(entry["flags"]) <= {"material_changed", "style_changed"} and entry["declared"]
               for entry in changed.values())
    assert {line["element"] for line in report["quantities"]} == set(walls)


def test_two_operations_and_a_rebuild(client, originals, synthetic):
    """A property and a material in one recipe; /build without the artifact rebuilds with the same verification."""
    ref = originals.add_model(synthetic.file)
    operations = [set_property(synthetic["D1"].GlobalId), set_material(synthetic["W1"].GlobalId, op_id="op-2")]
    report = preview(client, ref, *operations)
    assert report["ok"] is True, report["diff"]["unexpected"]
    assert report["diff"]["entities"]["snapshot"] == "written"
    response = build_revision(client, ref, operations)
    assert response.status_code == 200 and response.headers["X-ObraCota-Rebuilt"] == "true"


def test_empty_recipe_changes_nothing(client, originals, synthetic):
    report = preview(client, originals.add_model(synthetic.file))
    assert report["ok"] is True
    by_entity(report)
    counts = report["diff"]["entities"]
    assert (counts["changed"], counts["added"], counts["removed"]) == (0, 0, 0) and counts["compared"] > 100
    assert report["diff"]["changed"] == [] and report["diff"]["unexpected"] == []


# --- What is caught ------------------------------------------------------------------------------------------

def test_attribute_of_another_element(client, originals, synthetic, monkeypatch):
    """H1-2 by entities: the property of D1 also renames W1. W1 is unexpected, with the attribute named."""
    wall = synthetic["W1"].GlobalId

    def rename(model):
        model.by_guid(wall).Name = "W1 renombrado"

    patch_apply(monkeypatch, "ifc.set_property", rename)
    report = preview(client, originals.add_model(synthetic.file), set_property(synthetic["D1"].GlobalId))
    assert report["ok"] is False and "artifact" not in report
    [unexpected] = report["diff"]["unexpected"]
    assert (unexpected["guid"], unexpected["reason"], unexpected["flags"], unexpected["attributes"]) == (
        wall, "UNDECLARED", ["attributes_changed"], ["Name"])
    assert report_layer(report, 6)["status"] == "FAIL" and report_layer(report, 6)["unexpected"] == [wall]
    assert [error["code"] for error in report["errors"]] == ["SCOPE_UNEXPECTED"]


def test_property_of_another_element(client, originals, synthetic, monkeypatch):
    """The property of D1 also writes a property of the slab: the slab changed by its properties, undeclared."""
    slab = synthetic["slab"].GlobalId

    def write(model):
        pset = ifcopenshell.api.pset.add_pset(model, product=model.by_guid(slab), name="Pset_SlabCommon")
        ifcopenshell.api.pset.edit_pset(model, pset=pset, properties={"Status": "NEW"})

    patch_apply(monkeypatch, "ifc.set_property", write)
    report = preview(client, originals.add_model(synthetic.file), set_property(synthetic["D1"].GlobalId))
    assert report["ok"] is False
    assert reasons(report) == {(slab, "UNDECLARED")}
    [entry] = [item for item in report["diff"]["unexpected"]]
    assert entry["flags"] == ["properties_changed"]


def test_material_where_only_a_property_was_declared(client, originals, synthetic, monkeypatch):
    """D1 declares a property; a material on D1 is a change its operation does not make: FLAG_NOT_ALLOWED."""
    door = synthetic["D1"].GlobalId

    def paint(model):
        material = ifcopenshell.api.material.add_material(model, name="Pintura")
        ifcopenshell.api.material.assign_material(model, products=[model.by_guid(door)], material=material)

    patch_apply(monkeypatch, "ifc.set_property", paint)
    report = preview(client, originals.add_model(synthetic.file), set_property(door))
    assert report["ok"] is False
    assert (door, "FLAG_NOT_ALLOWED") in reasons(report)


def test_material_of_another_element(client, originals, synthetic, monkeypatch):
    """The material of W1 also reaches the slab: the slab is unexpected."""
    slab = synthetic["slab"].GlobalId

    def paint(model):
        material = ifcopenshell.api.material.add_material(model, name="Otra")
        ifcopenshell.api.material.assign_material(model, products=[model.by_guid(slab)], material=material)

    patch_apply(monkeypatch, "ifc.set_material", paint)
    report = preview(client, originals.add_model(synthetic.file), set_material(synthetic["W1"].GlobalId))
    assert report["ok"] is False
    assert (slab, "UNDECLARED") in reasons(report)


def test_geometry_is_caught(client, originals, synthetic, monkeypatch):
    """A property that also moves wall W1 (its placement's point): geometry changed, W1 named, ok=false."""
    wall = synthetic["W1"].GlobalId

    def move(model):
        location = model.by_guid(wall).ObjectPlacement.RelativePlacement.Location
        location.Coordinates = (location.Coordinates[0] + 0.5, *location.Coordinates[1:])

    patch_apply(monkeypatch, "ifc.set_property", move)
    report = preview(client, originals.add_model(synthetic.file), set_property(synthetic["D1"].GlobalId))
    assert report["ok"] is False
    assert report["diff"]["entities"]["geometry"] >= 1
    assert (wall, "GEOMETRY_CHANGED") in reasons(report)


def test_lost_opening_is_caught(client, originals, synthetic, monkeypatch):
    """H1-3 by entities: removing wall W1 also loses opening H1 and leaves D1 floating."""
    wall, opening, door = (synthetic[name].GlobalId for name in ("W1", "H1", "D1"))
    patch_apply(monkeypatch, "ifc.set_property",
                lambda model: ifcopenshell.api.root.remove_product(model, product=model.by_guid(wall)))
    report = preview(client, originals.add_model(synthetic.file), set_property(door))
    assert report["ok"] is False and "artifact" not in report
    assert {(wall, "DELETED"), (opening, "OPENING_DELETED")} <= reasons(report)
    assert [item["guid"] for item in report["diff"]["deleted"]] == [wall]
    assert [item["guid"] for item in report["diff"]["openings"]["deleted"]] == [opening]
    issues = {(issue["code"], issue["element"]) for issue in report_layer(report, 1)["issues"]}
    assert ("FILLING_CHANGED", door) in issues and ("OPENING_LOST", opening) in issues


def test_unfilled_opening_is_caught(client, originals, synthetic, monkeypatch):
    door, opening = synthetic["D1"].GlobalId, synthetic["H1"].GlobalId

    def unfill(model):
        for rel in model.by_guid(door).FillsVoids:
            model.remove(rel)

    patch_apply(monkeypatch, "ifc.set_property", unfill)
    report = preview(client, originals.add_model(synthetic.file), set_property(door))
    assert report["ok"] is False
    assert [item["guid"] for item in report["diff"]["openings"]["unfilled"]] == [opening]
    assert "ENTITY_OUT_OF_SCOPE" in {reason for _, reason in reasons(report)}


def test_opening_shape_is_caught(client, originals, synthetic, monkeypatch):
    """H1-4 by entities: opening H1 gets another representation. No mesh is compared: its new geometry is."""
    opening = synthetic["H1"].GlobalId

    def widen(model):
        product = model.by_guid(opening)
        body = next(context for context in model.by_type("IfcGeometricRepresentationSubContext")
                    if context.ContextIdentifier == "Body")
        for representation in list(product.Representation.Representations):
            ifcopenshell.api.geometry.unassign_representation(model, product=product, representation=representation)
        ifcopenshell.api.geometry.assign_representation(
            model, product=product,
            representation=ifcopenshell.api.geometry.add_wall_representation(
                model, context=body, length=1.02, height=2.12, thickness=0.27))

    patch_apply(monkeypatch, "ifc.set_property", widen)
    report = preview(client, originals.add_model(synthetic.file), set_property(synthetic["D1"].GlobalId))
    assert report["ok"] is False
    assert (opening, "GEOMETRY_CHANGED") in reasons(report)


def test_new_schema_issue_fails(client, originals, synthetic, monkeypatch):
    """A property without its required Name, added next to the change: layer 2 fails on the changed entities."""
    patch_apply(monkeypatch, "ifc.set_property",
                lambda model: model.createIfcPropertySingleValue(None, None, model.createIfcLabel("sin nombre"), None))
    report = preview(client, originals.add_model(synthetic.file), set_property(synthetic["D1"].GlobalId))
    assert report["ok"] is False
    schema = report_layer(report, 2)
    assert schema["status"] == "FAIL" and len(schema["new_issues"]) >= 1
    assert "SCHEMA_NEW_ISSUES" in {error["code"] for error in report["errors"]}


# --- Snapshots ----------------------------------------------------------------------------------------------

def test_snapshot_is_written_once(client, originals, synthetic, snapshot_store):
    ref = originals.add_model(synthetic.file)
    first = preview(client, ref, set_property(synthetic["D1"].GlobalId))
    second = preview(client, ref, set_property(synthetic["D2"].GlobalId, "IsExternal", True))
    assert (first["diff"]["entities"]["snapshot"], second["diff"]["entities"]["snapshot"]) == ("written", "cache")
    assert [entry.name.split("-")[0] for entry in snapshot_store.glob("*.ifc")] == [ref.sha256]


def test_snapshots_are_bounded(client, originals, synthetic, snapshot_store, monkeypatch):
    monkeypatch.setattr(settings, "ENGINE_SNAPSHOTS_MAX_BYTES", 1)
    first = originals.add_model(synthetic.file)
    synthetic["W1"].Name = "W1 bis"
    second = originals.add_model(synthetic.file)
    for ref in (first, second):
        assert preview(client, ref, set_property(synthetic["D1"].GlobalId))["ok"] is True
    assert [entry.name.split("-")[0] for entry in snapshot_store.glob("*.ifc")] == [second.sha256]


def test_rejected_recipe_leaves_no_snapshot_half_written(client, originals, synthetic, snapshot_store):
    report = preview(client, originals.add_model(synthetic.file), set_property(synthetic["D1"].GlobalId, value=None))
    assert report["ok"] is False and report["operations"][0]["errors"][0]["code"] == "VALUE_REQUIRED"
    assert not list(snapshot_store.glob(".*.part"))


def test_compare_merges_by_id(tmp_path):
    base, revision = tmp_path / "base.ifc", tmp_path / "revision.ifc"
    base.write_bytes(b"ISO-10303-21;\nHEADER;\nFILE_NAME('a');\nENDSEC;\nDATA;\n#1=IFCA(1);\n#2=IFCB(2);\n"
                     b"#4=IFCD(4);\nENDSEC;\nEND-ISO-10303-21;\n")
    revision.write_bytes(b"ISO-10303-21;\nHEADER;\nFILE_NAME('b');\nENDSEC;\nDATA;\n#1=IFCA(1);\n#2=IFCB(3);\n"
                         b"#5=IFCE(5);\nENDSEC;\nEND-ISO-10303-21;\n")
    delta = entities.compare(base, revision)
    assert (delta.changed, delta.added, delta.removed, delta.compared) == ([2], [5], [4], 3)
    revision.write_bytes(b"DATA;\n#2=IFCB(2);\n#1=IFCA(1);\n")
    with pytest.raises(EngineError) as raised:
        entities.compare(base, revision)
    assert raised.value.code == "MODEL_UNREADABLE"


# --- A real model -------------------------------------------------------------------------------------------

def test_duplex_property_and_material(client, duplex, tmp_path):
    """The Duplex (IFC2X3, Revit) by entities: a property of a door and the material of a wall pass, and only
    those pieces changed."""
    model = ifcopenshell.open(str(duplex.path))
    wall = next(w for w in model.by_type("IfcWallStandardCase")
                if not ifcopenshell.util.element.get_material(w)
                or not ifcopenshell.util.element.get_material(w).is_a("IfcMaterialProfileSetUsage")).GlobalId
    report = preview(client, duplex, set_property(DUPLEX_DOOR), set_material(wall, op_id="op-2"))
    assert report["ok"] is True, (report["errors"], report["diff"]["unexpected"], report_layer(report, 2))
    by_entity(report)
    assert {entry["guid"] for entry in report["diff"]["changed"]} == {DUPLEX_DOOR, wall}


# --- Large models (optional): BIG_IFC is any IFC above 32 MiB, e.g. Schependomlaan's as-planned.ifc ------------

def first_door_with(model) -> str:
    from obracota_engine import recipe as recipe_module
    from obracota_engine.operations import check_one
    for door in model.by_type("IfcDoor"):
        op = recipe_module.parse_operation(set_property(door.GlobalId), 0)
        if not check_one(model, op, [op]):
            return door.GlobalId
    pytest.skip("no door of BIG_IFC takes Pset_DoorCommon.FireRating")


def test_big_model_property_within_a_minute(client, originals, monkeypatch):
    """A property on a model far above the geometry limit, with the default threshold: under 60 s cold."""
    path = os.environ.get("BIG_IFC")
    if not path or not os.path.isfile(path):
        pytest.skip("set BIG_IFC to an IFC above 32 MiB to run this test")
    monkeypatch.setattr(settings, "ENGINE_ENTITY_VERIFY_MIN_BYTES", 4_194_304)  # the default
    ref = originals.link(Path(path))
    assert ref.path.stat().st_size > settings.ENGINE_PREVIEW_MAX_BYTES
    door = first_door_with(ifcopenshell.open(path))
    started = time.perf_counter()
    report = preview(client, ref, set_property(door))
    elapsed = time.perf_counter() - started
    print(f"BIG_IFC {ref.path.stat().st_size / 1e6:.0f} MB: {elapsed:.1f} s, timings {report['timings_ms']}")
    assert report["ok"] is True, (report["errors"], report["diff"]["unexpected"])
    assert report["diff"]["method"] == "entities" and report["diff"]["changed"][0]["guid"] == door
    assert elapsed < float(os.environ.get("BIG_IFC_MAX_S", "60"))
