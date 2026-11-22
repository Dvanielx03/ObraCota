"""H1-6: what /build sends validates (H1-ESPECIFICACION §5.11; layer 2 of §5.7).

The bytes of /build are reopened and ``ifcopenshell.validate`` (``express_rules=False``) reports 0 problems
in the synthetic model and 0 **new** problems in the Duplex, which has 0 of its own (step 0). Layer 2 of
the report says the same, and a schema problem the revision introduces makes the preview fail.
"""
import dataclasses
import logging
import unicodedata

import ifcopenshell
import ifcopenshell.api.pset
import ifcopenshell.validate
import pytest
from fastapi.testclient import TestClient

import engine
from conftest import DUPLEX_DOOR, DUPLEX_TYPE, build_revision, preview, recipe_of, report_layer
from obracota_engine import build, quantities, store, validation
from obracota_engine.operations import REGISTRY


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def reopened(content: bytes, tmp_path) -> ifcopenshell.file:
    path = tmp_path / "built.ifc"
    path.write_bytes(content)
    return ifcopenshell.open(str(path))


def test_synthetic_build_validates(client, originals, synthetic, tmp_path):
    ref = originals.add_model(synthetic.file)
    for operations in (
            [{"id": "op-1", "op": "ifc.change_type", "element": synthetic["D2"].GlobalId,
              "type_id": synthetic["P90C"].GlobalId}],
            [{"id": "op-1", "op": "ifc.set_property", "element": synthetic["D1"].GlobalId, "scope": "occurrence",
              "pset": "Pset_DoorCommon", "property": "FireRating", "value": "EI 60"}]):
        report = preview(client, ref, *operations)
        assert report["ok"] is True, report["errors"]
        schema = report_layer(report, 2)
        assert (schema["status"], schema["base_issues"], schema["output_issues"]) == ("PASS", 0, 0)
        response = build_revision(client, ref, operations, report["artifact"]["id"])
        assert response.status_code == 200
        assert validation.issues(reopened(response.content, tmp_path)) == []


def test_duplex_build_has_no_new_issues(client, duplex, tmp_path):
    operations = [{"id": "op-1", "op": "ifc.change_type", "element": DUPLEX_DOOR, "type_id": DUPLEX_TYPE}]
    report = preview(client, duplex, *operations)
    assert report["ok"] is True
    schema = report_layer(report, 2)
    assert (schema["status"], schema["base_issues"], schema["new_issues"]) == ("PASS", 0, [])
    response = build_revision(client, duplex, operations, report["artifact"]["id"])
    assert response.status_code == 200
    base = ifcopenshell.open(str(duplex.path))
    built = validation.issues(reopened(response.content, tmp_path))
    assert [issue for issue in built if issue not in validation.issues(base)] == []


def test_new_schema_issue_fails(client, originals, synthetic, monkeypatch):
    """An apply that also writes an IfcPropertySingleValue without its required Name adds a schema problem
    the base does not have: layer 2 fails and ok=false."""
    original = REGISTRY["ifc.set_property"]

    def apply(model, op):
        applied = original.apply(model, op)
        model.createIfcPropertySingleValue(None, None, model.createIfcLabel("sin nombre"), None)
        return applied

    monkeypatch.setitem(REGISTRY, "ifc.set_property", dataclasses.replace(original, apply=apply))
    report = preview(client, originals.add_model(synthetic.file),
                     {"id": "op-1", "op": "ifc.set_property", "element": synthetic["D1"].GlobalId,
                      "scope": "occurrence", "pset": "Pset_DoorCommon", "property": "FireRating", "value": "EI 60"})
    assert report["ok"] is False
    schema = report_layer(report, 2)
    assert schema["status"] == "FAIL" and schema["base_issues"] == 0 and len(schema["new_issues"]) >= 1
    assert "SCHEMA_NEW_ISSUES" in {error["code"] for error in report["errors"]}


# --- Untrusted text and failures inside the preview ----------------------------------------------------

def set_fire_rating(synthetic) -> dict:
    return {"id": "op-1", "op": "ifc.set_property", "element": synthetic["D1"].GlobalId, "scope": "occurrence",
            "pset": "Pset_DoorCommon", "property": "FireRating", "value": "EI 60"}


def plain(text: str) -> bool:
    return not any(unicodedata.category(ch) == "Cc" for ch in text)


def test_validate_messages_bounded(monkeypatch):
    """A validate message quotes the file: 512 characters at most and no control characters (§5.2)."""
    class Logger:
        statements = [{"level": "Error", "message": "valor\x07" * 1500, "instance": None, "attribute": "Name\n"}]

    monkeypatch.setattr(ifcopenshell.validate, "json_logger", lambda: Logger())
    monkeypatch.setattr(ifcopenshell.validate, "validate", lambda *args, **kwargs: None)
    [found] = validation.issues(None)
    assert len(found["message"]) <= 512 and plain(found["message"]) and found["message"].startswith("valor valor")
    assert found["attribute"] == "Name "


def test_qto_names_bounded(synthetic):
    """The names of a Qto set and quantity come from the file: QTO_MISMATCH and basis quote them bounded."""
    slab, name = synthetic["slab"], "Qto_Losa\n" + "X" * 800
    qto = ifcopenshell.api.pset.add_qto(synthetic.file, product=slab, name=name)
    ifcopenshell.api.pset.edit_qto(synthetic.file, qto=qto, properties={"NetArea": 1.0})
    findings = []
    line = quantities.measure(synthetic.file, slab, "before", findings)
    assert line["source"] == "QTO" and len(line["basis"]) <= 512 and plain(line["basis"])
    assert line["basis"].endswith("exportado en el IFC")
    [mismatch] = findings
    assert mismatch["rule"] == "QTO_MISMATCH" and len(mismatch["explanation"]) <= 512 and plain(mismatch["explanation"])
    assert mismatch["explanation"].startswith("Qto_Losa XXX") and mismatch["explanation"].endswith(").")
    assert "difiere más de un 2 % del valor calculado de la geometría" in mismatch["explanation"]


def test_library_failure_is_model_unreadable(client, originals, synthetic, monkeypatch, caplog, no_temporaries):
    """IfcOpenShell failing on the model (here validate) is 422 MODEL_UNREADABLE with the step that failed,
    logged with its traceback."""
    def broken(*args, **kwargs):
        raise RuntimeError("validate broke")

    monkeypatch.setattr(ifcopenshell.validate, "validate", broken)
    validation.clear()
    ref = originals.add_model(synthetic.file)
    with caplog.at_level(logging.ERROR, logger="obracota_engine.errors"):
        response = client.post("/preview", json={**ref.params(), "recipe": recipe_of(set_fire_rating(synthetic))})
    assert (response.status_code, response.json()) == (422, {"detail": build.VALIDATE_FAILED, "code": "MODEL_UNREADABLE"})
    assert any(record.exc_info for record in caplog.records)
    validation.clear()


def test_engine_failure_is_a_500(originals, synthetic, monkeypatch, no_temporaries):
    """A fault of the engine's own logic (here a KeyError in the quantities) does not blame the file: it is a
    500 without JSON, which the backend reads as a contract error (502)."""
    def broken(*args, **kwargs):
        raise KeyError("bug")

    monkeypatch.setattr(quantities, "lines", broken)
    ref = originals.add_model(synthetic.file)
    raw = TestClient(engine.app, raise_server_exceptions=False)
    response = raw.post("/preview", json={**ref.params(), "recipe": recipe_of(set_fire_rating(synthetic))})
    assert response.status_code == 500
    assert "MODEL_UNREADABLE" not in response.text
    assert not response.headers["content-type"].startswith("application/json")
