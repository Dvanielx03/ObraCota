"""H1-7a: the reading endpoints go through the cache of open models by SHA-256 (§5.9).

Through HTTP, with ``TestClient(engine.app)``: the second reading of the same SHA-256 does not open the file
again, whichever endpoint asks and even under another project and version with the same bytes. A SHA-256
that does not match the bytes is a 409 ``SHA_MISMATCH`` and opens nothing. Each test gets its own
``ModelCache`` with a counting opener, so the counters only see that test.
"""
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

import engine
from conftest import VersionRef, synthetic_model
from obracota_engine import reading, settings, store

READ_ROUTES = ["/summary", "/elements", "/element"]
WRONG_SHA = "0" * 64


class CountingOpener:
    """Opens like the engine does (``store._open_ifc``, with its 422) and records every path it opened."""

    def __init__(self, delay_s: float = 0.0):
        self.paths = []
        self.delay_s = delay_s
        self._guard = threading.Lock()

    def __call__(self, path):
        with self._guard:
            self.paths.append(path)
        if self.delay_s:
            time.sleep(self.delay_s)
        return store._open_ifc(path)


@pytest.fixture
def opener(monkeypatch) -> CountingOpener:
    counting = CountingOpener()
    monkeypatch.setattr(store, "models", store.ModelCache(opener=counting))
    return counting


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


@pytest.fixture
def version(originals, synthetic) -> tuple:
    return synthetic, originals.add_model(synthetic.file)


def read(client, route, ref: VersionRef, sha256=None, guid=None):
    params = {"project": ref.project, "version": ref.version, "sha256": sha256 or ref.sha256}
    if route == "/element":
        params["guid"] = guid
    return client.get(route, params=params)


def test_second_reading_of_the_same_sha_does_not_reopen(client, version, opener):
    s, ref = version

    first = read(client, "/summary", ref)
    second = read(client, "/summary", ref)
    listed = read(client, "/elements", ref)
    described = read(client, "/element", ref, guid=s["D1"].GlobalId)

    assert [r.status_code for r in (first, second, listed, described)] == [200, 200, 200, 200]
    assert first.json()["cache"]["hit"] is False and first.json()["cache"]["open_ms"] >= 0
    assert second.json()["cache"] == {"hit": True, "open_ms": 0}
    assert opener.paths == [ref.path], "one opening for four readings of the same SHA-256"
    assert store.models.opens == 1


def test_same_bytes_under_another_version_share_the_open_model(client, originals, version, opener):
    _, ref = version
    same_bytes = originals.link(ref.path)
    assert (same_bytes.project, same_bytes.version) != (ref.project, ref.version)
    assert same_bytes.sha256 == ref.sha256

    read(client, "/summary", ref)
    response = read(client, "/summary", same_bytes)

    assert response.status_code == 200
    assert response.json()["cache"]["hit"] is True
    assert store.models.opens == 1


@pytest.mark.parametrize("route", READ_ROUTES)
def test_a_different_sha_is_409_and_opens_nothing(client, version, opener, route):
    s, ref = version

    response = read(client, route, ref, sha256=WRONG_SHA, guid=s["D1"].GlobalId)

    assert response.status_code == 409
    assert response.json() == {"detail": "El archivo de la versión no coincide con su SHA-256.", "code": "SHA_MISMATCH"}
    assert opener.paths == []


def test_a_different_sha_is_409_also_once_the_model_is_cached(client, version, opener):
    s, ref = version
    assert read(client, "/summary", ref).status_code == 200

    for route in READ_ROUTES:
        response = read(client, route, ref, sha256=WRONG_SHA, guid=s["D1"].GlobalId)
        assert (response.status_code, response.json()["code"]) == (409, "SHA_MISMATCH")
    assert store.models.opens == 1


