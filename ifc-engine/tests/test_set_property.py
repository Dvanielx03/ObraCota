"""ifc.set_property: typed properties (H1-ESPECIFICACION §5.5; SP-1 to SP-7).

Step 3 covers every ``check`` through ``/preview`` with ``checks_only=true``, and ``apply``, ``declare`` and
``verify`` called directly on a fresh copy written and reopened from disk. Step 4 adds the full preview of
SP-1 to SP-7: the diff, layers 1, 2 and 6, the quantities and the artifact.

It also settles the two [?] of §5.5 that step 3 owns:

- the template: ``get_template(model.schema_identifier)`` and
  ``get_applicable_names(ifc_class, predefined_type, pset_only=True, schema=<fallback schema>)``. The
  ``schema`` argument defaults to IFC4, so it is passed explicitly; IFC2X3 offers Pset_DoorCommon for
  IfcDoor (PSET_OCCURRENCEDRIVEN) and nothing for IfcDoorStyle (test_template_signatures);
- ``add_pset`` in IFC2X3: ``ifc2x3_subclass`` only applies to material and profile properties. For an
  IfcDoor and an IfcDoorStyle it creates a plain IfcPropertySet (test_duplex_ifc2x3_add_pset).
"""
import ifcopenshell
import ifcopenshell.api.pset
import ifcopenshell.util.pset
import ifcopenshell.util.schema
import pytest
from fastapi.testclient import TestClient
from ifcopenshell.util.element import get_psets, get_type

import engine
from conftest import DUPLEX_DOOR, build_revision, preview, report_layer, synthetic_model
from obracota_engine import recipe, store
from obracota_engine.operations import REGISTRY, set_property


@pytest.fixture(autouse=True)
def model_cache(monkeypatch) -> store.ModelCache:
    cache = store.ModelCache()
    monkeypatch.setattr(store, "models", cache)
    return cache


@pytest.fixture(scope="module")
def client():
    return TestClient(engine.app)


def op(element, prop, value, pset="Pset_DoorCommon", scope="occurrence", op_id="op-1", **extra) -> dict:
    return {"id": op_id, "op": "ifc.set_property", "element": element, "scope": scope, "pset": pset,
            "property": prop, "value": value, **extra}


def checks(client, ref, *operations) -> dict:
    response = client.post("/preview", json={**ref.params(), "checks_only": True,
                                             "recipe": {"format": recipe.FORMAT, "operations": list(operations)}})
    assert response.status_code == 200, response.text
    return response.json()


def error_of(client, ref, operation) -> dict:
    result = checks(client, ref, operation)
    assert result["ok"] is False
    [error] = result["operations"][0]["errors"]
    return error


def parsed(raw: dict):
    return recipe.parse_operation(raw, 1)


def reopened(model: ifcopenshell.file, tmp_path) -> ifcopenshell.file:
    path = tmp_path / "revision.ifc"
    model.write(str(path))
    return ifcopenshell.open(str(path))


def copies(tmp_path, count=2):
    """The synthetic model and ``count`` copies opened from one file: same GlobalIds, independent models
    (a base to compare with and a fresh one to write on, as the preview does)."""
    source = synthetic_model()
    path = tmp_path / "base.ifc"
    source.file.write(str(path))
    return source, [ifcopenshell.open(str(path)) for _ in range(count)]


def own(product, pset="Pset_DoorCommon") -> dict:
    return {key: value for key, value in (get_psets(product, psets_only=True, should_inherit=False).get(pset) or {}).items()
            if key != "id"}


# --- check -------------------------------------------------------------------------------------------

@pytest.mark.parametrize("value", ["si", "false", "true", 1, 0.0])
def test_boolean_text_rejected(client, originals, synthetic, value):
    """SP-1: IsExternal is IfcBoolean; text or numbers would be stored as True (06 P11)."""
    ref = originals.add_model(synthetic.file)
    error = error_of(client, ref, op(synthetic["D1"].GlobalId, "IsExternal", value))
    assert error == {"code": "VALUE_TYPE",
                     "detail": "IsExternal admite solo verdadero o falso (un booleano JSON), no texto ni números."}


