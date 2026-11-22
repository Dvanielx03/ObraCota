"""H1-11: the size limit for verification (H1-ESPECIFICACION §5.9, §5.11).

ReStage (about 190 MB, ``TEST_IFC``) is above ``ENGINE_PREVIEW_MAX_BYTES`` (32 MiB, step 0): /summary marks
``ifc.change_type`` and ``ifc.set_property`` as not available with the size reason, and /preview answers
422 ``MODEL_TOO_LARGE`` without opening the file, with and without ``checks_only``. /build and /diff refuse
it the same way, because they generate the same geometry. Reading it still works.

The same limit is exercised on the synthetic model with a lowered ``ENGINE_PREVIEW_MAX_BYTES``, so the
rule is covered without the fixture too.
"""
import pytest
from fastapi.testclient import TestClient

import engine
from conftest import build_revision, recipe_of
from obracota_engine import settings, store

REASON = "El modelo supera el tamaño que H1 puede verificar (190 MB)."
RECIPE = recipe_of({"id": "op-1", "op": "ifc.set_property", "element": "0" * 22, "scope": "occurrence",
                    "pset": "Pset_DoorCommon", "property": "FireRating", "value": "EI 60"})


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def refused(response, detail=None):
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "MODEL_TOO_LARGE"
    assert body["detail"] == detail if detail else body["detail"].startswith(
        "El modelo supera el tamaño que H1 puede verificar (")


def every_route(client, ref):
    for checks_only in (True, False):
        yield client.post("/preview", json={**ref.params(), "checks_only": checks_only, "recipe": RECIPE})
    yield build_revision(client, ref, RECIPE["operations"])
    yield client.post("/diff", json={"project": ref.project, "base": {"version": ref.version, "sha256": ref.sha256},
                                     "revision": {"version": ref.version, "sha256": ref.sha256}})


def test_restage_above_the_limit(client, originals, restage_path, model_cache, no_temporaries):
    ref = originals.link(restage_path)
    for response in every_route(client, ref):
        refused(response, REASON)
    assert model_cache.opens == 0  # refused before opening
    summary = client.get("/summary", params=ref.params())
    assert summary.status_code == 200
    assert summary.json()["operations"] == {"ifc.change_type": {"available": False, "reason": REASON},
                                            "ifc.set_property": {"available": False, "reason": REASON}}


def test_limit_on_the_synthetic_model(client, originals, synthetic, model_cache, monkeypatch, no_temporaries):
    ref = originals.add_model(synthetic.file)
    monkeypatch.setattr(settings, "ENGINE_PREVIEW_MAX_BYTES", 1000)
    for response in every_route(client, ref):
        refused(response)
    assert model_cache.opens == 0
    reading = client.get("/summary", params=ref.params())
    assert reading.status_code == 200 and reading.json()["operations"]["ifc.set_property"]["available"] is False
