"""Openings: the delete guard, the layer 1 invariants and the own opening control (H1-ESPECIFICACION §5.7,
§5.8, §5.10; H1-3 and H1-4).

- H1-3: ``ifc.remove_element`` on a host with openings answers ``HOST_HAS_OPENINGS`` with its message. If
  an operation deletes the host anyway (``remove_product`` takes its openings and leaves the door floating
  without any ``validate`` error, 06 P8), invariants 1a and 1b catch it.
- H1-4: replacing the representation of opening H1 by a 1.02 m wide one is caught by the own control with
  the reason ``shape``. The synthetic model has the Body/MODEL_VIEW subcontext, so the second IfcDiff pass
  compares the openings' geometry too; what it said is pinned here (``geometry_changed``).
"""
import dataclasses

import ifcopenshell.api.geometry
import ifcopenshell.api.root
import pytest
from fastapi.testclient import TestClient

import engine
from conftest import preview, report_layer
from obracota_engine import store
from obracota_engine.operations import REGISTRY


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def fire_rating(element) -> dict:
    return {"id": "op-1", "op": "ifc.set_property", "element": element, "scope": "occurrence",
            "pset": "Pset_DoorCommon", "property": "FireRating", "value": "EI 60"}


def also(monkeypatch, extra):
    """ifc.set_property also runs ``extra(model)`` after writing the property."""
    original = REGISTRY["ifc.set_property"]

    def apply(model, op):
        applied = original.apply(model, op)
        extra(model)
        return applied

    monkeypatch.setitem(REGISTRY, "ifc.set_property", dataclasses.replace(original, apply=apply))


def test_remove_host_blocked(client, originals, synthetic, no_temporaries):
    """H1-3: the guard refuses a host with openings, with the literal message, and nothing is built."""
    report = preview(client, originals.add_model(synthetic.file),
                     {"id": "op-1", "op": "ifc.remove_element", "element": synthetic["W1"].GlobalId})
    assert report["ok"] is False and "artifact" not in report
    [operation] = report["operations"]
    assert operation["errors"] == [{
        "code": "HOST_HAS_OPENINGS",
        "detail": "W1 tiene 1 huecos con 1 puertas o ventanas. Borrarlo dejaría esas piezas sin anfitrión: "
                  "decide antes qué pasa con ellas."}]
    assert report["diff"] is None
    assert [layer["status"] for layer in report["validation"]["layers"]] == ["FAIL", "NOT_RUN", "NOT_RUN"]


def test_remove_without_openings_not_enabled(client, originals, synthetic):
    report = preview(client, originals.add_model(synthetic.file),
                     {"id": "op-1", "op": "ifc.remove_element", "element": synthetic["slab"].GlobalId})
    assert report["operations"][0]["errors"] == [{"code": "OPERATION_NOT_ENABLED",
                                                  "detail": "Eliminar elementos llega en H5."}]


def test_lost_opening_detected(client, originals, synthetic, monkeypatch, no_temporaries):
    """H1-3: an apply that also calls remove_product(W1) loses opening H1 and leaves D1 floating."""
    wall, opening, door = (synthetic[name].GlobalId for name in ("W1", "H1", "D1"))
    also(monkeypatch, lambda model: ifcopenshell.api.root.remove_product(model, product=model.by_guid(wall)))
    report = preview(client, originals.add_model(synthetic.file), fire_rating(door))
    assert report["ok"] is False and "artifact" not in report
    issues = {(issue["code"], issue["element"]) for issue in report_layer(report, 1)["issues"]}
    assert ("FILLING_CHANGED", door) in issues and ("OPENING_LOST", opening) in issues
    assert [item["guid"] for item in report["diff"]["deleted"]] == [wall]
    assert [item["guid"] for item in report["diff"]["openings"]["deleted"]] == [opening]
    reasons = {(item["guid"], item["reason"]) for item in report["diff"]["unexpected"]}
    assert {(wall, "DELETED"), (opening, "OPENING_DELETED")} <= reasons
    assert {error["code"] for error in report["errors"]} == {"LAYER_1_FAILED", "SCOPE_UNEXPECTED"}


def test_opening_change_detected(client, originals, synthetic, monkeypatch, no_temporaries):
    """H1-4: opening H1 gets a 1.02 m wide representation (P6). The own control reports ``shape``; the
    second IfcDiff pass marks ``geometry_changed`` (the synthetic model has a Body subcontext)."""
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

    also(monkeypatch, widen)
    report = preview(client, originals.add_model(synthetic.file), fire_rating(synthetic["D1"].GlobalId))
    assert report["ok"] is False and "artifact" not in report
    [changed] = report["diff"]["openings"]["changed"]
    assert changed["guid"] == opening and changed["reasons"] == ["shape"] and changed["declared"] is False
    assert changed["ifcdiff"] == ["geometry_changed"]  # what IfcDiff said (§5.11, H1-4)
    assert [(item["guid"], item["reason"]) for item in report["diff"]["unexpected"]] == [(opening, "OPENING_CHANGED")]
    assert report_layer(report, 1)["status"] == "PASS"  # the door still fills H1: only the scope sees it


def test_unfilled_opening(client, originals, synthetic, monkeypatch):
    """The own control also sees an opening that loses its filling while the door stays."""
    door, opening = synthetic["D1"].GlobalId, synthetic["H1"].GlobalId

    def unfill(model):
        for rel in model.by_guid(door).FillsVoids:
            model.remove(rel)

    also(monkeypatch, unfill)
    report = preview(client, originals.add_model(synthetic.file), fire_rating(door))
    assert report["ok"] is False
    assert [item["guid"] for item in report["diff"]["openings"]["unfilled"]] == [opening]
    assert report["diff"]["openings"]["changed"][0]["reasons"][0] == "fillings"
    assert ("FILLING_CHANGED", door) in {(issue["code"], issue["element"]) for issue in report_layer(report, 1)["issues"]}