def test_changed_bytes_are_caught_although_the_old_model_is_cached(client, version, opener):
    """Every request checks the file against its SHA-256 (a stat once hashed), so a cached model never
    answers for bytes that are no longer on disk."""
    _, ref = version
    assert read(client, "/summary", ref).status_code == 200

    other = synthetic_model()
    other["W1"].Name = "Muro cambiado"
    other.file.write(str(ref.path))
    stat = os.stat(ref.path)
    os.utime(ref.path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    new_sha = store.sha_of(ref.path)
    assert new_sha != ref.sha256

    stale = read(client, "/summary", ref)
    fresh = read(client, "/summary", ref, sha256=new_sha)

    assert (stale.status_code, stale.json()["code"]) == (409, "SHA_MISMATCH")
    assert fresh.status_code == 200 and fresh.json()["cache"]["hit"] is False
    assert opener.paths == [ref.path, ref.path]


@pytest.mark.parametrize("route", READ_ROUTES)
def test_a_missing_version_is_404_and_opens_nothing(client, version, opener, route):
    s, ref = version
    missing = VersionRef(ref.project, str(uuid.uuid4()), ref.sha256, ref.path)

    response = read(client, route, missing, guid=s["D1"].GlobalId)

    assert response.status_code == 404
    assert response.json() == {"detail": "Versión IFC no disponible.", "code": "VERSION_NOT_FOUND"}
    assert opener.paths == []


def test_an_unreadable_original_is_422_and_is_not_cached(client, originals, opener):
    project, version = str(uuid.uuid4()), str(uuid.uuid4())
    path = originals.root / project / version
    path.parent.mkdir()
    path.write_bytes(b"esto no es un IFC")
    garbage = VersionRef(project, version, store.sha_of(path), path)

    first = read(client, "/summary", garbage)
    second = read(client, "/summary", garbage)

    for response in (first, second):
        assert response.status_code == 422
        assert response.json() == {"detail": "El archivo de la versión no se pudo leer como IFC.",
                                   "code": "MODEL_UNREADABLE"}
    assert len(opener.paths) == 2 and len(store.models) == 0


def test_the_cache_keeps_ENGINE_CACHE_MODELS_models(client, originals, opener, monkeypatch):
    monkeypatch.setattr(settings, "ENGINE_CACHE_MODELS", 1)
    a, b = (originals.add_model(synthetic_model().file) for _ in range(2))

    hits = [read(client, "/summary", ref).json()["cache"]["hit"] for ref in (a, a, b, a)]

    assert hits == [False, True, False, False], "b evicts a with one slot"
    assert store.models.opens == 3


def test_concurrent_first_readings_open_the_file_once(version, monkeypatch):
    """Four readers arrive while the file is still opening: one opens it, the others wait for that opening."""
    _, ref = version
    slow = CountingOpener(delay_s=0.3)
    monkeypatch.setattr(store, "models", store.ModelCache(opener=slow))
    target = reading.version_ref(ref.project, ref.version, ref.sha256)

    with ThreadPoolExecutor(max_workers=4) as pool:
        answers = list(pool.map(lambda _: reading.summary(target), range(4)))

    assert slow.paths == [ref.path]
    assert sorted(answer["cache"]["hit"] for answer in answers) == [False, True, True, True]


def test_reading_during_a_preview_of_the_same_model(client, version, opener, monkeypatch, artifact_store):
    """A full preview holds its base's lock for the whole build. A reading of that model waits at most
    ENGINE_BUSY_WAIT_S and then answers 503 ENGINE_BUSY; it never waits for the preview to end (R3).
    Once the preview finishes, the same reading answers 200."""
    from obracota_engine import validation

    s, ref = version
    monkeypatch.setattr(settings, "ENGINE_BUSY_WAIT_S", 0.2)
    inside, release = threading.Event(), threading.Event()
    layer = validation.layer

    def slow_layer(*args, **kwargs):
        inside.set()
        assert release.wait(10)
        return layer(*args, **kwargs)

    monkeypatch.setattr(validation, "layer", slow_layer)
    operation = {"id": "op-1", "op": "ifc.set_property", "element": s["D1"].GlobalId, "scope": "occurrence",
                 "pset": "Pset_DoorCommon", "property": "FireRating", "value": "EI 60"}
    body = {**ref.params(), "recipe": {"format": "obracota.recipe/1", "operations": [operation]}}
    with ThreadPoolExecutor(max_workers=1) as pool:
        running = pool.submit(client.post, "/preview", json=body)
        try:
            assert inside.wait(10), "the preview did not reach the validate phase"
            started = time.monotonic()
            busy = read(client, "/summary", ref)
            checks = client.post("/preview", json={**body, "checks_only": True})
            waited = time.monotonic() - started
        finally:
            release.set()
        finished = running.result(timeout=30)
    busy_body = {"detail": store.MODEL_BUSY, "code": "ENGINE_BUSY"}
    assert (busy.status_code, busy.json()) == (503, busy_body)
    assert (checks.status_code, checks.json()) == (503, busy_body)
    assert waited < 3, f"the readings waited {waited:.1f} s"
    assert finished.status_code == 200 and finished.json()["ok"] is True
    assert read(client, "/summary", ref).status_code == 200
