"""Verification of a recipe that changes no geometry, entity by entity (``ENGINE_ENTITY_VERIFY_MIN_BYTES`` and up).

IfcDiff meshes every element of both files and ``ifcopenshell.validate`` checks every entity: Lantern Hollow (20 MB)
takes 89 s that way, and ReStage (190 MB) goes far beyond the 150 s deadline. A recipe of ``ifc.set_property`` and
``ifc.set_material`` (``build.GEOMETRY_FREE``) cannot move geometry, so for it this module proves the scope instead
of measuring meshes:

1. **Snapshot** (``SnapshotJob``). The base written by IfcOpenShell: the same writer that writes the revision, so an
   entity the recipe did not touch has exactly the same line in both files (IfcOpenShell keeps every ``#id`` and
   writes them in order). The first preview of a base writes it in a child process, in parallel with the revision;
   later previews read it from ``ENGINE_SNAPSHOTS``, by SHA-256 of the original and IfcOpenShell version.
2. **Comparison** (``compare``). Both files are read line by line and merged by ``#id``: the entities that changed,
   were added or were removed. Every other entity is, byte for byte, the one of the base.
3. **Audit** (``audit``, layer 6). Every changed, added or removed entity must be data the recipe may touch
   (property sets and properties, materials and layer sets, surface styles, their two relationships, owner history)
   and may only reach elements the recipe declares, with the kind of change its operation makes. Anything geometric
   (representation items, representations, placements, profiles, contexts), an element's own attributes, an
   opening, any other relationship, a quantity or a unit is unexpected. Which elements an entity reaches is found
   by walking its inverse references up to the elements (``owners``).
4. **Schema** (``validation.subset_layer``, layer 2) validates the entities that changed or were added and the ones
   they reference, whose inverse attributes may have changed. The rest of the file is identical to the base.

The operations' own ``verify`` and the invariants of layer 1 still run on the reopened revision, as in H1. The
report says which method verified the change (``diff.method``), what was compared (``diff.entities``) and that no
mesh was compared (layer 7 in ``validation.skipped``).
"""
import logging
import os
import re
import subprocess
import sys
import threading
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Optional

import ifcopenshell
from ifcopenshell.util.element import get_type

from . import settings
from .errors import EngineError
from .operations.base import by_guid

log = logging.getLogger(__name__)

LIMIT = 500
# Entities visited while looking for the elements an entity reaches; beyond it the entity is «shared widely».
WALK_LIMIT = 200_000
METHOD = "entities"

SNAPSHOT_FAILED = "IfcOpenShell no pudo escribir la base para compararla con la revisión."
UNORDERED = "La revisión no se pudo comparar entidad por entidad con la base."
SNAPSHOT_SCRIPT = "import sys, ifcopenshell; ifcopenshell.open(sys.argv[1]).write(sys.argv[2])"

# What each operation may change in the elements it declares.
OPERATION_FLAGS = {"ifc.set_property": frozenset({"properties_changed"}),
                   "ifc.set_material": frozenset({"material_changed", "style_changed"})}

# Classes, by the first group they belong to. The order matters: a styled item is a representation item, and a
# styled representation or a material's representation is a representation.
PRESENTATION = ("IfcStyledItem", "IfcStyledRepresentation", "IfcMaterialDefinitionRepresentation",
                "IfcPresentationStyleAssignment", "IfcPresentationStyle", "IfcSurfaceStyleShading",
                "IfcSurfaceStyleLighting", "IfcSurfaceStyleRefraction", "IfcSurfaceStyleWithTextures",
                "IfcColourSpecification", "IfcPreDefinedColour")
GEOMETRY = ("IfcRepresentationItem", "IfcRepresentation", "IfcProductRepresentation", "IfcObjectPlacement",
            "IfcRepresentationMap", "IfcRepresentationContext", "IfcProfileDef", "IfcShapeAspect")
PROPERTIES = ("IfcPropertySet", "IfcProperty", "IfcPropertyEnumeration")
MATERIALS = ("IfcMaterial", "IfcMaterialLayer", "IfcMaterialLayerSet", "IfcMaterialLayerSetUsage", "IfcMaterialList",
             "IfcMaterialConstituent", "IfcMaterialConstituentSet")
