"""Typed recipe operations (H1-ESPECIFICACION §5.5).

``REGISTRY`` maps each ``op`` of ``obracota.recipe/1`` to its ``Operation(check, apply, declare, verify)``:

- ``ifc.change_type``: door of equal measure (the door logic of the pre-H1 engine, moved in step 1);
- ``ifc.set_property``: typed properties;
- ``ifc.set_material``: one exterior finish for a list of pieces (H2);
- ``ifc.remove_element``: only the guard; it always refuses in H1 and the backend never enables it.

``run_checks`` is ``/preview`` with ``checks_only=true``: it runs every ``check`` on the model as it is,
writes nothing, and reports each rejection as data (``{"code", "detail"}``), never as an HTTP error (§5.2).
The checks of a recipe run against the base: each one sees the model before any operation is applied.
That is why an operation whose preconditions another operation of the same recipe changes is refused in its
``check`` (``set_property.TYPE_CHANGED_IN_RECIPE``): its checks, ``declare`` and ``verify`` would describe a
model that ``apply`` no longer sees.
"""
from . import change_type, remove_guard, set_material, set_property
from .base import Applied, Operation, Rejected

REGISTRY: dict[str, Operation] = {
    change_type.NAME: change_type.OPERATION,
    set_property.NAME: set_property.OPERATION,
    set_material.NAME: set_material.OPERATION,
    remove_guard.NAME: remove_guard.OPERATION,
}


def check_one(model, op, operations=()) -> list:
    """The rejections of one operation in ``model``, within the recipe ``operations``: an empty list when
    every precondition holds."""
    try:
        REGISTRY[op.op].check(model, op, operations)
    except Rejected as rejected:
        return [rejected.body()]
    return []


def run_checks(model, recipe) -> dict:
    """``{"ok", "operations": [{"id", "op", "ok", "element", "errors"}]}`` for every operation of the recipe.

    ``ok`` is true when every operation is; an empty recipe is ok (H1-1).
    """
    results = []
    for op in recipe.operations:
        errors = check_one(model, op, recipe.operations)
        results.append({"id": op.id, "op": op.op, "ok": not errors, "element": op.element, "errors": errors})
    return {"ok": all(result["ok"] for result in results), "operations": results}


__all__ = ["REGISTRY", "Applied", "Operation", "Rejected", "check_one", "run_checks"]
