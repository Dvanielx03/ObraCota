"""Quantities of the affected elements, before and after, each with its source (H1-ESPECIFICACION §6.1).

| Class | Source | ``basis`` |
|---|---|---|
| IfcDoor, IfcWindow | ``UNIT``, one unit | ifc5d does not map ``Qto_DoorBaseQuantities`` (06 §5.2) |
| others with ``Qto_*`` in the IFC | ``QTO`` | the set and quantity exported in the IFC |
| others without ``Qto_*`` | ``GEOMETRY`` | computed from the mesh, with the ``ifcopenshell.util.shape`` function named |

- With ``QTO``, the same measure is computed from the geometry too; a difference above 2 % is a
  ``QTO_MISMATCH`` warning.
- A mesh that is not closed gives ``reliable=false`` (06 §5.1): its areas and volumes are not trustworthy.
- The preview never writes ``Qto_*`` into the IFC: that would dirty the diff (06 §5.2).
- The names of a ``Qto`` set and quantity come from the file: they enter ``basis`` and the notice bounded
  (``texts.short``, §5.2). A mesh ``ifcopenshell.util.shape`` cannot measure gives no computed value.

Which measure stands for each class is a choice of this module, written in ``MEASURES``: walls by their net
side area, slabs, coverings and roofs by their area, beams, columns and members by their volume, and any
other element by its volume. ``Qto`` values are stored in the project's area or volume unit; they are
converted to SI with that unit's scale.
"""
from collections import Counter
from typing import Optional

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.shape
import ifcopenshell.util.unit
import numpy as np
from ifcopenshell.util.element import get_psets

from .errors import LIBRARY_FAILURES
from .operations.base import by_guid, finding
from .texts import bounded, short

MISMATCH = 0.02
SOURCE = "obracota_engine.quantities"

# class -> (unit, Qto quantity names in order of preference, geometric measure, words for the geometric basis)
MEASURES = {
    "IfcWall": ("M2", ("NetSideArea", "GrossSideArea"), "side_area",
                "Calculada de la geometría: util.shape.get_side_area(axis=\"Y\"), neta, una cara"),
    "IfcCurtainWall": ("M2", ("NetSideArea", "GrossSideArea"), "side_area",
                       "Calculada de la geometría: util.shape.get_side_area(axis=\"Y\"), neta, una cara"),
    "IfcSlab": ("M2", ("NetArea", "GrossArea"), "footprint",
                "Calculada de la geometría: util.shape.get_footprint_area, en planta"),
    "IfcCovering": ("M2", ("NetArea", "GrossArea"), "footprint",
                    "Calculada de la geometría: util.shape.get_footprint_area, en planta"),
    "IfcRoof": ("M2", ("NetArea", "GrossArea"), "footprint",
                "Calculada de la geometría: util.shape.get_footprint_area, en planta"),
}
VOLUME = ("M3", ("NetVolume", "GrossVolume"), "volume", "Calculada de la geometría: util.shape.get_volume")
UNIT_BASIS = {"IfcDoor": "Puerta por unidad: ifc5d no mapea Qto_DoorBaseQuantities",
              "IfcWindow": "Ventana por unidad"}
UNIT_TYPES = {"M": "LENGTHUNIT", "M2": "AREAUNIT", "M3": "VOLUMEUNIT"}


def _measure_of(element):
    for ifc_class, measure in MEASURES.items():
        if element.is_a(ifc_class):
            return measure
    return VOLUME


FAST_BASIS = "; sin restar vanos ni recortes: el cambio no altera la geometría, se mide una vez"


def _fast_settings():
    settings = ifcopenshell.geom.settings()
    # Boolean clippings and opening subtractions are what make a heritage wall take 25 s to mesh (Rame Tower).
    for name in ("disable-opening-subtractions", "disable-boolean-result"):
        try:
            settings.set(name, True)
        except (RuntimeError, ValueError, AttributeError, TypeError):
            pass
    return settings


def _shape(element, fast: bool = False):
    try:
        shape = ifcopenshell.geom.create_shape(_fast_settings() if fast else ifcopenshell.geom.settings(), element)
    except (RuntimeError, ValueError, AttributeError):
        return None
    return shape.geometry if shape.geometry.verts else None


