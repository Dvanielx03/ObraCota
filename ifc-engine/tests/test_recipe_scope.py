"""Layer 6, the scope rule, and /diff (H1-ESPECIFICACION §5.8, §5.6; H1-1 and H1-2).

- H1-1: an empty recipe changes nothing: no element or opening changed, added or deleted, and ``ok=true``.
  With the Duplex the result is a characterisation: the round trip rewrites the numbers (other bytes, other
  SHA-256) but neither IfcDiff pass nor the own opening control sees a change (step 0).
- H1-2: an operation that declares X and also touches Y is caught: ``ok=false`` and ``diff.unexpected`` is
  exactly Y.
- A declared element with a flag its declaration does not allow (an attribute outside ``attributes:<Name>``)
  is unexpected too.
- The report says how many elements IfcDiff compared by geometry: all those with a Body/MODEL_VIEW
  representation in the synthetic model, none in the Duplex (Revit 2011 has no Body subcontext).
- /diff compares two stored versions: the diff object without ``declared`` or ``unexpected``.
"""
import dataclasses

import ifcopenshell
import ifcopenshell.api.type
import pytest
from fastapi.testclient import TestClient

import engine
from conftest import DUPLEX_DOOR, DUPLEX_TYPE, preview, report_layer
from obracota_engine import scope, store
from obracota_engine.operations import REGISTRY


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def change_type(element, type_id, op_id="op-1") -> dict:
    return {"id": op_id, "op": "ifc.change_type", "element": element, "type_id": type_id}


def set_property(element, prop, value, op_id="op-1", pset="Pset_DoorCommon", scope_="occurrence") -> dict:
    return {"id": op_id, "op": "ifc.set_property", "element": element, "scope": scope_, "pset": pset,
            "property": prop, "value": value}


def nothing_changed(diff: dict) -> None:
    assert diff["changed"] == [] and diff["added"] == [] and diff["deleted"] == []
    assert diff["openings"] == {"changed": [], "added": [], "deleted": [], "unfilled": []}
    assert diff["unexpected"] == [] and diff["truncated"] is False


def patch_apply(monkeypatch, op_name: str, extra):
    """Make ``op_name`` also run ``extra(model)`` after its own apply (H1-2 to H1-4)."""
    original = REGISTRY[op_name]

    def apply(model, op):
        applied = original.apply(model, op)
        extra(model)
        return applied

    monkeypatch.setitem(REGISTRY, op_name, dataclasses.replace(original, apply=apply))


def test_empty_recipe_zero_diff(client, originals, synthetic, no_temporaries):
    """H1-1 (synthetic): nothing changed, ok=true and the three layers pass."""
    report = preview(client, originals.add_model(synthetic.file))
    assert report["ok"] is True and report["errors"] == [] and report["operations"] == []
    nothing_changed(report["diff"])
    assert [layer["status"] for layer in report["validation"]["layers"]] == ["PASS", "PASS", "PASS"]
    assert report["diff"]["relationships"] == scope.RELATIONSHIPS
    assert report["affected"] == [] and report["quantities"] == []


def test_empty_recipe_duplex(client, duplex, no_temporaries):
    """H1-1 (Duplex, characterisation): the round trip shows no difference in either pass, in the openings
    or in the schema, although the bytes change. IfcDiff compares the geometry of none of its elements."""
    report = preview(client, duplex)
    assert report["ok"] is True
    nothing_changed(report["diff"])
    assert report["artifact"]["sha256"] != duplex.sha256  # the writer reformats the numbers (step 0)
    geometry = report["diff"]["geometry"]
    assert (geometry["elements_compared"], geometry["openings_compared"], geometry["openings"]) == (0, 0, 50)
    schema = report_layer(report, 2)
    assert (schema["base_issues"], schema["output_issues"], schema["new_issues"]) == (0, 0, [])


def test_declared_x_touches_y(client, originals, synthetic, monkeypatch, no_temporaries):
    """H1-2: set_property declares D1 and, through a patched apply, also renames W1: diff.unexpected is
    exactly W1, ok=false and there is no artifact."""
    wall = synthetic["W1"].GlobalId

    def rename(model):
        model.by_guid(wall).Name = "W1 renombrado"

    patch_apply(monkeypatch, "ifc.set_property", rename)
    report = preview(client, originals.add_model(synthetic.file),
                     set_property(synthetic["D1"].GlobalId, "FireRating", "EI 60"))
    assert report["ok"] is False and "artifact" not in report
    assert [item["guid"] for item in report["diff"]["unexpected"]] == [wall]
    [unexpected] = report["diff"]["unexpected"]
    assert unexpected["reason"] == "UNDECLARED" and unexpected["flags"] == ["attributes_changed"]
    assert unexpected["attributes"] == ["Name"]
    assert report_layer(report, 6) == {"layer": 6, "name": "Alcance del cambio", "status": "FAIL", "unexpected": [wall]}
    assert {entry["guid"]: entry["declared"] for entry in report["diff"]["changed"]} == {
        synthetic["D1"].GlobalId: True, wall: False}
    assert [error["code"] for error in report["errors"]] == ["SCOPE_UNEXPECTED"]


