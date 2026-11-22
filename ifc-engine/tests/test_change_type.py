"""ifc.change_type: door of equal measure (H1-ESPECIFICACION §5.5; CT-1 to CT-4).

Step 3 covers the ``check`` of every operation through ``/preview`` with ``checks_only=true``, plus
``apply``, ``declare`` and ``verify`` called directly on a fresh copy written and reopened from disk.
Step 4 adds the full preview of CT-1 to CT-4: the diff, layers 1, 2 and 6, the quantities and the artifact.
"""
import unicodedata

import ifcopenshell
import ifcopenshell.api.type
import pytest
from fastapi.testclient import TestClient

import engine
from conftest import DUPLEX_DOOR, DUPLEX_TYPE, preview, report_layer, synthetic_model
from obracota_engine import recipe, store
from obracota_engine.operations import REGISTRY, change_type


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def op(element, type_id, op_id="op-1") -> dict:
    return {"id": op_id, "op": "ifc.change_type", "element": element, "type_id": type_id}


def checks(client, ref, *operations) -> dict:
    response = client.post("/preview", json={**ref.params(), "checks_only": True,
                                             "recipe": {"format": recipe.FORMAT, "operations": list(operations)}})
    assert response.status_code == 200, response.text
    return response.json()


def only_error(result: dict) -> dict:
    assert result["ok"] is False
    [operation] = result["operations"]
    assert operation["ok"] is False
    [error] = operation["errors"]
    return error


def parsed(raw: dict):
    return recipe.parse_operation(raw, 1)


def test_equal_measure_check_ok(client, originals, synthetic):
    """CT-1 (check): D1 from P90 to P90B, the same measure and it fits H1."""
    ref = originals.add_model(synthetic.file)
    result = checks(client, ref, op(synthetic["D1"].GlobalId, synthetic["P90B"].GlobalId))
    assert result == {"ok": True, "operations": [{"id": "op-1", "op": "ifc.change_type", "ok": True,
                                                  "element": synthetic["D1"].GlobalId, "errors": []}]}


def test_ifc4_predefined_type_check_ok(client, originals, synthetic):
    """CT-2 (check): D2 to P90C (PredefinedType=DOOR) passes the checks; the warning comes from apply."""
    ref = originals.add_model(synthetic.file)
    assert checks(client, ref, op(synthetic["D2"].GlobalId, synthetic["P90C"].GlobalId))["ok"] is True


def test_incompatible_rejected(client, originals, synthetic):
    """CT-3 (check): P100 is 1.0 m wide, the door 0.9 m: TYPE_NOT_COMPATIBLE, ok=false."""
    ref = originals.add_model(synthetic.file)
    error = only_error(checks(client, ref, op(synthetic["D1"].GlobalId, synthetic["P100"].GlobalId)))
    assert error == {"code": "TYPE_NOT_COMPATIBLE",
                     "detail": "El tipo P100 no tiene la medida de la puerta o no cabe en su hueco."}


@pytest.mark.parametrize("target", ["P90", "slab", "W1"])
def test_type_not_available(client, originals, synthetic, target):
    """Its own type, or a GlobalId that is not a door type, is not among the options of inspect()."""
    ref = originals.add_model(synthetic.file)
    error = only_error(checks(client, ref, op(synthetic["D1"].GlobalId, synthetic[target].GlobalId)))
    assert error["code"] == "TYPE_NOT_AVAILABLE"


def test_not_a_door_and_missing(client, originals, synthetic):
    ref = originals.add_model(synthetic.file)
    result = checks(client, ref, op(synthetic["W1"].GlobalId, synthetic["P90B"].GlobalId),
                    op("0" * 22, synthetic["P90B"].GlobalId, "op-2"))
    assert [o["errors"] for o in result["operations"]] == [
        [{"code": "NOT_A_DOOR", "detail": "La edición se habilita para puertas IFC."}],
        [{"code": "ELEMENT_NOT_FOUND", "detail": "La pieza no aparece en el IFC."}]]


