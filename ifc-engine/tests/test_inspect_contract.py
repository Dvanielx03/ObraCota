"""H1-10: /health, /inspect and the deprecated /apply keep exactly the contract they had before H1 (§5.1).

The reference is tests/fixtures/inspect-duplex.json, captured in step 0 with obracota-ifc-engine:latest
(``json.dumps(engine.inspect(*engine.load(...)), sort_keys=True)``). The error bodies stay
``{"detail": ...}`` without ``code``: the backend's HttpBimEdit reads them that way.
"""
import json
import uuid
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element
import pytest
from fastapi.testclient import TestClient

import engine
from conftest import DUPLEX_DOOR, DUPLEX_TYPE
from obracota_engine import store
from obracota_engine.operations import change_type

REFERENCE = Path(__file__).parent / "fixtures" / "inspect-duplex.json"
DUPLEX_INCOMPATIBLE_TYPE = "0pB8AT2hfEtQhuGzBhCesc"


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


@pytest.fixture
def synthetic_version(originals, synthetic):
    return synthetic, originals.add_model(synthetic.file)


def inspect(client, ref, element):
    return client.get("/inspect", params={"project": ref.project, "version": ref.version, "element": element})


def apply(client, ref, element, type_id):
    return client.post("/apply", params={"project": ref.project, "version": ref.version,
                                         "element": element, "type_id": type_id})


def test_health(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "UP"}


def test_duplex_inspect_matches_reference(client, duplex):
    """H1-10: field by field, and byte for byte once serialised the way the reference was."""
    response = inspect(client, duplex, DUPLEX_DOOR)

    assert response.status_code == 200
    reference = REFERENCE.read_text(encoding="utf-8")
    assert response.json() == json.loads(reference)
    assert json.dumps(response.json(), sort_keys=True) + "\n" == reference


def test_inspect_of_the_synthetic_door_offers_the_candidates(client, synthetic_version):
    """The sample doors of conftest.py are what lets inspect() measure P90B, P100 and P90C (§5.11)."""
    s, ref = synthetic_version

    body = inspect(client, ref, s["D1"].GlobalId).json()

    assert body["typeId"] == s["P90"].GlobalId
    assert (body["width"], body["height"], body["openingSize"]) == (0.9, 2.1, [0.92, 2.12])
    assert (body["opening"], body["host"], body["loadBearing"]) == (s["H1"].GlobalId, s["W1"].GlobalId, False)
    assert [(o["name"], o["width"], o["height"], o["compatible"]) for o in body["options"]] == [
        ("P90B", 0.9, 2.1, True), ("P90C", 0.9, 2.1, True), ("P100", 1.0, 2.1, False)]


@pytest.mark.parametrize("case, status, detail", [
    ("missing version", 404, "Versión IFC no disponible."),
    ("unknown element", 404, "La pieza no aparece en el IFC."),
    ("not a door", 422, "La edición se habilita para puertas IFC."),
], ids=["missing-version", "unknown-element", "not-a-door"])
def test_inspect_errors_keep_their_body(client, synthetic_version, case, status, detail):
    s, ref = synthetic_version
    if case == "missing version":
        ref = type(ref)(ref.project, str(uuid.uuid4()), ref.sha256, ref.path)
    element = {"missing version": s["D1"].GlobalId, "unknown element": "0" * 22,
               "not a door": s["W1"].GlobalId}[case]

    response = inspect(client, ref, element)

    assert response.status_code == status
    assert response.json() == {"detail": detail}


def test_inspect_rejects_a_malformed_uuid_as_fastapi_does(client):
    response = client.get("/inspect", params={"project": "no-es-uuid", "version": str(uuid.uuid4()), "element": "x"})

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_inspect_without_a_length_unit(client, originals, synthetic):
    project = synthetic["project"]
    for unit in [u for u in project.UnitsInContext.Units if u.UnitType == "LENGTHUNIT"]:
        project.UnitsInContext.Units = [u for u in project.UnitsInContext.Units if u != unit]
    ref = originals.add_model(synthetic.file)

    response = inspect(client, ref, synthetic["D1"].GlobalId)

    assert response.status_code == 422
    assert response.json() == {"detail": "El IFC necesita una unidad de longitud definida."}