def test_boolean_accepted(client, originals, synthetic):
    ref = originals.add_model(synthetic.file)
    assert checks(client, ref, op(synthetic["D1"].GlobalId, "IsExternal", True))["ok"] is True


def test_null_rejected(client, originals, synthetic):
    """SP-2: null would delete the property with should_purge=True (04)."""
    ref = originals.add_model(synthetic.file)
    assert error_of(client, ref, op(synthetic["D1"].GlobalId, "IsExternal", None)) == {
        "code": "VALUE_REQUIRED", "detail": "Indica un valor: una propiedad no se vacía desde una receta."}


def test_fire_rating_label_check(client, originals, synthetic):
    """SP-4 (check): FireRating is an IfcLabel and takes text, on the piece and on the type."""
    ref = originals.add_model(synthetic.file)
    result = checks(client, ref, op(synthetic["D1"].GlobalId, "FireRating", "EI 60"),
                    op(synthetic["D1"].GlobalId, "FireRating", "EI 60", scope="type", op_id="op-2"))
    assert result["ok"] is True
    assert error_of(client, ref, op(synthetic["D1"].GlobalId, "FireRating", 60))["code"] == "VALUE_TYPE"


def enumerated_property(schema: str, ifc_class: str):
    """The first enumerated property that the schema's templates declare for the class."""
    templates = ifcopenshell.util.pset.get_template(schema)
    for template in templates.get_applicable(ifc_class, pset_only=True, schema=schema):
        for prop in template.HasPropertyTemplates or ():
            if prop.TemplateType == "P_ENUMERATEDVALUE" and prop.Enumerators:
                return template.Name, prop.Name, [value.wrappedValue for value in prop.Enumerators.EnumerationValues]
    raise AssertionError(f"no enumerated property for {ifc_class} in {schema}")


def test_unknown_and_enum(client, originals, synthetic):
    """SP-5: a property outside the template and absent from the file is PROPERTY_UNKNOWN; a value outside
    the enumeration is VALUE_NOT_IN_ENUM. The enumerated property is read from the template."""
    ref = originals.add_model(synthetic.file)
    door = synthetic["D1"].GlobalId
    assert error_of(client, ref, op(door, "Colour", "rojo"))["code"] == "PROPERTY_UNKNOWN"
    assert error_of(client, ref, op(door, "Anything", "x", pset="Obracota_Custom"))["code"] == "PROPERTY_UNKNOWN"
    pset, prop, values = enumerated_property("IFC4", "IfcDoor")
    error = error_of(client, ref, op(door, prop, "NO_ES_UN_VALOR", pset=pset))
    assert error["code"] == "VALUE_NOT_IN_ENUM"
    assert error["detail"].startswith(f"«NO_ES_UN_VALOR» no es un valor de {prop}. Valores admitidos: {values[0]}")
    assert checks(client, ref, op(door, prop, values[0], pset=pset))["ok"] is True


def test_quantity_set_rejected(client, originals, synthetic, model_cache):
    """SP-7: Qto_DoorBaseQuantities is a quantity set, not a property set; the Qto stays intact."""
    ref = originals.add_model(synthetic.file)
    door = synthetic["D1"].GlobalId
    for pset, prop in (("Qto_DoorBaseQuantities", "Width"), ("Qto_Anything", "Width")):
        assert error_of(client, ref, op(door, prop, 1.0, pset=pset)) == {
            "code": "PSET_IS_QUANTITY", "detail": "Las cantidades no se editan como propiedades."}
    model = model_cache.get(ref.project, ref.version, ref.sha256).model
    quantities = get_psets(model.by_guid(door), qtos_only=True)["Qto_DoorBaseQuantities"]
    assert quantities["Width"] == pytest.approx(0.9) and quantities["Height"] == pytest.approx(2.1)
    assert store.sha_of(ref.path) == ref.sha256


