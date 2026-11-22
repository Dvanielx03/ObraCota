"""The recipe obracota.recipe/1 and /preview with checks_only (H1-ESPECIFICACION §5.4, §5.6).

- Shape: a malformed recipe is a 400 ``RECIPE_INVALID`` and a repeated target a 400 ``DUPLICATE_TARGET``,
  before any model is opened. Rejections of the model are data (200, ``ok=false``).
- The size limit comes first: above ``ENGINE_PREVIEW_MAX_BYTES`` /preview answers 422 ``MODEL_TOO_LARGE``
  without opening the file, also with ``checks_only``.
- ``ifc.remove_element`` is only the guard: a host with openings is ``HOST_HAS_OPENINGS``, anything else
  ``OPERATION_NOT_ENABLED``.
- The canonical hash of §5.4 ties an artifact to the normalised recipe.
"""
import copy
import json

import pytest
from fastapi.testclient import TestClient

import engine
from obracota_engine import recipe, settings, store

GUID = "1hOSvn6df7F8_7GcBWlS8Z"
TYPE = "2klOFZffH6WQFlV10uM1wF"


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def change_type(op_id="op-1", element=GUID, type_id=TYPE) -> dict:
    return {"id": op_id, "op": "ifc.change_type", "element": element, "type_id": type_id}


def set_property(op_id="op-2", element=GUID, value="EI 60", **extra) -> dict:
    return {"id": op_id, "op": "ifc.set_property", "element": element, "scope": "occurrence",
            "pset": "Pset_DoorCommon", "property": "FireRating", "value": value, **extra}


def body(operations, fmt=recipe.FORMAT) -> dict:
    return {"format": fmt, "operations": operations}


def rejected(raw) -> recipe.EngineError:
    with pytest.raises(recipe.EngineError) as caught:
        recipe.parse_recipe(raw)
    return caught.value


# --- Shape -------------------------------------------------------------------------------------------

def test_valid_recipe_parses_in_order():
    parsed = recipe.parse_recipe(body([change_type(), set_property(price_key="item:Cerradura antipánico")]))
    assert [op.id for op in parsed.operations] == ["op-1", "op-2"]
    assert parsed.operations[1].price_key == "item:Cerradura antipánico"
    assert recipe.parse_recipe(body([])).operations == ()


@pytest.mark.parametrize("value", [True, False, 3, 2.5, "EI 60", None])
def test_values_accepted(value):
    """Text, booleans and finite numbers; null passes the shape check (the operation says VALUE_REQUIRED)."""
    [op] = recipe.parse_recipe(body([set_property(value=value)])).operations
    assert op.value == value and type(op.value) is type(value)


@pytest.mark.parametrize("raw, fragment", [
    ([], "tiene que ser un objeto"),
    (body([], fmt="obracota.recipe/2"), "el formato tiene que ser obracota.recipe/1"),
    ({**body([]), "extra": 1}, "«extra» no es un campo de la receta"),
    (body("op-1"), "«operations» tiene que ser una lista"),
    (body([change_type(f"op-{i}", element=f"{i:022d}") for i in range(21)]), "como máximo 20 operaciones"),
    (body(["op-1"]), "la operación 1 tiene que ser un objeto"),
    (body([{**change_type(), "op": "ifc.move"}]), "la operación 1 no es una operación conocida"),
    (body([change_type(op_id="1")]), "el campo «id» no tiene el formato esperado"),
    (body([change_type(element="corto")]), "el campo «element» no tiene el formato esperado"),
    (body([change_type(type_id=None)]), "el campo «type_id»"),
    (body([{**change_type(), "price": 1}]), "el campo «price» no es un campo de la operación"),
    (body([{k: v for k, v in change_type().items() if k != "type_id"}]), "el campo «type_id» falta"),
    (body([set_property(value=[1])]), "el campo «value»"),
    (body([set_property(value={"text": "EI 60"})]), "el campo «value»"),
    (body([set_property(value="")]), "el campo «value»"),
    (body([set_property(value="x" * 256)]), "el campo «value»"),
    (body([set_property(value="EI\n60")]), "el campo «value»"),
    (body([set_property(value=float("nan"))]), "el campo «value»"),
    (body([set_property(value=float("inf"))]), "el campo «value»"),
    (body([{**set_property(), "scope": "project"}]), "el campo «scope» no es un valor admitido"),
    (body([{**set_property(), "pset": "Pset DoorCommon"}]), "el campo «pset» no tiene el formato esperado"),
    (body([{**set_property(), "property": "9Fire"}]), "el campo «property» no tiene el formato esperado"),
    (body([set_property(price_key="precio:1")]), "el campo «price_key» no tiene el formato esperado"),
    (body([{k: v for k, v in set_property().items() if k != "value"}]), "el campo «value» falta"),
    (body([change_type(), change_type(element="0" * 22)]), "el id op-1 está repetido"),
])
def test_shape_rejected(raw, fragment):
    error = rejected(raw)
    assert (error.status, error.code) == (400, "RECIPE_INVALID")
    assert fragment in error.detail, error.detail


