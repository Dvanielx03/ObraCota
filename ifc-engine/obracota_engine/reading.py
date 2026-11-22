"""Reading a stored version: /summary, /elements and /element (H1-ESPECIFICACION §5.3).

It generalises the door-only ``load()`` of the pre-H1 engine to any IfcProduct. Every reading:

- validates its parameters first (400 ``PARAMS_INVALID``, or ``SELECTOR_INVALID`` for the filters of
  /elements), because project and version become a path under ``ENGINE_ORIGINALS``;
- checks the original against its SHA-256 (404 ``VERSION_NOT_FOUND``, 409 ``SHA_MISMATCH``) and reads it
  from ``store.models``, the LRU of open read-only models, holding that model's lock. Nothing here writes;
- returns the names, ObjectType and text values of the IFC as ``{"text": ...}``, at most 512 characters
  and without control characters. They are untrusted data, never instructions (§5.2; PROPUESTA §3.0,
  invariant 5). A missing value is ``null``.

Fields named ``*_m`` are in metres whatever the project unit (``null`` when the model has no single length
unit). Property and quantity values are the stored ones, in project units, next to their IFC type.

Operations are reported as capabilities. ``ifc.change_type`` needs a door with a type that fills exactly
one opening; nothing is offered on an original above ``ENGINE_PREVIEW_MAX_BYTES`` (§5.9), although reading
it still works.
"""
import logging
import math
import re
import unicodedata
import uuid
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Optional

import ifcopenshell
import ifcopenshell.ifcopenshell_wrapper
import ifcopenshell.util.pset
import ifcopenshell.util.selector
import ifcopenshell.util.unit
from ifcopenshell.util.element import get_material, get_materials, get_parent, get_psets, get_type, get_types
from ifcopenshell.util.placement import get_local_placement
from lark.exceptions import LarkError

from . import store, texts
from .errors import LIBRARY_FAILURES, EngineError
from .operations import change_type

log = logging.getLogger(__name__)

CHANGE_TYPE = "ifc.change_type"
SET_PROPERTY = "ifc.set_property"

TEXT_MAX = texts.TEXT_MAX
ELEMENTS_LIMIT = 50
QUERY_MAX = 200
FILTER_MAX = 200

NOT_A_DOOR = "La edición se habilita para puertas IFC."
UNIT_UNDEFINED = "El IFC necesita una unidad de longitud definida."
NO_DOORS = "El modelo no tiene puertas."
DOOR_WITHOUT_TYPE = "La puerta no tiene tipo."
DOOR_WITHOUT_OPENING = "La puerta no está en un hueco."
ELEMENT_NOT_FOUND = "La pieza no aparece en el IFC."
NOT_A_PRODUCT = "El GlobalId no corresponde a una pieza del modelo."

_GLOBAL_ID = re.compile(r"[0-9A-Za-z_$]{22}")
_SHA256 = re.compile(r"[0-9a-fA-F]{64}")
_IFC_CLASS = re.compile(r"[Ii][Ff][Cc][A-Za-z0-9]{1,60}")
_CURSOR = re.compile(r"[0-9]{1,9}")
_TEMPLATE_SCHEMAS = {"IFC2X3", "IFC4", "IFC4X3"}
# What a malformed or unusual model can raise while it is read; it becomes a 422, never a 500.
_MODEL_FAILURES = LIBRARY_FAILURES


# --- Parameters --------------------------------------------------------------------------------------

@dataclass(frozen=True)
class VersionRef:
    """A stored version as the backend names it: project, version and the SHA-256 of its bytes."""

    project: str
    version: str
    sha256: str


def version_ref(project: Optional[str], version: Optional[str], sha256: Optional[str]) -> VersionRef:
    return VersionRef(_uuid("project", project), _uuid("version", version), _sha256(sha256))


def _required(name: str, value: Optional[str]) -> str:
    if value is None or not value.strip():
        raise EngineError(400, "PARAMS_INVALID", f"Falta el parámetro {name}.")
    return value.strip()


