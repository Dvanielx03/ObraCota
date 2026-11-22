"""ifc.set_property: typed properties (H1-ESPECIFICACION §5.5).

The operation writes one property of one property set, on the piece (``scope=occurrence``) or on its type
(``scope=type``). The professional decides the scope; the engine never changes it.

What ``check`` resolves, in this order (the first failure is the rejection):

1. The piece exists and is an IfcProduct; with ``scope=type`` it also has a type (``NO_TYPE``).
2. Quantities are not properties (``PSET_IS_QUANTITY``): a name starting with ``Qto_``, a schema template
   that is a quantity set, or an IfcElementQuantity of that name on the piece or its type. Existing sets
   are read with ``psets_only=True``, so a Qto never counts as an existing property set.
3. ``null`` is ``VALUE_REQUIRED``: ``edit_pset`` would delete the property (04; §5.10).
4. The set and the property are allowed: the schema template applicable to the owner's class declares them
   (``get_template(schema_identifier).get_applicable_names(class, predefined_type, pset_only=True,
   schema=fallback)``), or the property already exists in that set on the piece or on its type. If not:
   ``PROPERTY_UNKNOWN``. A predefined set (IfcDoorLiningProperties...) or a bounded, list, table or
   reference property is ``PROPERTY_NOT_EDITABLE``.
5. The IFC type comes from the existing value (the owner's first, then the other owner's), else from the
   template, else from the JSON value; ``edit_pset`` keeps an existing value's type the same way.
6. The value matches it (``VALUE_TYPE``): IfcBoolean and IfcLogical take only a JSON boolean (06 P11: the API
   would store «si» or «false» as True), text types take text, integers an integer, measures a finite
   number. Positive measures are greater than 0 and non-negative ones not below 0. Lengths arrive in metres
   and are stored in project units (``UNIT_UNDEFINED`` without a single length unit). An enumeration takes
   one of its values (``VALUE_NOT_IN_ENUM``).

``apply`` never sends ``None`` to ``edit_pset``; it sends the IFC value already built with the resolved type.
A set shared with other pieces is unshared first (``PSET_UNSHARED``), so they keep their values.

Within a recipe:

- ``scope=type`` is refused when the recipe also changes the type of that piece (``TYPE_CHANGED_IN_RECIPE``),
  in either order. ``check``, ``declare`` and ``verify`` read the base, where the piece still has its old
  type, while ``apply`` runs after the other operations: the property would land on the new type (or on the
  old one, and then the piece would leave it), and the report would name the wrong type;
- several operations may write different properties of one set of one owner (§5.4 only forbids repeating
  the same property). ``verify`` leaves out every property the recipe writes in that set of that owner, not
  only its own, when it checks that nothing else changed.
"""
import math
from dataclasses import dataclass
from typing import Optional

import ifcopenshell
import ifcopenshell.api.pset
import ifcopenshell.ifcopenshell_wrapper as wrapper
import ifcopenshell.util.pset
import ifcopenshell.util.schema
import ifcopenshell.util.unit
from ifcopenshell.util.element import get_psets, get_type, get_types

from ..texts import short
from .base import Applied, Operation, Rejected, by_guid, finding, issue

NAME = "ifc.set_property"

ELEMENT_NOT_FOUND = "La pieza no aparece en el IFC."
NOT_A_PRODUCT = "El GlobalId no corresponde a una pieza del modelo."
NO_TYPE = "La pieza no tiene tipo: la propiedad solo se puede cambiar en la pieza."
PSET_IS_QUANTITY = "Las cantidades no se editan como propiedades."
VALUE_REQUIRED = "Indica un valor: una propiedad no se vacía desde una receta."
PROPERTY_UNKNOWN = "{pset}.{prop} no está en la plantilla de {ifc_class} ni existe en la pieza o en su tipo."
PROPERTY_NOT_EDITABLE = "{pset}.{prop} no es una propiedad de valor simple o enumerado; H1 no la edita."
UNIT_UNDEFINED = "El IFC necesita una unidad de longitud definida."
VALUE_NOT_IN_ENUM = "«{value}» no es un valor de {prop}. Valores admitidos: {allowed}."
PSET_OVERRIDES_TYPE = "La pieza tendrá su propio valor; el tipo conserva el suyo."
PSET_UNSHARED = "{pset} lo compartían {n} piezas: {name} recibe su propia copia y las demás conservan sus valores."
TYPE_SCOPE_AFFECTS = "El cambio en el tipo {name} alcanza a {n} piezas; {m} tienen su propio valor y no cambian."
TYPE_CHANGED_IN_RECIPE = ("Esta receta también cambia el tipo de la pieza: cambia la propiedad en la pieza "
                          "(scope occurrence) o en el tipo con una receta aparte.")