def test_flag_not_allowed(client, originals, synthetic, monkeypatch):
    """A declared door whose Name also changes: change_type allows OverallWidth, OverallHeight, ObjectType and
    PredefinedType, not Name, so the door is unexpected with FLAG_NOT_ALLOWED."""
    door = synthetic["D1"].GlobalId

    def rename(model):
        model.by_guid(door).Name = "D1 renombrada"

    patch_apply(monkeypatch, "ifc.change_type", rename)
    report = preview(client, originals.add_model(synthetic.file), change_type(door, synthetic["P90B"].GlobalId))
    assert report["ok"] is False
    [unexpected] = report["diff"]["unexpected"]
    assert (unexpected["guid"], unexpected["reason"], unexpected["attributes"]) == (door, "FLAG_NOT_ALLOWED", ["Name"])


def test_two_operations_on_one_door(client, originals, synthetic):
    """A recipe applies in order: change_type then set_property on the same door. Both declare D1; the
    union of their flags covers what changed, and the door is affected by both operations."""
    door = synthetic["D1"].GlobalId
    report = preview(client, originals.add_model(synthetic.file),
                     change_type(door, synthetic["P90B"].GlobalId),
                     set_property(door, "FireRating", "EI 60", op_id="op-2"))
    assert report["ok"] is True, report["errors"]
    assert report["affected"] == [{"guid": door, "class": "IfcDoor", "name": {"text": "D1"},
                                   "operations": ["op-1", "op-2"]}]
    [changed] = report["diff"]["changed"]
    assert changed["guid"] == door and changed["declared"] is True
    assert {"type_changed"} <= set(changed["flags"])
    assert [o["id"] for o in report["operations"]] == ["op-1", "op-2"]
    assert all(o["ok"] and o["errors"] == [] for o in report["operations"])


def test_geometry_counts_synthetic(client, originals, synthetic):
    """The synthetic model has the Body/MODEL_VIEW subcontext: IfcDiff compares the geometry of every
    element and opening with a representation (the storeys, site and building have none)."""
    report = preview(client, originals.add_model(synthetic.file))
    geometry = report["diff"]["geometry"]
    assert geometry["openings_compared"] == geometry["openings"] == 5
    assert geometry["elements_compared"] == 11  # 5 walls, 5 doors and the slab
    assert geometry["elements"] == 14           # ... plus site, building and storey


def test_changed_attributes_names_the_attribute(synthetic):
    model = synthetic.file
    door = synthetic["D2"]
    copy = ifcopenshell.file.from_string(model.to_string())
    copy.by_guid(door.GlobalId).ObjectType = None
    assert scope.changed_attributes(door, copy.by_guid(door.GlobalId)) == ["ObjectType"]
    assert scope.changed_attributes(door, door) == []


# --- /diff -------------------------------------------------------------------------------------------

def test_diff_between_versions(client, originals, synthetic, tmp_path):
    """/diff of a base and a stored revision of it: the door changed type, nothing declared or unexpected."""
    base = originals.add_model(synthetic.file)
    copy = ifcopenshell.open(str(base.path))
    ifcopenshell.api.type.assign_type(copy, related_objects=[copy.by_guid(synthetic["D1"].GlobalId)],
                                      relating_type=copy.by_guid(synthetic["P90B"].GlobalId))
    folder = base.path.parent
    revision_path = folder / "00000000-0000-4000-8000-0000000000aa"
    copy.write(str(revision_path))
    response = client.post("/diff", json={"project": base.project,
                                          "base": {"version": base.version, "sha256": base.sha256},
                                          "revision": {"version": revision_path.name,
                                                       "sha256": store.sha_of(revision_path)}})
    assert response.status_code == 200, response.text
    diff = response.json()
    assert "unexpected" not in diff
    [changed] = diff["changed"]
    assert changed["guid"] == synthetic["D1"].GlobalId and "type_changed" in changed["flags"]
    assert "declared" not in changed
    same = client.post("/diff", json={"project": base.project,
                                      "base": {"version": base.version, "sha256": base.sha256},
                                      "revision": {"version": base.version, "sha256": base.sha256}})
    assert same.status_code == 200 and same.json()["changed"] == []


@pytest.mark.parametrize("payload, code", [
    ([], "PARAMS_INVALID"),
    ({"project": "x", "base": {}, "revision": {}}, "PARAMS_INVALID"),
    ({"base": {"version": "x"}}, "PARAMS_INVALID"),
    ({"project": "00000000-0000-4000-8000-000000000001", "base": {"version": "00000000-0000-4000-8000-000000000002",
      "sha256": "0" * 64, "extra": 1}, "revision": {}}, "PARAMS_INVALID"),
])
def test_diff_parameters(client, payload, code):
    response = client.post("/diff", json=payload)
    assert response.status_code == 400 and response.json()["code"] == code


def test_diff_missing_version(client, originals, synthetic):
    base = originals.add_model(synthetic.file)
    response = client.post("/diff", json={"project": base.project,
                                          "base": {"version": base.version, "sha256": base.sha256},
                                          "revision": {"version": "00000000-0000-4000-8000-0000000000ab",
                                                       "sha256": base.sha256}})
    assert response.status_code == 404 and response.json()["code"] == "VERSION_NOT_FOUND"


def test_duplex_change_type_scope(client, duplex):
    """CT-4 seen from layer 6: the Duplex door is the only change and only with type_changed (step 0)."""
    report = preview(client, duplex, change_type(DUPLEX_DOOR, DUPLEX_TYPE))
    assert report["ok"] is True
    assert [(entry["guid"], entry["flags"]) for entry in report["diff"]["changed"]] == [(DUPLEX_DOOR, ["type_changed"])]
    assert report["diff"]["unexpected"] == []