def _uuid(name: str, value: Optional[str]) -> str:
    raw = _required(name, value)
    try:
        return str(uuid.UUID(raw))  # canonical form: the folder names the backend writes
    except ValueError:
        raise EngineError(400, "PARAMS_INVALID", f"El parámetro {name} tiene que ser un UUID.") from None


def _sha256(value: Optional[str]) -> str:
    raw = _required("sha256", value)
    if not _SHA256.fullmatch(raw):
        raise EngineError(400, "PARAMS_INVALID", "El parámetro sha256 tiene que tener 64 caracteres hexadecimales.")
    return raw.lower()


def _global_id(value: Optional[str]) -> str:
    raw = _required("guid", value)
    if not _GLOBAL_ID.fullmatch(raw):
        raise EngineError(400, "PARAMS_INVALID", "El GlobalId tiene que tener 22 caracteres [0-9A-Za-z_$].")
    return raw


def _filter(name: str, value: Optional[str], maximum: int) -> Optional[str]:
    if value is None or not value.strip():
        return None
    value = value.strip()
    if len(value) > maximum:
        raise EngineError(400, "SELECTOR_INVALID", f"El filtro {name} admite como máximo {maximum} caracteres.")
    if any(unicodedata.category(ch) == "Cc" for ch in value):
        raise EngineError(400, "SELECTOR_INVALID", f"El filtro {name} no admite caracteres de control.")
    return value


def _limit(value: Optional[str]) -> int:
    if value is None or not value.strip():
        return ELEMENTS_LIMIT
    try:
        limit = int(value.strip())
    except ValueError:
        limit = 0
    if not 1 <= limit <= ELEMENTS_LIMIT:
        raise EngineError(400, "SELECTOR_INVALID", f"El límite va de 1 a {ELEMENTS_LIMIT}.")
    return limit


def _cursor(value: Optional[str]) -> int:
    """The cursor is opaque to callers; today it is the offset in the list ordered by GlobalId."""
    if value is None or not value.strip():
        return 0
    if not _CURSOR.fullmatch(value.strip()):
        raise EngineError(400, "SELECTOR_INVALID", "El cursor no es válido.")
    return int(value.strip())


# --- Untrusted text and units ------------------------------------------------------------------------

def _clean(value) -> str:
    return texts.clean(value)


def text(value) -> Optional[dict]:
    """IFC text as data: ``{"text": ...}``, at most 512 characters, control characters turned into spaces."""
    return None if value is None else {"text": _clean(value)}


def length_unit(model: ifcopenshell.file) -> Optional[dict]:
    """The project's length unit, or None unless it declares exactly one (the rule of inspect())."""
    projects = model.by_type("IfcProject")
    units_in_context = projects[0].UnitsInContext if projects else None
    units = [unit for unit in (units_in_context.Units if units_in_context else ())
             if getattr(unit, "UnitType", None) == "LENGTHUNIT"]
    if len(units) != 1:
        return None
    return {"name": ifcopenshell.util.unit.get_full_unit_name(units[0]),
            "scale": ifcopenshell.util.unit.calculate_unit_scale(model)}


def _metres(value, scale: Optional[float]) -> Optional[float]:
    if scale is None or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return round(value * scale, 6) + 0.0  # + 0.0 turns -0.0 into 0.0


