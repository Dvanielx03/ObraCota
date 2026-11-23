"""The recipe format ``obracota.recipe/1`` and the body of /preview (H1-ESPECIFICACION §5.4, §5.6).

A recipe is an ordered list of 0 to 20 typed operations. Its shape is checked here, before any model is
opened: a malformed recipe is a 400 (``RECIPE_INVALID``, or ``DUPLICATE_TARGET`` when two operations aim
at the same target). Whether the model accepts an operation is not a shape question: that is the
operation's ``check`` (``operations``), and its rejections come back as data, never as HTTP errors (§5.2).

``value`` of ``ifc.set_property`` accepts text (1 to 255 characters, no control characters), a JSON boolean
or a finite number. ``null`` passes the shape check on purpose: the operation rejects it with
``VALUE_REQUIRED`` (§5.5, §5.10), because ``edit_pset`` would delete the property. Lists and objects are
a 400.

``ifc.set_material`` (H2) carries the list of pieces (``elements``, 1 to 500, ``element`` being the first), the
material name and category of the chosen finish, its approximate colour (``#rrggbb``) and an optional price key.

``ifc.remove_element`` exists only in the engine, as the guard of §5.5; the backend never enables it.

``recipe_sha256`` ties an artifact to its recipe: the SHA-256 of the normalised recipe serialised with
sorted keys, compact separators and without ASCII escaping (§5.4). The backend keeps its own hash.
"""
import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, field_validator, model_validator

from . import reading
from .errors import EngineError

FORMAT = "obracota.recipe/1"
MAX_OPERATIONS = 20
VALUE_MAX = 255

CHANGE_TYPE = "ifc.change_type"
SET_PROPERTY = "ifc.set_property"
REMOVE_ELEMENT = "ifc.remove_element"
SET_MATERIAL = "ifc.set_material"
MATERIAL_PIECES_MAX = 500

OperationId = Annotated[str, StringConstraints(pattern=r"^op-[0-9]{1,3}$")]
GlobalId = Annotated[str, StringConstraints(pattern=r"^[0-9A-Za-z_$]{22}$")]
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")]
# The price key of §4.4: a type by its GlobalId, or a free item of up to 60 characters.
_ARTIFACT_ID = re.compile(r"[0-9a-f]{32}")
PriceKey = Annotated[str, StringConstraints(pattern=r"^(type:[0-9A-Za-z_$]{22}|item:[^\x00-\x1f]{1,60})$")]


class _Operation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    id: OperationId
    element: GlobalId


class ChangeType(_Operation):
    op: Literal["ifc.change_type"]
    type_id: GlobalId

    def target(self) -> tuple:
        return (CHANGE_TYPE, self.element)


class SetProperty(_Operation):
    op: Literal["ifc.set_property"]
    scope: Literal["occurrence", "type"]
    pset: Identifier
    property: Identifier
    # bool first: in strict mode True is never taken as an int, and 1 never as a bool.
    value: Union[bool, int, float, str, None]
    price_key: Optional[PriceKey] = None

    @field_validator("value")
    @classmethod
    def _value(cls, value):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("number must be finite")
        if isinstance(value, str):
            if not 1 <= len(value) <= VALUE_MAX:
                raise ValueError("text must have 1 to 255 characters")
            if any(unicodedata.category(ch) == "Cc" for ch in value):
                raise ValueError("text must not contain control characters")
        return value

    def target(self) -> tuple:
        return (SET_PROPERTY, self.element, self.scope, self.pset, self.property)


def _plain_text(value: str) -> str:
    if any(unicodedata.category(ch) == "Cc" for ch in value) or not value.strip():
        raise ValueError("text must not be blank or contain control characters")
    return value