CHANGE_TYPE = "ifc.change_type"

LENGTH = "IfcLengthMeasure"
_ENUM_LISTED = 12


@dataclass(frozen=True)
class Target:
    """What a set_property operation resolves to in one model."""

    element: ifcopenshell.entity_instance
    owner: ifcopenshell.entity_instance          # the piece, or its type with scope=type
    other: Optional[ifcopenshell.entity_instance]  # the type of the piece, or the piece with scope=type
    definition: Optional[ifcopenshell.entity_instance]  # the owner's own IfcPropertySet of that name
    shared_by: int
    own: Optional[ifcopenshell.entity_instance]    # the property in the owner's set
    inherited: Optional[ifcopenshell.entity_instance]  # the property in the type's set (scope=occurrence)
    kind: str                                     # "single" or "enum"
    ifc_type: str
    allowed: Optional[tuple]
    value: object                                 # the Python value to store, in project units


# --- Reading the model -------------------------------------------------------------------------------

def _reading():
    from .. import reading  # late: reading imports this package
    return reading


def _own_sets(owner) -> dict:
    return get_psets(owner, psets_only=True, should_inherit=False) if owner is not None else {}


def _quantity_names(owner) -> set:
    return set(get_psets(owner, qtos_only=True, should_inherit=False)) if owner is not None else set()


def _property(model, sets: dict, pset: str, name: str):
    data = sets.get(pset)
    if data is None:
        return None, None
    definition = model.by_id(data["id"])
    if not definition.is_a("IfcPropertySet"):
        return definition, None
    return definition, next((prop for prop in definition.HasProperties or () if prop.Name == name), None)


def _template_property(model, owner, pset: str, name: str):
    """The schema template of ``pset.name`` when it applies to the owner's class, else None.

    ``get_template`` takes the schema identifier; ``get_applicable_names`` also needs the (fallback) schema
    name, because it defaults to IFC4 (step 3: both signatures checked with IFC2X3 and IFC4).
    """
    templates = ifcopenshell.util.pset.get_template(model.schema_identifier)
    template = templates.get_by_name(pset)
    if template is None:
        return None, None
    schema = ifcopenshell.util.schema.get_fallback_schema(model.schema_identifier)
    applicable = templates.get_applicable_names(owner.is_a(), predefined_type=getattr(owner, "PredefinedType", None) or "",
                                                pset_only=True, schema=schema)
    if pset not in applicable:
        return template, None
    return template, next((prop for prop in template.HasPropertyTemplates or () if prop.Name == name), None)


def _shared_by(model, definition, source: str) -> int:
    return _reading()._shared_by(model, definition, source)


def _holders(model, definition) -> list:
    """Every occurrence and type that receives this very set."""
    holders = []
    for inverse in model.get_inverse(definition):
        if inverse.is_a("IfcRelDefinesByProperties"):
            holders.extend(inverse.RelatedObjects or ())
        elif inverse.is_a("IfcTypeObject"):
            holders.append(inverse)
    return holders


def _kind_of_property(prop, pset: str):
    if prop.is_a("IfcPropertySingleValue"):
        return "single", prop.NominalValue.is_a() if prop.NominalValue is not None else None, None
    if prop.is_a("IfcPropertyEnumeratedValue"):
        values = prop.EnumerationValues or ()
        reference = prop.EnumerationReference
        listed = tuple(reference.EnumerationValues or ()) if reference is not None else ()
        ifc_type = values[0].is_a() if values else (listed[0].is_a() if listed else None)
        return "enum", ifc_type, tuple(value.wrappedValue for value in listed) if listed else None
    raise Rejected("PROPERTY_NOT_EDITABLE", PROPERTY_NOT_EDITABLE.format(pset=pset, prop=prop.Name))


def _kind_of_template(template, pset: str):
    kind = template.TemplateType or "P_SINGLEVALUE"
    if kind == "P_SINGLEVALUE":
        return "single", template.PrimaryMeasureType or "IfcLabel", None
    if kind == "P_ENUMERATEDVALUE":
        listed = template.Enumerators.EnumerationValues if template.Enumerators else ()
        return "enum", template.PrimaryMeasureType or "IfcLabel", tuple(v.wrappedValue for v in listed) or None
    raise Rejected("PROPERTY_NOT_EDITABLE", PROPERTY_NOT_EDITABLE.format(pset=pset, prop=template.Name))


