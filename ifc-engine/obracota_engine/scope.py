"""Layer 6: the scope of the change (H1-ESPECIFICACION §5.8).

1. **Declared.** The union of every operation's ``declare``: ``{GlobalId: [allowed flags]}``.
2. **First IfcDiff pass** over elements (IfcDiff leaves out IfcFeatureElement). ``relationships`` names all
   seven comparisons: in ifcdiff 0.9.0 an explicit list *replaces* the default ``["attributes", "geometry"]``
   (``ifcdiff.py:91``, step 0), so without those two nothing would compare attributes or geometry.
3. **Second IfcDiff pass** with ``filter_elements="IfcOpeningElement"``.
4. **Own opening control**, independent of IfcDiff: for every IfcOpeningElement of the base and of the
   revision, its host (``VoidsElements``), its fillings (``HasFillings``), its local placement and the box of
   its mesh, to 1e-6.
5. **Unexpected** is every changed GlobalId that is not declared or shows a flag its declaration does not
   allow, plus everything added or deleted. The same goes for openings. In H1 no operation adds, deletes or
   declares an opening.

What IfcDiff 0.9.0 really does (step 0, read in ``ifcdiff.py``), and how it is handled here:

- its flags are not exhaustive: ``diff_element_relationships`` returns at the first relationship that
  differs. The scope rule treats them as a minimum: every flag shown must be allowed;
- ``attributes_changed`` does not say which attribute changed. ``changed_attributes`` compares the scalar
  attributes itself, so ``attributes:<Name>`` can be checked one by one;
- geometry is only compared for elements with a Model/Body/MODEL_VIEW representation. The Duplex (Revit
  2011) has none: IfcDiff compares the geometry of 0 of its elements. The report says how many it compared
  (``geometry``), so «no geometry change» is never claimed for what was not looked at;
- ``diff()`` prints to stdout and disables logging; ``run_ifcdiff`` captures the first and restores the second;
- a library failure inside a pass is 422 ``MODEL_UNREADABLE`` with ``DIFF_FAILED`` (``errors.library``); a
  failure of this module's own logic stays a 500.
"""
import contextlib
import io
import logging
import math
from dataclasses import dataclass, field
from typing import Optional

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.representation
import ifcopenshell.util.selector
import numpy as np
from ifcdiff import IfcDiff
from ifcopenshell.util.placement import get_local_placement

from .errors import library
from .operations.base import by_guid

RELATIONSHIPS = ["attributes", "geometry", "type", "property", "container", "aggregate", "classification"]
OPENINGS = "IfcOpeningElement"
LIMIT = 500
ATOL = 1e-6
ATTRIBUTE_FLAG = "attributes_changed"
ATTRIBUTE_PREFIX = "attributes:"
DIFF_FAILED = "IfcDiff no pudo comparar la revisión con la base."


@dataclass
class Pass:
    """One IfcDiff pass in our own terms."""

    changed: dict = field(default_factory=dict)     # GlobalId -> sorted flags
    added: list = field(default_factory=list)
    deleted: list = field(default_factory=list)
    compared: int = 0                               # common elements IfcDiff compared at all
    geometry_compared: int = 0                      # ... and of those, by geometry


def _compared_set(model, filter_elements: Optional[str]) -> set:
    """The GlobalIds IfcDiff takes from a model, with the same rule as ``IfcDiff.diff()``."""
    if filter_elements:
        return {e.GlobalId for e in ifcopenshell.util.selector.filter_elements(model, filter_elements)}
    elements = list(model.by_type("IfcElement"))
    elements += model.by_type("IfcSpatialStructureElement" if model.schema == "IFC2X3" else "IfcSpatialElement")
    return {e.GlobalId for e in elements if not e.is_a("IfcFeatureElement")}


