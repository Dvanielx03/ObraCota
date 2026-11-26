"""H1-11: the size limit for verification (H1-ESPECIFICACION §5.9, §5.11), by kind of recipe.

ReStage (about 190 MB, ``TEST_IFC``; any export above the limit, see conftest) is above ``ENGINE_PREVIEW_MAX_BYTES``
(32 MiB, step 0). A recipe that may change geometry (``ifc.change_type``) is refused there with 422
``MODEL_TOO_LARGE`` before the file is opened, with and without ``checks_only``, and so is /build; the reason says
what still works on that model. /diff compares geometry too and keeps the H1 wording. /summary marks
``ifc.change_type`` as not available with that reason.

A recipe that changes no geometry (``ifc.set_property``, ``ifc.set_material``) is verified entity by entity, so its
limit is ``ENGINE_DATA_PREVIEW_MAX_BYTES`` (256 MiB, the upload limit): on ReStage it reaches the checks, and
/summary offers ``ifc.set_property``. A DWG revision keeps ``ENGINE_PREVIEW_MAX_BYTES`` and its wording.

The same limits are exercised on the synthetic model with lowered settings, so the rules are covered without the
fixture too.
"""
import pytest
from fastapi.testclient import TestClient

import engine
from conftest import build_revision, geometry_limit_reason, recipe_of, too_large_reason
from obracota_engine import settings, store

PROPERTY = {"id": "op-1", "op": "ifc.set_property", "element": "0" * 22, "scope": "occurrence",
            "pset": "Pset_DoorCommon", "property": "FireRating", "value": "EI 60"}
CHANGE_TYPE = {"id": "op-1", "op": "ifc.change_type", "element": "0" * 22, "type_id": "1" * 22}
GEOMETRY_PREFIX = "El modelo pesa "
H1_PREFIX = "El modelo supera el tamaño que H1 puede verificar ("


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def refused(response, detail=None, prefix=H1_PREFIX):
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "MODEL_TOO_LARGE"
    assert body["detail"] == detail if detail else body["detail"].startswith(prefix), body["detail"]


def recipe_routes(client, ref, operation):
    for checks_only in (True, False):
        yield client.post("/preview", json={**ref.params(), "checks_only": checks_only, "recipe": recipe_of(operation)})
    yield build_revision(client, ref, [operation])


def diff(client, ref):
    return client.post("/diff", json={"project": ref.project, "base": {"version": ref.version, "sha256": ref.sha256},
                                      "revision": {"version": ref.version, "sha256": ref.sha256}})


def test_restage_above_the_geometry_limit(client, originals, restage_path, model_cache, no_temporaries):
    ref = originals.link(restage_path)
    for response in recipe_routes(client, ref, CHANGE_TYPE):
        refused(response, geometry_limit_reason(restage_path))
    refused(diff(client, ref), too_large_reason(restage_path))
    assert model_cache.opens == 0  # refused before opening
    summary = client.get("/summary", params=ref.params())
    assert summary.status_code == 200
    assert summary.json()["operations"] == {
        "ifc.change_type": {"available": False, "reason": geometry_limit_reason(restage_path)},
        "ifc.set_property": {"available": True}}


def test_restage_takes_a_property_recipe(client, originals, restage_path, model_cache):
    """Under ENGINE_DATA_PREVIEW_MAX_BYTES a property recipe reaches the checks of its operation."""
    ref = originals.link(restage_path)
    response = client.post("/preview", json={**ref.params(), "checks_only": True, "recipe": recipe_of(PROPERTY)})
    assert response.status_code == 200, response.text
    assert response.json()["operations"][0]["errors"][0]["code"] == "ELEMENT_NOT_FOUND"
    assert model_cache.opens == 1


def test_limits_on_the_synthetic_model(client, originals, synthetic, model_cache, monkeypatch, no_temporaries):
    ref = originals.add_model(synthetic.file)
    monkeypatch.setattr(settings, "ENGINE_PREVIEW_MAX_BYTES", 1000)
    for response in recipe_routes(client, ref, CHANGE_TYPE):
        refused(response, prefix=GEOMETRY_PREFIX)
    refused(diff(client, ref))
    assert model_cache.opens == 0
    reading = client.get("/summary", params=ref.params())
    assert reading.status_code == 200
    assert reading.json()["operations"]["ifc.change_type"]["available"] is False
    assert reading.json()["operations"]["ifc.set_property"] == {"available": True}

    door = {**PROPERTY, "element": synthetic["D1"].GlobalId}
    response = client.post("/preview", json={**ref.params(), "recipe": recipe_of(door)})
    assert response.status_code == 200 and response.json()["ok"] is True, response.text
    material = {"id": "op-1", "op": "ifc.set_material", "element": synthetic["W1"].GlobalId,
                "elements": [synthetic["W1"].GlobalId], "material": "Piedra · claro", "category": "stone",
                "color": "#d8d2c4"}
    response = client.post("/preview", json={**ref.params(), "checks_only": True, "recipe": recipe_of(material)})
    assert response.status_code == 200 and response.json()["ok"] is True, response.text

    monkeypatch.setattr(settings, "ENGINE_DATA_PREVIEW_MAX_BYTES", 1000)
    opened = model_cache.opens
    for response in recipe_routes(client, ref, door):
        refused(response)
    assert model_cache.opens == opened
    assert client.get("/summary", params=ref.params()).json()["operations"]["ifc.set_property"]["available"] is False


def test_drawing_keeps_its_limit(client, originals, monkeypatch):
    """A DWG or DXF original keeps ENGINE_PREVIEW_MAX_BYTES and the H1 wording, even with an empty recipe."""
    ref = originals.write(b"0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n" + b"999\n" + b"x" * 2000 + b"\n")
    monkeypatch.setattr(settings, "ENGINE_PREVIEW_MAX_BYTES", 1000)
    refused(client.post("/preview", json={**ref.params(), "recipe": recipe_of()}))