RELATIONS = {"IfcRelDefinesByProperties": "properties_changed", "IfcRelAssociatesMaterial": "material_changed"}
METADATA = ("IfcOwnerHistory", "IfcPerson", "IfcOrganization", "IfcPersonAndOrganization", "IfcApplication",
            "IfcActorRole", "IfcAddress")
OPENINGS = ("IfcOpeningElement", "IfcFeatureElementSubtraction")
DATA_FLAGS = {"properties": "properties_changed", "materials": "material_changed", "presentation": "style_changed"}


# --- Snapshots of the base --------------------------------------------------------------------------------------

def _tag() -> str:
    return re.sub(r"[^0-9A-Za-z.]+", "_", str(ifcopenshell.version))


class Snapshots:
    """The bases written by IfcOpenShell, on disk by SHA-256: at most ``ENGINE_SNAPSHOTS_MAX_BYTES``, the least
    recently used removed first. A file only gets its final name once written whole (``.part`` until then)."""

    def __init__(self):
        self._guard = threading.Lock()

    @staticmethod
    def directory() -> Path:
        return Path(settings.ENGINE_SNAPSHOTS)

    def path(self, sha256: str) -> Path:
        return self.directory() / f"{sha256}-{_tag()}.ifc"

    def get(self, sha256: str) -> Optional[Path]:
        path = self.path(sha256)
        try:
            os.utime(path)
        except FileNotFoundError:
            return None
        return path

    def part(self, sha256: str) -> Path:
        self.directory().mkdir(parents=True, exist_ok=True)
        return self.directory() / f".{sha256}-{uuid.uuid4().hex}.part"

    def commit(self, sha256: str, part: Path) -> Path:
        final = self.path(sha256)
        with self._guard:
            os.replace(part, final)
            self._evict(keep=final)
        return final

    def _evict(self, keep: Path) -> None:
        files = []
        for entry in self.directory().glob("*.ifc"):
            try:
                stat = entry.stat()
            except FileNotFoundError:
                continue
            files.append((stat.st_mtime, stat.st_size, entry))
        total = sum(size for _, size, _ in files)
        for _, size, entry in sorted(files):
            if total <= settings.ENGINE_SNAPSHOTS_MAX_BYTES:
                break
            if entry == keep:
                continue
            entry.unlink(missing_ok=True)
            total -= size

    def clear_parts(self) -> None:
        """Removes what a previous process left half written."""
        for entry in self.directory().glob(".*.part") if self.directory().is_dir() else ():
            entry.unlink(missing_ok=True)


snapshots = Snapshots()