def test_element_and_type_preconditions(client, originals, synthetic):
    ref = originals.add_model(synthetic.file)
    result = checks(client, ref,
                    op("0" * 22, "FireRating", "EI 60"),
                    op(synthetic["Pset_DoorCommon"].GlobalId, "FireRating", "EI 60", op_id="op-2"),
                    op(synthetic["slab"].GlobalId, "Status", "NEW", pset="Pset_SlabCommon", scope="type", op_id="op-3"))
    assert [o["errors"][0]["code"] for o in result["operations"]] == ["ELEMENT_NOT_FOUND", "ELEMENT_NOT_FOUND", "NO_TYPE"]
    assert result["operations"][1]["errors"][0]["detail"] == "El GlobalId no corresponde a una pieza del modelo."


def test_measures(client, originals, synthetic):
    """Measures take finite numbers; positive ones must be greater than 0."""
    ref = originals.add_model(synthetic.file)
    door = synthetic["D1"].GlobalId
    assert checks(client, ref, op(door, "ThermalTransmittance", 1.8),
                  op(door, "GlazingAreaFraction", 0.25, op_id="op-2"))["ok"] is True
    assert error_of(client, ref, op(door, "GlazingAreaFraction", 0))["detail"] == "GlazingAreaFraction tiene que ser mayor que 0."
    assert error_of(client, ref, op(door, "ThermalTransmittance", "1,8"))["code"] == "VALUE_TYPE"


def test_template_signatures():
    """The [?] of §5.5 on the template: get_template takes the schema identifier and get_applicable_names
    needs the schema name too (it defaults to IFC4)."""
    for schema, type_class, type_psets in (("IFC2X3", "IfcDoorStyle", False), ("IFC4", "IfcDoorType", True)):
        templates = ifcopenshell.util.pset.get_template(schema)
        fallback = ifcopenshell.util.schema.get_fallback_schema(schema)
        assert "Pset_DoorCommon" in templates.get_applicable_names("IfcDoor", pset_only=True, schema=fallback)
        assert ("Pset_DoorCommon" in templates.get_applicable_names(type_class, pset_only=True, schema=fallback)) \
            is type_psets
        assert "Qto_DoorBaseQuantities" not in templates.get_applicable_names("IfcDoor", pset_only=True, schema=fallback)


# --- apply, declare and verify -----------------------------------------------------------------------

def test_fire_rating_label(tmp_path):
    """SP-4 (operation): FireRating="EI 60" is stored as IfcLabel on D1 only; D2 keeps "EI 30"."""
    base, (base_file, work) = copies(tmp_path)
    operation = parsed(op(base["D1"].GlobalId, "FireRating", "EI 60"))
    entry = REGISTRY["ifc.set_property"]
    assert entry.declare(base_file, operation) == {base["D1"].GlobalId: ["properties_changed"]}
    applied = entry.apply(work, operation)
    assert applied.before == {"value_before": {"text": "EI 30"}, "source_before": "occurrence", "ifc_type": "IfcLabel"}
    assert applied.after == {"value_after": {"text": "EI 60"}, "ifc_type": "IfcLabel"}
    revised = reopened(work, tmp_path)
    assert entry.verify(base_file, revised, operation) == []
    assert own(revised.by_guid(base["D1"].GlobalId)) == {"FireRating": "EI 60", "IsExternal": False}
    assert own(revised.by_guid(base["D2"].GlobalId)) == {"FireRating": "EI 30", "IsExternal": False}
    prop = next(p for p in revised.by_type("IfcPropertySingleValue") if p.NominalValue and p.NominalValue.wrappedValue == "EI 60")
    assert prop.NominalValue.is_a() == "IfcLabel"