def _number(value):
    """Booleans and integers as they are, finite floats; anything else (NaN, tuples...) is None."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value if isinstance(value, int) else None  # bool is an int


def _value(nominal):
    """A property value: booleans and finite numbers as they are, text as ``{"text": ...}``."""
    if nominal is None:
        return None
    return _plain(nominal.wrappedValue)


def _available(reason: Optional[str], **extra) -> dict:
    return {"available": True, **extra} if reason is None else {"available": False, "reason": reason}


@contextmanager
def _model_errors():
    try:
        yield
    except _MODEL_FAILURES as exc:
        log.info("IFC not readable for this request: %s", type(exc).__name__)
        raise EngineError(422, "MODEL_UNREADABLE", "El IFC no contiene datos suficientes para esta lectura.") from exc


# --- Spatial structure -------------------------------------------------------------------------------

def storey_of(element) -> Optional[ifcopenshell.entity_instance]:
    """The building storey above an element: through containment, aggregation, nesting, the opening it
    fills or the element its opening voids (``get_parent`` walks all of them)."""
    try:
        return get_parent(element, ifc_class="IfcBuildingStorey")
    except (RecursionError, AttributeError, RuntimeError):
        return None


def _storey_ref(storey) -> Optional[dict]:
    return {"guid": storey.GlobalId, "name": text(storey.Name)} if storey is not None else None


# --- /summary ----------------------------------------------------------------------------------------

def summary(ref: VersionRef) -> dict:
    with store.models.lease(ref.project, ref.version, ref.sha256) as lease, _model_errors():
        model = lease.model
        unit = length_unit(model)
        scale = unit["scale"] if unit else None
        doors, windows = model.by_type("IfcDoor"), model.by_type("IfcWindow")
        storeys = sorted(model.by_type("IfcBuildingStorey"),
                         key=lambda s: (s.Elevation is None, s.Elevation or 0.0, s.Name or "", s.GlobalId))
        counts = Counter(element.is_a() for element in model.by_type("IfcElement"))
        too_large = store.preview_limit_reason(lease.path)
        return {
            "schema": model.schema,
            "sha256": ref.sha256,
            "length_unit": unit,
            "storeys": [{"guid": s.GlobalId, "name": text(s.Name), "elevation_m": _metres(s.Elevation, scale)}
                        for s in storeys],
            "counts": dict(sorted(counts.items())),
            "capabilities": {
                "doors": len(doors),
                "doors_in_openings": sum(1 for door in doors if door.FillsVoids),
                "door_types_with_maps": _door_types_with_maps(model),
                "windows": len(windows),
                "windows_in_openings": sum(1 for window in windows if window.FillsVoids),
                "element_qto_sets": _element_qto_sets(model),
                "material_layer_set_usages": sum(
                    len(rel.RelatedObjects) for rel in model.by_type("IfcRelAssociatesMaterial")
                    if rel.RelatingMaterial is not None and rel.RelatingMaterial.is_a("IfcMaterialLayerSetUsage")),
                "coverings": len(model.by_type("IfcCovering")),
            },
            "operations": {
                CHANGE_TYPE: _available(too_large or _model_change_type_reason(unit, doors)),
                SET_PROPERTY: _available(too_large),
            },
            "cache": {"hit": lease.hit, "open_ms": lease.open_ms},
        }


def _model_change_type_reason(unit: Optional[dict], doors) -> Optional[str]:
    if unit is None:
        return UNIT_UNDEFINED
    if not doors:
        return NO_DOORS
    if not any(get_type(door) and change_type.opening_and_host(door)[0] for door in doors):
        return f"Ninguna puerta tiene tipo ni hueco (0 de {len(doors)})."
    return None


def _door_types_with_maps(model: ifcopenshell.file) -> int:
    types = {}
    for ifc_class in ("IfcDoorType", "IfcDoorStyle"):  # IfcDoorType does not exist in IFC2X3, nor IfcDoorStyle in IFC4X3
        try:
            types.update((door_type.id(), door_type) for door_type in model.by_type(ifc_class))
        except RuntimeError:
            continue
    return sum(1 for door_type in types.values() if door_type.RepresentationMaps)


def _element_qto_sets(model: ifcopenshell.file) -> int:
    """IfcElementQuantity sets defining at least one IfcElement (the Duplex's 21 sets are on spaces)."""
    found = set()
    for rel in model.by_type("IfcRelDefinesByProperties"):
        definitions = rel.RelatingPropertyDefinition
        definitions = definitions if isinstance(definitions, tuple) else (definitions,)
        if any(related.is_a("IfcElement") for related in rel.RelatedObjects or ()):
            found.update(d.id() for d in definitions if d is not None and d.is_a("IfcElementQuantity"))
    return len(found)


# --- /elements ---------------------------------------------------------------------------------------

def elements(ref: VersionRef, ifc_class: Optional[str] = None, name: Optional[str] = None,
             storey: Optional[str] = None, query: Optional[str] = None, limit: Optional[str] = None,
             cursor: Optional[str] = None) -> dict:
    """A page of products ordered by GlobalId. Without ``query`` nor ``ifc_class`` the list holds every
    IfcElement, openings included; ``name`` matches part of the Name and ``storey`` a storey's GlobalId or
    its whole Name, both without case."""
    ifc_class = _filter("ifc_class", ifc_class, FILTER_MAX)
    name = _filter("name", name, FILTER_MAX)
    storey = _filter("storey", storey, FILTER_MAX)
    query = _filter("query", query, QUERY_MAX)
    size, offset = _limit(limit), _cursor(cursor)
    with store.models.reading(ref.project, ref.version, ref.sha256) as model:
        product_class = _product_class(model, ifc_class) if ifc_class else None
        found = _candidates(model, product_class, query)
        with _model_errors():
            if name:
                needle = name.casefold()
                found = [element for element in found if needle in (element.Name or "").casefold()]
            if storey:
                found = [element for element in found if _in_storey(element, storey)]
            found.sort(key=lambda element: element.GlobalId)
            following = offset + size
            return {"items": [_item(element) for element in found[offset:following]],
                    "total": len(found),
                    "next_cursor": str(following) if following < len(found) else None}


def _product_class(model: ifcopenshell.file, name: str) -> str:
    if not _IFC_CLASS.fullmatch(name):
        raise EngineError(400, "SELECTOR_INVALID", "La clase IFC no es válida.")
    try:  # schema_identifier, not schema: IFC4X3 files are «IFC4X3_ADD2» in the wrapper
        declaration = ifcopenshell.ifcopenshell_wrapper.schema_by_name(model.schema_identifier).declaration_by_name(name)
    except RuntimeError:
        raise EngineError(400, "SELECTOR_INVALID", f"La clase {name} no existe en {model.schema}.") from None
    entity = declaration.as_entity()
    ancestor = entity
    while ancestor is not None and ancestor.name() != "IfcProduct":
        ancestor = ancestor.supertype()
    if ancestor is None:
        raise EngineError(400, "SELECTOR_INVALID", f"La clase {name} no es una pieza del modelo (IfcProduct).")
    return entity.name()


def _candidates(model: ifcopenshell.file, product_class: Optional[str], query: Optional[str]) -> list:
    if not query:
        return list(model.by_type(product_class or "IfcElement"))
    try:
        selected = ifcopenshell.util.selector.filter_elements(model, query)
    except (LarkError, *_MODEL_FAILURES):
        raise EngineError(400, "SELECTOR_INVALID", "El selector no es válido.") from None
    return [element for element in selected
            if element.is_a("IfcProduct") and (product_class is None or element.is_a(product_class))]


def _in_storey(element, wanted: str) -> bool:
    found = storey_of(element)
    return found is not None and (found.GlobalId == wanted or (found.Name or "").casefold() == wanted.casefold())


def _item(element) -> dict:
    element_type = get_type(element)
    return {"guid": element.GlobalId, "class": element.is_a(), "name": text(element.Name),
            "storey": _storey_ref(storey_of(element)),
            "type": {"guid": element_type.GlobalId, "name": text(element_type.Name)} if element_type else None}


# --- /element ----------------------------------------------------------------------------------------

def element(ref: VersionRef, guid: Optional[str]) -> dict:
    guid = _global_id(guid)
    with store.models.lease(ref.project, ref.version, ref.sha256) as lease:
        model = lease.model
        try:
            product = model.by_guid(guid)
        except RuntimeError:
            raise EngineError(404, "ELEMENT_NOT_FOUND", ELEMENT_NOT_FOUND) from None
        if not product.is_a("IfcProduct"):
            raise EngineError(404, "ELEMENT_NOT_FOUND", NOT_A_PRODUCT)
        with _model_errors():
            return _describe(model, product, store.preview_limit_reason(lease.path))


def _describe(model: ifcopenshell.file, product, too_large: Optional[str]) -> dict:
    unit = length_unit(model)
    scale = unit["scale"] if unit else None
    element_type = get_type(product)
    opening, host = change_type.opening_and_host(product) if product.is_a("IfcElement") else (None, None)
    return {
        "guid": product.GlobalId,
        "class": product.is_a(),
        "name": text(product.Name),
        "object_type": text(getattr(product, "ObjectType", None)),
        "predefined_type": getattr(product, "PredefinedType", None),
        "storey": _storey_ref(storey_of(product)),
        "type": _type_ref(element_type),
        "overall_m": _overall(product, scale),
        "placement": _placement(product, scale),
        "opening": {"guid": opening.GlobalId, "host": host.GlobalId if host else None,
                    "size_m": change_type.opening_dimensions(opening, product)} if opening else None,
        "host_load_bearing": change_type.portante(host) if opening else None,
        "psets": _property_sets(model, product, element_type),
        "qtos": _quantity_sets(model, product, element_type),
        "materials": _materials(product),
        "operations": {
            CHANGE_TYPE: _element_change_type(model, product, unit, element_type, opening, too_large),
            SET_PROPERTY: _available(too_large) if too_large else _available(None, templates=_templates(model, product)),
        },
    }


def _type_ref(element_type) -> Optional[dict]:
    if element_type is None:
        return None
    return {"guid": element_type.GlobalId, "class": element_type.is_a(), "name": text(element_type.Name),
            "predefined_type": getattr(element_type, "PredefinedType", None),
            "occurrences": len(get_types(element_type))}


def _overall(product, scale: Optional[float]) -> Optional[dict]:
    if scale is None or not (hasattr(product, "OverallWidth") and hasattr(product, "OverallHeight")):
        return None
    width, height = change_type.size(product, scale)
    return {"width": width, "height": height}


def _placement(product, scale: Optional[float]) -> Optional[dict]:
    """Where the product sits: the GlobalId of the product its placement is relative to, and its absolute
    origin in metres."""
    placement = product.ObjectPlacement
    if placement is None:
        return None
    parent = getattr(placement, "PlacementRelTo", None)
    places = (getattr(parent, "PlacesObject", None) or ()) if parent is not None else ()
    try:
        origin = [_metres(float(x), scale) for x in get_local_placement(placement)[:3, 3]] if scale else None
    except _MODEL_FAILURES:
        origin = None
    return {"relative_to": places[0].GlobalId if places else None, "origin_m": origin}


def _owners(product, element_type):
    yield "occurrence", product
    if element_type is not None:
        yield "type", element_type


def _shared_by(model: ifcopenshell.file, definition, source: str) -> int:
    """How many occurrences (or types, for a type's set) receive this very set."""
    if source == "type":
        return sum(1 for holder in model.get_inverse(definition) if holder.is_a("IfcTypeObject"))
    return sum(len(rel.RelatedObjects or ()) for rel in model.get_inverse(definition)
               if rel.is_a("IfcRelDefinesByProperties"))


def _property_sets(model: ifcopenshell.file, product, element_type) -> list:
    """Psets of the occurrence and of its type, separately (``should_inherit=False``, as portante() reads),
    so that each value shows where it comes from. Quantity sets never appear here (``psets_only``)."""
    found = []
    for source, owner in _owners(product, element_type):
        for name, data in sorted(get_psets(owner, psets_only=True, should_inherit=False).items()):
            definition = model.by_id(data["id"])
            if definition.is_a("IfcPropertySet"):
                properties = [_property(prop) for prop in definition.HasProperties or ()]
            else:  # predefined property sets (IfcDoorLiningProperties...): attributes, without IFC type
                properties = [{"name": _clean(key), "value": _plain(value), "ifc_type": None}
                              for key, value in data.items() if key != "id"]
            found.append({"name": _clean(name), "source": source, "shared_by": _shared_by(model, definition, source),
                          "properties": sorted(properties, key=lambda prop: prop["name"])})
    return found


def _property(prop) -> dict:
    name = _clean(prop.Name)
    if prop.is_a("IfcPropertySingleValue"):
        nominal = prop.NominalValue
        return {"name": name, "value": _value(nominal), "ifc_type": nominal.is_a() if nominal is not None else None}
    values = None
    if prop.is_a("IfcPropertyEnumeratedValue"):
        values = prop.EnumerationValues
    elif prop.is_a("IfcPropertyListValue"):
        values = prop.ListValues
    if values is not None:
        return {"name": name, "value": [_value(value) for value in values],
                "ifc_type": values[0].is_a() if values else None}
    return {"name": name, "value": None, "ifc_type": prop.is_a()}  # bounded, table, reference, complex


def _plain(value):
    if isinstance(value, (bool, int, float)):
        return _number(value)
    return text(value) if isinstance(value, str) else None


def _quantity_sets(model: ifcopenshell.file, product, element_type) -> list:
    found = []
    for source, owner in _owners(product, element_type):
        for name, data in sorted(get_psets(owner, qtos_only=True, should_inherit=False).items()):
            definition = model.by_id(data["id"])
            quantities = [{"name": _clean(quantity.Name),
                           "value": _number(quantity[3]) if quantity.is_a("IfcPhysicalSimpleQuantity") else None,
                           "ifc_type": quantity.is_a()}
                          for quantity in getattr(definition, "Quantities", None) or ()]
            found.append({"name": _clean(name), "source": source, "shared_by": _shared_by(model, definition, source),
                          "quantities": sorted(quantities, key=lambda quantity: quantity["name"])})
    return found


def _materials(product) -> list:
    definition = get_material(product, should_skip_usage=False, should_inherit=True)
    if definition is None:
        return []
    own = get_material(product, should_skip_usage=False, should_inherit=False)
    entry = {"kind": definition.is_a(), "name": text(_material_name(definition)),
             "source": "occurrence" if own is not None else "type"}
    if not definition.is_a("IfcMaterial"):
        entry["materials"] = [text(material.Name) for material in get_materials(product, should_inherit=True)
                              if material is not None]
    return [entry]


def _material_name(definition) -> Optional[str]:
    if definition.is_a("IfcMaterialLayerSetUsage"):
        definition = definition.ForLayerSet
    elif definition.is_a("IfcMaterialProfileSetUsage"):
        definition = definition.ForProfileSet
    for attribute in ("Name", "LayerSetName"):
        value = getattr(definition, attribute, None)
        if value:
            return value
    return None


def _element_change_type(model, product, unit, element_type, opening, too_large) -> dict:
    reason = (too_large
              or (None if product.is_a("IfcDoor") else NOT_A_DOOR)
              or (UNIT_UNDEFINED if unit is None else None)
              or (DOOR_WITHOUT_TYPE if element_type is None else None)
              or (DOOR_WITHOUT_OPENING if opening is None else None))
    if reason:
        return _available(reason)
    return _available(None, options=change_type.inspect(model, product)["options"])


def _templates(model: ifcopenshell.file, product) -> list:
    """Standard property set templates that the schema declares for the product's class."""
    schema = model.schema
    if schema not in _TEMPLATE_SCHEMAS:
        return []
    predefined = getattr(product, "PredefinedType", None) or ""
    names = ifcopenshell.util.pset.get_template(schema).get_applicable_names(
        product.is_a(), predefined_type=predefined, pset_only=True, schema=schema)
    return sorted(set(names))