def _closed(geometry) -> bool:
    """Every edge of the welded triangulation is shared by exactly two triangles."""
    vertices = np.round(np.asarray(geometry.verts).reshape(-1, 3), 6)
    _, welded = np.unique(vertices, axis=0, return_inverse=True)
    welded = welded.reshape(-1)
    edges = Counter()
    for a, b, c in np.asarray(geometry.faces).reshape(-1, 3):
        for edge in ((welded[a], welded[b]), (welded[b], welded[c]), (welded[c], welded[a])):
            if edge[0] != edge[1]:
                edges[tuple(sorted(edge))] += 1
    return bool(edges) and all(count == 2 for count in edges.values())


def _geometric(geometry, kind: str) -> float:
    if kind == "side_area":
        return float(ifcopenshell.util.shape.get_side_area(geometry, axis="Y"))
    if kind == "footprint":
        return float(ifcopenshell.util.shape.get_footprint_area(geometry))
    return float(ifcopenshell.util.shape.get_volume(geometry))


def _qto(model, element, names) -> Optional[tuple]:
    """(set, quantity, value in SI) of the first ``Qto_*`` quantity with one of ``names``, or None."""
    for set_name, values in sorted(get_psets(element, qtos_only=True).items()):
        if not set_name.startswith("Qto_"):
            continue
        for name in names:
            value = values.get(name)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return set_name, name, value
    return None


def _line(element, phase: str, quantity, unit: str, source: str, basis: str, reliable: bool) -> dict:
    return {"element": element.GlobalId, "phase": phase, "quantity": quantity, "unit": unit, "source": source,
            "basis": basis, "reliable": reliable}


def measure(model, element, phase: str, findings: list, fast: bool = False) -> dict:
    """The quantity line of one element in one model (``phase`` is ``before`` or ``after``).

    ``fast`` meshes without openings and booleans: for operations that leave the geometry as it was."""
    for ifc_class, basis in UNIT_BASIS.items():
        if element.is_a(ifc_class):
            return _line(element, phase, 1, "UNIT", "UNIT", basis, True)
    unit, names, kind, words = _measure_of(element)
    geometry = _shape(element, fast)
    reliable = geometry is not None and _closed(geometry)
    computed = None
    if geometry is not None:
        try:
            computed = round(_geometric(geometry, kind), 6)
        except LIBRARY_FAILURES:
            reliable = False
    exported = _qto(model, element, names)
    if exported is not None:
        set_name, name, value = exported
        quoted = f"{short(set_name)}.{short(name)}"
        scale = ifcopenshell.util.unit.calculate_unit_scale(model, unit_type=UNIT_TYPES[unit])
        value = round(value * scale, 6)
        if computed is not None and value and abs(computed - value) / abs(value) > MISMATCH:
            findings.append(finding(
                "QTO_MISMATCH",
                f"{quoted} exportado en el IFC ({value}) difiere más de un 2 % del valor calculado de la "
                f"geometría ({computed}).", SOURCE, element.GlobalId))
        return _line(element, phase, value, unit, "QTO", bounded(f"{quoted} exportado en el IFC"), reliable)
    basis = words if reliable else words + "; la malla no está cerrada: no confiable"
    if fast:
        basis += FAST_BASIS
    return _line(element, phase, computed, unit, "GEOMETRY", bounded(basis), reliable)


def lines(base, revised, guids, check=None, unchanged=frozenset()) -> tuple[list, list]:
    """Quantity lines of every affected GlobalId, before (base) and after (revision), plus their notices.

    ``check`` runs before each element: the preview's deadline. Meshing one wall of a heritage model with many
    boolean clippings can take 25 s (Rame Tower), so a long list must stop at the deadline, not after it."""
    found, findings = [], []
    for guid in guids:
        if check is not None:
            check()
        if guid in unchanged:
            # Same geometry before and after (a material or a property): measure once, fast, and reuse it.
            element = by_guid(base, guid)
            if element is not None and element.is_a("IfcElement"):
                before = measure(base, element, "before", findings, fast=True)
                found += [before, {**before, "phase": "after"}]
            continue
        for phase, model in (("before", base), ("after", revised)):
            element = by_guid(model, guid)
            if element is not None and element.is_a("IfcElement"):
                found.append(measure(model, element, phase, findings))
    return found, findings