def test_shared_pset_unshared(tmp_path):
    """SP-3: Pset_DoorCommon is shared by D1 and D2: it is unshared and the notice counts 2 pieces."""
    base, (base_file, work) = copies(tmp_path)
    operation = parsed(op(base["D1"].GlobalId, "IsExternal", True))
    applied = set_property.apply(work, operation)
    [unshared] = applied.findings
    assert unshared["rule"] == "PSET_UNSHARED" and unshared["element"] == base["D1"].GlobalId
    assert unshared["explanation"] == ("Pset_DoorCommon lo compartían 2 piezas: D1 recibe su propia copia y las demás "
                                       "conservan sus valores.")
    revised = reopened(work, tmp_path)
    assert set_property.verify(base_file, revised, operation) == []
    assert own(revised.by_guid(base["D1"].GlobalId))["IsExternal"] is True
    assert own(revised.by_guid(base["D2"].GlobalId))["IsExternal"] is False


def test_type_scope_counts(tmp_path):
    """SP-3: on type P90 the change reaches D1 and D2 (N=2). Both own a FireRating (M=2), so only a property
    they lack is declared on them."""
    base, (base_file, *works) = copies(tmp_path, 3)
    owned = parsed(op(base["D1"].GlobalId, "FireRating", "EI 90", scope="type"))
    assert set_property.declare(base_file, owned) == {}
    inherited = parsed(op(base["D1"].GlobalId, "AcousticRating", "35 dB", scope="type"))
    assert set_property.declare(base_file, inherited) == {base["D1"].GlobalId: ["properties_changed"],
                                                          base["D2"].GlobalId: ["properties_changed"]}
    for (operation, kept), work in zip(((owned, 2), (inherited, 0)), works):
        applied = set_property.apply(work, operation)
        [counts] = applied.findings
        assert counts["rule"] == "TYPE_SCOPE_AFFECTS"
        assert counts["explanation"] == f"El cambio en el tipo P90 alcanza a 2 piezas; {kept} tienen su propio valor y no cambian."
        assert applied.before["source_before"] == "absent"
        revised = reopened(work, tmp_path)
        assert set_property.verify(base_file, revised, operation) == []
        assert own(get_type(revised.by_guid(base["D1"].GlobalId)))[operation.property] == operation.value


def test_pset_overrides_type(tmp_path):
    """A set only on the type: the piece gets its own set with that property; the type keeps its value."""
    base = synthetic_model()
    type_set = ifcopenshell.api.pset.add_pset(base.file, product=base["P90B"], name="Pset_DoorCommon")
    ifcopenshell.api.pset.edit_pset(base.file, pset=type_set, properties={"AcousticRating": "30 dB"})
    path = tmp_path / "base.ifc"
    base.file.write(str(path))
    base_file, work = ifcopenshell.open(str(path)), ifcopenshell.open(str(path))
    sample = base["S-P90B"].GlobalId
    operation = parsed(op(sample, "AcousticRating", "40 dB"))
    applied = set_property.apply(work, operation)
    assert [found["rule"] for found in applied.findings] == ["PSET_OVERRIDES_TYPE"]
    assert applied.findings[0]["explanation"] == "La pieza tendrá su propio valor; el tipo conserva el suyo."
    assert applied.before == {"value_before": {"text": "30 dB"}, "source_before": "type", "ifc_type": "IfcLabel"}
    revised = reopened(work, tmp_path)
    assert set_property.verify(base_file, revised, operation) == []
    assert own(revised.by_guid(sample)) == {"AcousticRating": "40 dB"}
    assert own(get_type(revised.by_guid(sample))) == {"AcousticRating": "30 dB"}


def test_enumerated_value_written(tmp_path):
    base, (base_file, work) = copies(tmp_path)
    pset, prop, values = enumerated_property("IFC4", "IfcDoor")
    operation = parsed(op(base["D1"].GlobalId, prop, values[1], pset=pset))
    set_property.apply(work, operation)
    revised = reopened(work, tmp_path)
    assert set_property.verify(base_file, revised, operation) == []
    assert own(revised.by_guid(base["D1"].GlobalId), pset)[prop] == [values[1]]