class SetMaterial(_Operation):
    """``ifc.set_material``: one finish for a list of pieces (H2 material). ``element`` is the first piece of
    ``elements``, so every report that names one piece per operation keeps working."""
    op: Literal["ifc.set_material"]
    elements: list[GlobalId] = Field(min_length=1, max_length=MATERIAL_PIECES_MAX)
    material: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    category: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
    price_key: Optional[PriceKey] = None

    @field_validator("material", "category")
    @classmethod
    def _text(cls, value):
        return _plain_text(value)

    @model_validator(mode="after")
    def _pieces(self):
        if self.elements[0] != self.element:
            raise ValueError("element must be the first of elements")
        if len(set(self.elements)) != len(self.elements):
            raise ValueError("elements must not repeat")
        return self

    def target(self) -> tuple:
        return (SET_MATERIAL, *sorted(self.elements))


class RemoveElement(_Operation):
    op: Literal["ifc.remove_element"]

    def target(self) -> tuple:
        return (REMOVE_ELEMENT, self.element)


Operation = Union[ChangeType, SetProperty, SetMaterial, RemoveElement]
_MODELS = {CHANGE_TYPE: ChangeType, SET_PROPERTY: SetProperty, SET_MATERIAL: SetMaterial, REMOVE_ELEMENT: RemoveElement}


@dataclass(frozen=True)
class Recipe:
    operations: tuple

    def dump(self) -> dict:
        return {"format": FORMAT, "operations": [op.model_dump(mode="json") for op in self.operations]}


@dataclass(frozen=True)
class PreviewRequest:
    ref: reading.VersionRef
    recipe: Recipe
    checks_only: bool