def _inferred(value) -> str:
    if isinstance(value, bool):
        return "IfcBoolean"
    if isinstance(value, int):
        return "IfcInteger"
    if isinstance(value, float):
        return "IfcReal"
    return "IfcLabel"


def _measure(model, ifc_type: str):
    """The primitive under an IFC defined type (``string``, ``real``, ``boolean``...) and the chain of
    defined types it goes through (IfcPositiveLengthMeasure -> IfcLengthMeasure)."""
    try:
        declaration = wrapper.schema_by_name(model.schema_identifier).declaration_by_name(ifc_type)
    except RuntimeError:
        return None, ()
    chain = []
    while declaration is not None and declaration.as_type_declaration() is not None:
        chain.append(declaration.name())
        declared = declaration.as_type_declaration().declared_type()
        if isinstance(declared, wrapper.named_type):
            declaration = declared.declared_type()
            continue
        if isinstance(declared, wrapper.simple_type):
            return declared.declared_type(), tuple(chain)
        return None, tuple(chain)
    return None, tuple(chain)


def _typed(model, op, ifc_type: str, kind: str, allowed: Optional[tuple]):
    """The Python value to store for ``op.value`` as ``ifc_type``, or the rejection."""
    value, prop = op.value, op.property
    primitive, chain = _measure(model, ifc_type)
    if primitive in ("boolean", "logical"):
        if not isinstance(value, bool):
            raise Rejected("VALUE_TYPE", f"{prop} admite solo verdadero o falso (un booleano JSON), no texto ni números.")
        typed = value
    elif primitive == "string":
        if not isinstance(value, str):
            raise Rejected("VALUE_TYPE", f"{prop} admite texto.")
        typed = value
    elif primitive == "integer":
        if isinstance(value, bool) or not (isinstance(value, int) or (isinstance(value, float) and value.is_integer())):
            raise Rejected("VALUE_TYPE", f"{prop} admite un número entero.")
        typed = int(value)
    elif primitive in ("real", "number"):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise Rejected("VALUE_TYPE", f"{prop} admite un número.")
        typed = float(value)
    else:
        raise Rejected("PROPERTY_NOT_EDITABLE", PROPERTY_NOT_EDITABLE.format(pset=op.pset, prop=prop))
    if primitive in ("integer", "real", "number"):
        if any("Positive" in name for name in chain) and typed <= 0:
            raise Rejected("VALUE_TYPE", f"{prop} tiene que ser mayor que 0.")
        if any("NonNegative" in name for name in chain) and typed < 0:
            raise Rejected("VALUE_TYPE", f"{prop} no puede ser negativo.")
        if LENGTH in chain:
            if _reading().length_unit(model) is None:
                raise Rejected("UNIT_UNDEFINED", UNIT_UNDEFINED)
            typed = typed / ifcopenshell.util.unit.calculate_unit_scale(model)
    if kind == "enum" and allowed is not None and typed not in allowed:
        listed = ", ".join(short(item) for item in allowed[:_ENUM_LISTED]) + (", …" if len(allowed) > _ENUM_LISTED else "")
        raise Rejected("VALUE_NOT_IN_ENUM", VALUE_NOT_IN_ENUM.format(value=short(value), prop=prop, allowed=listed))
    return typed


