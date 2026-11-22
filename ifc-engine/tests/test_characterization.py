"""H1-9: what IfcOpenShell 0.9.0.post1 does today in the traps of §5.10 (06 annex A: P2, P3, P5, P8, P11, P16).

These tests pin library behaviour, not engine behaviour. The engine's defences rely on it: if an upgrade
changes one of these results, the test fails and the matching defence of §5.10 has to be reviewed.
All of them run on the synthetic IFC4 model of conftest.py, where D1 is placed relative to its opening H1.
"""
import ifcopenshell
import ifcopenshell.api.geometry
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.type
import ifcopenshell.api.unit
import ifcopenshell.util.element
import ifcopenshell.util.placement
import ifcopenshell.util.unit
import ifcopenshell.validate
import numpy as np
import pytest

from conftest import synthetic_model
from obracota_engine.operations.change_type import mesh

SHIFT = 0.5


def world_origin(element) -> np.ndarray:
    return ifcopenshell.util.placement.get_local_placement(element.ObjectPlacement)[:3, 3]


def nominal(pset, name):
    value = next(prop.NominalValue for prop in pset.HasProperties if prop.Name == name)
    return value.is_a(), value.wrappedValue


@pytest.mark.parametrize("moved", ["H1", "W1"])
@pytest.mark.parametrize("transform_children", [False, True])
def test_transform_children_door_follows_only_when_true(moved, transform_children):
    """P2 (move the opening) and P3 (move the wall), with D1 placed relative to H1.

    With should_transform_children=False the door keeps its world position, because the API rewrites its
    local placement to compensate. With True it follows. The opening follows its wall in both cases.
    """
    s = synthetic_model()
    door_before, opening_before = world_origin(s["D1"]).copy(), world_origin(s["H1"]).copy()
    matrix = ifcopenshell.util.placement.get_local_placement(s[moved].ObjectPlacement).copy()
    matrix[0, 3] += SHIFT

    ifcopenshell.api.geometry.edit_object_placement(
        s.file, product=s[moved], matrix=matrix, should_transform_children=transform_children)

    shift = np.array([SHIFT, 0, 0])
    assert np.allclose(world_origin(s["H1"]), opening_before + shift, atol=1e-9)
    expected_door = door_before + shift if transform_children else door_before
    assert np.allclose(world_origin(s["D1"]), expected_door, atol=1e-9)
    assert s["D1"].ObjectPlacement.PlacementRelTo == s["H1"].ObjectPlacement


def test_edit_object_placement_rewrites_the_matrix_it_receives_when_not_si():
    """§5.10: with is_si=False the API converts the caller's matrix to SI in place. H5 must pass copies."""
    s = synthetic_model("MILLIMETRE")
    matrix = np.eye(4)
    matrix[:3, 3] = (1000.0, 0.0, 3000.0)

    ifcopenshell.api.geometry.edit_object_placement(s.file, product=s["slab"], matrix=matrix, is_si=False)

    assert np.allclose(matrix[:3, 3], (1.0, 0.0, 3.0))
    assert np.allclose(world_origin(s["slab"]), (1000.0, 0.0, 3000.0))


def test_assign_type_keeps_overall():
    """P5: assign_type maps the new type's representation but leaves OverallWidth/Height untouched.

    The P100 geometry (1.05 m with its lining) no longer fits the 0.92 m opening while the attribute still
    says 0.9 m: that is why the engine sets Overall* after assign_type (§5.5).
    """
    s = synthetic_model()

    ifcopenshell.api.type.assign_type(s.file, related_objects=[s["D1"]], relating_type=s["P100"])

    door = s["D1"]
    assert ifcopenshell.util.element.get_type(door) == s["P100"]
    assert [item.is_a() for rep in door.Representation.Representations for item in rep.Items] == ["IfcMappedItem"]
    assert (door.OverallWidth, door.OverallHeight) == pytest.approx((0.9, 2.1))
    vertices = mesh(door)
    assert float(vertices[:, 0].max() - vertices[:, 0].min()) == pytest.approx(1.05, abs=1e-6)


@pytest.mark.parametrize("target, cleared", [("P90C", True), ("P90B", False)])
def test_assign_type_clears_type_attributes_7006(target, cleared):
    """Issue #7006: assign_type empties ObjectType and PredefinedType of the occurrence when the type has a
    PredefinedType other than NOTDEFINED (P90C is DOOR, P90B is NOTDEFINED). CT-2 warns about it."""
    s = synthetic_model()

    ifcopenshell.api.type.assign_type(s.file, related_objects=[s["D2"]], relating_type=s[target])

    expected = (None, None) if cleared else ("USERDEFINED", "Puerta cortafuego")
    assert (s["D2"].PredefinedType, s["D2"].ObjectType) == expected


def test_remove_host_deletes_openings_and_validate_is_silent():
    """P8: remove_product on the host also deletes its openings and leaves the door without FillsVoids,
    and validate reports nothing. That is why ifc.remove_element has the HOST_HAS_OPENINGS guard."""
    s = synthetic_model()
    opening_id = s["H1"].id()

    ifcopenshell.api.root.remove_product(s.file, product=s["W1"])

    with pytest.raises(RuntimeError):
        s.file.by_id(opening_id)
    assert len(s.file.by_guid(s["D1"].GlobalId).FillsVoids) == 0
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(s.file, logger, express_rules=False)
    assert logger.statements == []


def test_edit_pset_types_values_with_the_standard_template():
    """P11, first half: with the standard template FireRating is an IfcLabel and IsExternal an IfcBoolean."""
    s = synthetic_model()
    pset = s["Pset_DoorCommon"]

    ifcopenshell.api.pset.edit_pset(s.file, pset=pset, properties={"FireRating": "EI 60", "IsExternal": True})

    assert nominal(pset, "FireRating") == ("IfcLabel", "EI 60")
    assert nominal(pset, "IsExternal") == ("IfcBoolean", True)


@pytest.mark.parametrize("text", ["si", "false", "true", "no"])
def test_edit_pset_turns_any_text_into_true_for_a_boolean(text):
    """P11, second half: any text sent to a boolean property is stored as True, without error.
    ifc.set_property therefore demands a JSON boolean (SP-1, VALUE_TYPE)."""
    s = synthetic_model()
    pset = s["Pset_DoorCommon"]

    ifcopenshell.api.pset.edit_pset(s.file, pset=pset, properties={"IsExternal": text})

    assert nominal(pset, "IsExternal") == ("IfcBoolean", True)


def test_edit_pset_none_removes_the_property():
    """04: with should_purge=True (the default) a None value deletes the property. null is rejected (SP-2)."""
    s = synthetic_model()
    pset = s["Pset_DoorCommon"]

    ifcopenshell.api.pset.edit_pset(s.file, pset=pset, properties={"FireRating": None})

    assert [prop.Name for prop in pset.HasProperties] == ["IsExternal"]


def test_assign_unit_without_arguments_is_millimetres():
    """P16: unit.assign_unit() with no arguments picks millimetres; conftest.py sets metres explicitly."""
    model = ifcopenshell.file(schema="IFC4")
    ifcopenshell.api.root.create_entity(model, ifc_class="IfcProject")

    ifcopenshell.api.unit.assign_unit(model)

    assert ifcopenshell.util.unit.calculate_unit_scale(model) == pytest.approx(0.001)