@pytest.mark.parametrize("length_unit, stored", [("METRE", 0.85), ("MILLIMETRE", 850.0)])
def test_length_in_metres(tmp_path, length_unit, stored):
    """Lengths arrive in metres and are stored in project units, with the existing value's IFC type."""
    base = synthetic_model(length_unit)
    custom = ifcopenshell.api.pset.add_pset(base.file, product=base["D1"], name="Obracota_Holgura")
    ifcopenshell.api.pset.edit_pset(base.file, pset=custom, properties={
        "Clearance": base.file.create_entity("IfcPositiveLengthMeasure", 0.9 / base.scale)})
    path = tmp_path / "base.ifc"
    base.file.write(str(path))
    base_file, work = ifcopenshell.open(str(path)), ifcopenshell.open(str(path))
    operation = parsed(op(base["D1"].GlobalId, "Clearance", 0.85, pset="Obracota_Holgura"))
    set_property.apply(work, operation)
    revised = reopened(work, tmp_path)
    assert set_property.verify(base_file, revised, operation) == []
    assert own(revised.by_guid(base["D1"].GlobalId), "Obracota_Holgura")["Clearance"] == pytest.approx(stored)
    with pytest.raises(set_property.Rejected) as rejected:
        set_property.check(base_file, parsed(op(base["D1"].GlobalId, "Clearance", -1, pset="Obracota_Holgura")))
    assert rejected.value.code == "VALUE_TYPE"


def test_verify_catches_a_wrong_revision(tmp_path):
    base, (base_file, untouched, both) = copies(tmp_path, 3)
    operation = parsed(op(base["D1"].GlobalId, "FireRating", "EI 60"))
    assert [found["code"] for found in set_property.verify(base_file, reopened(untouched, tmp_path), operation)] \
        == ["VALUE_NOT_WRITTEN"]
    # Editing the shared set in place changes D2 too.
    shared = both.by_guid(base["Pset_DoorCommon"].GlobalId)
    ifcopenshell.api.pset.edit_pset(both, pset=shared, properties={"FireRating": "EI 60"})
    assert [found["code"] for found in set_property.verify(base_file, reopened(both, tmp_path), operation)] \
        == ["SHARED_PSET_CHANGED"]


# --- IFC2X3: the Duplex ------------------------------------------------------------------------------

def test_duplex_ifc2x3(client, duplex, duplex_path, tmp_path):
    """SP-6: Pset_DoorCommon.FireRating in IFC2X3 is accepted and written as IfcLabel."""
    assert checks(client, duplex, op(DUPLEX_DOOR, "FireRating", "EI 60"))["ok"] is True
    assert error_of(client, duplex, op(DUPLEX_DOOR, "IsExternal", "si"))["code"] == "VALUE_TYPE"
    base, work = ifcopenshell.open(str(duplex_path)), ifcopenshell.open(str(duplex_path))
    operation = parsed(op(DUPLEX_DOOR, "FireRating", "EI 60"))
    applied = set_property.apply(work, operation)
    assert applied.before == {"value_before": {"text": "Fire Rating"}, "source_before": "occurrence", "ifc_type": "IfcLabel"}
    revised = reopened(work, tmp_path)
    assert set_property.verify(base, revised, operation) == []
    assert own(revised.by_guid(DUPLEX_DOOR))["FireRating"] == "EI 60"
    assert store.sha_of(duplex.path) == duplex.sha256


def test_duplex_ifc2x3_add_pset(client, duplex, duplex_path, tmp_path):
    """The [?] of add_pset in IFC2X3: a new set on the door and on its IfcDoorStyle is a plain
    IfcPropertySet (ifc2x3_subclass only matters for material and profile properties)."""
    glazing = op(DUPLEX_DOOR, "GlassLayers", 2, pset="Pset_DoorWindowGlazingType")
    on_type = op(DUPLEX_DOOR, "FireRating", "EI 30", scope="type", op_id="op-2")
    assert checks(client, duplex, glazing, on_type)["ok"] is True
    base, work = ifcopenshell.open(str(duplex_path)), ifcopenshell.open(str(duplex_path))
    for raw in (glazing, on_type):
        set_property.apply(work, parsed(raw))
    revised = reopened(work, tmp_path)
    for raw in (glazing, on_type):
        assert set_property.verify(base, revised, parsed(raw)) == []
    door = revised.by_guid(DUPLEX_DOOR)
    sets = get_psets(door, psets_only=True, should_inherit=False)
    assert revised.by_id(sets["Pset_DoorWindowGlazingType"]["id"]).is_a() == "IfcPropertySet"
    assert sets["Pset_DoorWindowGlazingType"]["GlassLayers"] == 2
    style = get_type(door)
    assert style.is_a("IfcDoorStyle")
    assert [definition.is_a() for definition in style.HasPropertySets if definition.Name == "Pset_DoorCommon"] \
        == ["IfcPropertySet"]