def run_ifcdiff(base: ifcopenshell.file, revised: ifcopenshell.file, filter_elements: Optional[str] = None) -> Pass:
    """IfcDiff with the seven relationships, ``is_shallow=False``, wrapped in our own format."""
    with library(DIFF_FAILED):
        differ = IfcDiff(base, revised, relationships=list(RELATIONSHIPS), is_shallow=False,
                         filter_elements=filter_elements)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                differ.diff()
        finally:
            logging.disable(logging.NOTSET)
        common = _compared_set(base, filter_elements) & _compared_set(revised, filter_elements)
    result = Pass(added=sorted(differ.added_elements), deleted=sorted(differ.deleted_elements),
                  compared=len(common))
    result.geometry_compared = sum(
        1 for guid in common
        if ifcopenshell.util.representation.get_representation(revised.by_guid(guid), "Model", "Body", "MODEL_VIEW"))
    for guid, flags in differ.change_register.items():
        result.changed[guid] = sorted(name for name, value in flags.items() if value)
    return result


def _scalars(element) -> dict:
    info = element.get_info(include_identifier=False, recursive=False)
    return {key: value for key, value in info.items()
            if key != "type" and not isinstance(value, (tuple, ifcopenshell.entity_instance))}


def _same(old, new, precision: float) -> bool:
    if isinstance(old, float) and isinstance(new, (int, float)) and not isinstance(new, bool):
        return math.isclose(old, new, rel_tol=0, abs_tol=precision)
    return old == new


def changed_attributes(old, new, precision: float = 1e-4) -> list:
    """The scalar attributes (the ones IfcDiff compares) whose value differs between two instances."""
    before, after = _scalars(old), _scalars(new)
    return sorted(name for name in set(before) | set(after) if not _same(before.get(name), after.get(name), precision))


# --- Own opening control -----------------------------------------------------------------------------

def _host(opening) -> Optional[str]:
    voids = getattr(opening, "VoidsElements", None) or ()
    return voids[0].RelatingBuildingElement.GlobalId if len(voids) == 1 else None


def _fillings(opening) -> list:
    return sorted(rel.RelatedBuildingElement.GlobalId for rel in getattr(opening, "HasFillings", None) or ())


def _placement(opening):
    try:
        return get_local_placement(opening.ObjectPlacement) if opening.ObjectPlacement is not None else None
    except (RuntimeError, AttributeError, ValueError):
        return None


def _box(opening) -> Optional[list]:
    """The size of the box of the opening's mesh in its own coordinates, rounded to 1e-6, or None."""
    try:
        shape = ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), opening)
    except (RuntimeError, ValueError, AttributeError):
        return None
    vertices = np.asarray(shape.geometry.verts).reshape(-1, 3)
    if not len(vertices):
        return None
    return [round(float(x), 6) for x in vertices.max(axis=0) - vertices.min(axis=0)]


def _openings(model) -> dict:
    return {opening.GlobalId: opening for opening in model.by_type(OPENINGS)}


def opening_control(base, revised) -> dict:
    """``{changed: {guid: [reasons]}, added, deleted, unfilled}``; reasons are host, fillings, placement, shape."""
    old, new = _openings(base), _openings(revised)
    changed, unfilled = {}, []
    for guid in sorted(set(old) & set(new)):
        before, after = old[guid], new[guid]
        reasons = []
        if _host(before) != _host(after):
            reasons.append("host")
        if _fillings(before) != _fillings(after):
            reasons.append("fillings")
            if _fillings(before) and not _fillings(after):
                unfilled.append(guid)
        a, b = _placement(before), _placement(after)
        if (a is None) != (b is None) or (a is not None and not np.allclose(a, b, atol=ATOL)):
            reasons.append("placement")
        if _box(before) != _box(after):
            reasons.append("shape")
        if reasons:
            changed[guid] = reasons
    return {"changed": changed, "added": sorted(set(new) - set(old)), "deleted": sorted(set(old) - set(new)),
            "unfilled": unfilled}


# --- Report ------------------------------------------------------------------------------------------

def _describe(model, guid: str) -> dict:
    from . import reading  # late: reading imports the operations package
    element = by_guid(model, guid)
    if element is None:
        return {"guid": guid, "class": None, "name": None}
    return {"guid": guid, "class": element.is_a(), "name": reading.text(element.Name)}


def _allowed(flags: list, attributes: list, allow: Optional[list]) -> bool:
    if allow is None:
        return False
    for flag in flags:
        if flag == ATTRIBUTE_FLAG:
            allowed_attributes = {item[len(ATTRIBUTE_PREFIX):] for item in allow if item.startswith(ATTRIBUTE_PREFIX)}
            if not allowed_attributes or any(name not in allowed_attributes for name in attributes):
                return False
        elif flag not in allow:
            return False
    return True


