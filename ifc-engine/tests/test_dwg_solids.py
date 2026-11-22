"""/dwg/solids: ACIS solids of 3D DWG files as one mesh (ACIS-LECTOR.md §4-§5).

Contract tests run always: parameters, 404/409, NOT_DWG, MODEL_TOO_LARGE, ENGINE_BUSY, the cache (a hit is
answered without reading the DWG again and with the same ETag) and the mesh format.

Reference tests need the BIMobject folder (``BIMOBJECT_DIR``, the DWG next to their FBX/OBJ). Without it they
are skipped, unless ``REQUIRE_FIXTURES=1``: then they fail. Each DWG goes through the HTTP route as the backend
calls it and its mesh is compared with the manufacturer's mesh, with the thresholds of ACIS-LECTOR §4:

- outline (bounding box) within ±2 mm per axis;
- area within ±1.5 %;
- no body failed.

Known differences of the references themselves are written per file next to the measured value:

- PK24: the FBX is 3.1 mm lower than the ACIS solids (884.3 vs 881.2 mm, also in the feasibility test of
  ACIS-LECTOR §3), so its Z axis is checked within 3.5 mm.
- Hven: the OBJ (metres, Y up) draws its thin parts with both sides, so its area is taken once per distinct
  triangle.

Files that do not meet the criterion yet are expected failures (``xfail(strict=True)``) with the reason, so
the suite shows them as not met and a fix makes the test fail until the mark is removed:

- Hven: area -2.2 %, the tolerant ODA tips of the legs mesh short.
- Grand Prix: Y +6 mm against the FBX (also in ACIS-LECTOR §3), not reviewed visually yet.
- Plusminus 6230: +7.1 mm and +3.7 % (also in §3) and one SURFACE entity not decoded.
- Tray table (-8.5 % area) and Avion (outline -313 mm): their generic SURFACE entities, which libredwg-web
  0.9.0 does not decode; ``test_undecoded_surfaces_are_counted`` pins how many.
"""
import gzip
import json
import os
import struct
import threading
import time
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

import engine
from obracota_engine import build, settings
from obracota_engine.dwg import meshfile, reader, solids, tessellate, units
from obracota_engine.dwg.sab import Sab, SabError

from reference_mesh import fbx, obj

client = TestClient(engine.app)


@pytest.fixture(autouse=True)
def solids_cache(tmp_path, monkeypatch) -> Path:
    root = tmp_path / "solids"
    monkeypatch.setattr(settings, "ENGINE_SOLIDS_CACHE", root)
    return root


def _write(originals, data: bytes):
    return originals.write(data)


# --- Contract ------------------------------------------------------------------------------------------

def test_parameters_are_validated():
    answer = client.get("/dwg/solids", params={"project": "x", "version": "y", "sha256": "z"})
    assert answer.status_code == 400 and answer.json()["code"] == "PARAMS_INVALID"


def test_missing_version_and_wrong_sha(originals):
    ref = _write(originals, b"AC1032" + bytes(64))
    missing = client.get("/dwg/solids", params={**ref.params(), "version": "00000000-0000-0000-0000-000000000000"})
    assert missing.status_code == 404 and missing.json()["code"] == "VERSION_NOT_FOUND"
    wrong = client.get("/dwg/solids", params={**ref.params(), "sha256": "0" * 64})
    assert wrong.status_code == 409 and wrong.json()["code"] == "SHA_MISMATCH"


def test_an_ifc_is_not_a_dwg(originals):
    ref = _write(originals, b"ISO-10303-21;\nHEADER;")
    answer = client.get("/dwg/solids", params=ref.params())
    assert answer.status_code == 422 and answer.json() == {"detail": solids.NOT_DWG, "code": "NOT_DWG"}


def test_size_limit_comes_before_reading(originals, monkeypatch):
    ref = _write(originals, b"AC1032" + bytes(2_000_000))
    monkeypatch.setattr(settings, "ENGINE_SOLIDS_MAX_BYTES", 1_000_000)
    answer = client.get("/dwg/solids", params=ref.params())
    assert answer.status_code == 422
    assert answer.json() == {"detail": "El DWG supera el tamaño que el motor puede teselar (2 MB).",
                             "code": "MODEL_TOO_LARGE"}