# --- Full preview (step 4) ---------------------------------------------------------------------------

def changed_guids(report: dict) -> dict:
    return {entry["guid"]: entry["flags"] for entry in report["diff"]["changed"]}


@pytest.mark.parametrize("value, code", [("si", "VALUE_TYPE"), ("false", "VALUE_TYPE"), ("true", "VALUE_TYPE"),
                                         (None, "VALUE_REQUIRED")])
def test_rejected_values_preview(client, originals, synthetic, artifact_store, value, code):
    """SP-1 and SP-2 in the full preview: ok=false, the code of the operation and no artifact."""
    report = preview(client, originals.add_model(synthetic.file), op(synthetic["D1"].GlobalId, "IsExternal", value))
    assert report["ok"] is False and "artifact" not in report
    assert report["operations"][0]["errors"][0]["code"] == code
    assert list(artifact_store.iterdir()) == []


def test_shared_pset_unshared_preview(client, originals, synthetic):
    """SP-3 (occurrence): the shared set is unshared; only D1 changes, D2 keeps its value."""
    report = preview(client, originals.add_model(synthetic.file), op(synthetic["D1"].GlobalId, "IsExternal", True))
    assert report["ok"] is True, report["errors"]
    assert changed_guids(report) == {synthetic["D1"].GlobalId: ["properties_changed"]}
    assert [finding["rule"] for finding in report["findings"]] == ["PSET_UNSHARED"]


def test_type_scope_counts_preview(client, originals, synthetic):
    """SP-3 (type): AcousticRating on P90 reaches D1 and D2 (N=2, M=0). Both are declared and both are the
    only changes; the type itself is not an IfcElement and does not enter the diff."""
    d1, d2 = synthetic["D1"].GlobalId, synthetic["D2"].GlobalId
    report = preview(client, originals.add_model(synthetic.file), op(d1, "AcousticRating", "35 dB", scope="type"))
    assert report["ok"] is True, report["errors"]
    assert changed_guids(report) == {d1: ["properties_changed"], d2: ["properties_changed"]}
    assert all(entry["declared"] for entry in report["diff"]["changed"])
    assert sorted(item["guid"] for item in report["affected"]) == sorted([d1, d2])
    [counts] = report["findings"]
    assert counts["explanation"] == "El cambio en el tipo P90 alcanza a 2 piezas; 0 tienen su propio valor y no cambian."


def test_fire_rating_label_preview(client, originals, synthetic, tmp_path):
    """SP-4: FireRating="EI 60" is an IfcLabel; only D1 shows properties_changed; no new schema issue."""
    ref = originals.add_model(synthetic.file)
    operation = op(synthetic["D1"].GlobalId, "FireRating", "EI 60")
    report = preview(client, ref, operation)
    assert report["ok"] is True
    assert changed_guids(report) == {synthetic["D1"].GlobalId: ["properties_changed"]}
    assert report_layer(report, 2)["new_issues"] == []
    [operation_report] = report["operations"]
    assert operation_report["after"] == {"value_after": {"text": "EI 60"}, "ifc_type": "IfcLabel"}
    built = build_revision(client, ref, [operation], report["artifact"]["id"])
    assert built.status_code == 200
    path = tmp_path / "built.ifc"
    path.write_bytes(built.content)
    revised = ifcopenshell.open(str(path))
    assert own(revised.by_guid(synthetic["D1"].GlobalId))["FireRating"] == "EI 60"
    assert own(revised.by_guid(synthetic["D2"].GlobalId))["FireRating"] == "EI 30"