def _cut(items: list, state: dict) -> list:
    if len(items) > LIMIT:
        state["truncated"] = True
    return items[:LIMIT]


def diff(base, revised, declared: Optional[dict]) -> dict:
    """The ``diff`` object of the report (§5.6). With ``declared=None`` (``/diff``, two stored versions) it
    has no ``declared`` fields and no ``unexpected`` list."""
    first = run_ifcdiff(base, revised)
    second = run_ifcdiff(base, revised, filter_elements=OPENINGS)
    own = opening_control(base, revised)
    precision = _precision(revised)
    scoped = declared is not None
    declared = declared or {}
    state = {"truncated": False}
    changed, unexpected = [], []

    for guid, flags in sorted(first.changed.items()):
        old, new = by_guid(base, guid), by_guid(revised, guid)
        attributes = changed_attributes(old, new, precision) if ATTRIBUTE_FLAG in flags and old and new else []
        entry = {**_describe(revised, guid), "flags": flags, "attributes": attributes}
        if scoped:
            entry["declared"] = _allowed(flags, attributes, declared.get(guid))
            if not entry["declared"]:
                reason = "UNDECLARED" if guid not in declared else "FLAG_NOT_ALLOWED"
                unexpected.append({**_describe(revised, guid), "reason": reason, "flags": flags,
                                   "attributes": attributes})
        changed.append(entry)
    added = [_describe(revised, guid) for guid in first.added]
    deleted = [_describe(base, guid) for guid in first.deleted]
    if scoped:
        unexpected += [{**item, "reason": "ADDED", "flags": [], "attributes": []} for item in added]
        unexpected += [{**item, "reason": "DELETED", "flags": [], "attributes": []} for item in deleted]

    opening_guids = sorted(set(own["changed"]) | set(second.changed))
    openings_changed = []
    for guid in opening_guids:
        entry = {**_describe(revised, guid), "reasons": own["changed"].get(guid, []),
                 "ifcdiff": second.changed.get(guid, [])}
        if scoped:
            entry["declared"] = guid in declared
            if not entry["declared"]:
                unexpected.append({**_describe(revised, guid), "reason": "OPENING_CHANGED",
                                   "flags": entry["ifcdiff"], "attributes": [], "reasons": entry["reasons"]})
        openings_changed.append(entry)
    openings_added = [_describe(revised, guid) for guid in sorted(set(own["added"]) | set(second.added))]
    openings_deleted = [_describe(base, guid) for guid in sorted(set(own["deleted"]) | set(second.deleted))]
    if scoped:
        unexpected += [{**item, "reason": "OPENING_ADDED", "flags": [], "attributes": []} for item in openings_added]
        unexpected += [{**item, "reason": "OPENING_DELETED", "flags": [], "attributes": []}
                       for item in openings_deleted if item["guid"] not in declared]

    result = {
        "changed": _cut(changed, state),
        "added": _cut(added, state),
        "deleted": _cut(deleted, state),
        "openings": {"changed": _cut(openings_changed, state), "added": _cut(openings_added, state),
                     "deleted": _cut(openings_deleted, state),
                     "unfilled": _cut([_describe(revised, guid) for guid in own["unfilled"]], state)},
        "relationships": list(RELATIONSHIPS),
        "geometry": {"elements_compared": first.geometry_compared, "elements": first.compared,
                     "openings_compared": second.geometry_compared, "openings": second.compared},
    }
    if scoped:
        result["unexpected"] = _cut(unexpected, state)
    result["truncated"] = state["truncated"]
    return result


def _precision(model) -> float:
    contexts = [c for c in model.by_type("IfcGeometricRepresentationContext") if c.ContextType == "Model"]
    return (contexts[0].Precision if contexts and contexts[0].Precision else None) or 1e-4


def layer(diff_report: dict) -> dict:
    """Layer 6 of the report: PASS when nothing is unexpected."""
    unexpected = diff_report.get("unexpected", [])
    return {"layer": 6, "name": "Alcance del cambio", "status": "PASS" if not unexpected else "FAIL",
            "unexpected": [item["guid"] for item in unexpected]}
