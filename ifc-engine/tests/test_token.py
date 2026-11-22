"""R3: the shared token between the backend and the engine (obracota_engine/auth.py).

With ``ENGINE_TOKEN`` set every route but /health answers 401 ``ENGINE_UNAUTHORIZED`` unless the request
carries ``Authorization: Bearer <token>``; without it the engine stays open, which the other tests rely on.
"""
import pytest
from fastapi.testclient import TestClient

import engine
from obracota_engine import auth, settings

TOKEN = "un-token-de-prueba"


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


@pytest.fixture
def guarded(monkeypatch):
    monkeypatch.setattr(settings, "ENGINE_TOKEN", TOKEN)


def refused(response):
    assert response.status_code == 401, response.text
    assert response.json() == {"detail": auth.UNAUTHORIZED, "code": "ENGINE_UNAUTHORIZED"}
    assert response.headers["www-authenticate"] == "Bearer"


def test_health_stays_open_for_the_healthcheck(client, guarded):
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer otro"}, {"Authorization": TOKEN},
                                     {"Authorization": f"Basic {TOKEN}"}, {"Authorization": f"Bearer {TOKEN} "}])
def test_every_other_route_needs_the_exact_token(client, guarded, headers):
    refused(client.get("/summary", headers=headers))
    refused(client.post("/preview", json={}, headers=headers))
    refused(client.get("/inspect", headers=headers))
    refused(client.get("/docs", headers=headers))


def test_the_right_token_reaches_the_route(client, guarded):
    # Past the guard the route validates as always: missing parameters are its own 400, not a 401.
    response = client.get("/summary", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 400 and response.json()["code"] != "ENGINE_UNAUTHORIZED", response.text


def test_without_a_token_the_engine_is_open(client, monkeypatch):
    monkeypatch.setattr(settings, "ENGINE_TOKEN", "")
    assert client.get("/summary").status_code == 400