def test_busy_geometry_slot_answers_503(originals, monkeypatch):
    ref = _write(originals, b"AC1032" + bytes(64))
    monkeypatch.setattr(settings, "ENGINE_BUSY_WAIT_S", 1)
    assert build._slot.acquire(timeout=5)
    try:
        answer = client.get("/dwg/solids", params=ref.params())
    finally:
        build._slot.release()
    assert answer.status_code == 503 and answer.json()["code"] == "ENGINE_BUSY"


def test_missing_reader_is_reported(originals, monkeypatch, tmp_path):
    ref = _write(originals, b"AC1032" + bytes(64))
    monkeypatch.setattr(settings, "ENGINE_LIBREDWG_WEB", tmp_path / "nowhere")
    answer = client.get("/dwg/solids", params=ref.params())
    assert answer.status_code == 503 and answer.json()["code"] == "DWG_READER_MISSING"


def test_cache_hit_is_served_as_stored(originals, solids_cache):
    ref = _write(originals, b"AC1032" + bytes(64))
    payload = meshfile.encode({"bodies": []}, np.zeros((3, 3)), np.array([[0, 1, 2]]))
    solids_cache.mkdir()
    solids.cache_path(ref.sha256).write_bytes(payload)
    answer = client.get("/dwg/solids", params=ref.params())
    assert answer.status_code == 200
    assert answer.content == payload
    assert answer.headers["content-type"] == meshfile.MEDIA_TYPE
    assert answer.headers["etag"] == f'"{ref.sha256}.{tessellate.TESSELLATOR}"'
    assert answer.headers["x-obracota-cache"] == "hit"
    assert answer.headers["x-obracota-source-sha256"] == ref.sha256


def test_cache_evicts_the_least_recently_used(solids_cache, monkeypatch):
    solids_cache.mkdir()
    old, new = solids_cache / f"{'a' * 64}.x.ocsolid.gz", solids.cache_path("b" * 64)
    old.write_bytes(b"0" * 600)
    os.utime(old, (1, 1))
    monkeypatch.setattr(settings, "ENGINE_SOLIDS_CACHE_MAX_BYTES", 1000)
    solids._store(new, b"1" * 600)
    assert new.is_file() and not old.exists()
    assert not [p for p in solids_cache.iterdir() if p.name.startswith(".tmp-")]


def test_mesh_format_round_trip():
    positions = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=float)
    payload = meshfile.encode({"bodies": [{"handle": "1F"}]}, positions, np.array([[0, 1, 2]]))
    raw = gzip.decompress(payload)
    assert raw[:8] == b"OCSOLID1"
    size = struct.unpack_from("<I", raw, 8)[0]
    assert size % 4 == 0
    header = json.loads(raw[12:12 + size])
    assert header["format"] == "obracota.dwg-solids/1"
    assert (header["vertex_count"], header["triangle_count"]) == (3, 1)
    assert len(raw) == 12 + size + 3 * 12 + 1 * 12
    decoded, p, t = meshfile.decode(payload)
    assert decoded["bodies"] == [{"handle": "1F"}]
    assert np.array_equal(p, positions.astype(np.float32)) and t.tolist() == [[0, 1, 2]]


def test_units_are_the_drawing_units():
    assert units.to_mm(1) == 25.4 and units.to_mm(4) == 1.0 and units.to_mm(6) == 1000.0
    assert units.to_mm(0) == 1.0 and units.name(0).startswith("sin unidad")


def test_reader_rejects_a_truncated_stream():
    with pytest.raises(Exception) as caught:
        reader.parse(struct.pack("<I", 10) + b"{}")
    assert getattr(caught.value, "code", None) == "DWG_UNREADABLE"


def test_sab_needs_its_signature():
    with pytest.raises(SabError):
        Sab(b"ACIS TextFile 21800 ...")