def test_no_type(client, originals):
    synthetic = synthetic_model()
    ifcopenshell.api.type.unassign_type(synthetic.file, related_objects=[synthetic["D1"]])
    ref = originals.add_model(synthetic.file)
    error = only_error(checks(client, ref, op(synthetic["D1"].GlobalId, synthetic["P90B"].GlobalId)))
    assert error == {"code": "NO_TYPE", "detail": "La puerta no tiene tipo."}


def test_unit_undefined(client, originals):
    synthetic = synthetic_model()
    units = synthetic["project"].UnitsInContext
    units.Units = tuple(unit for unit in units.Units if getattr(unit, "UnitType", None) != "LENGTHUNIT")
    ref = originals.add_model(synthetic.file)
    error = only_error(checks(client, ref, op(synthetic["D1"].GlobalId, synthetic["P90B"].GlobalId)))
    assert error == {"code": "UNIT_UNDEFINED", "detail": "El IFC necesita una unidad de longitud definida."}


def test_no_placement(client, originals):
    """Without a placement inspect() cannot measure the opening; the check names the real cause."""
    synthetic = synthetic_model()
    synthetic["D1"].ObjectPlacement = None
    ref = originals.add_model(synthetic.file)
    error = only_error(checks(client, ref, op(synthetic["D1"].GlobalId, synthetic["P90B"].GlobalId)))
    assert error == {"code": "NO_PLACEMENT", "detail": "Falta la colocación de la puerta."}


def test_checks_write_nothing(client, originals, synthetic, model_cache):
    """checks_only writes nothing: neither the original nor the cached model change."""
    ref = originals.add_model(synthetic.file)
    first = checks(client, ref, op(synthetic["D2"].GlobalId, synthetic["P90C"].GlobalId))
    model = model_cache.get(ref.project, ref.version, ref.sha256).model
    entities = len(list(model))
    door = model.by_guid(synthetic["D2"].GlobalId)
    assert checks(client, ref, op(synthetic["D2"].GlobalId, synthetic["P90C"].GlobalId)) == first
    assert store.sha_of(ref.path) == ref.sha256
    assert len(list(model)) == entities
    assert ifcopenshell.util.element.get_type(door).Name == "P90"
    assert door.ObjectType == "Puerta cortafuego"


def reopened(model: ifcopenshell.file, tmp_path) -> ifcopenshell.file:
    path = tmp_path / "revision.ifc"
    model.write(str(path))
    return ifcopenshell.open(str(path))


def copies(tmp_path, count=2):
    """The synthetic model and ``count`` copies opened from one file: same GlobalIds, independent models
    (a base to compare with and a fresh one to write on, as the preview does)."""
    source = synthetic_model()
    path = tmp_path / "base.ifc"
    source.file.write(str(path))
    return source, [ifcopenshell.open(str(path)) for _ in range(count)]


def test_apply_declare_verify_equal_measure(tmp_path):
    """CT-1 (operation): apply on a fresh copy, write, reopen and verify; the door keeps its opening."""
    base, (base_file, work) = copies(tmp_path)
    operation = parsed(op(base["D1"].GlobalId, base["P90B"].GlobalId))
    entry = REGISTRY["ifc.change_type"]
    assert entry.declare(base_file, operation) == {base["D1"].GlobalId: change_type.DECLARED}
    applied = entry.apply(work, operation)
    assert applied.findings == []
    assert applied.before["typeName"] == "P90" and applied.before["opening"] == base["H1"].GlobalId
    assert applied.after == {"typeId": base["P90B"].GlobalId, "typeName": "P90B", "width": 0.9, "height": 2.1}
    assert entry.verify(base_file, reopened(work, tmp_path), operation) == []


def test_ifc4_assign_type_clears_and_warns(tmp_path):
    """CT-2 (operation, #7006): assign_type to a type with PredefinedType=DOOR rewrites D2's attributes;
    apply warns with the previous values."""
    base, (base_file, work) = copies(tmp_path)
    operation = parsed(op(base["D2"].GlobalId, base["P90C"].GlobalId))
    applied = change_type.apply(work, operation)
    [warning] = applied.findings
    assert warning["rule"] == "ASSIGN_TYPE_CLEARED_ATTRIBUTES" and warning["status"] == "WARNING"
    assert warning["element"] == base["D2"].GlobalId
    assert "«Puerta cortafuego»" in warning["explanation"] and "«USERDEFINED»" in warning["explanation"]
    assert warning["source"] == "ifcopenshell.api.type.assign_type · incidencia #7006"
    assert change_type.verify(base_file, reopened(work, tmp_path), operation) == []