class SnapshotJob:
    """The snapshot of one base: from the cache, or written by a child process while the revision is built.

    The child process opens the original read-only and writes it with the same IfcOpenShell; it holds neither the
    GIL nor the cached model, so it runs next to the main work on the second CPU. ``cancel`` (always called) kills
    it and removes its partial file."""

    def __init__(self, original: Path, sha256: str):
        self.sha256 = sha256
        self.path = snapshots.get(sha256)
        self.hit = self.path is not None
        self.process = None
        self._part = None
        if not self.hit:
            self._part = snapshots.part(sha256)
            self.process = subprocess.Popen([sys.executable, "-I", "-c", SNAPSHOT_SCRIPT, str(original), str(self._part)],
                                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    def wait(self, timeout: float) -> Path:
        if self.path is not None:
            return self.path
        try:
            _, error = self.process.communicate(timeout=max(1.0, timeout))
        except subprocess.TimeoutExpired:
            self.cancel()
            raise EngineError(503, "DEADLINE_EXCEEDED", "La verificación superó el plazo mientras se escribía la base "
                                                        "para compararla; el motor está cargado.") from None
        if self.process.returncode != 0 or not self._part.is_file():
            log.error("Snapshot of %s failed (exit %s): %s", self.sha256, self.process.returncode,
                      (error or b"")[-2000:].decode("utf-8", "replace"))
            self.cancel()
            raise EngineError(422, "MODEL_UNREADABLE", SNAPSHOT_FAILED)
        self.path = snapshots.commit(self.sha256, self._part)
        self._part = None
        return self.path

    def cancel(self) -> None:
        if self.process is not None and self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        if self.process is not None and self.process.stderr is not None:
            self.process.stderr.close()
        if self._part is not None:
            self._part.unlink(missing_ok=True)
            self._part = None


# --- Comparison -------------------------------------------------------------------------------------------------

@dataclass
class Delta:
    """What differs between the base snapshot and the revision, by ``#id``."""

    changed: list = field(default_factory=list)
    added: list = field(default_factory=list)
    removed: list = field(default_factory=list)
    compared: int = 0          # entities of the base

    @property
    def count(self) -> int:
        return len(self.changed) + len(self.added) + len(self.removed)


class Unordered(Exception):
    """A file whose entities are not written in increasing ``#id`` order."""


def _records(path: Path) -> Iterator[tuple[int, bytes]]:
    last = 0
    with open(path, "rb") as source:
        for line in source:
            if not line.startswith(b"#"):
                continue
            cut = line.find(b"=")
            if cut < 2:
                raise Unordered(f"line without #id= in {path.name}")
            key = int(line[1:cut])
            if key <= last:
                raise Unordered(f"#{key} after #{last} in {path.name}")
            last = key
            yield key, line.rstrip(b"\r\n")


def compare(snapshot: Path, revision: Path) -> Delta:
    """Merge the entity lines of both files by ``#id``. Streams both: memory grows only with the differences."""
    delta = Delta()
    try:
        old, new = _records(snapshot), _records(revision)
        a, b = next(old, None), next(new, None)
        while a is not None or b is not None:
            if b is None or (a is not None and a[0] < b[0]):
                delta.removed.append(a[0])
                delta.compared += 1
                a = next(old, None)
            elif a is None or b[0] < a[0]:
                delta.added.append(b[0])
                b = next(new, None)
            else:
                if a[1] != b[1]:
                    delta.changed.append(a[0])
                delta.compared += 1
                a, b = next(old, None), next(new, None)
    except (Unordered, ValueError) as exc:
        log.error("Entity comparison impossible: %s", exc)
        raise EngineError(422, "MODEL_UNREADABLE", UNORDERED) from exc
    return delta


# --- Which elements an entity reaches ---------------------------------------------------------------------------

def _is(entity, classes) -> bool:
    return any(entity.is_a(name) for name in classes)


def kind(entity) -> str:
    """The group of an entity for the audit."""
    if _is(entity, PRESENTATION):
        return "presentation"
    if _is(entity, GEOMETRY):
        return "geometry"
    if _is(entity, PROPERTIES):
        return "properties"
    if _is(entity, MATERIALS):
        return "materials"
    if entity.is_a() in RELATIONS:
        return "relation"
    if _is(entity, METADATA):
        return "metadata"
    if _is(entity, OPENINGS):
        return "opening"
    if entity.is_a("IfcTypeObject"):
        return "type"
    if entity.is_a("IfcObjectDefinition"):
        return "element"
    return "other"


def _references(entity) -> list:
    """The entities an entity references directly (in its attributes, also inside lists)."""
    found = []
    stack = list(entity)
    while stack:
        value = stack.pop()
        if isinstance(value, ifcopenshell.entity_instance):
            if value.id():
                found.append(value)
            else:
                stack.extend(value)  # a typed value or a select wrapper
        elif isinstance(value, (tuple, list)):
            stack.extend(value)
    return found


def owners(model, entity, limit: int = WALK_LIMIT) -> Optional[set]:
    """GlobalIds of the elements (and types) ``entity`` reaches in ``model``, or None when it reaches too much.

    Walks the inverse references upwards (a point to its polyline, a property to its set...) and stops at an element
    or a type, or at a relationship, whose objects it takes. A styled item continues from the item it styles, and a
    material's representation from its material: they change how something else looks."""
    seen = {entity.id()}
    queue = deque([entity])
    found = set()
    while queue:
        node = queue.popleft()
        if node.is_a("IfcObjectDefinition"):
            found.add(node.GlobalId)
            continue
        if node.is_a("IfcRelationship"):
            found.update(item.GlobalId for item in _references(node) if item.is_a("IfcObjectDefinition"))
            continue
        following = list(model.get_inverse(node))
        if node.is_a("IfcStyledItem") and node.Item is not None:
            following.append(node.Item)
        if node.is_a("IfcMaterialDefinitionRepresentation") and node.RepresentedMaterial is not None:
            following.append(node.RepresentedMaterial)
        for item in following:
            if item.id() not in seen:
                seen.add(item.id())
                if len(seen) > limit:
                    return None
                queue.append(item)
    return found


def _related(rel) -> set:
    return {item.GlobalId for item in rel.RelatedObjects or ()}


def _plain(value):
    """An attribute value comparable across two files: entities by ``#id``."""
    if isinstance(value, ifcopenshell.entity_instance):
        return ("#", value.id()) if value.id() else (value.is_a(), _plain(value.wrappedValue))
    if isinstance(value, (tuple, list)):
        return tuple(_plain(item) for item in value)
    return value


def differing(old, new) -> list:
    """Names of the attributes whose value differs between two versions of one entity."""
    if old.is_a() != new.is_a():
        return ["class"]
    names = [old.attribute_name(i) for i in range(len(old))]
    return [name for i, name in enumerate(names) if _plain(old[i]) != _plain(new[i])]


def permitted(base, recipe, owners_by_guid: dict) -> dict:
    """``{GlobalId: flags}`` that the recipe allows: each declared element with the kind of change of the operations
    that declare it, plus the type of every ``ifc.set_property`` with ``scope=type`` (its property sets change)."""
    kinds = {op.id: op.op for op in recipe.operations}
    allowed = {}
    for guid, ids in owners_by_guid.items():
        for op_id in ids:
            allowed.setdefault(guid, set()).update(OPERATION_FLAGS.get(kinds.get(op_id), ()))
    for op in recipe.operations:
        if op.op == "ifc.set_property" and op.scope == "type":
            element = by_guid(base, op.element)
            element_type = get_type(element) if element is not None else None
            if element_type is not None:
                allowed.setdefault(element_type.GlobalId, set()).add("properties_changed")
    return allowed


# --- Audit (layer 6) --------------------------------------------------------------------------------------------

def _describe(base, revised, guid: str) -> dict:
    from . import reading  # late: reading imports the operations package
    element = by_guid(revised, guid) or by_guid(base, guid)
    if element is None:
        return {"guid": guid, "class": None, "name": None}
    return {"guid": guid, "class": element.is_a(), "name": reading.text(element.Name)}


def _entity(entity) -> dict:
    return {"guid": f"#{entity.id()}", "class": entity.is_a(), "name": None}


class _Audit:
    def __init__(self, base, revised, delta: Delta, allowed: dict):
        self.base, self.revised, self.delta, self.allowed = base, revised, delta, allowed
        self.added_ids = set(delta.added)
        self.touched: dict = {}
        self.unexpected: list = []
        self.added: list = []
        self.deleted: list = []
        self.openings = {"changed": [], "added": [], "deleted": [], "unfilled": []}
        self.geometry = 0
        self.overflow = 0
        self._seen = set()

    # Recording -------------------------------------------------------------------------------------------------

    def touch(self, guids, flag: str) -> None:
        for guid in guids:
            self.touched.setdefault(guid, set()).add(flag)

    def refuse(self, entity, model, reason: str, flags=(), attributes=()) -> None:
        """An unexpected entity, told by the elements it reaches when it reaches any (deduplicated). Past ``LIMIT``
        entries the list is cut and the rest are only counted."""
        if len(self.unexpected) >= LIMIT:
            self.overflow += 1
            return
        reached = owners(model, entity, limit=20_000) if not entity.is_a("IfcObjectDefinition") else {entity.GlobalId}
        targets = [_describe(self.base, self.revised, guid) for guid in sorted(reached or ())[:5]] or [_entity(entity)]
        for target in targets:
            key = (target["guid"], reason)
            if key in self._seen:
                continue
            self._seen.add(key)
            self.unexpected.append({**target, "reason": reason, "flags": list(flags) or [entity.is_a()],
                                    "attributes": list(attributes)})

    # Entities --------------------------------------------------------------------------------------------------

    def run(self) -> None:
        for key in self.delta.changed:
            self.entity("changed", self.base.by_id(key), self.revised.by_id(key))
        for key in self.delta.added:
            self.entity("added", None, self.revised.by_id(key))
        for key in self.delta.removed:
            self.entity("removed", self.base.by_id(key), None)

    def entity(self, state: str, old, new) -> None:
        current = new if new is not None else old
        model = self.revised if new is not None else self.base
        group = kind(current)
        if old is not None and new is not None and kind(old) != group:
            self.refuse(current, model, "ENTITY_OUT_OF_SCOPE")
            return
        if group == "geometry":
            self.geometry += 1
            self.refuse(current, model, "GEOMETRY_CHANGED")
        elif group == "metadata":
            if state != "added":
                self.refuse(current, model, "ENTITY_OUT_OF_SCOPE")
        elif group in DATA_FLAGS:
            self.data(state, old, new, DATA_FLAGS[group])
        elif group == "relation":
            self.relation(state, old, new)
        elif group == "type":
            self.element_type(state, old, new)
        elif group == "opening":
            self.opening(state, old, new)
        elif group == "element":
            self.element(state, old, new)
        else:
            if current.is_a("IfcRelFillsElement") and state != "added":
                self.unfilled(old)
            self.refuse(current, model, "ENTITY_OUT_OF_SCOPE")

    def unfilled(self, rel) -> None:
        """An opening that had this filling and has none in the revision."""
        opening = rel.RelatingOpeningElement
        now = by_guid(self.revised, opening.GlobalId) if opening is not None else None
        if now is not None and not getattr(now, "HasFillings", None):
            self.openings["unfilled"].append(_describe(self.base, self.revised, opening.GlobalId))

    def reach(self, model, entity, flag: str) -> bool:
        found = owners(model, entity)
        if found is None:
            self.refuse(entity, model, "SHARED_WIDELY", flags=[flag])
            return False
        self.touch(found, flag)
        return True

    def data(self, state: str, old, new, flag: str) -> None:
        if state == "added":
            # A new entity matters through what references it, which is new or changed too and audited as well.
            # Only two point at an existing entity and change how it looks: a style on an existing item, and a
            # representation of an existing material.
            if new.is_a("IfcStyledItem") and new.Item is not None and new.Item.id() not in self.added_ids:
                self.reach(self.revised, new.Item, flag)
            elif (new.is_a("IfcMaterialDefinitionRepresentation") and new.RepresentedMaterial is not None
                  and new.RepresentedMaterial.id() not in self.added_ids):
                self.reach(self.revised, new.RepresentedMaterial, "material_changed")
            return
        if self.reach(self.base, old, flag) and new is not None:
            self.reach(self.revised, new, flag)

    def relation(self, state: str, old, new) -> None:
        flag = RELATIONS[(new or old).is_a()]
        if state == "added":
            self.touch(_related(new), flag)
        elif state == "removed":
            self.touch(_related(old), flag)
        else:
            # Only the related objects changed (one piece joins or leaves a shared set): the ones that joined or left.
            names = [name for name in differing(old, new) if name not in ("RelatedObjects", "OwnerHistory")]
            self.touch(_related(old) ^ _related(new) if not names else _related(old) | _related(new), flag)

    def element_type(self, state: str, old, new) -> None:
        if state != "changed":
            self.element(state, old, new)
            return
        names = set(differing(old, new)) - {"OwnerHistory"}
        if names == {"HasPropertySets"}:
            self.touch([new.GlobalId], "properties_changed")
        else:
            self.element(state, old, new)

    def opening(self, state: str, old, new) -> None:
        if state == "added":
            self.openings["added"].append(_describe(self.base, self.revised, new.GlobalId))
            self.refuse(new, self.revised, "OPENING_ADDED", flags=["added"])
        elif state == "removed":
            self.openings["deleted"].append(_describe(self.base, self.revised, old.GlobalId))
            self.refuse(old, self.base, "OPENING_DELETED", flags=["deleted"])
        else:
            names = differing(old, new)
            self.openings["changed"].append({**_describe(self.base, self.revised, new.GlobalId),
                                             "reasons": names, "ifcdiff": []})
            self.refuse(new, self.revised, "OPENING_CHANGED", flags=["attributes_changed"], attributes=names)

    def element(self, state: str, old, new) -> None:
        if state == "added":
            self.added.append(_describe(self.base, self.revised, new.GlobalId))
            self.refuse(new, self.revised, "ADDED", flags=["added"])
        elif state == "removed":
            self.deleted.append(_describe(self.base, self.revised, old.GlobalId))
            self.refuse(old, self.base, "DELETED", flags=["deleted"])
        else:
            names = differing(old, new)
            reason = "FLAG_NOT_ALLOWED" if new.GlobalId in self.allowed else "UNDECLARED"
            self.touch([new.GlobalId], "attributes_changed")
            self.refuse(new, self.revised, reason, flags=["attributes_changed"], attributes=names)

    # Result ----------------------------------------------------------------------------------------------------

    def result(self, snapshot_hit: bool) -> dict:
        state = {"truncated": self.overflow > 0}

        def cut(items):
            if len(items) > LIMIT:
                state["truncated"] = True
            return items[:LIMIT]

        changed = []
        for guid, flags in sorted(self.touched.items()):
            allowed = self.allowed.get(guid)
            declared = allowed is not None and flags <= allowed
            changed.append({**_describe(self.base, self.revised, guid), "flags": sorted(flags), "attributes": [],
                            "declared": declared})
            if not declared and "attributes_changed" not in flags:
                key = (guid, "UNDECLARED" if allowed is None else "FLAG_NOT_ALLOWED")
                if key not in self._seen:
                    self._seen.add(key)
                    self.unexpected.append({**_describe(self.base, self.revised, guid), "reason": key[1],
                                            "flags": sorted(flags), "attributes": []})
        if self.revised.schema != self.base.schema:
            self.unexpected.append({"guid": "FILE_SCHEMA", "class": None, "name": None, "reason": "SCHEMA_CHANGED",
                                    "flags": [], "attributes": []})
        return {
            "changed": cut(changed),
            "added": cut(self.added),
            "deleted": cut(self.deleted),
            "openings": {name: cut(items) for name, items in self.openings.items()},
            "method": METHOD,
            "entities": {"compared": self.delta.compared, "changed": len(self.delta.changed),
                         "added": len(self.delta.added), "removed": len(self.delta.removed),
                         "geometry": self.geometry, "snapshot": "cache" if snapshot_hit else "written"},
            "unexpected": cut(self.unexpected),
            "truncated": state["truncated"],
        }


def audit(base, revised, delta: Delta, allowed: dict, snapshot_hit: bool = False) -> dict:
    """The ``diff`` object of the report for a verification by entities, in the shape of ``scope.diff``: changed
    elements with their flags (``properties_changed``, ``material_changed``, ``style_changed``), what was added or
    deleted, the openings, and what is outside the declared scope (``unexpected``)."""
    work = _Audit(base, revised, delta, allowed)
    work.run()
    return work.result(snapshot_hit)


def layer_reason(diff: dict) -> str:
    counts = diff["entities"]
    return (f"Comparación entidad por entidad con la base ({counts['compared']} entidades): {counts['changed']} "
            f"cambiadas, {counts['added']} añadidas y {counts['removed']} eliminadas, ninguna de geometría, colocación "
            f"ni huecos fuera de lo declarado." if not diff["unexpected"] else
            f"Comparación entidad por entidad con la base ({counts['compared']} entidades): {len(diff['unexpected'])} "
            f"cambios fuera del alcance declarado.")