def resolve(model, op) -> Target:
    """Every precondition of the operation in ``model``, in the order of the module docstring."""
    element = by_guid(model, op.element)
    if element is None:
        raise Rejected("ELEMENT_NOT_FOUND", ELEMENT_NOT_FOUND)
    if not element.is_a("IfcProduct"):
        raise Rejected("ELEMENT_NOT_FOUND", NOT_A_PRODUCT)
    element_type = get_type(element)
    if op.scope == "type":
        if element_type is None:
            raise Rejected("NO_TYPE", NO_TYPE)
        owner, other = element_type, element
    else:
        owner, other = element, element_type

    template, template_prop = _template_property(model, owner, op.pset, op.property)
    if (op.pset.startswith("Qto_") or (template is not None and (template.TemplateType or "").startswith("QTO"))
            or op.pset in _quantity_names(owner) or op.pset in _quantity_names(other)):
        raise Rejected("PSET_IS_QUANTITY", PSET_IS_QUANTITY)
    if op.value is None:
        raise Rejected("VALUE_REQUIRED", VALUE_REQUIRED)

    definition, own = _property(model, _own_sets(owner), op.pset, op.property)
    other_definition, other_prop = _property(model, _own_sets(other), op.pset, op.property)
    for found in (definition, other_definition):
        if found is not None and not found.is_a("IfcPropertySet"):
            raise Rejected("PROPERTY_NOT_EDITABLE", PROPERTY_NOT_EDITABLE.format(pset=op.pset, prop=op.property))
    if own is None and other_prop is None and template_prop is None:
        raise Rejected("PROPERTY_UNKNOWN", PROPERTY_UNKNOWN.format(pset=op.pset, prop=op.property,
                                                                   ifc_class=owner.is_a()))

    kind, ifc_type, allowed = None, None, None
    for source in (own, other_prop):
        if source is not None:
            kind, ifc_type, allowed = _kind_of_property(source, op.pset)
            break
    if template_prop is not None:
        template_kind, template_type, template_allowed = _kind_of_template(template_prop, op.pset)
        if kind is None:
            kind, ifc_type, allowed = template_kind, template_type, template_allowed
        else:
            ifc_type = ifc_type or template_type
            if kind == "enum" and allowed is None and template_kind == "enum":
                allowed = template_allowed
    ifc_type = ifc_type or _inferred(op.value)
    value = _typed(model, op, ifc_type, kind, allowed)
    shared_by = _shared_by(model, definition, op.scope) if definition is not None else 0
    inherited = other_prop if op.scope == "occurrence" else None
    return Target(element, owner, other, definition, shared_by, own, inherited, kind, ifc_type, allowed, value)


# --- The operation -----------------------------------------------------------------------------------

def check(model, op, operations=()) -> None:
    resolve(model, op)
    if op.scope == "type" and any(other.op == CHANGE_TYPE and other.element == op.element for other in operations):
        raise Rejected("TYPE_CHANGED_IN_RECIPE", TYPE_CHANGED_IN_RECIPE)


def _owns(occurrence, pset: str, name: str) -> bool:
    return name in (_own_sets(occurrence).get(pset) or {})


def _plain(prop):
    if prop is None:
        return None
    if prop.is_a("IfcPropertySingleValue"):
        nominal = prop.NominalValue
        return _reading()._plain(nominal.wrappedValue) if nominal is not None else None
    values = prop.EnumerationValues or ()
    return _reading()._plain(values[0].wrappedValue) if values else None


def _enumerated(model, target: Target, name: str):
    """A new IfcPropertyEnumeratedValue with its enumeration, for a property the owner's set lacks."""
    reference = None
    source = target.inherited
    if source is not None and source.is_a("IfcPropertyEnumeratedValue"):
        reference = source.EnumerationReference
    if reference is None and target.allowed is not None:
        reference = model.create_entity("IfcPropertyEnumeration", Name=name, EnumerationValues=tuple(
            model.create_entity(target.ifc_type, item) for item in target.allowed))
    return model.create_entity("IfcPropertyEnumeratedValue", Name=name,
                               EnumerationValues=(model.create_entity(target.ifc_type, target.value),),
                               EnumerationReference=reference)


def apply(model, op) -> Applied:
    target = resolve(model, op)
    # Read before writing: edit_pset changes an unshared property in place.
    if target.own is not None:
        source_before, value_before = op.scope, _plain(target.own)
    elif target.inherited is not None:
        source_before, value_before = "type", _plain(target.inherited)
    else:
        source_before, value_before = "absent", None
    before = {"value_before": value_before, "source_before": source_before, "ifc_type": target.ifc_type}
    findings = []
    definition = target.definition
    name = short(target.owner.Name or target.owner.GlobalId)
    if definition is not None and target.shared_by > 1:
        definition = ifcopenshell.api.pset.unshare_pset(model, products=[target.owner], pset=definition)[0]
        findings.append(finding("PSET_UNSHARED", PSET_UNSHARED.format(pset=op.pset, n=target.shared_by, name=name),
                                "ifcopenshell.api.pset.unshare_pset", op.element))
    elif definition is None:
        definition = ifcopenshell.api.pset.add_pset(model, product=target.owner, name=op.pset)
    if target.inherited is not None and target.own is None:
        findings.append(finding("PSET_OVERRIDES_TYPE", PSET_OVERRIDES_TYPE, "ifcopenshell.api.pset.add_pset", op.element))
    if op.scope == "type":
        occurrences = list(get_types(target.owner))
        keep = sum(1 for occurrence in occurrences if _owns(occurrence, op.pset, op.property))
        findings.append(finding("TYPE_SCOPE_AFFECTS", TYPE_SCOPE_AFFECTS.format(name=name, n=len(occurrences), m=keep),
                                "ifcopenshell.util.element.get_types", op.element))

    # The property in the (possibly unshared) set: a copy keeps referencing the same property entities, and
    # edit_pset then treats a shared property as new, so the other pieces keep theirs.
    current = next((prop for prop in definition.HasProperties or () if prop.Name == op.property), None)
    if target.kind == "enum":
        if current is not None and current.is_a("IfcPropertyEnumeratedValue") and model.get_total_inverses(current) <= 1:
            value = [target.value]
        else:
            value = _enumerated(model, target, op.property)
    else:
        value = model.create_entity(target.ifc_type, target.value)
    ifcopenshell.api.pset.edit_pset(model, pset=definition, properties={op.property: value})

    after = {"value_after": _reading()._plain(op.value), "ifc_type": target.ifc_type}
    return Applied(before=before, after=after, findings=findings)


