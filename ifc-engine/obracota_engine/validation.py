"""Layer 2: the IFC schema, with a baseline per SHA-256 (H1-ESPECIFICACION §5.7).

``ifcopenshell.validate.validate(f, json_logger(), express_rules=False)`` checks the schema without the
WHERE rules (layer 3 stays off in H1). A real model often brings its own problems (step 0: ReStage 68,
Sports Complex 195), so the layer passes when the output adds none: ``new_issues`` is what the output has
and the base does not, compared by message and by the GlobalId (or ``#id``) of the instance.

The problems of a base are computed once per SHA-256 and kept, like the open models: a base with the same
bytes always has the same problems.

A message of ``validate`` quotes values of the file, so it is untrusted text: at most 512 characters and no
control characters (``texts.clean``, §5.2). Base and output are bounded the same way before they are compared.

``subset_layer`` is the same layer for a verification by entities (``entities.py``, large models and recipes that
change no geometry): the per-instance checks of ``validate`` run only on the entities the recipe changed or added and
on the ones they reference, in the output and in the base; the rest of the file is identical to the base.
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


def _check_instance(schema, inst, logger) -> None:
    """The checks ``ifcopenshell.validate.validate`` makes on every instance of a file, on one instance: abstract
    entity, GlobalId format, attribute values (optional, derived, type, aggregates) and inverse cardinalities."""
    v = ifcopenshell.validate
    logger.set_state("instance", inst)
    logger.set_state("attribute", None)
    guid = getattr(inst, "GlobalId", None)
    if isinstance(guid, str) and (problem := v.validate_guid(guid)) is not None:
        logger.error("IfcGloballyUniqueId base64 validation: %s", problem)
    entity, attrs = v.get_entity_attributes(schema, inst.is_a())
    if entity.is_abstract():
        logger.error("Entity %s is abstract" % entity.name())
    values, invalid = [None] * len(attrs), False
    for i in range(len(attrs)):
        try:
            values[i] = inst[i]
        except Exception:  # what validate() catches: a value the parser cannot read
            logger.set_state("attribute", f"{entity.name()}.{attrs[i].name()}")
            logger.error("Invalid attribute value")
            invalid = True
    if not invalid:
        for attr, val, is_derived in zip(attrs, values, entity.derived()):
            if is_derived and not isinstance(val, ifcopenshell.ifcopenshell_wrapper.attribute_value_derived):
                logger.set_state("attribute", f"{entity.name()}.{attr.name()}")
                logger.error("Attribute is derived in subtype")
            if val is None and not attr.optional() and not is_derived:
                logger.set_state("attribute", f"{entity.name()}.{attr.name()}")
                logger.error("Attribute not optional")
            if val is not None and not is_derived:
                try:
                    v.assert_valid(attr.type_of_attribute(), val, schema, attr=attr)
                except v.ValidationError as error:
                    logger.set_state("attribute", error.attribute)
                    logger.error(str(error))
    for attr in entity.all_inverse_attributes():
        logger.set_state("attribute", f"{entity.name()}.{attr.name()}")
        try:
            val = getattr(inst, attr.name())
        except Exception as error:  # as validate(): an inverse the library cannot compute is an issue
            logger.error(str(error))
            continue
        try:
            v.assert_valid_inverse(attr, val, schema)
        except v.ValidationError as error:
            logger.error(str(error))


def instance_issues(model: ifcopenshell.file, instances) -> list:
    """The schema problems of some instances of ``model``, in the shape of ``issues``."""
    logger = ifcopenshell.validate.json_logger()
    logger.set_state("type", "schema")
    schema = ifcopenshell.ifcopenshell_wrapper.schema_by_name(model.schema_identifier)
    derived = ifcopenshell.ifcopenshell_wrapper.get_feature("use_attribute_value_derived")
    ifcopenshell.ifcopenshell_wrapper.set_feature("use_attribute_value_derived", True)
    try:
        for inst in instances:
            _check_instance(schema, inst, logger)
    finally:
        ifcopenshell.ifcopenshell_wrapper.set_feature("use_attribute_value_derived", derived)
    return [{"level": str(statement.get("level")), "message": clean(statement.get("message")),
             "instance": _where(statement), "attribute": _attribute(statement.get("attribute"))}
            for statement in logger.statements]


SUBSET_REASON = ("Se validaron las {n} entidades que la receta añadió o cambió y las que ellas referencian; el resto "
                 "del archivo es idéntico a la base, entidad por entidad, y no se volvió a validar.")


def subset_layer(base: ifcopenshell.file, output: ifcopenshell.file, delta, limit: int) -> dict:
    """Layer 2 for a verification by entities (``entities.py``): the entities that changed or were added, and the
    ones they reference or referenced (their inverse attributes may have changed), against the same entities of
    the base. A GlobalId the recipe added must not exist in the base (rule IfcRoot.UR1)."""
    from .entities import _references  # late: entities imports this package's operations
    added = set(delta.added)
    checked = set(delta.changed) | added
    for key in delta.changed + delta.added:
        checked.update(item.id() for item in _references(output.by_id(key)))
    for key in delta.changed + delta.removed:
        checked.update(item.id() for item in _references(base.by_id(key)))
    checked -= set(delta.removed)

    def present(model, keys):
        found = []
        for key in sorted(keys):
            try:
                found.append(model.by_id(key))
            except RuntimeError:
                continue
        return found

    now = instance_issues(output, present(output, checked))
    for key in sorted(added):
        inst = output.by_id(key)
        guid = getattr(inst, "GlobalId", None)
        if isinstance(guid, str) and _in(base, guid):
            now.append({"level": "Error", "message": clean(f"Rule IfcRoot.UR1: the GlobalId {guid} already exists in the base"),
                        "instance": guid, "attribute": None})
    known = instance_issues(base, present(base, checked - added))
    before = Counter(_key(item) for item in known)
    new = []
    for item in now:
        key = _key(item)
        if before[key]:
            before[key] -= 1
        else:
            new.append(item)
    return {"layer": 2, "name": NAME, "status": "PASS" if not new else "FAIL", "base_issues": len(known),
            "output_issues": len(now), "new_issues": new[:limit], "truncated": len(new) > limit,
            "entities_checked": len(checked), "reason": SUBSET_REASON.format(n=len(checked))}


def _in(model, guid: str) -> bool:
    try:
        model.by_guid(guid)
    except RuntimeError:
        return False
    return True


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
