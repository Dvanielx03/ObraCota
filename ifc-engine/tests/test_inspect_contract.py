"""H1-10: /health and /inspect keep exactly the contract they had before H1 (§5.1).

The reference is tests/fixtures/inspect-duplex.json, captured in step 0 with obracota-ifc-engine:latest
(``json.dumps(engine.inspect(*engine.load(...)), sort_keys=True)``). The error bodies stay
``{"detail": ...}`` without ``code``: the backend's HttpDoorInspection reads them that way.
"""
import json
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import engine
from conftest import DUPLEX_DOOR

REFERENCE = Path(__file__).parent / "fixtures" / "inspect-duplex.json"


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


@pytest.fixture
def synthetic_version(originals, synthetic):
    return synthetic, originals.add_model(synthetic.file)


def inspect(client, ref, element):
    return client.get("/inspect", params={"project": ref.project, "version": ref.version, "element": element})


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


def test_the_retired_apply_route_is_gone(client, synthetic_version):
    """R4: the pre-H1 /apply was removed; revisions only come from /preview and /build."""
    s, ref = synthetic_version
    response = client.post("/apply", params={"project": ref.project, "version": ref.version,
                                              "element": s["D1"].GlobalId, "type_id": s["P90B"].GlobalId})
    assert response.status_code in (404, 405)
