"""Step 1 foundations: settings, errors and store (§5.1, §5.2, §5.9), and the synthetic model of §5.11.

The cache behaviour behind the read endpoints (H1-7a) is tested again through HTTP in step 2.
"""
import hashlib
import importlib
import os

import ifcopenshell
import ifcopenshell.util.element
import ifcopenshell.validate
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import DOOR_TYPES, synthetic_model
from obracota_engine import ENGINE_VERSION, errors, settings, store
from obracota_engine.errors import EngineError

SETTING_NAMES = ["ENGINE_ORIGINALS", "ENGINE_ARTIFACTS", "ENGINE_CACHE_MODELS", "ENGINE_ARTIFACT_MAX",
                 "ENGINE_ARTIFACT_MAX_BYTES", "ENGINE_ARTIFACT_TTL_S", "ENGINE_PREVIEW_MAX_BYTES",
                 "ENGINE_PREVIEW_DEADLINE_S", "ENGINE_BUSY_WAIT_S"]


@pytest.fixture
def reload_settings(monkeypatch):
    """Reload settings under a controlled environment and restore the real one afterwards."""
    for name in SETTING_NAMES:
        monkeypatch.delenv(name, raising=False)

    def reload(**env):
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        return importlib.reload(settings)

    yield reload
    monkeypatch.undo()
    importlib.reload(settings)


def test_engine_version():
    assert ENGINE_VERSION == "h1.0"


def test_settings_defaults_are_the_specified_ones(reload_settings):
    s = reload_settings()

    assert str(s.ENGINE_ORIGINALS) == "/srv/originals"
    assert str(s.ENGINE_ARTIFACTS) == "/tmp/obracota-artifacts"
    assert (s.ENGINE_CACHE_MODELS, s.ENGINE_ARTIFACT_MAX, s.ENGINE_ARTIFACT_MAX_BYTES) == (2, 4, 1 << 30)
    assert s.ENGINE_ARTIFACT_TTL_S == 900
    assert s.ENGINE_PREVIEW_MAX_BYTES == 33_554_432
    assert (s.ENGINE_PREVIEW_DEADLINE_S, s.ENGINE_BUSY_WAIT_S) == (150, 20)


def test_settings_come_from_the_environment(reload_settings):
    s = reload_settings(ENGINE_ORIGINALS="/data/originals", ENGINE_CACHE_MODELS="5", ENGINE_BUSY_WAIT_S="")

    assert str(s.ENGINE_ORIGINALS) == "/data/originals"
    assert s.ENGINE_CACHE_MODELS == 5
    assert s.ENGINE_BUSY_WAIT_S == 20


@pytest.mark.parametrize("value", ["dos", "0", "-3"])
def test_settings_reject_values_that_are_not_positive_integers(reload_settings, value):
    with pytest.raises(ValueError, match="ENGINE_CACHE_MODELS"):
        reload_settings(ENGINE_CACHE_MODELS=value)


def test_engine_error_body_has_detail_and_code():
    app = FastAPI()
    errors.install(app)

    @app.get("/boom")
    def boom():
        raise EngineError(409, "SHA_MISMATCH", "El archivo de la versión no coincide con su SHA-256.")

    response = TestClient(app).get("/boom")

    assert response.status_code == 409
    assert response.json() == {"detail": "El archivo de la versión no coincide con su SHA-256.", "code": "SHA_MISMATCH"}


def test_original_path_follows_the_configured_root(originals):
    assert store.original_path("p", "v") == originals.root / "p" / "v"


def test_sha_of_is_memoised_by_path_size_and_mtime(tmp_path):
    path = tmp_path / "original"
    path.write_bytes(b"ISO-10303-21; first")
    first = store.sha_of(path)
    assert first == hashlib.sha256(b"ISO-10303-21; first").hexdigest()

    stat = os.stat(path)
    path.write_bytes(b"ISO-10303-21; other")  # same size
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    assert store.sha_of(path) == first, "same path, size and mtime: the memo answers"

    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    assert store.sha_of(path) == hashlib.sha256(b"ISO-10303-21; other").hexdigest()


def test_require_original_checks_presence_and_sha(originals, synthetic):
    ref = originals.add_model(synthetic.file)
    assert store.require_original(ref.project, ref.version, ref.sha256) == ref.path

    with pytest.raises(EngineError) as missing:
        store.require_original(ref.project, "otra-version", ref.sha256)
    assert (missing.value.status, missing.value.code) == (404, "VERSION_NOT_FOUND")

    with pytest.raises(EngineError) as mismatch:
        store.require_original(ref.project, ref.version, "0" * 64)
    assert (mismatch.value.status, mismatch.value.code) == (409, "SHA_MISMATCH")


class CountingOpener:
    def __init__(self):
        self.paths = []

    def __call__(self, path):
        self.paths.append(path)
        return ifcopenshell.open(str(path), format=".ifc")