def test_a_truncated_sab_is_a_sab_error():
    head = b"ACIS BinaryFile" + struct.pack("<4i", 21800, 0, 0, 0)
    for broken in (head + b"\x06\x00\x00", head + b"\x0d\x40abc", head + b"\x09\xff\x00\x00\x00ab"):
        with pytest.raises(SabError):
            Sab(broken)


def test_a_truncated_sab_fails_its_body_only():
    head = b"ACIS BinaryFile" + struct.pack("<4i", 21800, 0, 0, 0)
    body = reader.Body("1F", "3DSOLID", head + b"\x06\x00\x00", (reader.Placement(np.eye(4), "Muebles"),))
    mesh = tessellate.tessellate(reader.Extraction("AC1032", 4, [body]), time.monotonic() + 60, 1000)
    assert len(mesh.indices) == 0
    assert [(f["handle"], f["layer"]) for f in mesh.failed] == [("1F", "Muebles")]
    assert mesh.failed[0]["reason"].startswith("ACIS ilegible")


def test_deflection_follows_the_scale_of_the_body():
    one = (reader.Placement(np.eye(4), "0"),)
    ten = (reader.Placement(np.diag([10.0, 10.0, 10.0, 1.0]), "0"), reader.Placement(np.eye(4), "0"))
    mirrored = (reader.Placement(np.diag([-1.0, 1.0, 1.0, 1.0]), "0"),)
    assert tessellate.deflection(1.0, None, one) == pytest.approx(0.1)
    assert tessellate.deflection(25.4, None, one) == pytest.approx(0.1 / 25.4)
    assert tessellate.deflection(1.0, None, ten) == pytest.approx(0.01)
    assert tessellate.deflection(1.0, np.diag([2.0, 2.0, 2.0, 1.0]), ten) == pytest.approx(0.005)
    assert tessellate.deflection(1.0, None, mirrored) == pytest.approx(0.1)


def test_tessellator_names_the_pipeline():
    assert tessellate.TESSELLATOR.startswith(f"acis-occt-{tessellate.PIPELINE}-")
    assert len(tessellate.TESSELLATOR) <= 64


def test_if_none_match_answers_304_without_meshing(originals, monkeypatch):
    ref = _write(originals, b"AC1032" + bytes(64))
    monkeypatch.setattr(solids, "build", lambda *args: pytest.fail("meshed for a revalidation"))
    current = f'"{ref.sha256}.{tessellate.TESSELLATOR}"'
    for tag in (current, "W/" + current, '"other", ' + current, "*"):
        answer = client.get("/dwg/solids", params=ref.params(), headers={"If-None-Match": tag})
        assert answer.status_code == 304, tag
        assert answer.content == b""
        assert answer.headers["etag"] == current
        assert answer.headers["x-obracota-source-sha256"] == ref.sha256
        assert answer.headers["x-obracota-tessellator"] == tessellate.TESSELLATOR
    wrong = client.get("/dwg/solids", params={**ref.params(), "sha256": "0" * 64}, headers={"If-None-Match": "*"})
    assert wrong.status_code == 409


def test_a_stale_etag_gets_the_mesh(originals, solids_cache):
    ref = _write(originals, b"AC1032" + bytes(64))
    payload = meshfile.encode({"bodies": []}, np.zeros((3, 3)), np.array([[0, 1, 2]]))
    solids_cache.mkdir()
    solids.cache_path(ref.sha256).write_bytes(payload)
    stale = f'"{ref.sha256}.acis-occt-1"'
    answer = client.get("/dwg/solids", params=ref.params(), headers={"If-None-Match": stale})
    assert answer.status_code == 200 and answer.content == payload


