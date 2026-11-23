"""ifc.change_type: door of equal measure (H1-ESPECIFICACION §5.5).

Step 1 moves here, without changing its result, the door logic that engine.py had before H1: ``load``,
``inspect`` and the export with checks of the pre-H1 /apply (retired in R4). tests/test_inspect_contract.py pins the
result against the /inspect captured with the pre-H1 image. Step 3 builds check/apply/declare/verify
on top of these functions.

Errors are ``EngineError`` with the code that §5.5 gives them; the pre-H1 routes turn them back into
the exact status and message they had.

Step 3 adds the recipe operation on top (``check``, ``apply``, ``declare``, ``verify`` and ``OPERATION``).
Its checks are the ones of the retired /apply, in this order: the piece is an IfcDoor, the project has
exactly one length unit, the door has a type and a placement, and ``type_id`` is one of the options of
``inspect()`` and is compatible (equal measure within 1 mm, and it fits the opening).
"""
import math

import ifcopenshell
import ifcopenshell.geom
import numpy as np
from ifcopenshell.api.type import assign_type
from ifcopenshell.util.element import get_pset, get_type, get_types
from ifcopenshell.util.placement import get_local_placement
from ifcopenshell.util.unit import calculate_unit_scale

from .. import store
from ..errors import EngineError
from ..texts import clean, short
from .base import Applied, Operation, Rejected, by_guid, finding, issue

TOLERANCE = .001
NAME = "ifc.change_type"

ELEMENT_NOT_FOUND = "La pieza no aparece en el IFC."
NOT_A_DOOR = "La edición se habilita para puertas IFC."
UNIT_UNDEFINED = "El IFC necesita una unidad de longitud definida."
NO_TYPE = "La puerta no tiene tipo."
NO_PLACEMENT = "Falta la colocación de la puerta."
TYPE_NOT_AVAILABLE = ("El tipo pedido no está entre las opciones de esta puerta: tiene que ser de su misma clase, "
                      "con representación y con una sola medida entre sus puertas.")
TYPE_NOT_COMPATIBLE = "El tipo {name} no tiene la medida de la puerta o no cabe en su hueco."
# Attributes that assign_type may rewrite (#7006) and that the door keeps in step with its type.
DECLARED = ["type_changed", "geometry_changed", "properties_changed", "attributes:OverallWidth",
            "attributes:OverallHeight", "attributes:ObjectType", "attributes:PredefinedType"]
ASSIGN_TYPE_SOURCE = "ifcopenshell.api.type.assign_type · incidencia #7006"


def load(project, version, guid):
    path = store.original_path(project, version)
    if not path.is_file():
        raise EngineError(404, "VERSION_NOT_FOUND", "Versión IFC no disponible.")
    model = ifcopenshell.open(str(path), format=".ifc")
    try:
        door = model.by_guid(guid)
    except RuntimeError:
        raise EngineError(404, "ELEMENT_NOT_FOUND", "La pieza no aparece en el IFC.")
    if not door.is_a("IfcDoor"):
        raise EngineError(422, "NOT_A_DOOR", "La edición se habilita para puertas IFC.")
    return model, door


def mesh(element):
    shape = ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), element)
    return np.asarray(shape.geometry.verts).reshape(-1, 3)


def size(element, scale):
    return [round(x * scale, 6) if x and math.isfinite(x) and x > 0 else None
            for x in (element.OverallWidth, element.OverallHeight)]


def opening_and_host(door):
    fills = door.FillsVoids or ()
    if len(fills) != 1:
        return None, None
    opening = fills[0].RelatingOpeningElement
    voids = opening.VoidsElements or ()
    return opening, voids[0].RelatingBuildingElement if len(voids) == 1 else None


