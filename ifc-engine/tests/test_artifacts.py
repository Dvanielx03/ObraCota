"""H1-7b: artifacts, the geometry slot and the deadline (H1-ESPECIFICACION §5.6, §5.9, §5.11).

- /build with a valid artifact sends the bytes /preview verified (same SHA-256, ``Rebuilt: false``) without
  taking the slot, and only once. An expired, evicted, unknown or foreign artifact is rebuilt
  (``Rebuilt: true``) with the full verification.
- When the engine starts, ``ENGINE_ARTIFACTS`` is emptied.
- With the slot held longer than ``ENGINE_BUSY_WAIT_S``, /preview, a rebuilding /build and /diff answer
  503 ``ENGINE_BUSY``. Full previews can wait longer in a bounded FIFO queue. A deadline exceeded is 503 ``DEADLINE_EXCEEDED``, leaves no temporary directory and
  releases the slot.
"""
import hashlib
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep

import pytest
from fastapi.testclient import TestClient

import engine
from conftest import build_revision, preview
from obracota_engine import artifacts, build, settings, store


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


@pytest.fixture
def slot_taken(monkeypatch):
    """The geometry slot held by someone else, and a wait of 0 s for it."""
    monkeypatch.setattr(settings, "ENGINE_BUSY_WAIT_S", 0)
    monkeypatch.setattr(settings, "ENGINE_PREVIEW_WAIT_S", 0)
    assert build._slot.acquire(timeout=1)
    yield
    build._slot.release()


def door_change(synthetic, target="P90B") -> list:
    return [{"id": "op-1", "op": "ifc.change_type", "element": synthetic["D1"].GlobalId,
             "type_id": synthetic[target].GlobalId}]