def declare(model_before, op) -> dict:
    target = resolve(model_before, op)
    if op.scope == "occurrence":
        return {op.element: ["properties_changed"]}
    return {occurrence.GlobalId: ["properties_changed"] for occurrence in get_types(target.owner)
            if occurrence.is_a("IfcElement") and not _owns(occurrence, op.pset, op.property)}


def _same(stored, expected) -> bool:
    if isinstance(expected, float) and isinstance(stored, (int, float)) and not isinstance(stored, bool):
        return math.isclose(stored, expected, rel_tol=1e-9, abs_tol=1e-12)
    return type(stored) is type(expected) and stored == expected


def _without(data: Optional[dict], names) -> dict:
    return {key: value for key, value in (data or {}).items() if key != "id" and key not in names}


def _owner(model, op):
    element = by_guid(model, op.element)
    if element is None:
        return None
    return get_type(element) if op.scope == "type" else element


def _written(base, op, operations) -> dict:
    """``{owner id: properties}`` that the set_property operations of the recipe write in ``op.pset``."""
    written = {}
    for other in (*operations, op):
        if other.op != NAME or other.pset != op.pset:
            continue
        owner = _owner(base, other)
        if owner is not None:
            written.setdefault(owner.id(), set()).add(other.property)
    return written


def verify(base, revised, op, operations=()) -> list:
    """On the reopened file: the value is the requested one with the expected IFC type, the other properties
    of that set did not change, and the pieces that shared the set keep their values. A property that another
    operation of the recipe writes in the same set of the same owner is not «another property»."""
    try:
        target = resolve(base, op)
    except Rejected as rejected:
        return [issue(rejected.code, rejected.detail)]
    written = _written(base, op, operations)
    element = by_guid(revised, op.element)
    owner = (get_type(element) if op.scope == "type" else element) if element is not None else None
    if owner is None:
        return [issue("ELEMENT_MISSING", "La pieza o su tipo no aparecen en la revisión.")]
    sets = _own_sets(owner)
    definition, prop = _property(revised, sets, op.pset, op.property)
    issues = []
    if prop is None:
        return [issue("PROPERTY_MISSING", f"{op.pset}.{op.property} no aparece en la revisión.")]
    if target.kind == "enum":
        values = (prop.EnumerationValues or ()) if prop.is_a("IfcPropertyEnumeratedValue") else ()
        stored = values[0] if len(values) == 1 else None
    else:
        stored = prop.NominalValue if prop.is_a("IfcPropertySingleValue") else None
    if stored is None or stored.is_a() != target.ifc_type or not _same(stored.wrappedValue, target.value):
        issues.append(issue("VALUE_NOT_WRITTEN", f"{op.pset}.{op.property} no quedó con el valor y el tipo pedidos."))
    if target.definition is not None:
        mine = written.get(target.owner.id(), set())
        if _without(_own_sets(target.owner).get(op.pset), mine) != _without(sets.get(op.pset), mine):
            issues.append(issue("OTHER_PROPERTIES_CHANGED", f"Cambiaron otras propiedades de {op.pset}."))
        for holder in _holders(base, target.definition):
            if holder.id() == target.owner.id():
                continue
            theirs = written.get(holder.id(), set())
            kept = by_guid(revised, holder.GlobalId)
            if kept is None or (_without(_own_sets(kept).get(op.pset), theirs)
                                != _without(_own_sets(holder).get(op.pset), theirs)):
                issues.append(issue("SHARED_PSET_CHANGED",
                                    f"{op.pset} cambió también en {short(holder.Name or holder.GlobalId)}."))
    return issues


OPERATION = Operation(NAME, check, apply, declare, verify)