def test_unknown_and_enum_preview(client, originals, synthetic):
    """SP-5 in the full preview: PROPERTY_UNKNOWN and VALUE_NOT_IN_ENUM leave ok=false."""
    ref = originals.add_model(synthetic.file)
    pset, prop, _ = enumerated_property("IFC4", "IfcDoor")
    report = preview(client, ref, op(synthetic["D1"].GlobalId, "Colour", "rojo"),
                     op(synthetic["D1"].GlobalId, prop, "NO_ES_UN_VALOR", pset=pset, op_id="op-2"))
    assert report["ok"] is False
    assert [o["errors"][0]["code"] for o in report["operations"]] == ["PROPERTY_UNKNOWN", "VALUE_NOT_IN_ENUM"]


def test_duplex_ifc2x3_preview(client, duplex, no_temporaries):
    """SP-6: Pset_DoorCommon.FireRating on the Duplex (IFC2X3) is ok in the full preview."""
    report = preview(client, duplex, op(DUPLEX_DOOR, "FireRating", "EI 60"))
    assert report["ok"] is True, report["errors"]
    assert changed_guids(report) == {DUPLEX_DOOR: ["properties_changed"]}
    assert report_layer(report, 2)["new_issues"] == []
    assert store.sha_of(duplex.path) == duplex.sha256


def test_quantity_set_rejected_preview(client, originals, synthetic, artifact_store):
    """SP-7 in the full preview: PSET_IS_QUANTITY, ok=false, no artifact and the Qto intact."""
    ref = originals.add_model(synthetic.file)
    report = preview(client, ref, op(synthetic["D1"].GlobalId, "Width", 1.0, pset="Qto_DoorBaseQuantities"))
    assert report["ok"] is False and "artifact" not in report
    assert report["operations"][0]["errors"][0]["code"] == "PSET_IS_QUANTITY"
    assert store.sha_of(ref.path) == ref.sha256 and list(artifact_store.iterdir()) == []

# --- Several operations in one recipe ----------------------------------------------------------------

def change_type_op(element, type_id, op_id) -> dict:
    return {"id": op_id, "op": "ifc.change_type", "element": element, "type_id": type_id}


def built_file(client, ref, operations, report, tmp_path) -> ifcopenshell.file:
    built = build_revision(client, ref, operations, report["artifact"]["id"])
    assert built.status_code == 200 and built.headers["X-ObraCota-Rebuilt"] == "false"
    path = tmp_path / "built.ifc"
    path.write_bytes(built.content)
    return ifcopenshell.open(str(path))


def test_two_properties_of_one_shared_set_preview(client, originals, synthetic, tmp_path):
    """FireRating and IsExternal on D1's shared Pset_DoorCommon: two different properties of one set (§5.4
    only forbids the same one twice). Neither counts the other's as «another property»; D2 stays intact."""
    ref = originals.add_model(synthetic.file)
    d1, d2 = synthetic["D1"].GlobalId, synthetic["D2"].GlobalId
    operations = [op(d1, "FireRating", "EI 60"), op(d1, "IsExternal", True, op_id="op-2")]
    report = preview(client, ref, *operations)
    assert report["ok"] is True, (report["errors"], report_layer(report, 1)["issues"])
    assert report_layer(report, 1)["issues"] == []
    assert changed_guids(report) == {d1: ["properties_changed"]}
    revised = built_file(client, ref, operations, report, tmp_path)
    assert own(revised.by_guid(d1)) == {"FireRating": "EI 60", "IsExternal": True}
    assert own(revised.by_guid(d2)) == {"FireRating": "EI 30", "IsExternal": False}