def reopen(tmp_path, content: bytes) -> ifcopenshell.file:
    path = tmp_path / "revision.ifc"
    path.write_bytes(content)
    return ifcopenshell.open(str(path))


def test_duplex_apply_exports_the_checked_revision(client, duplex, tmp_path, no_temporaries):
    """The current /apply on the Playwright door: same opening and host, 0.762 x 2.032 m, original intact."""
    before = inspect(client, duplex, DUPLEX_DOOR).json()

    response = apply(client, duplex, DUPLEX_DOOR, DUPLEX_TYPE)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    revision = reopen(tmp_path, response.content)
    door = revision.by_guid(DUPLEX_DOOR)
    assert ifcopenshell.util.element.get_type(door).GlobalId == DUPLEX_TYPE
    opening, host = change_type.opening_and_host(door)
    assert (opening.GlobalId, host.GlobalId) == (before["opening"], before["host"])
    assert change_type.size(door, 1.0) == [0.762, 2.032]
    assert store.sha_of(duplex.path) == duplex.sha256


def test_synthetic_apply_exports_the_checked_revision(client, synthetic_version, tmp_path, no_temporaries):
    s, ref = synthetic_version

    response = apply(client, ref, s["D1"].GlobalId, s["P90B"].GlobalId)

    assert response.status_code == 200
    revision = reopen(tmp_path, response.content)  # keep the file alive while its entities are read
    door = revision.by_guid(s["D1"].GlobalId)
    assert ifcopenshell.util.element.get_type(door).GlobalId == s["P90B"].GlobalId
    assert (door.OverallWidth, door.OverallHeight) == pytest.approx((0.9, 2.1))
    assert store.sha_of(ref.path) == ref.sha256


@pytest.mark.parametrize("case, status, detail", [
    ("incompatible type", 422, "El motor solo aplica tipos compatibles con el hueco existente."),
    ("type not offered", 422, "El motor solo aplica tipos compatibles con el hueco existente."),
    ("missing version", 404, "Versión IFC no disponible."),
    ("not a door", 422, "La edición se habilita para puertas IFC."),
], ids=["incompatible-type", "type-not-offered", "missing-version", "not-a-door"])
def test_apply_errors_keep_their_body(client, synthetic_version, no_temporaries, case, status, detail):
    s, ref = synthetic_version
    if case == "missing version":
        ref = type(ref)(ref.project, str(uuid.uuid4()), ref.sha256, ref.path)
    element = s["W1"].GlobalId if case == "not a door" else s["D1"].GlobalId
    type_id = s["P90"].GlobalId if case == "type not offered" else s["P100"].GlobalId

    response = apply(client, ref, element, type_id)

    assert response.status_code == status
    assert response.json() == {"detail": detail}


def test_duplex_apply_rejects_an_incompatible_type(client, duplex, no_temporaries):
    response = apply(client, duplex, DUPLEX_DOOR, DUPLEX_INCOMPATIBLE_TYPE)

    assert response.status_code == 422
    assert response.json() == {"detail": "El motor solo aplica tipos compatibles con el hueco existente."}


def test_apply_reports_a_failed_check_of_the_written_revision(client, synthetic_version, monkeypatch, no_temporaries):
    """If the reopened door lost its opening, /apply refuses the revision with the message of today."""
    s, ref = synthetic_version
    real, calls = change_type.opening_and_host, []

    def lose_opening_after_writing(door):
        calls.append(door)
        return real(door) if len(calls) == 1 else (None, None)

    monkeypatch.setattr(change_type, "opening_and_host", lose_opening_after_writing)

    response = apply(client, ref, s["D1"].GlobalId, s["P90B"].GlobalId)

    assert response.status_code == 422
    assert response.json() == {"detail": "La revisión exportada no superó las comprobaciones de la pieza."}


def test_apply_turns_an_unexpected_failure_into_the_generic_message(client, synthetic_version, monkeypatch,
                                                                   no_temporaries):
    s, ref = synthetic_version

    def broken(*_args, **_kwargs):
        raise RuntimeError("simulated library failure")

    monkeypatch.setattr(change_type, "assign_type", broken)

    response = apply(client, ref, s["D1"].GlobalId, s["P90B"].GlobalId)

    assert response.status_code == 422
    assert response.json() == {"detail": "No se pudo exportar y comprobar la revisión IFC."}