def test_verify_catches_a_wrong_revision(tmp_path):
    """verify fails when the reopened file does not hold what apply should have written."""
    base, (base_file, untouched, moved) = copies(tmp_path, 3)
    operation = parsed(op(base["D1"].GlobalId, base["P90B"].GlobalId))
    codes = {found["code"] for found in change_type.verify(base_file, reopened(untouched, tmp_path), operation)}
    assert codes == {"TYPE_NOT_ASSIGNED"}
    change_type.apply(moved, operation)
    door = moved.by_guid(base["D1"].GlobalId)
    door.ObjectPlacement.RelativePlacement.Location = moved.createIfcCartesianPoint((0.5, 0.0, 0.0))
    assert "PLACEMENT_CHANGED" in {found["code"] for found in
                                   change_type.verify(base_file, reopened(moved, tmp_path), operation)}


def test_duplex_door(client, originals, duplex, duplex_path, tmp_path):
    """CT-4 (check and operation): the Duplex door to the type that Playwright expects, 0.762 x 2.032 m."""
    assert checks(client, duplex, op(DUPLEX_DOOR, DUPLEX_TYPE))["ok"] is True
    base = ifcopenshell.open(str(duplex_path))
    work = ifcopenshell.open(str(duplex_path))
    operation = parsed(op(DUPLEX_DOOR, DUPLEX_TYPE))
    applied = change_type.apply(work, operation)
    assert applied.after["width"] == 0.762 and applied.after["height"] == 2.032
    assert applied.findings == []  # #7006 does not reproduce in the Duplex (H0 §1)
    assert change_type.verify(base, reopened(work, tmp_path), operation) == []
    assert store.sha_of(duplex.path) == duplex.sha256


# --- Full preview (step 4) ---------------------------------------------------------------------------

def passed(report: dict) -> None:
    assert report["ok"] is True, report["errors"]
    assert [layer["status"] for layer in report["validation"]["layers"]] == ["PASS", "PASS", "PASS"]
    assert report["errors"] == [] and report["diff"]["unexpected"] == []


def test_equal_measure_ok(client, originals, synthetic, no_temporaries):
    """CT-1: D1 from P90 to P90B is ok. The diff only has D1; its opening, host and placement stay."""
    door = synthetic["D1"].GlobalId
    report = preview(client, originals.add_model(synthetic.file), op(door, synthetic["P90B"].GlobalId))
    passed(report)
    assert [(entry["guid"], entry["flags"], entry["declared"]) for entry in report["diff"]["changed"]] == [
        (door, ["type_changed"], True)]
    assert report["diff"]["added"] == report["diff"]["deleted"] == []
    assert report["diff"]["openings"] == {"changed": [], "added": [], "deleted": [], "unfilled": []}
    assert report_layer(report, 1)["issues"] == []  # verify: same opening, host and placement
    [operation] = report["operations"]
    assert operation["before"]["opening"] == synthetic["H1"].GlobalId
    assert operation["before"]["host"] == synthetic["W1"].GlobalId
    assert operation["after"] == {"typeId": synthetic["P90B"].GlobalId, "typeName": "P90B", "width": 0.9, "height": 2.1}
    assert operation["declared"] == [{"guid": door, "allow": change_type.DECLARED}]
    assert [(line["phase"], line["quantity"], line["unit"], line["source"]) for line in report["quantities"]] == [
        ("before", 1, "UNIT", "UNIT"), ("after", 1, "UNIT", "UNIT")]
    assert report["artifact"]["sha256"] and report["engine"]["version"] == "h1.0"


