"""ifc.remove_element: only the guard (H1-ESPECIFICACION §5.5). H5 enables the deletion.

``remove_product`` deletes the host's openings and leaves the door floating without any ``validate``
error (06 P8). So before anything can be deleted, a host with openings is refused with what it would
orphan. Every other element is refused too, because deleting is not enabled in H1; the backend never
lets this operation into a recipe (422 ``OPERATION_NOT_ENABLED``).
"""
from ..texts import short
from .base import Applied, Operation, Rejected, by_guid

NAME = "ifc.remove_element"
NOT_ENABLED = "Eliminar elementos llega en H5."
HOST_HAS_OPENINGS = ("{name} tiene {openings} huecos con {fillings} puertas o ventanas. Borrarlo dejaría esas piezas "
                     "sin anfitrión: decide antes qué pasa con ellas.")


def check(model, op, operations=()) -> None:
    element = by_guid(model, op.element)
    if element is None or not element.is_a("IfcProduct"):
        raise Rejected("ELEMENT_NOT_FOUND", "La pieza no aparece en el IFC.")
    openings = [rel.RelatedOpeningElement for rel in getattr(element, "HasOpenings", None) or ()]
    if openings:
        fillings = sum(len(opening.HasFillings or ()) for opening in openings)
        name = short(element.Name or element.GlobalId)
        raise Rejected("HOST_HAS_OPENINGS", HOST_HAS_OPENINGS.format(name=name, openings=len(openings),
                                                                     fillings=fillings))
    raise Rejected("OPERATION_NOT_ENABLED", NOT_ENABLED)


def apply(model, op) -> Applied:
    check(model, op)  # always refuses in H1
    raise AssertionError("unreachable")


def declare(model_before, op) -> dict:
    return {}


def verify(base, revised, op, operations=()) -> list:
    return []


OPERATION = Operation(NAME, check, apply, declare, verify, enabled=False)