def sha(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def test_build_sends_the_artifact_once(client, originals, synthetic, artifact_store, no_temporaries):
    ref = originals.add_model(synthetic.file)
    operations = door_change(synthetic)
    report = preview(client, ref, *operations)
    artifact = report["artifact"]
    assert sorted(entry.name for entry in artifact_store.iterdir()) == [f"{artifact['id']}.ifc", f"{artifact['id']}.json"]
    assert artifact["expires_at"].endswith("Z") and artifact["size"] == (artifact_store / f"{artifact['id']}.ifc").stat().st_size

    response = build_revision(client, ref, operations, artifact["id"])
    assert response.status_code == 200
    assert response.headers["X-ObraCota-Rebuilt"] == "false"
    assert response.headers["X-ObraCota-Output-Sha256"] == artifact["sha256"] == sha(response.content)
    assert response.headers["X-ObraCota-Recipe-Sha256"] == report["recipe_sha256"]
    assert int(response.headers["Content-Length"]) == artifact["size"]
    assert response.headers["Content-Type"] == "application/octet-stream"
    assert list(artifact_store.iterdir()) == []  # one use

    again = build_revision(client, ref, operations, artifact["id"])
    assert again.status_code == 200 and again.headers["X-ObraCota-Rebuilt"] == "true"
    # The synthetic model has no IfcOwnerHistory: rebuilding gives the same bytes (step 0).
    assert again.headers["X-ObraCota-Output-Sha256"] == artifact["sha256"] == sha(again.content)


def test_build_with_artifact_skips_the_slot(client, originals, synthetic, monkeypatch):
    ref = originals.add_model(synthetic.file)
    operations = door_change(synthetic)
    artifact = preview(client, ref, *operations)["artifact"]
    monkeypatch.setattr(settings, "ENGINE_BUSY_WAIT_S", 0)
    assert build._slot.acquire(timeout=1)
    try:
        response = build_revision(client, ref, operations, artifact["id"])
        assert response.status_code == 200 and response.headers["X-ObraCota-Rebuilt"] == "false"
        busy = build_revision(client, ref, operations, artifact["id"])  # gone: it must rebuild, and waits
        assert busy.status_code == 503 and busy.json()["code"] == "ENGINE_BUSY"
    finally:
        build._slot.release()


def test_expired_artifact_is_rebuilt(client, originals, synthetic, artifact_store, monkeypatch):
    ref = originals.add_model(synthetic.file)
    operations = door_change(synthetic)
    artifact = preview(client, ref, *operations)["artifact"]
    later = artifacts._now() + settings.ENGINE_ARTIFACT_TTL_S + 1
    monkeypatch.setattr(artifacts, "_now", lambda: later)
    response = build_revision(client, ref, operations, artifact["id"])
    assert response.status_code == 200 and response.headers["X-ObraCota-Rebuilt"] == "true"
    assert list(artifact_store.iterdir()) == []  # the expired one was removed


def test_artifact_of_another_recipe_or_base_is_not_sent(client, originals, synthetic, artifact_store):
    ref = originals.add_model(synthetic.file)
    other = originals.link(ref.path)  # the same bytes as another version: the same base SHA-256
    artifact = preview(client, ref, *door_change(synthetic))["artifact"]
    response = build_revision(client, ref, [], artifact["id"])
    assert response.status_code == 200 and response.headers["X-ObraCota-Rebuilt"] == "true"
    assert (artifact_store / f"{artifact['id']}.ifc").exists()  # still there for its own recipe
    same_bytes = build_revision(client, other, door_change(synthetic), artifact["id"])
    assert same_bytes.headers["X-ObraCota-Rebuilt"] == "false"  # tied to the base SHA-256, not to its id


def test_unknown_artifact_and_parameters(client, originals, synthetic):
    ref = originals.add_model(synthetic.file)
    response = build_revision(client, ref, door_change(synthetic), "f" * 32)
    assert response.status_code == 200 and response.headers["X-ObraCota-Rebuilt"] == "true"
    for artifact in ("../x", 42, "F" * 32):
        bad = build_revision(client, ref, [], artifact)
        assert bad.status_code == 400 and bad.json()["code"] == "PARAMS_INVALID"
    assert client.post("/build", json={**ref.params(), "recipe": {"format": "x"}}).json()["code"] == "RECIPE_INVALID"


def test_build_that_fails_verification(client, originals, synthetic, artifact_store, no_temporaries):
    """A recipe that does not verify is 422 VERIFICATION_FAILED with its report; nothing is sent or kept."""
    ref = originals.add_model(synthetic.file)
    response = build_revision(client, ref, door_change(synthetic, "P100"))
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "VERIFICATION_FAILED" and body["detail"] == "La revisión no superó la verificación."
    assert body["report"]["ok"] is False
    assert body["report"]["operations"][0]["errors"][0]["code"] == "TYPE_NOT_COMPATIBLE"
    assert list(artifact_store.iterdir()) == []


def test_eviction_keeps_the_newest(client, originals, synthetic, artifact_store, monkeypatch):
    monkeypatch.setattr(settings, "ENGINE_ARTIFACT_MAX", 2)
    ref = originals.add_model(synthetic.file)
    recipes = [[], door_change(synthetic), door_change(synthetic, "P90C")]
    ids = [preview(client, ref, *operations)["artifact"]["id"] for operations in recipes]
    assert set(artifacts.known()) == set(ids[1:])
    assert build_revision(client, ref, recipes[0], ids[0]).headers["X-ObraCota-Rebuilt"] == "true"
    monkeypatch.setattr(settings, "ENGINE_ARTIFACT_MAX_BYTES", 1)
    big = preview(client, ref, *recipes[0])["artifact"]  # larger than the cache: reported, not kept
    assert big["id"] not in artifacts.known() and artifacts.known() == {}


def test_startup_empties_the_artifacts(originals, synthetic, artifact_store):
    artifact_store.mkdir(exist_ok=True)
    (artifact_store / "stale.ifc").write_bytes(b"ISO-10303-21;")
    with TestClient(engine.app) as started:
        assert started.get("/health").status_code == 200
        assert list(artifact_store.iterdir()) == []


def test_busy_slot(client, originals, synthetic, slot_taken, no_temporaries):
    ref = originals.add_model(synthetic.file)
    busy = {"detail": "El motor IFC está ocupado con otra vista previa; vuelve a intentarlo en un momento.",
            "code": "ENGINE_BUSY"}
    response = client.post("/preview", json={**ref.params(), "recipe": {"format": "obracota.recipe/1", "operations": []}})
    assert (response.status_code, response.json()) == (503, busy)
    response = build_revision(client, ref, [])
    assert (response.status_code, response.json()) == (503, busy)
    diff = client.post("/diff", json={"project": ref.project, "base": {"version": ref.version, "sha256": ref.sha256},
                                      "revision": {"version": ref.version, "sha256": ref.sha256}})
    assert (diff.status_code, diff.json()) == (503, busy)
    checks = client.post("/preview", json={**ref.params(), "checks_only": True,
                                           "recipe": {"format": "obracota.recipe/1", "operations": []}})
    assert checks.status_code == 200  # checks_only does not take the slot (R3)


def test_full_previews_queue_in_order_and_reject_an_excess_request(client, originals, synthetic, monkeypatch):
    ref = originals.add_model(synthetic.file)
    queue = build.GeometryQueue(max_waiters=1)
    monkeypatch.setattr(build, "_slot", queue)
    monkeypatch.setattr(settings, "ENGINE_PREVIEW_WAIT_S", 5)
    entered, proceed = Event(), Event()
    calls = []
    verify = build.build_and_verify

    def tracked(ref, recipe, directory, deadline):
        calls.append(recipe.operations[0].id)
        if len(calls) == 1:
            entered.set()
            assert proceed.wait(10)
        return verify(ref, recipe, directory, deadline)

    def send(op_id):
        operations = [{**door_change(synthetic)[0], "id": op_id}]
        return client.post("/preview", json={**ref.params(), "recipe": {"format": "obracota.recipe/1", "operations": operations}})

    monkeypatch.setattr(build, "build_and_verify", tracked)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(send, "op-1")
        try:
            assert entered.wait(5)
            second = pool.submit(send, "op-2")
            until = monotonic() + 3
            while not queue.waiters and monotonic() < until:
                sleep(.005)
            assert len(queue.waiters) == 1
            overflow = send("op-3")
            assert (overflow.status_code, overflow.json()["code"]) == (503, "ENGINE_BUSY")
            assert calls == ["op-1"]
        finally:
            proceed.set()
        assert all(response.status_code == 200 and response.json()["ok"] for response in (first.result(), second.result()))
    assert calls == ["op-1", "op-2"]


def test_deadline_exceeded(client, originals, synthetic, artifact_store, monkeypatch, no_temporaries):
    ref = originals.add_model(synthetic.file)
    monkeypatch.setattr(settings, "ENGINE_PREVIEW_DEADLINE_S", 0)
    for response in (client.post("/preview", json={**ref.params(),
                                                   "recipe": {"format": "obracota.recipe/1",
                                                              "operations": door_change(synthetic)}}),
                     build_revision(client, ref, door_change(synthetic))):
        assert response.status_code == 503
        assert response.json()["code"] == "DEADLINE_EXCEEDED"
        assert response.json()["detail"].startswith("La verificación superó el plazo de 0 s")
    assert list(artifact_store.iterdir()) == []
    monkeypatch.setattr(settings, "ENGINE_PREVIEW_DEADLINE_S", 150)
    monkeypatch.setattr(settings, "ENGINE_BUSY_WAIT_S", 0)
    assert preview(client, ref, *door_change(synthetic))["ok"] is True  # the slot was released


def test_deadline_counts_between_phases(monkeypatch):
    clock = iter([100.0, 100.5, 260.0])
    monkeypatch.setattr(build, "_clock", lambda: next(clock))
    deadline = build.Deadline()
    deadline.check("open")
    with pytest.raises(build.EngineError) as raised:
        deadline.check("diff")
    assert (raised.value.status, raised.value.code) == (503, "DEADLINE_EXCEEDED")