def test_model_cache_opens_each_sha_once_and_evicts_the_least_recent(originals):
    a, b, c = (originals.add_model(synthetic_model().file) for _ in range(3))
    same_bytes_as_a = originals.link(a.path)
    opener = CountingOpener()
    cache = store.ModelCache(capacity=2, opener=opener)

    first = cache.get(a.project, a.version, a.sha256)
    assert cache.get(a.project, a.version, a.sha256) is first
    assert cache.get(same_bytes_as_a.project, same_bytes_as_a.version, a.sha256) is first
    assert cache.opens == 1

    cache.get(b.project, b.version, b.sha256)
    cache.get(a.project, a.version, a.sha256)          # a becomes the most recent
    cache.get(c.project, c.version, c.sha256)          # evicts b
    assert (a.sha256 in cache, b.sha256 in cache, c.sha256 in cache) == (True, False, True)
    assert len(cache) == 2 and cache.opens == 3

    cache.get(b.project, b.version, b.sha256)
    assert cache.opens == 4


def test_model_cache_capacity_follows_the_setting(originals, monkeypatch):
    monkeypatch.setattr(settings, "ENGINE_CACHE_MODELS", 1)
    a, b = (originals.add_model(synthetic_model().file) for _ in range(2))
    cache = store.ModelCache(opener=CountingOpener())

    cache.get(a.project, a.version, a.sha256)
    cache.get(b.project, b.version, b.sha256)

    assert (a.sha256 in cache, b.sha256 in cache) == (False, True)


def test_model_cache_reading_holds_the_model_lock(originals, synthetic):
    ref = originals.add_model(synthetic.file)
    cache = store.ModelCache()

    with cache.reading(ref.project, ref.version, ref.sha256) as model:
        assert model.by_guid(synthetic["D1"].GlobalId).Name == "D1"
        assert cache.get(ref.project, ref.version, ref.sha256).lock.locked()
    assert not cache.get(ref.project, ref.version, ref.sha256).lock.locked()


def test_model_cache_errors(originals):
    cache = store.ModelCache()
    folder = originals.root / "proyecto"
    folder.mkdir()
    (folder / "basura").write_bytes(b"esto no es un IFC")
    garbage_sha = store.sha_of(folder / "basura")

    with pytest.raises(EngineError) as unreadable:
        cache.get("proyecto", "basura", garbage_sha)
    assert (unreadable.value.status, unreadable.value.code) == (422, "MODEL_UNREADABLE")
    assert len(cache) == 0

    with pytest.raises(EngineError) as missing:
        cache.get("proyecto", "no-existe", garbage_sha)
    assert missing.value.code == "VERSION_NOT_FOUND"


def test_synthetic_model_has_what_section_5_11_lists(synthetic):
    s = synthetic
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(s.file, logger, express_rules=False)
    assert logger.statements == [], "H1-6 expects 0 schema problems in the synthetic model"

    assert s.file.schema == "IFC4" and s.scale == 1.0
    assert s["storey"].Elevation == 3.0
    body = s["body"]
    assert (body.ContextIdentifier, body.TargetView) == ("Body", "MODEL_VIEW")

    for door, opening, wall in (("D1", "H1", "W1"), ("D2", "H2", "W2"), ("S-P90B", "H3", "W3"),
                                ("S-P100", "H4", "W4"), ("S-P90C", "H5", "W5")):
        assert s[door].FillsVoids[0].RelatingOpeningElement == s[opening]
        assert s[opening].VoidsElements[0].RelatingBuildingElement == s[wall]
        assert s[door].ObjectPlacement.PlacementRelTo == s[opening].ObjectPlacement, f"{door} relative to {opening}"
        assert ifcopenshell.util.element.get_pset(s[wall], "Pset_WallCommon", "LoadBearing") is False

    types = {t.Name: t for t in s.file.by_type("IfcDoorType")}
    assert set(types) == set(DOOR_TYPES)
    assert all(t.RepresentationMaps for t in types.values())
    assert types["P90C"].PredefinedType == "DOOR"
    assert (s["D2"].PredefinedType, s["D2"].ObjectType) == ("USERDEFINED", "Puerta cortafuego")

    shared = [rel for rel in s.file.by_type("IfcRelDefinesByProperties")
              if rel.RelatingPropertyDefinition == s["Pset_DoorCommon"]]
    assert len(shared) == 1 and set(shared[0].RelatedObjects) == {s["D1"], s["D2"]}
    assert ifcopenshell.util.element.get_psets(s["D1"], qtos_only=True).keys() == {"Qto_DoorBaseQuantities"}
    assert ifcopenshell.util.element.get_material(s["slab"]).Name == "Concreto 3000 psi"


def test_synthetic_model_in_millimetres_keeps_the_same_measures():
    s = synthetic_model("MILLIMETRE")

    assert s.scale == pytest.approx(0.001)
    assert (s["D1"].OverallWidth, s["D1"].OverallHeight) == pytest.approx((900.0, 2100.0))
    assert s["storey"].Elevation == pytest.approx(3000.0)
