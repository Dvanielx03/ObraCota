"""H1-5: the original keeps its bytes (H1-ESPECIFICACION §5.11; invariant 1d of §5.7).

The SHA-256 and the modification time of the original are the same before and after /preview and /build,
with every kind of recipe: empty, ok, rejected by a check and rejected by the scope. The originals volume
is mounted ``:ro`` in Compose; this proves the engine never writes on it even when it could.
"""
import os

import pytest
from fastapi.testclient import TestClient

import engine
from conftest import DUPLEX_DOOR, DUPLEX_TYPE, build_revision, preview
from obracota_engine import invariants, store
from obracota_engine.errors import EngineError


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def fingerprint(path):
    stat = os.stat(path)
    with open(path, "rb") as source:
        data = source.read()
    return store.sha_of(path), stat.st_size, stat.st_mtime_ns, data


def recipes(synthetic):
    door = synthetic["D1"].GlobalId
    return [
        [],
        [{"id": "op-1", "op": "ifc.change_type", "element": door, "type_id": synthetic["P90B"].GlobalId}],
        [{"id": "op-1", "op": "ifc.change_type", "element": door, "type_id": synthetic["P100"].GlobalId}],
        [{"id": "op-1", "op": "ifc.set_property", "element": door, "scope": "occurrence", "pset": "Pset_DoorCommon",
          "property": "FireRating", "value": "EI 60"}],
        [{"id": "op-1", "op": "ifc.set_property", "element": door, "scope": "type", "pset": "Pset_DoorCommon",
          "property": "AcousticRating", "value": "35 dB"}],
    ]


def test_original_untouched_synthetic(client, originals, synthetic, no_temporaries):
    ref = originals.add_model(synthetic.file)
    before = fingerprint(ref.path)
    for operations in recipes(synthetic):
        report = preview(client, ref, *operations)
        artifact = report.get("artifact", {}).get("id")
        response = build_revision(client, ref, operations, artifact)
        assert response.status_code == (200 if report["ok"] else 422), response.text
        response = build_revision(client, ref, operations)  # rebuilt
        assert response.status_code == (200 if report["ok"] else 422)
        assert fingerprint(ref.path) == before
    assert before[0] == ref.sha256


def test_original_untouched_duplex(client, duplex, duplex_path, no_temporaries):
    before = fingerprint(duplex_path)
    operations = [{"id": "op-1", "op": "ifc.change_type", "element": DUPLEX_DOOR, "type_id": DUPLEX_TYPE}]
    report = preview(client, duplex, *operations)
    assert report["ok"] is True
    assert build_revision(client, duplex, operations, report["artifact"]["id"]).status_code == 200
    assert fingerprint(duplex_path) == before == fingerprint(duplex.path)


def test_original_changed_is_a_500(originals, synthetic):
    """Invariant 1d: a different SHA-256 after the build is ORIGINAL_CHANGED (500), never a report."""
    ref = originals.add_model(synthetic.file)
    invariants.require_original_unchanged(ref.path, ref.sha256)
    with pytest.raises(EngineError) as raised:
        invariants.require_original_unchanged(ref.path, "0" * 64)
    assert (raised.value.status, raised.value.code) == (500, "ORIGINAL_CHANGED")


def test_original_changed_with_the_same_size_and_time(originals, synthetic):
    """Invariant 1d hashes the bytes again: the memo of sha_of keys on size and mtime, and would miss bytes
    that changed under the same size and modification time."""
    ref = originals.add_model(synthetic.file)
    stat = os.stat(ref.path)
    data = bytearray(ref.path.read_bytes())
    data[-2] = ord("X") if data[-2] != ord("X") else ord("Y")
    ref.path.write_bytes(bytes(data))
    os.utime(ref.path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    assert store.sha_of(ref.path) == ref.sha256, "the memo still answers with the old hash"
    with pytest.raises(EngineError) as raised:
        invariants.require_original_unchanged(ref.path, ref.sha256)
    assert (raised.value.status, raised.value.code) == (500, "ORIGINAL_CHANGED")