def test_strict_types():
    """No coercion: a GlobalId given as a number or a boolean as text are shape errors."""
    assert rejected(body([change_type(element=12345)])).code == "RECIPE_INVALID"
    assert rejected(body([{**set_property(), "scope": 1}])).code == "RECIPE_INVALID"


@pytest.mark.parametrize("operations", [
    [change_type("op-1"), change_type("op-2", type_id="0" * 22)],
    [set_property("op-1"), set_property("op-2", value="EI 90")],
    [{"id": "op-1", "op": "ifc.remove_element", "element": GUID},
     {"id": "op-2", "op": "ifc.remove_element", "element": GUID}],
])
def test_duplicate_target(operations):
    error = rejected(body(operations))
    assert (error.status, error.code) == (400, "DUPLICATE_TARGET")
    assert error.detail == "La operación op-2 repite el destino de otra operación de la receta."


def test_distinct_targets_allowed():
    """The same piece with another scope, set or property is another target."""
    operations = [change_type("op-1"), set_property("op-2"), {**set_property("op-3"), "scope": "type"},
                  {**set_property("op-4"), "property": "AcousticRating"}]
    assert len(recipe.parse_recipe(body(operations)).operations) == 4


def test_recipe_sha256_is_canonical():
    """sha256(json.dumps(recipe, sort_keys=True, separators=(",", ":"), ensure_ascii=False)) of the normalised
    recipe: key order does not matter, an absent price_key equals null, and any value change does."""
    one = recipe.parse_recipe(body([change_type(), set_property(value="Puerta añadida")]))
    reordered = {"operations": [dict(reversed(list(change_type().items()))),
                                {**set_property(value="Puerta añadida"), "price_key": None}],
                 "format": recipe.FORMAT}
    assert recipe.recipe_sha256(one) == recipe.recipe_sha256(recipe.parse_recipe(reordered))
    expected = json.dumps(one.dump(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert "Puerta añadida" in expected
    import hashlib
    assert recipe.recipe_sha256(one) == hashlib.sha256(expected.encode()).hexdigest()
    changed = recipe.parse_recipe(body([change_type(), set_property(value="Puerta cambiada")]))
    assert recipe.recipe_sha256(changed) != recipe.recipe_sha256(one)


# --- /preview with checks_only -----------------------------------------------------------------------

def post(client, payload):
    return client.post("/preview", json=payload)


def test_preview_parameters(client, originals, synthetic):
    ref = originals.add_model(synthetic.file)
    good = {**ref.params(), "checks_only": True, "recipe": body([])}
    assert post(client, good).json() == {"ok": True, "operations": []}  # H1-1: an empty recipe is ok
    for broken, code in (({**good, "project": "../.."}, "PARAMS_INVALID"),
                         ({**good, "sha256": None}, "PARAMS_INVALID"),
                         ({**good, "checks_only": "true"}, "PARAMS_INVALID"),
                         ({**good, "otro": 1}, "PARAMS_INVALID"),
                         ({k: v for k, v in good.items() if k != "recipe"}, "RECIPE_INVALID"),
                         ({**good, "recipe": body([], fmt="x")}, "RECIPE_INVALID")):
        response = post(client, broken)
        assert response.status_code == 400 and response.json()["code"] == code, response.text
    assert post(client, [good]).status_code == 400


def test_preview_version_errors(client, originals, synthetic, model_cache):
    ref = originals.add_model(synthetic.file)
    missing = {**ref.params(), "version": "00000000-0000-4000-8000-000000000009", "checks_only": True,
               "recipe": body([])}
    assert post(client, missing).json() == {"detail": "Versión IFC no disponible.", "code": "VERSION_NOT_FOUND"}
    other = {**ref.params(), "sha256": "0" * 64, "checks_only": True, "recipe": body([])}
    response = post(client, other)
    assert response.status_code == 409 and response.json()["code"] == "SHA_MISMATCH"
    assert model_cache.opens == 0


def test_model_too_large_without_opening(client, originals, synthetic, model_cache, monkeypatch):
    """The size limit is checked before the model is opened, also with checks_only (H1-11, §5.6)."""
    ref = originals.add_model(synthetic.file)
    monkeypatch.setattr(settings, "ENGINE_PREVIEW_MAX_BYTES", 1000)
    for checks_only in (True, False):
        response = post(client, {**ref.params(), "checks_only": checks_only,
                                 "recipe": body([change_type(element=synthetic["D1"].GlobalId)])})
        assert response.status_code == 422
        assert response.json()["code"] == "MODEL_TOO_LARGE"
        assert response.json()["detail"].startswith("El modelo supera el tamaño que H1 puede verificar (")
    assert model_cache.opens == 0


def test_full_preview_without_checks_only(client, originals, synthetic, model_cache):
    """Without checks_only (the default), /preview builds and verifies (step 4): the base is the cached
    model, opened once, and the revision is opened fresh from disk (never the cached one)."""
    ref = originals.add_model(synthetic.file)
    response = post(client, {**ref.params(), "recipe": body([])})
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["ok"] is True and report["recipe_sha256"] == recipe.recipe_sha256(recipe.parse_recipe(body([])))
    assert report["base"] == {"version": ref.version, "sha256": ref.sha256, "schema": "IFC4"}
    assert model_cache.opens == 1


def test_checks_reuse_the_cached_model(client, originals, synthetic, model_cache):
    """checks_only reads the cached model (it writes nothing): two calls open the file once."""
    ref = originals.add_model(synthetic.file)
    payload = {**ref.params(), "checks_only": True,
               "recipe": body([change_type(element=synthetic["D1"].GlobalId, type_id=synthetic["P90B"].GlobalId)])}
    assert post(client, payload).json()["ok"] is True
    assert post(client, copy.deepcopy(payload)).json()["ok"] is True
    assert model_cache.opens == 1


def test_mixed_recipe_reports_each_operation(client, originals, synthetic):
    ref = originals.add_model(synthetic.file)
    door = synthetic["D1"].GlobalId
    result = post(client, {**ref.params(), "checks_only": True, "recipe": body([
        change_type("op-1", element=door, type_id=synthetic["P90B"].GlobalId),
        set_property("op-2", element=door, value=None),
        {**set_property("op-3", element=door, value="35 dB", price_key="type:" + synthetic["P90B"].GlobalId),
         "property": "AcousticRating"},
    ])}).json()
    assert result["ok"] is False
    assert [(o["id"], o["op"], o["ok"], [e["code"] for e in o["errors"]]) for o in result["operations"]] == [
        ("op-1", "ifc.change_type", True, []),
        ("op-2", "ifc.set_property", False, ["VALUE_REQUIRED"]),
        ("op-3", "ifc.set_property", True, []),
    ]
    assert {o["element"] for o in result["operations"]} == {door}


def test_remove_guard(client, originals, synthetic):
    """ifc.remove_element is a guard (06 P8): a host with openings names what it would orphan."""
    ref = originals.add_model(synthetic.file)
    result = post(client, {**ref.params(), "checks_only": True, "recipe": body([
        {"id": "op-1", "op": "ifc.remove_element", "element": synthetic["W1"].GlobalId},
        {"id": "op-2", "op": "ifc.remove_element", "element": synthetic["slab"].GlobalId},
    ])}).json()
    assert result["ok"] is False
    assert [o["errors"] for o in result["operations"]] == [
        [{"code": "HOST_HAS_OPENINGS",
          "detail": "W1 tiene 1 huecos con 1 puertas o ventanas. Borrarlo dejaría esas piezas sin anfitrión: "
                    "decide antes qué pasa con ellas."}],
        [{"code": "OPERATION_NOT_ENABLED", "detail": "Eliminar elementos llega en H5."}]]


def test_registry_flags():
    from obracota_engine.operations import REGISTRY
    assert {name: entry.enabled for name, entry in REGISTRY.items()} == {
        "ifc.change_type": True, "ifc.set_property": True, "ifc.remove_element": False}