def opening_dimensions(opening, door):
    if opening is None:
        return None
    try:
        relation = np.linalg.solve(get_local_placement(door.ObjectPlacement),
                                   get_local_placement(opening.ObjectPlacement))[:3, :3]
        if not np.allclose(abs(relation), np.eye(3), atol=1e-6):
            return None
        vertices = mesh(opening)
        minimum, maximum = vertices.min(axis=0), vertices.max(axis=0)
        if np.any(maximum - minimum < 1e-5):
            return None
        corners = np.isclose(vertices, minimum, atol=1e-6, rtol=0) | np.isclose(vertices, maximum, atol=1e-6, rtol=0)
        if not corners.all() or len(np.unique(np.isclose(vertices, minimum, atol=1e-6, rtol=0), axis=0)) != 8:
            return None
        return [round(float(maximum[i] - minimum[i]), 6) for i in (0, 2)]
    except (RuntimeError, AttributeError, ValueError, np.linalg.LinAlgError):
        return None


def portante(host):
    if not host:
        return None
    values = []
    for part in (host, get_type(host)):
        value = get_pset(part, "Pset_WallCommon", "LoadBearing", should_inherit=False) if part else None
        if isinstance(value, bool):
            values.append(value)
    return values[0] if values and len(set(values)) == 1 else None


def inspect(model, door):
    opening, host = opening_and_host(door)
    unit = [u for u in model.by_type("IfcProject")[0].UnitsInContext.Units if getattr(u, "UnitType", None) == "LENGTHUNIT"]
    if len(unit) != 1:
        raise EngineError(422, "UNIT_UNDEFINED", "El IFC necesita una unidad de longitud definida.")
    scale = calculate_unit_scale(model)
    current = size(door, scale)
    door_type = get_type(door)
    opening_size = opening_dimensions(opening, door)
    options = []
    if door_type:
        for candidate in model.by_type(door_type.is_a()):
            if candidate == door_type or not candidate.RepresentationMaps:
                continue
            exemplars = {
                tuple(size(item, scale)) for item in get_types(candidate)
                if item.is_a("IfcDoor")
            }
            if len(exemplars) != 1 or None in next(iter(exemplars)):
                continue
            width, height = next(iter(exemplars))
            compatible = bool(opening_size and None not in current
                              and abs(width - current[0]) <= TOLERANCE
                              and abs(height - current[1]) <= TOLERANCE
                              and width <= opening_size[0] + TOLERANCE
                              and height <= opening_size[1] + TOLERANCE)
            options.append({"id": candidate.GlobalId, "name": candidate.Name or candidate.GlobalId,
                            "width": width, "height": height, "compatible": compatible})
    return {"element": door.GlobalId, "name": door.Name or door.GlobalId,
            "typeId": door_type.GlobalId if door_type else None,
            "typeName": door_type.Name if door_type else None,
            "width": current[0], "height": current[1],
            "opening": opening.GlobalId if opening else None, "openingSize": opening_size,
            "host": host.GlobalId if host else None, "loadBearing": portante(host),
            "options": sorted(options, key=lambda option: (not option["compatible"], option["name"], option["id"]))}


# --- Recipe operation (§5.5) -------------------------------------------------------------------------

def _length_units(model) -> int:
    projects = model.by_type("IfcProject")
    units = projects[0].UnitsInContext if projects else None
    return sum(1 for unit in (units.Units if units else ()) if getattr(unit, "UnitType", None) == "LENGTHUNIT")


def _door(model, op):
    door = by_guid(model, op.element)
    if door is None:
        raise Rejected("ELEMENT_NOT_FOUND", ELEMENT_NOT_FOUND)
    if not door.is_a("IfcDoor"):
        raise Rejected("NOT_A_DOOR", NOT_A_DOOR)
    return door


def _chosen(model, op):
    """The door, what inspect() says of it and the requested option, once every precondition holds.

    The placement is checked before the options: without it inspect() cannot measure the opening and every
    option would read as incompatible, which would hide the real cause.
    """
    door = _door(model, op)
    if _length_units(model) != 1:
        raise Rejected("UNIT_UNDEFINED", UNIT_UNDEFINED)
    if get_type(door) is None:
        raise Rejected("NO_TYPE", NO_TYPE)
    if door.ObjectPlacement is None:
        raise Rejected("NO_PLACEMENT", NO_PLACEMENT)
    before = inspect(model, door)
    chosen = next((item for item in before["options"] if item["id"] == op.type_id), None)
    if chosen is None:
        raise Rejected("TYPE_NOT_AVAILABLE", TYPE_NOT_AVAILABLE)
    if not chosen["compatible"]:
        raise Rejected("TYPE_NOT_COMPATIBLE", TYPE_NOT_COMPATIBLE.format(name=short(chosen["name"])))
    return door, before, chosen