def test_the_second_request_waits_for_the_first_beyond_the_busy_wait(originals, monkeypatch):
    # Rug Dots takes 21 s cold and ENGINE_BUSY_WAIT_S is 20 s: a second request for the same file waits for
    # the first one (its whole budget) instead of answering ENGINE_BUSY.
    ref = _write(originals, b"AC1032" + bytes(64))
    monkeypatch.setattr(settings, "ENGINE_BUSY_WAIT_S", 1)
    payload = meshfile.encode({"bodies": []}, np.zeros((0, 3)), np.zeros((0, 3)))

    def slow_build(*args):
        threading.Event().wait(1.6)
        return payload

    monkeypatch.setattr(solids, "build", slow_build)
    results, errors = [], []

    def ask():
        try:
            results.append(solids.solids(ref))
        except Exception as exc:  # noqa: BLE001 - reported below
            errors.append(exc)

    threads = [threading.Thread(target=ask) for _ in range(2)]
    for t in threads:
        t.start()
        threading.Event().wait(0.1)
    for t in threads:
        t.join()
    assert errors == [] and sorted(r.hit for r in results) == [False, True]
    assert ref.sha256 not in solids._locks or not solids._locks[ref.sha256].locked()


def test_two_requests_for_the_same_dwg_mesh_it_once(originals, monkeypatch):
    ref = _write(originals, b"AC1032" + bytes(64))
    calls = []
    payload = meshfile.encode({"bodies": []}, np.zeros((0, 3)), np.zeros((0, 3)))

    def slow_build(path, sha, *rest):
        calls.append(sha)
        threading.Event().wait(0.3)
        return payload

    monkeypatch.setattr(solids, "build", slow_build)
    results = []
    threads = [threading.Thread(target=lambda: results.append(solids.solids(ref))) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1
    assert sorted(r.hit for r in results) == [False, True]


# --- Reference files (BIMOBJECT_DIR) -------------------------------------------------------------------

# name: (folder, DWG, reference, axes of the reference as DWG x/y/z, scale to mm, per-axis tolerance mm,
#        area tolerance (low %, high %), FBX/OBJ duplicate triangles counted once)
REFERENCES = {
    "Basket": ("Basket", "Furniture_Other-Furniture_Fritz-Hansen_Basket", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "Rug Dots": ("Rug Dots", "Furniture_Other-Furniture_Fritz-Hansen_Rug-Dots", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "PK24": ("PK24™ Wicker Lounge chair", "Furniture_Chairs-Stools-Benches_Fritz-Hansen_PK24T-Wicker", ".fbx", (0, 1, 2), 1.0, (2, 2, 3.5), (-1.5, 1.5), False),
    "Hven": ("Hven Bar Stool Low", "1067 Hven Bar Stool Low", ".obj", (0, 2, 1), 1000.0, (2, 2, 2), (-1.5, 1.5), True),
    "Rug Balance": ("Rug Balance", "Furniture_Other-Furniture_Fritz-Hansen_Rug-balance", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "PM-02": ("PM-02 Table lamp", "Lighting_Desk-Table-Lighting_Fritz-Hansen_PM-02", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "Night Owl": ("Night Owl™ Table lamp", "Lighting_Desk-Table-Lighting_Fritz-Hansen_Night-OwlT", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "Plusminus 6245": ("Vibia-Plusminus-6245", "Lighting_Other_Vibia_Vibia-Plusminus-6245", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "Tempo": ("Tempo 5757 Diseño de Lievore Altherr", "Lighting_Wall-Mounted_Vibia_TEMPO-WALL-LARGE-DISC", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "Grand Prix": ("Grand Prix™ Chair 4130-NotUph", "Furniture_Chairs-Stools-Benches_Fritz-Hansen_Grand-PrixT-4130-NotUph", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "Plusminus 6230": ("Vibia-Plusminus-6230", "Lighting_Other_Vibia_Vibia-Plusminus-6230", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "Tray table": ("Tray table", "Furniture_Other-Furniture_Fritz-Hansen_Tray-table", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
    "Avion": ("Avion™ Pendant", "Lighting_Pendant-Lighting_Fritz-Hansen_AvionT", ".fbx", (0, 1, 2), 1.0, (2, 2, 2), (-1.5, 1.5), False),
}

# Files that do not meet the criterion yet (module docstring). strict: meeting it fails until the mark goes.
NOT_MET = {
    "Hven": "área -2,2 %: las puntas toroidales tolerantes de ODA se teselan cortas (ACIS-LECTOR §5)",
    "Grand Prix": "eje Y +6 mm frente al FBX (ACIS-LECTOR §3), sin revisión visual",
    "Plusminus 6230": "+7,1 mm y +3,7 % frente al FBX (ACIS-LECTOR §3) y una SURFACE sin decodificar",
    "Tray table": "4 SURFACE genéricas que libredwg-web 0.9.0 no decodifica: área -8,5 %",
    "Avion": "1 SURFACE genérica que libredwg-web 0.9.0 no decodifica: contorno -313 mm",
}

# Entities that libredwg-web 0.9.0 does not decode, per file: pinned so that a new reader shows up here.
UNDECODED = {
    "Tray table": {"SURFACE sin decodificar": 4},
    "Avion": {"SURFACE sin decodificar": 1},
    "Plusminus 6230": {"SURFACE sin decodificar": 1},
}


def _cases():
    for name in REFERENCES:
        reason = NOT_MET.get(name)
        yield pytest.param(name, marks=pytest.mark.xfail(strict=True, reason=reason)) if reason else name


def _bimobject(folder: str, stem: str, suffix: str) -> tuple:
    required = os.environ.get("REQUIRE_FIXTURES") == "1"
    root = os.environ.get("BIMOBJECT_DIR")
    base = Path(root) / folder if root else None
    dwg = next((p for p in base.iterdir() if p.stem == stem and p.suffix.lower() == ".dwg"), None) if base and base.is_dir() else None
    ref = next((p for p in base.iterdir() if p.stem == stem and p.suffix.lower() == suffix), None) if base and base.is_dir() else None
    if dwg is None or ref is None:
        problem = "BIMOBJECT_DIR is not set" if not root else f"{folder}/{stem} (.dwg and {suffix}) not found under {root}"
        if required:
            pytest.fail(f"REQUIRE_FIXTURES=1 and {problem}")
        pytest.skip(problem)
    return dwg, ref


def _unique_area(path: Path, scale: float) -> float:
    """Area of an OBJ counting once the triangles drawn twice (both sides of a thin part)."""
    vertices, seen = [], {}
    with open(path, encoding="latin1") as source:
        for line in source:
            if line.startswith("v "):
                vertices.append(np.array([float(x) for x in line.split()[1:4]]) * scale)
            elif line.startswith("f "):
                ids = [int(part.split("/")[0]) - 1 for part in line.split()[1:]]
                for k in range(1, len(ids) - 1):
                    a, b, c = (vertices[i] for i in (ids[0], ids[k], ids[k + 1]))
                    key = tuple(sorted(tuple(np.round(p, 1)) for p in (a, b, c)))
                    seen.setdefault(key, 0.5 * float(np.linalg.norm(np.cross(b - a, c - a))))
    return sum(seen.values())


@pytest.mark.parametrize("name", list(_cases()))
def test_solids_match_the_manufacturer_mesh(name, originals):
    folder, stem, suffix, axes, scale, outline_mm, (area_low, area_high), unique = REFERENCES[name]
    dwg, reference = _bimobject(folder, stem, suffix)
    ref = originals.link(dwg)
    answer = client.get("/dwg/solids", params=ref.params())
    assert answer.status_code == 200, answer.text
    header, positions, indices = meshfile.decode(answer.content)
    assert header["failed"] == [], header["failed"]
    assert header["bodies"], "no body was meshed"
    assert header["triangle_count"] == len(indices) and header["vertex_count"] == len(positions)
    assert indices.max() < len(positions)

    v = positions.astype(float) + np.array(header["origin_mm"])
    t = indices.astype(np.int64)
    size = v.max(axis=0) - v.min(axis=0)
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    area = float(0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum())

    ref_area, lo, hi = (fbx if suffix == ".fbx" else obj)(reference)
    ref_size = (hi - lo)[list(axes)] * scale
    ref_area = _unique_area(reference, scale) if unique else ref_area * scale * scale
    delta = size - ref_size
    for axis, (d, limit) in enumerate(zip(delta, outline_mm)):
        assert abs(d) <= limit, f"{name}: axis {'xyz'[axis]} differs by {d:+.2f} mm ({size} vs {ref_size})"
    change = 100 * (area / ref_area - 1)
    assert area_low <= change <= area_high, f"{name}: area {area:.0f} mm² vs {ref_area:.0f} mm² ({change:+.2f} %)"

    # The second request is the cached mesh, byte for byte, with the same ETag.
    again = client.get("/dwg/solids", params=ref.params())
    assert again.headers["x-obracota-cache"] == "hit" and again.content == answer.content
    assert again.headers["etag"] == answer.headers["etag"]


@pytest.mark.parametrize("name", list(UNDECODED))
def test_undecoded_surfaces_are_counted(name, originals):
    folder, stem, suffix, *_ = REFERENCES[name]
    dwg, _ = _bimobject(folder, stem, suffix)
    header, _, _ = meshfile.decode(client.get("/dwg/solids", params=originals.link(dwg).params()).content)
    assert header["failed"] == []
    assert {k: v for k, v in header["skipped"].items() if k.startswith("SURFACE")} == UNDECODED[name]


def _basket() -> reader.Extraction:
    folder, stem, suffix, *_ = REFERENCES["Basket"]
    dwg, _ = _bimobject(folder, stem, suffix)
    return reader.extract(dwg, 120)


def _signed_volume(v, t) -> float:
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def test_a_mirrored_insert_keeps_its_normals_outwards():
    extraction = _basket()
    mirror = np.diag([-1.0, 1.0, 1.0, 1.0])
    extraction.bodies = [replace(b, placements=(b.placements[0], replace(b.placements[0], matrix=mirror @ b.placements[0].matrix)))
                         for b in extraction.bodies]
    mesh = tessellate.tessellate(extraction, time.monotonic() + 120, 10_000_000)
    assert mesh.failed == []
    for body in mesh.bodies:
        first, count = body["first_triangle"], body["triangle_count"]
        volume = _signed_volume(mesh.positions, mesh.indices[first:first + count].astype(np.int64))
        assert volume > 0, (body["handle"], body["instance"], volume)
        assert body["mirrored"] == (body["instance"] == 1)
    straight = [b["area_mm2"] for b in mesh.bodies if b["instance"] == 0]
    mirrored = [b["area_mm2"] for b in mesh.bodies if b["instance"] == 1]
    assert straight == pytest.approx(mirrored, rel=1e-9)


def test_a_scaled_insert_is_meshed_to_the_same_precision():
    extraction = _basket()
    plain = tessellate.tessellate(extraction, time.monotonic() + 120, 10_000_000)
    ten = np.diag([10.0, 10.0, 10.0, 1.0])
    extraction.bodies = [replace(b, placements=tuple(replace(p, matrix=ten @ p.matrix) for p in b.placements))
                         for b in extraction.bodies]
    scaled = tessellate.tessellate(extraction, time.monotonic() + 120, 10_000_000)
    assert scaled.failed == []
    # 0.1 mm at ten times the size needs a finer mesh in the body's coordinates: more triangles, and the area
    # (100 times) as close to the exact one as at full size.
    assert len(scaled.indices) > 1.5 * len(plain.indices)
    area = lambda m: sum(b["area_mm2"] for b in m.bodies)
    assert area(scaled) == pytest.approx(100 * area(plain), rel=0.01)


def test_half_a_real_sab_fails_its_body_only():
    extraction = _basket()
    body = extraction.bodies[0]
    extraction.bodies = [replace(body, sab=body.sab[:len(body.sab) // 2])] + extraction.bodies[1:]
    mesh = tessellate.tessellate(extraction, time.monotonic() + 120, 10_000_000)
    assert {f["handle"] for f in mesh.failed} == {body.handle}
    assert len(mesh.bodies) == sum(len(b.placements) for b in extraction.bodies[1:])