def test_two_pieces_of_one_shared_set_preview(client, originals, synthetic, tmp_path):
    """D1 and D2 share the set and each one writes its own property: the other piece's change is not
    SHARED_PSET_CHANGED, and each keeps the value the other wrote out of its copy."""
    ref = originals.add_model(synthetic.file)
    d1, d2 = synthetic["D1"].GlobalId, synthetic["D2"].GlobalId
    operations = [op(d1, "FireRating", "EI 60"), op(d2, "IsExternal", True, op_id="op-2")]
    report = preview(client, ref, *operations)
    assert report["ok"] is True, (report["errors"], report_layer(report, 1)["issues"])
    assert changed_guids(report) == {d1: ["properties_changed"], d2: ["properties_changed"]}
    revised = built_file(client, ref, operations, report, tmp_path)
    assert own(revised.by_guid(d1)) == {"FireRating": "EI 60", "IsExternal": False}
    assert own(revised.by_guid(d2)) == {"FireRating": "EI 30", "IsExternal": True}


def test_other_properties_still_checked(tmp_path):
    """The recipe's own properties are left out, nothing else: alone, op-1 still sees IsExternal changed."""
    base, (base_file, work) = copies(tmp_path)
    first = parsed(op(base["D1"].GlobalId, "FireRating", "EI 60"))
    second = parsed(op(base["D1"].GlobalId, "IsExternal", True, op_id="op-2"))
    for operation in (first, second):
        set_property.apply(work, operation)
    revised = reopened(work, tmp_path)
    assert set_property.verify(base_file, revised, first, (first, second)) == []
    assert set_property.verify(base_file, revised, second, (first, second)) == []
    assert [found["code"] for found in set_property.verify(base_file, revised, first)] == ["OTHER_PROPERTIES_CHANGED"]


@pytest.mark.parametrize("order", ["type_first", "property_first"])
def test_type_scope_with_type_change_rejected(client, originals, synthetic, artifact_store, order):
    """scope=type on a piece whose type the same recipe changes is refused in its check, in either order:
    checks, declare and verify read the base (old type) while apply would see the new one."""
    ref = originals.add_model(synthetic.file)
    d1 = synthetic["D1"].GlobalId
    change = change_type_op(d1, synthetic["P90B"].GlobalId, "op-1")
    on_type = op(d1, "FireRating", "EI 60", scope="type", op_id="op-2")
    operations = [change, on_type] if order == "type_first" else [on_type, change]
    expected = {"code": "TYPE_CHANGED_IN_RECIPE", "detail": set_property.TYPE_CHANGED_IN_RECIPE}
    result = checks(client, ref, *operations)
    assert result["ok"] is False
    assert {o["id"]: o["errors"] for o in result["operations"]} == {"op-1": [], "op-2": [expected]}
    report = preview(client, ref, *operations)
    assert report["ok"] is False and "artifact" not in report
    assert [error["code"] for error in report["errors"]] == ["OPERATIONS_REJECTED"]
    assert list(artifact_store.iterdir()) == []


def test_type_change_with_occurrence_property_preview(client, originals, synthetic):
    """The recipe of the §5.4 example: change_type and then a property on the same piece (scope=occurrence)."""
    ref = originals.add_model(synthetic.file)
    d1 = synthetic["D1"].GlobalId
    report = preview(client, ref, change_type_op(d1, synthetic["P90B"].GlobalId, "op-1"),
                     op(d1, "FireRating", "EI 60", op_id="op-2"))
    assert report["ok"] is True, (report["errors"], report_layer(report, 1)["issues"])
    assert list(changed_guids(report)) == [d1]


def test_type_scope_on_another_piece_of_the_changed_type(client, originals, synthetic):
    """The guard is per piece: a property of P90 through D2 still goes with a type change of D1."""
    ref = originals.add_model(synthetic.file)
    result = checks(client, ref, change_type_op(synthetic["D1"].GlobalId, synthetic["P90B"].GlobalId, "op-1"),
                    op(synthetic["D2"].GlobalId, "AcousticRating", "35 dB", scope="type", op_id="op-2"))
    assert result["ok"] is True