def check(model, op, operations=()) -> None:
    _chosen(model, op)


def _reported(before: dict) -> dict:
    """What inspect() says, with its IFC names bounded for the report (§5.2); /inspect keeps them as they are."""
    names = {key: clean(before[key]) if before[key] is not None else None for key in ("name", "typeName")}
    options = [{**option, "name": clean(option["name"])} for option in before["options"]]
    return {**before, **names, "options": options}


def apply(model, op) -> Applied:
    """assign_type, then OverallWidth/Height in project units: assign_type does not touch them (06 P5)."""
    door, before, chosen = _chosen(model, op)
    # IfcDoor has no PredefinedType in IFC2X3.
    previous = {name: getattr(door, name, None) for name in ("ObjectType", "PredefinedType")}
    assign_type(model, related_objects=[door], relating_type=model.by_guid(op.type_id))
    scale = calculate_unit_scale(model)
    door.OverallWidth, door.OverallHeight = chosen["width"] / scale, chosen["height"] / scale
    findings = []
    cleared = {name: value for name, value in previous.items() if getattr(door, name, None) != value}
    if cleared:
        values = ", ".join(f"{name} era «{short(value)}»" if value is not None else f"{name} estaba vacío"
                           for name, value in cleared.items())
        findings.append(finding(
            "ASSIGN_TYPE_CLEARED_ATTRIBUTES",
            f"Al asignar el tipo {short(chosen['name'])} cambiaron atributos de la puerta: {values}. "
            "Revisa si la puerta debe conservarlos.",
            ASSIGN_TYPE_SOURCE, door.GlobalId))
    after = {"typeId": op.type_id, "typeName": clean(chosen["name"]), "width": chosen["width"], "height": chosen["height"]}
    return Applied(before=_reported(before), after=after, findings=findings)


def declare(model_before, op) -> dict:
    return {op.element: list(DECLARED)}


def verify(base, revised, op, operations=()) -> list:
    """The checks of the retired /apply on the reopened file: the requested type, the same opening and
    host, a non-empty mesh, the exact measure and the same placement."""
    try:
        base_door, before, chosen = _chosen(base, op)
    except Rejected as rejected:
        return [issue(rejected.code, rejected.detail)]
    door = by_guid(revised, op.element)
    if door is None or not door.is_a("IfcDoor"):
        return [issue("ELEMENT_MISSING", "La puerta no aparece en la revisión.")]
    issues = []
    door_type = get_type(door)
    if door_type is None or door_type.GlobalId != op.type_id:
        issues.append(issue("TYPE_NOT_ASSIGNED", "La puerta no quedó con el tipo pedido."))
    opening, host = opening_and_host(door)
    if (opening and opening.GlobalId) != before["opening"]:
        issues.append(issue("OPENING_CHANGED", "La puerta ya no llena el mismo hueco."))
    if (host and host.GlobalId) != before["host"]:
        issues.append(issue("HOST_CHANGED", "El hueco de la puerta ya no pertenece al mismo anfitrión."))
    try:
        empty = not len(mesh(door))
    except RuntimeError:
        empty = True
    if empty:
        issues.append(issue("MESH_EMPTY", "La puerta quedó sin geometría."))
    if size(door, calculate_unit_scale(revised)) != [chosen["width"], chosen["height"]]:
        issues.append(issue("SIZE_CHANGED", "La medida de la puerta no es la del tipo elegido."))
    if door.ObjectPlacement is None or not np.allclose(get_local_placement(base_door.ObjectPlacement),
                                                       get_local_placement(door.ObjectPlacement)):
        issues.append(issue("PLACEMENT_CHANGED", "La colocación de la puerta cambió."))
    return issues


OPERATION = Operation(NAME, check, apply, declare, verify)