def test_ifc4_assign_type_clears_and_warns_preview(client, originals, synthetic):
    """CT-2: D2 (P90, in H2) to P90C is ok. attributes_changed on ObjectType and PredefinedType is declared,
    and the warning carries «Puerta cortafuego» as the previous value."""
    door = synthetic["D2"].GlobalId
    report = preview(client, originals.add_model(synthetic.file), op(door, synthetic["P90C"].GlobalId))
    passed(report)
    [changed] = report["diff"]["changed"]
    assert changed["guid"] == door and changed["declared"] is True
    assert "attributes_changed" in changed["flags"]
    assert changed["attributes"] == ["ObjectType", "PredefinedType"]
    [warning] = report["findings"]
    assert warning["rule"] == "ASSIGN_TYPE_CLEARED_ATTRIBUTES" and "«Puerta cortafuego»" in warning["explanation"]


def test_incompatible_rejected_preview(client, originals, synthetic, artifact_store, no_temporaries):
    """CT-3: P100 gives TYPE_NOT_COMPATIBLE, ok=false and no artifact."""
    report = preview(client, originals.add_model(synthetic.file),
                     op(synthetic["D1"].GlobalId, synthetic["P100"].GlobalId))
    assert report["ok"] is False and "artifact" not in report
    assert report["operations"][0]["errors"][0]["code"] == "TYPE_NOT_COMPATIBLE"
    assert [error["code"] for error in report["errors"]] == ["OPERATIONS_REJECTED"]
    assert list(artifact_store.iterdir()) == []


def test_duplex_door_preview(client, duplex, no_temporaries):
    """CT-4: the Duplex door to 2klOFZffH6WQFlV10uM1wF is ok at 0.762 x 2.032 m, as Playwright expects."""
    report = preview(client, duplex, op(DUPLEX_DOOR, DUPLEX_TYPE))
    passed(report)
    [operation] = report["operations"]
    assert (operation["after"]["width"], operation["after"]["height"]) == (0.762, 2.032)
    assert operation["before"]["typeId"] != DUPLEX_TYPE and operation["findings"] == []
    assert [entry["guid"] for entry in report["diff"]["changed"]] == [DUPLEX_DOOR]
    assert report_layer(report, 2)["new_issues"] == []
    assert report["base"]["schema"] == "IFC2X3"
    assert store.sha_of(duplex.path) == duplex.sha256

# --- Untrusted text in the report (§5.2) ---------------------------------------------------------------

def plain(text: str) -> bool:
    """No control character and no bidirectional override."""
    return not any(unicodedata.category(ch) == "Cc" or "\u202a" <= ch <= "\u202e" or "\u2066" <= ch <= "\u2069"
                   for ch in text)


def test_ifc_names_bounded_in_messages():
    """A type Name of 1000 characters with a line break, and an ObjectType with control characters, reach
    the detail and the explanation bounded: at most 512 characters, no control characters, and the sentence
    keeps its end."""
    base = synthetic_model()
    base["P100"].Name = "P100\n" + "x" * 1000
    base["P90C"].Name = "P90C\u202e" + "y" * 1000
    base["D2"].ObjectType = "Puerta\x07" + "z" * 1000
    with pytest.raises(change_type.Rejected) as rejected:
        change_type.check(base.file, parsed(op(base["D1"].GlobalId, base["P100"].GlobalId)))
    detail = rejected.value.detail
    assert rejected.value.code == "TYPE_NOT_COMPATIBLE" and len(detail) <= 512 and plain(detail)
    assert detail.startswith("El tipo P100 xxx") and detail.endswith("no tiene la medida de la puerta o no cabe en su hueco.")

    applied = change_type.apply(base.file, parsed(op(base["D2"].GlobalId, base["P90C"].GlobalId)))
    [warning] = applied.findings
    explanation = warning["explanation"]
    assert len(explanation) <= 512 and plain(explanation)
    assert explanation.startswith("Al asignar el tipo P90C") and "ObjectType era «Puerta zzz" in explanation
    assert explanation.endswith("Revisa si la puerta debe conservarlos.")
    assert len(applied.after["typeName"]) <= 512 and plain(applied.after["typeName"])
    assert all(len(option["name"]) <= 512 and plain(option["name"]) for option in applied.before["options"])
