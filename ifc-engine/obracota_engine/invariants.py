"""Layer 1, global invariants (H1-ESPECIFICACION §5.7), next to the ``verify`` of each operation.

Checked between the base and the reopened revision, whatever the recipe says:

- (a) every IfcDoor or IfcWindow that filled an opening in the base still fills **the same** opening;
- (b) no IfcOpeningElement disappears unless an operation declares it;
- (c) the placement of the doors and windows no operation declares does not change
  (``get_local_placement``, ``atol=1e-6``);
- (d) the original keeps its SHA-256. It is mounted ``:ro``, so a change means something is badly wrong:
  500 ``ORIGINAL_CHANGED`` (§5.2), never a report. The bytes are hashed again (``fresh=True``): the memo of
  ``store.sha_of`` would only compare the size and the modification time.

(a) and (b) are the defence against ``remove_product`` deleting a host's openings and leaving the door
floating without any ``validate`` error (06 P8). (c) catches a move that drags a filling along (§5.10).
"""
import numpy as np
from ifcopenshell.util.placement import get_local_placement

from . import store
from .errors import EngineError
from .texts import short
from .operations.base import by_guid

ATOL = 1e-6
FILLINGS = ("IfcDoor", "IfcWindow")


def _filled(element):
    return sorted(rel.RelatingOpeningElement.GlobalId for rel in getattr(element, "FillsVoids", None) or ())


def _name(element) -> str:
    return short(element.Name or element.GlobalId)


def _placement(element):
    if element.ObjectPlacement is None:
        return None
    try:
        return get_local_placement(element.ObjectPlacement)
    except (RuntimeError, AttributeError, ValueError):
        return None


def check(base, revised, declared: dict) -> list:
    """Issues of (a), (b) and (c): ``{code, detail, element}``. An empty list passes."""
    issues = []
    for kind in FILLINGS:
        for element in base.by_type(kind):
            before = _filled(element)
            after_element = by_guid(revised, element.GlobalId)
            if before:
                after = _filled(after_element) if after_element is not None else []
                if after != before:
                    issues.append({"code": "FILLING_CHANGED", "element": element.GlobalId,
                                   "detail": f"{_name(element)} ya no llena el mismo hueco."})
            if element.GlobalId in declared or after_element is None:
                continue
            old, new = _placement(element), _placement(after_element)
            if (old is None) != (new is None) or (old is not None and not np.allclose(old, new, atol=ATOL)):
                issues.append({"code": "PLACEMENT_CHANGED", "element": element.GlobalId,
                               "detail": f"La colocación de {_name(element)} cambió sin que la receta lo declare."})
    for opening in base.by_type("IfcOpeningElement"):
        if opening.GlobalId not in declared and by_guid(revised, opening.GlobalId) is None:
            issues.append({"code": "OPENING_LOST", "element": opening.GlobalId,
                           "detail": f"El hueco {_name(opening)} desapareció sin que la receta lo declare."})
    return issues


def require_original_unchanged(path, sha256: str) -> None:
    """(d): the original still has the SHA-256 it had when the preview started."""
    if store.sha_of(path, fresh=True) != sha256:
        raise EngineError(500, "ORIGINAL_CHANGED", "El archivo original cambió durante la vista previa.")
