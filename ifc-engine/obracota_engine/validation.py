"""Layer 2: the IFC schema, with a baseline per SHA-256 (H1-ESPECIFICACION §5.7).

``ifcopenshell.validate.validate(f, json_logger(), express_rules=False)`` checks the schema without the
WHERE rules (layer 3 stays off in H1). A real model often brings its own problems (step 0: ReStage 68,
Sports Complex 195), so the layer passes when the output adds none: ``new_issues`` is what the output has
and the base does not, compared by message and by the GlobalId (or ``#id``) of the instance.

The problems of a base are computed once per SHA-256 and kept, like the open models: a base with the same
bytes always has the same problems.

A message of ``validate`` quotes values of the file, so it is untrusted text: at most 512 characters and no
control characters (``texts.clean``, §5.2). Base and output are bounded the same way before they are compared.
"""
import threading
from collections import Counter, OrderedDict

import ifcopenshell
import ifcopenshell.validate

from .texts import clean

_BASELINES_MAX = 16
_baselines: "OrderedDict[str, list]" = OrderedDict()
_guard = threading.Lock()

NAME = "Esquema IFC"


def _where(statement: dict):
    instance = statement.get("instance")
    if isinstance(instance, ifcopenshell.entity_instance):
        try:
            guid = getattr(instance, "GlobalId", None)
        except (RuntimeError, AttributeError):
            guid = None
        return guid or f"#{instance.id()}"
    return None


def issues(model: ifcopenshell.file) -> list:
    """The schema problems of ``model`` as JSON: ``{level, message, instance, attribute}``."""
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger, express_rules=False)
    return [{"level": str(statement.get("level")), "message": clean(statement.get("message")),
             "instance": _where(statement), "attribute": _attribute(statement.get("attribute"))}
            for statement in logger.statements]


def _attribute(value):
    return None if value is None else clean(value)


def baseline(sha256: str, model: ifcopenshell.file) -> list:
    """The problems of the base with this SHA-256, computed the first time and kept."""
    with _guard:
        known = _baselines.get(sha256)
        if known is not None:
            _baselines.move_to_end(sha256)
            return known
    found = issues(model)
    with _guard:
        _baselines[sha256] = found
        while len(_baselines) > _BASELINES_MAX:
            _baselines.popitem(last=False)
    return found


def clear() -> None:
    with _guard:
        _baselines.clear()


def _key(issue: dict) -> tuple:
    return issue["message"], issue["instance"], issue["attribute"]


def layer(base_sha: str, base: ifcopenshell.file, output: ifcopenshell.file, limit: int) -> dict:
    """Layer 2 of the report: PASS when the output has no problem the base did not have."""
    known = baseline(base_sha, base)
    before = Counter(_key(item) for item in known)
    found = issues(output)
    new = []
    for item in found:
        key = _key(item)
        if before[key]:
            before[key] -= 1
        else:
            new.append(item)
    return {"layer": 2, "name": NAME, "status": "PASS" if not new else "FAIL",
            "base_issues": len(known),
            "output_issues": len(found), "new_issues": new[:limit], "truncated": len(new) > limit}