def recipe_sha256(recipe: Recipe) -> str:
    canonical = json.dumps(recipe.dump(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _invalid(detail: str) -> EngineError:
    return EngineError(400, "RECIPE_INVALID", detail)


_REASONS = {
    "missing": "falta",
    "extra_forbidden": "no es un campo de la operación",
    "string_pattern_mismatch": "no tiene el formato esperado",
    "literal_error": "no es un valor admitido",
    "string_type": "tiene que ser texto",
    "too_short": "no puede estar vacío",
    "too_long": "tiene demasiados elementos",
    "string_too_long": "es demasiado largo",
    "string_too_short": "no puede estar vacío",
}


def _describe(error: dict, where: str) -> str:
    # A Union reports one error per member (``("value", "bool")``...); the field is what matters to the caller.
    field_name = reading.text(str(error["loc"][0])[:64])["text"] if error["loc"] else ""
    reason = _REASONS.get(error["type"], "no es válido")
    if field_name == "value" and error["type"] != "missing":
        reason = "tiene que ser texto de 1 a 255 caracteres sin caracteres de control, un booleano o un número finito"
    return f"Receta no válida: en {where}, el campo «{field_name}» {reason}." if field_name \
        else f"Receta no válida: {where} no es válida."


def parse_operation(raw: Any, position: int) -> Operation:
    where = f"la operación {position}"
    if not isinstance(raw, dict):
        raise _invalid(f"Receta no válida: {where} tiene que ser un objeto.")
    kind = raw.get("op")
    model = _MODELS.get(kind) if isinstance(kind, str) else None
    if model is None:
        raise _invalid(f"Receta no válida: {where} no es una operación conocida.")
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        raise _invalid(_describe(exc.errors()[0], where)) from None


def parse_recipe(raw: Any) -> Recipe:
    """The recipe of a request, with its shape checked. Raises 400 ``RECIPE_INVALID`` or ``DUPLICATE_TARGET``."""
    if not isinstance(raw, dict):
        raise _invalid("Receta no válida: tiene que ser un objeto con «format» y «operations».")
    unknown = sorted(set(raw) - {"format", "operations"})
    if unknown:
        raise _invalid(f"Receta no válida: «{reading.text(unknown[0])['text']}» no es un campo de la receta.")
    if raw.get("format") != FORMAT:
        raise _invalid(f"Receta no válida: el formato tiene que ser {FORMAT}.")
    items = raw.get("operations")
    if not isinstance(items, list):
        raise _invalid("Receta no válida: «operations» tiene que ser una lista.")
    if len(items) > MAX_OPERATIONS:
        raise _invalid(f"Receta no válida: admite como máximo {MAX_OPERATIONS} operaciones.")
    operations = tuple(parse_operation(item, index) for index, item in enumerate(items, start=1))
    ids, targets = set(), set()
    for op in operations:
        if op.id in ids:
            raise _invalid(f"Receta no válida: el id {op.id} está repetido.")
        ids.add(op.id)
        if op.target() in targets:
            raise EngineError(400, "DUPLICATE_TARGET",
                              f"La operación {op.id} repite el destino de otra operación de la receta.")
        targets.add(op.target())
    return Recipe(operations)


def _body(payload: Any, allowed: set, what: str) -> dict:
    if not isinstance(payload, dict):
        raise EngineError(400, "PARAMS_INVALID", "El cuerpo tiene que ser un objeto JSON.")
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise EngineError(400, "PARAMS_INVALID", f"«{reading.text(unknown[0])['text']}» no es un parámetro de {what}.")
    return payload


def _ref(payload: dict, project: Any = None) -> reading.VersionRef:
    values = [project if project is not None else payload.get("project"), payload.get("version"), payload.get("sha256")]
    if any(value is not None and not isinstance(value, str) for value in values):
        raise EngineError(400, "PARAMS_INVALID", "project, version y sha256 tienen que ser texto.")
    return reading.version_ref(*values)


def _recipe_of(payload: dict) -> Recipe:
    if "recipe" not in payload:
        raise _invalid("Falta la receta.")
    return parse_recipe(payload["recipe"])


def preview_request(payload: Any) -> PreviewRequest:
    """The body of /preview: ``{"project", "version", "sha256", "recipe", "checks_only": false}``."""
    payload = _body(payload, {"project", "version", "sha256", "recipe", "checks_only"}, "la vista previa")
    ref = _ref(payload)
    checks_only = payload.get("checks_only", False)
    if not isinstance(checks_only, bool):
        raise EngineError(400, "PARAMS_INVALID", "checks_only tiene que ser un booleano.")
    return PreviewRequest(ref, _recipe_of(payload), checks_only)


@dataclass(frozen=True)
class BuildRequest:
    ref: reading.VersionRef
    recipe: Recipe
    artifact: Optional[str]


def build_request(payload: Any) -> BuildRequest:
    """The body of /build: ``{"project", "version", "sha256", "recipe", "artifact": "<id>"|null}``."""
    payload = _body(payload, {"project", "version", "sha256", "recipe", "artifact"}, "la construcción")
    ref = _ref(payload)
    artifact = payload.get("artifact")
    if artifact is not None and (not isinstance(artifact, str) or not _ARTIFACT_ID.fullmatch(artifact)):
        raise EngineError(400, "PARAMS_INVALID", "artifact tiene que ser el id de un artefacto o null.")
    return BuildRequest(ref, _recipe_of(payload), artifact)


@dataclass(frozen=True)
class DiffRequest:
    base: reading.VersionRef
    revision: reading.VersionRef


def diff_request(payload: Any) -> DiffRequest:
    """The body of /diff: ``{"project", "base": {"version", "sha256"}, "revision": {"version", "sha256"}}``.
    Both versions belong to the same project, the one named once at the top."""
    payload = _body(payload, {"project", "base", "revision"}, "la comparación")
    refs = []
    for name in ("base", "revision"):
        part = payload.get(name)
        if not isinstance(part, dict):
            raise EngineError(400, "PARAMS_INVALID", f"{name} tiene que ser un objeto con version y sha256.")
        _body(part, {"version", "sha256"}, name)
        project = payload.get("project")
        if project is not None and not isinstance(project, str):
            raise EngineError(400, "PARAMS_INVALID", "project, version y sha256 tienen que ser texto.")
        refs.append(_ref(part, project if project is not None else ""))
    return DiffRequest(*refs)
