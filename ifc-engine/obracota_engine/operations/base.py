"""What every recipe operation shares (H1-ESPECIFICACION §5.5).

An operation has four functions:

- ``check(model, op, operations=())``: preconditions, writing nothing. Each failed precondition raises ``Rejected``; the
  registry turns it into ``{"code", "detail"}``, a rejection inside the recipe (data, not an HTTP error).
- ``apply(model, op) -> Applied``: writes on a model opened fresh from disk, never the cached one.
- ``declare(model_before, op) -> {GlobalId: [allowed flags]}``: the changes the scope rule accepts.
- ``verify(base, revised, op, operations=()) -> [issue]``: layer 1 checks on the reopened file; an empty list passes.

Flags are IfcDiff's (``type_changed``, ``geometry_changed``, ``properties_changed``...) plus
``attributes:<Name>`` for one attribute that may change.

``check`` and ``verify`` also receive the whole recipe (``operations``), for the rules that depend on the
other operations: a property set two operations write, or a type the recipe changes.

Every ``detail`` and ``explanation`` is bounded here (``texts.bounded``): at most 512 characters and no
control characters, whatever IFC text it quotes (§5.2). Text from the IFC goes into a sentence through
``texts.short``, so the sentence keeps its end.
"""
from dataclasses import dataclass, field
from typing import Callable, Optional

import ifcopenshell

from ..texts import bounded

WARNING = "WARNING"


class Rejected(Exception):
    """A precondition of an operation that the model does not meet."""

    def __init__(self, code: str, detail: str):
        detail = bounded(detail)
        super().__init__(detail)
        self.code = code
        self.detail = detail

    def body(self) -> dict:
        return {"code": self.code, "detail": self.detail}


def issue(code: str, detail: str) -> dict:
    return {"code": code, "detail": bounded(detail)}


def finding(rule: str, explanation: str, source: str, element: Optional[str], status: str = WARNING) -> dict:
    """A notice in the shape the backend reads (``Finding``: rule, status, explanation, source, element)."""
    return {"rule": rule, "status": status, "explanation": bounded(explanation), "source": source, "element": element}


@dataclass
class Applied:
    """What ``apply`` did: ``before`` and ``after`` for the report, plus its notices."""

    before: dict
    after: dict
    findings: list = field(default_factory=list)


@dataclass(frozen=True)
class Operation:
    name: str
    check: Callable[..., None]                   # (model, op, operations=())
    apply: Callable[[ifcopenshell.file, object], Applied]
    declare: Callable[[ifcopenshell.file, object], dict]
    verify: Callable[..., list]                  # (base, revised, op, operations=())
    # Whether the backend may enable it. ifc.remove_element is only a guard in H1.
    enabled: bool = True


def by_guid(model: ifcopenshell.file, guid: str):
    try:
        return model.by_guid(guid)
    except RuntimeError:
        return None
