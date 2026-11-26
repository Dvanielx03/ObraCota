"""Revisions of a DWG drawing, written as DXF (decision «Revisión DXF real»).

No maintained Python library writes DWG, and AutoCAD opens a DXF and saves it as DWG. So a recipe of ``dwg.*``
operations is applied like this:

    original DWG -> DXF made by LibreDWG (``dxf.mjs convert``, the reader the viewer uses, in WebAssembly)
    -> checks of every operation on that DXF -> ezdxf applies them on a fresh copy -> revision.dxf
    -> layer 1: ezdxf opens the revision again and every operation must read back as it was asked
    -> layer 2: LibreDWG (``dxf.mjs read``) opens the revision as the viewer will, with the same entities and the
       new texts in place
    -> layer 6: every entity of model space keeps its type, layer, colour, text and position unless an operation
       declared it (``SCOPE_UNEXPECTED`` otherwise)

A DXF original (a revision of a revision) skips the conversion. Entities are addressed by their DWG handle, the
identity the viewer shows («Handle CAD») and LibreDWG keeps in the DXF (group 5).

The report has the shape of the IFC one (``build.build_and_verify``), so the backend stores it, gates on ``ok`` and
publishes the artifact the same way. Quantities do not apply to a drawing: the list is empty and a finding says so.

Converted bases are cached on disk by the SHA-256 of the original (``ENGINE_DXF_CACHE``): a check, a preview and
a build of the same base convert it once.
"""
import json
import logging
import math
import os
import re
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import ezdxf
from ezdxf import bbox as dxf_bbox
from ezdxf import recover, revcloud
from ezdxf.entities import DXFGraphic
from ezdxf.lldxf import validator

from .. import ENGINE_VERSION, invariants, settings, store, texts
from ..errors import EngineError
from ..recipe import (DWG_ADD_NOTE, DWG_MOVE, DWG_SET_COLOR, DWG_SET_LAYER, DWG_SET_TEXT, Recipe, recipe_sha256)
from . import units

log = logging.getLogger(__name__)

SCRIPT = Path(__file__).with_name("dxf.mjs")
NOTE_LAYER = "OBRACOTA-REVISION"
NOTE_COLOR = 1  # red, as revision clouds usually are
_DXF_HEAD = re.compile(rb"^\s*(?:999\s*\r?\n[^\n]*\r?\n\s*)*0\s*\r?\n\s*SECTION\b")
_BINARY_DXF = b"AutoCAD Binary DXF"
TEXT_TYPES = ("TEXT", "MTEXT", "ATTRIB", "DIMENSION", "MULTILEADER")
# Entities ezdxf can translate. ACIS bodies (3DSOLID, BODY, REGION) and proxies cannot be moved without a kernel.
MOVABLE = frozenset({"LINE", "ARC", "CIRCLE", "ELLIPSE", "LWPOLYLINE", "POLYLINE", "SPLINE", "POINT", "TEXT", "MTEXT",
                     "INSERT", "DIMENSION", "ARC_DIMENSION", "HATCH", "SOLID", "TRACE", "3DFACE", "LEADER",
                     "MULTILEADER", "XLINE", "RAY", "WIPEOUT", "IMAGE", "MESH", "TOLERANCE"})
TIMINGS = ("convert", "checks", "open", "apply", "write", "reopen", "verify", "viewer", "diff")
SKIPPED = [
    {"layer": 3, "reason": "Un DXF no tiene reglas de esquema IFC."},
    {"layer": 4, "reason": "El proyecto no tiene un IDS."},
    {"layer": 7, "reason": "Las cantidades no aplican a un plano DWG."},
]
NOT_RUN = "No se ejecutó: una operación no superó sus comprobaciones."
CONVERSION_FAILED = "No se pudo convertir el DWG a DXF para revisarlo."
UNREADABLE = "El DXF del dibujo no se pudo leer."
SLOW = "La conversión del DWG superó el tiempo permitido."
LIMIT = 50


# --- What the file is -------------------------------------------------------------------------------------------

def kind(path: Path) -> Optional[str]:
    """``DWG``, ``DXF`` or None, from the first bytes of a file."""
    with open(path, "rb") as source:
        head = source.read(4096)
    if re.match(rb"^AC10\d\d", head):
        return "DWG"
    if head.startswith(_BINARY_DXF) or _DXF_HEAD.match(head):
        return "DXF"
    return None


def is_drawing(path: Path) -> bool:
    return kind(path) is not None


# --- LibreDWG (Node) -------------------------------------------------------------------------------------------

def _node(arguments: list, timeout: float) -> bytes:
    package = settings.ENGINE_LIBREDWG_WEB
    if not (Path(package) / "dist" / "libredwg-web.js").is_file():
        raise EngineError(503, "DWG_READER_MISSING", "El lector DWG del motor no está instalado.")
    command = [settings.ENGINE_NODE, f"--max-old-space-size={settings.ENGINE_DWG_NODE_HEAP_MB}", str(SCRIPT),
               str(package), *map(str, arguments)]
    try:
        done = subprocess.run(command, capture_output=True, timeout=max(1.0, timeout), check=False,
                              env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "NODE_OPTIONS": ""})
    except subprocess.TimeoutExpired as exc:
        raise EngineError(503, "DEADLINE_EXCEEDED", SLOW) from exc
    except OSError as exc:
        raise EngineError(503, "DWG_READER_MISSING", "El lector DWG del motor no está instalado.") from exc
    if done.returncode == 3:
        code, detail = "DXF_CONVERSION_FAILED", CONVERSION_FAILED
        try:
            failure = json.loads(done.stderr.decode("utf-8").strip().splitlines()[-1])
            code, detail = str(failure["code"]), str(failure["detail"])
        except (ValueError, KeyError, IndexError, UnicodeDecodeError):
            pass
        raise EngineError(422, code, detail)
    if done.returncode != 0:
        log.info("dxf.mjs %s failed: %s", arguments[0], done.stderr[-400:])
        raise EngineError(422, "DXF_CONVERSION_FAILED", CONVERSION_FAILED)
    return done.stdout


def viewer_read(path: Path, timeout: float = 60) -> dict:
    """The DXF as the viewer reads it (LibreDWG): entity counts of model space and texts by handle."""
    try:
        return json.loads(_node(["read", path], timeout).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise EngineError(422, "DXF_UNREADABLE", "LibreDWG no pudo leer el DXF.") from exc


_cache_guard = threading.Lock()


def _cache_dir() -> Path:
    root = Path(settings.ENGINE_DXF_CACHE)
    root.mkdir(parents=True, exist_ok=True)
    return root


def base_dxf(path: Path, sha256: str, timeout: float = 120) -> Path:
    """The DXF of an original: the file itself for a DXF, LibreDWG's conversion (cached) for a DWG."""
    found = kind(path)
    if found == "DXF":
        return path
    if found != "DWG":
        raise EngineError(422, "NOT_DWG", "La versión no es un DWG ni un DXF.")
    target = _cache_dir() / f"{sha256}.dxf"
    if target.is_file():
        os.utime(target)
        return target
    with _cache_guard:
        if target.is_file():
            return target
        fd, partial = tempfile.mkstemp(suffix=".dxf.part", dir=_cache_dir())
        os.close(fd)
        try:
            _node(["convert", path, partial], timeout)
            os.replace(partial, target)
        finally:
            if os.path.exists(partial):
                os.unlink(partial)
        _evict()
    return target


def _evict() -> None:
    files = sorted(_cache_dir().glob("*.dxf"), key=lambda p: p.stat().st_mtime)
    total = sum(p.stat().st_size for p in files)
    while files and total > settings.ENGINE_DXF_CACHE_MAX_BYTES:
        oldest = files.pop(0)
        total -= oldest.stat().st_size
        oldest.unlink(missing_ok=True)


def load(path: Path):
    """An ezdxf document; a damaged DXF is recovered, an unreadable one is 422 ``DXF_UNREADABLE``."""
    try:
        return ezdxf.readfile(str(path))
    except ezdxf.DXFStructureError:
        try:
            doc, _auditor = recover.readfile(str(path))
            return doc
        except (ezdxf.DXFStructureError, OSError, ValueError) as exc:
            raise EngineError(422, "DXF_UNREADABLE", UNREADABLE) from exc
    except (OSError, ValueError, UnicodeDecodeError) as exc:
        raise EngineError(422, "DXF_UNREADABLE", UNREADABLE) from exc


# --- Entities ---------------------------------------------------------------------------------------------------

def _round(value: float) -> float:
    return round(float(value), 6)


def _xy(point) -> list:
    return [_round(point[0]), _round(point[1])]


def find(doc, handle: str):
    """The graphic entity with ``handle`` (upper-case hex), or None."""
    entity = doc.entitydb.get(handle)
    if entity is None or not entity.is_alive or not isinstance(entity, DXFGraphic):
        return None
    return entity


def space(doc, entity) -> str:
    """``model``, ``paper``, ``block:<name>`` or ``attrib`` (an attribute of an insert)."""
    if entity.dxftype() == "ATTRIB":
        return "attrib"
    owner = entity.dxf.get("owner")
    if owner == doc.modelspace().block_record_handle:
        return "model"
    record = doc.entitydb.get(owner)
    name = getattr(getattr(record, "dxf", None), "name", "") or ""
    if name.upper().startswith("*PAPER_SPACE"):
        return "paper"
    return "block:" + name


def text_of(entity) -> Optional[str]:
    kind_ = entity.dxftype()
    if kind_ in ("TEXT", "ATTRIB", "DIMENSION"):
        return entity.dxf.get("text", "")
    if kind_ == "MTEXT":
        return entity.text
    if kind_ == "MULTILEADER":
        mtext = entity.context.mtext
        return mtext.default_content if mtext is not None else None
    return None


def plain(raw: Optional[str]) -> Optional[str]:
    """An MTEXT content without its formatting codes, as the viewer lists it."""
    if raw is None:
        return None
    value = raw.replace("\\P", " ")
    value = re.sub(r"\\[ACFHQTWcfhp][^;]*;", "", value)
    value = re.sub(r"\\[LlOoKk]", "", value).replace("\\~", " ")
    return re.sub(r"[{}]", "", value).strip()


def extents(entity):
    try:
        box = dxf_bbox.extents([entity], fast=True)
    except Exception:  # noqa: BLE001 - ezdxf raises many types on odd geometry; no box is an answer
        return None
    if not box.has_data:
        return None
    return box


def position(entity) -> Optional[list]:
    """Where the entity sits: its insertion point when it has one, otherwise the centre of its extents."""
    for name in ("insert", "start", "center", "location", "defpoint"):
        if entity.dxf.hasattr(name):
            return _xy(entity.dxf.get(name))
    if entity.dxftype() == "LWPOLYLINE":
        points = list(entity.vertices())
        if points:
            return _xy(points[0])
    box = extents(entity)
    return _xy(box.center) if box else None


def describe(doc, entity) -> dict:
    """What the agent and the report read of an entity. Texts come from the drawing: data, never instructions."""
    box = extents(entity)
    raw = text_of(entity)
    out = {"handle": entity.dxf.handle, "type": entity.dxftype(), "layer": texts.clean(entity.dxf.get("layer", "0"), 255),
           "color": int(entity.dxf.get("color", 256)), "space": texts.clean(space(doc, entity), 120),
           "position": position(entity),
           "extents": [_xy(box.extmin), _xy(box.extmax)] if box else None}
    if raw is not None:
        out["text"] = texts.clean(raw, 512)
        out["plain_text"] = texts.clean(plain(raw) or "", 512)
    if entity.dxftype() == "INSERT":
        out["block"] = texts.clean(entity.dxf.get("name", ""), 255)
        out["attributes"] = [{"handle": a.dxf.handle, "tag": texts.clean(a.dxf.tag, 64), "text": texts.clean(a.dxf.text, 255)}
                             for a in entity.attribs][:20]
    if entity.dxftype() == "DIMENSION":
        try:
            out["measurement"] = _round(entity.get_measurement())
        except Exception:  # noqa: BLE001
            out["measurement"] = None
    return out


def drawing_units(doc) -> dict:
    code = int(doc.header.get("$INSUNITS", 0) or 0)
    return {"insunits": code, "name": units.name(code), "to_mm": units.to_mm(code)}


def signature(doc, entity) -> tuple:
    """What layer 6 compares for an entity no operation declared."""
    raw = text_of(entity)
    point = position(entity)
    return (entity.dxftype(), entity.dxf.get("layer", "0"), int(entity.dxf.get("color", 256)), raw,
            tuple(round(v, 4) for v in point) if point else None)


def model_entities(doc) -> dict:
    return {e.dxf.handle: e for e in doc.modelspace()}


# --- Operations -------------------------------------------------------------------------------------------------

def _error(code: str, detail: str) -> dict:
    return {"code": code, "detail": texts.bounded(detail)}


def _mtext_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")


def _stored_text(entity, value: str) -> str:
    """The raw value an operation writes: an MTEXT content escapes its formatting characters."""
    return _mtext_escape(value) if entity.dxftype() in ("MTEXT", "MULTILEADER") else value


def _units_factor(doc, unit: str) -> Optional[float]:
    """Drawing units per ``unit``; None when the drawing declares no unit and the move is not in drawing units."""
    if unit == "drawing":
        return 1.0
    code = int(doc.header.get("$INSUNITS", 0) or 0)
    if code == 0:
        return None
    per_mm = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": 25.4, "ft": 304.8}[unit]
    return per_mm / units.to_mm(code)


def check(doc, op) -> list:
    """Errors of one operation on the base, before anything is written. Empty when it can be applied."""
    entity = find(doc, op.element)
    if entity is None:
        return [_error("ENTITY_NOT_FOUND", f"No existe la entidad {op.element} en el dibujo.")]
    where = space(doc, entity)
    if where == "paper":
        return [_error("ENTITY_NOT_IN_MODEL", f"La entidad {op.element} está en un espacio papel; marca una del espacio modelo.")]
    kind_ = entity.dxftype()
    if op.op == DWG_SET_TEXT:
        current = text_of(entity)
        if current is None or (kind_ == "MULTILEADER" and entity.context.mtext is None):
            return [_error("TEXT_NOT_EDITABLE", f"La entidad {kind_} {op.element} no tiene un texto que cambiar.")]
        if current == _stored_text(entity, op.text):
            return [_error("VALUE_UNCHANGED", "El texto ya es ese.")]
    elif op.op == DWG_SET_LAYER:
        if not validator.is_valid_layer_name(op.layer):
            return [_error("LAYER_INVALID", "El nombre de capa tiene caracteres que AutoCAD no admite.")]
        if entity.dxf.get("layer", "0") == op.layer:
            return [_error("VALUE_UNCHANGED", "La entidad ya está en esa capa.")]
    elif op.op == DWG_SET_COLOR:
        if int(entity.dxf.get("color", 256)) == op.color and not entity.dxf.hasattr("true_color"):
            return [_error("VALUE_UNCHANGED", "La entidad ya tiene ese color.")]
    elif op.op == DWG_MOVE:
        if where != "model" or kind_ == "ATTRIB":
            return [_error("MOVE_NOT_SUPPORTED", "Solo se mueven entidades del espacio modelo (un bloque se mueve con su inserción).")]
        if kind_ not in MOVABLE:
            return [_error("MOVE_NOT_SUPPORTED", f"Una entidad {kind_} no se puede mover sin un núcleo geométrico; muévela en AutoCAD.")]
        if _units_factor(doc, op.unit) is None:
            return [_error("UNITS_UNKNOWN", "El dibujo no declara unidades ($INSUNITS = 0): indica el desplazamiento en unidades del dibujo.")]
    elif op.op == DWG_ADD_NOTE:
        if where not in ("model", "attrib") and not where.startswith("block:"):
            return [_error("ENTITY_NOT_IN_MODEL", "La nota se coloca junto a una entidad del espacio modelo.")]
        if extents(_outer(doc, entity)) is None and position(entity) is None:
            return [_error("NOTE_POSITION_UNKNOWN", f"No se pudo ubicar la entidad {op.element} para poner la nota.")]
    return []


def _outer(doc, entity):
    """An attribute is placed with its insert."""
    if entity.dxftype() == "ATTRIB":
        owner = doc.entitydb.get(entity.dxf.owner)
        if owner is not None:
            return owner
    return entity


@dataclass
class Applied:
    before: dict
    after: dict
    findings: list = field(default_factory=list)
    declared: set = field(default_factory=set)
    added: dict = field(default_factory=dict)  # type -> count of new model space entities


def _finding(rule: str, explanation: str, element: str, status: str = "INFO") -> dict:
    return {"rule": rule, "status": status, "explanation": texts.bounded(explanation), "source": "motor DWG", "element": element}


def _block_notice(doc, entity, op) -> list:
    where = space(doc, entity)
    if not where.startswith("block:"):
        return []
    name = where[6:]
    inserts = sum(1 for e in doc.modelspace().query("INSERT") if e.dxf.get("name") == name)
    return [_finding("DWG_BLOCK_DEFINITION",
                     f"La entidad está dentro del bloque «{texts.short(name)}»: el cambio se ve en sus {inserts} inserciones del espacio modelo.",
                     op.element, "WARNING")]


def apply(doc, op) -> Applied:
    entity = find(doc, op.element)
    kind_ = entity.dxftype()
    if op.op == DWG_SET_TEXT:
        before = {"type": kind_, "layer": entity.dxf.get("layer", "0"), "text": texts.clean(text_of(entity) or "", 512)}
        value = _stored_text(entity, op.text)
        if kind_ in ("TEXT", "ATTRIB", "DIMENSION"):
            entity.dxf.text = value
        elif kind_ == "MTEXT":
            entity.text = value
        else:
            entity.context.mtext.default_content = value
        findings = _block_notice(doc, entity, op)
        if kind_ == "DIMENSION":
            findings.append(_finding("DWG_DIMENSION_OVERRIDE",
                                     "El texto de la cota queda como sustitución del valor medido; AutoCAD lo muestra al regenerar (REGEN).",
                                     op.element))
        return Applied(before, {"text": texts.clean(value, 512)}, findings, {op.element})
    if op.op == DWG_SET_LAYER:
        before = {"type": kind_, "layer": entity.dxf.get("layer", "0")}
        created = op.layer not in doc.layers
        if created:
            doc.layers.add(op.layer, color=7)
        entity.dxf.layer = op.layer
        findings = _block_notice(doc, entity, op)
        if created:
            findings.append(_finding("DWG_LAYER_CREATED", f"Se creó la capa «{texts.short(op.layer)}», que el dibujo no tenía.", op.element))
        return Applied(before, {"layer": op.layer, "created": created}, findings, {op.element})
    if op.op == DWG_SET_COLOR:
        before = {"type": kind_, "color": int(entity.dxf.get("color", 256))}
        entity.dxf.color = op.color
        entity.dxf.discard("true_color")
        return Applied(before, {"color": op.color}, _block_notice(doc, entity, op), {op.element})
    if op.op == DWG_MOVE:
        factor = _units_factor(doc, op.unit)
        dx, dy = op.dx * factor, op.dy * factor
        before = {"type": kind_, "position": position(entity)}
        entity.translate(dx, dy, 0)
        declared = {op.element}
        if kind_ == "INSERT":
            declared |= {attrib.dxf.handle for attrib in entity.attribs}
        after = {"position": position(entity), "dx": _round(dx), "dy": _round(dy), "unit": drawing_units(doc)["name"]}
        return Applied(before, after, [], declared)
    if op.op == DWG_ADD_NOTE:
        return _add_note(doc, entity, op)
    raise ValueError(op.op)


def _note_height(doc, entity, box) -> float:
    if entity.dxftype() in ("TEXT", "ATTRIB"):
        return float(entity.dxf.get("height", 0) or 0) or 1.0
    if entity.dxftype() == "MTEXT":
        return float(entity.dxf.get("char_height", 0) or 0) or 1.0
    if box is not None:
        size = box.size
        diagonal = math.hypot(size.x, size.y)
        if diagonal > 0:
            return diagonal * 0.08
    size = float(doc.header.get("$TEXTSIZE", 0) or 0)
    return size if size > 0 else 2.5


def _add_note(doc, entity, op) -> Applied:
    target = _outer(doc, entity)
    box = extents(target)
    height = _note_height(doc, entity, box)
    if box is not None:
        x0, y0, x1, y1 = box.extmin.x, box.extmin.y, box.extmax.x, box.extmax.y
    else:
        x0, y0 = position(target)
        x1, y1 = x0, y0
    margin = max(height * 1.2, 0.15 * math.hypot(x1 - x0, y1 - y0))
    x0, y0, x1, y1 = x0 - margin, y0 - margin, x1 + margin, y1 + margin
    if NOTE_LAYER not in doc.layers:
        doc.layers.add(NOTE_LAYER, color=NOTE_COLOR)
    msp = doc.modelspace()
    perimeter = 2 * ((x1 - x0) + (y1 - y0))
    segment = max(perimeter / 24, height * 0.8)
    cloud = revcloud.add_entity(msp, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], segment,
                                dxfattribs={"layer": NOTE_LAYER, "color": 256})
    note = msp.add_mtext(_mtext_escape(op.text), dxfattribs={"layer": NOTE_LAYER, "color": 256, "char_height": height,
                                                             "insert": (x1 + height * 0.6, y1 + height * 0.6, 0),
                                                             "attachment_point": 7})
    after = {"note": note.dxf.handle, "cloud": cloud.dxf.handle, "layer": NOTE_LAYER, "text": texts.clean(op.text, 512),
             "position": _xy((x1 + height * 0.6, y1 + height * 0.6))}
    findings = [_finding("DWG_NOTE_ADDED", f"Nota y nube de revisión en la capa {NOTE_LAYER}.", op.element)]
    return Applied({"type": entity.dxftype(), "layer": entity.dxf.get("layer", "0")}, after, findings, {op.element},
                   {"LWPOLYLINE": 1, "MTEXT": 1})


def verify(revised, op, applied: Applied) -> list:
    """Layer 1: the operation reads back from the written revision as it was asked."""
    entity = find(revised, op.element)
    if entity is None:
        return [{"code": "ENTITY_LOST", "detail": f"La entidad {op.element} no está en la revisión escrita.", "element": op.element}]
    issue = None
    if op.op == DWG_SET_TEXT and text_of(entity) != _stored_text(entity, op.text):
        issue = "El texto no quedó escrito en la revisión."
    elif op.op == DWG_SET_LAYER and entity.dxf.get("layer") != op.layer:
        issue = "La capa no quedó escrita en la revisión."
    elif op.op == DWG_SET_COLOR and int(entity.dxf.get("color", 256)) != op.color:
        issue = "El color no quedó escrito en la revisión."
    elif op.op == DWG_MOVE:
        expected = applied.after.get("position")
        found = position(entity)
        if expected and (not found or any(abs(a - b) > 1e-6 * max(1.0, abs(a)) for a, b in zip(expected, found))):
            issue = "La entidad no quedó en la posición pedida."
    elif op.op == DWG_ADD_NOTE:
        note = find(revised, applied.after["note"])
        if note is None or note.dxftype() != "MTEXT" or note.text != _mtext_escape(op.text):
            issue = "La nota no quedó escrita en la revisión."
        elif find(revised, applied.after["cloud"]) is None:
            issue = "La nube de revisión no quedó escrita en la revisión."
    return [{"code": "OPERATION_NOT_WRITTEN", "detail": issue, "element": op.element}] if issue else []


# --- Preview ----------------------------------------------------------------------------------------------------

@dataclass
class Built:
    report: dict
    output: Optional[Path] = None
    sha256: Optional[str] = None

    @property
    def ok(self) -> bool:
        return bool(self.report["ok"])


class _Timer:
    def __init__(self, deadline):
        self.deadline = deadline
        self.timings = dict.fromkeys(TIMINGS, 0)

    def phase(self, name: str):
        timer = self

        class _Phase:
            def __enter__(self):
                self.started = time.perf_counter()

            def __exit__(self, *_):
                timer.timings[name] += round((time.perf_counter() - self.started) * 1000)
                timer.deadline.check(name)
                return False
        return _Phase()


def engine_versions() -> dict:
    return {"version": ENGINE_VERSION, "ezdxf": ezdxf.__version__, "libredwg_web": "0.9.0"}


def _result(op) -> dict:
    return {"id": op.id, "op": op.op, "ok": True, "element": op.element, "errors": [], "before": {}, "after": {},
            "findings": [], "declared": []}


def _layer(number: int, name: str, issues: list) -> dict:
    return {"layer": number, "name": name, "status": "PASS" if not issues else "FAIL", "issues": issues[:LIMIT],
            "truncated": len(issues) > LIMIT}


def checks_only(ref, recipe: Recipe) -> dict:
    """/preview with ``checks_only=true`` on a drawing: the checks of every operation, nothing written."""
    path = store.require_original(ref.project, ref.version, ref.sha256)
    doc = load(base_dxf(path, ref.sha256))
    results = []
    for op in recipe.operations:
        errors = check(doc, op)
        results.append({"id": op.id, "op": op.op, "ok": not errors, "element": op.element, "errors": errors})
    return {"ok": all(result["ok"] for result in results), "operations": results}


def entity_reading(ref, handle: str) -> dict:
    """/dwg/entity: one entity of a stored drawing, for the agent («Leer la entidad marcada»)."""
    if not isinstance(handle, str) or not re.fullmatch(r"[0-9A-F]{1,16}", handle or ""):
        raise EngineError(400, "PARAMS_INVALID", "handle tiene que ser un handle DWG en hexadecimal.")
    path = store.require_original(ref.project, ref.version, ref.sha256)
    doc = load(base_dxf(path, ref.sha256))
    entity = find(doc, handle)
    if entity is None:
        raise EngineError(404, "ENTITY_NOT_FOUND", f"No existe la entidad {handle} en el dibujo.")
    return {**describe(doc, entity), "units": drawing_units(doc), "format": kind(path)}


def build_and_verify(ref, recipe: Recipe, workdir: Path, deadline) -> Built:
    """Apply a ``dwg.*`` recipe on the DXF of the base and verify the written revision (see the module docstring)."""
    timer = _Timer(deadline)
    path = store.require_original(ref.project, ref.version, ref.sha256)
    source_kind = kind(path)
    results = [_result(op) for op in recipe.operations]
    report = {"ok": False, "engine": engine_versions(),
              "base": {"version": ref.version, "sha256": ref.sha256, "schema": source_kind},
              "recipe_sha256": recipe_sha256(recipe), "operations": results, "affected": [], "findings": [],
              "quantities": [], "diff": None, "validation": None, "errors": [], "timings_ms": timer.timings,
              "output": {"format": "DXF"}}
    if any(not op.op.startswith("dwg.") for op in recipe.operations):
        raise EngineError(400, "RECIPE_INVALID", "Un plano DWG solo admite operaciones dwg.*.")
    with timer.phase("convert"):
        source = base_dxf(path, ref.sha256, max(1.0, deadline.limit - (time.monotonic() - deadline.started)))
    with timer.phase("open"):
        base = load(source)
        work = load(source)
    report["base"]["dxf_version"] = base.dxfversion
    report["output"].update(dxf_version=work.dxfversion, units=drawing_units(base))

    with timer.phase("checks"):
        for op, result in zip(recipe.operations, results):
            result["errors"] = check(base, op)
            result["ok"] = not result["errors"]
    if not all(result["ok"] for result in results):
        return Built(_rejected(report, results))

    applied = {}
    with timer.phase("apply"):
        for op, result in zip(recipe.operations, results):
            try:
                done = apply(work, op)
            except Exception:  # noqa: BLE001 - an ezdxf failure on this entity is a rejection, not a 500
                log.exception("DWG operation %s failed while applying", op.op)
                result["errors"], result["ok"] = [_error("APPLY_FAILED", "No se pudo aplicar la operación en este dibujo.")], False
                continue
            applied[op.id] = done
            result.update(before=done.before, after=done.after, findings=done.findings,
                          declared=[{"handle": handle, "allow": [op.op]} for handle in sorted(done.declared)])
    if not all(result["ok"] for result in results):
        return Built(_rejected(report, results))

    output = Path(workdir) / "revision.dxf"
    with timer.phase("write"):
        try:
            work.saveas(str(output))
        except (OSError, ValueError, UnicodeEncodeError) as exc:
            raise EngineError(422, "DXF_WRITE_FAILED", "No se pudo escribir la revisión DXF.") from exc
        del work
    with timer.phase("reopen"):
        revised = load(output)

    with timer.phase("verify"):
        issues = []
        for op in recipe.operations:
            issues += [{**issue, "operation": op.id} for issue in verify(revised, op, applied[op.id])]
        invariants.require_original_unchanged(path, ref.sha256)

    expected_texts = {op.element: _stored_text(find(revised, op.element), op.text)
                      for op in recipe.operations if op.op == DWG_SET_TEXT and find(revised, op.element) is not None}
    added = {}
    for done in applied.values():
        for name, count in done.added.items():
            added[name] = added.get(name, 0) + count
    with timer.phase("viewer"):
        viewer_issues = _viewer_layer(source, output, expected_texts, added)

    declared = set().union(*(done.declared for done in applied.values())) if applied else set()
    with timer.phase("diff"):
        diff = _diff(base, revised, declared, applied)

    owners = {}
    for op in recipe.operations:
        for handle in applied[op.id].declared:
            owners.setdefault(handle, []).append(op.id)
    affected = []
    for handle in sorted(owners):
        entity = find(revised, handle)
        affected.append({"guid": handle, "handle": handle, "class": entity.dxftype() if entity is not None else None,
                         "name": {"text": texts.clean(entity.dxf.get("layer", "0"), 255)} if entity is not None else None,
                         "operations": owners[handle]})
    findings = [finding for result in results for finding in result["findings"]]
    findings.append(_finding("DWG_NO_QUANTITIES", "Un cambio de plano no tiene cantidades ni costo que estimar.",
                             recipe.operations[0].element if recipe.operations else None))

    layers = [_layer(1, "Comprobaciones de la operación", issues),
              {**_layer(2, "Lectura en el visor (LibreDWG)", viewer_issues), "new_issues": viewer_issues[:LIMIT], "base_issues": 0},
              {**_layer(6, "Alcance del cambio", diff["unexpected"]), "status": "PASS" if not diff["unexpected"] else "FAIL"}]
    report.update(affected=affected[:LIMIT], findings=findings[:LIMIT], diff=diff,
                  validation={"layers": layers, "skipped": list(SKIPPED)})
    errors = []
    if issues:
        errors.append({"code": "LAYER_1_FAILED", "detail": f"La capa 1 encontró {len(issues)} incidencias."})
    if viewer_issues:
        errors.append({"code": "VIEWER_UNREADABLE", "detail": "El visor no leería la revisión como se escribió."})
    if diff["unexpected"]:
        errors.append({"code": "SCOPE_UNEXPECTED", "detail": f"{len(diff['unexpected'])} cambios quedan fuera del alcance declarado."})
    report["errors"] = errors
    report["ok"] = not errors
    report["output"]["size"] = output.stat().st_size
    sha = store.sha_of(output, fresh=True)
    return Built(report, output if report["ok"] else None, sha if report["ok"] else None)


def _rejected(report: dict, results: list) -> dict:
    issues = [{"code": error["code"], "detail": error["detail"], "element": result["element"], "operation": result["id"]}
              for result in results for error in result["errors"]]
    report["validation"] = {"layers": [_layer(1, "Comprobaciones de la operación", issues),
                                       {"layer": 2, "name": "Lectura en el visor (LibreDWG)", "status": "NOT_RUN", "reason": NOT_RUN},
                                       {"layer": 6, "name": "Alcance del cambio", "status": "NOT_RUN", "reason": NOT_RUN}],
                            "skipped": list(SKIPPED)}
    rejected = sum(1 for result in results if not result["ok"])
    report["errors"] = [{"code": "OPERATIONS_REJECTED",
                         "detail": f"{rejected} de {len(results)} operaciones no superaron sus comprobaciones."}]
    report["ok"] = False
    return report


def _viewer_layer(source: Path, output: Path, expected_texts: dict, added: dict) -> list:
    """Layer 2: LibreDWG reads the revision with the entities of the base (plus the notes) and the new texts."""
    try:
        before = viewer_read(source)
        after = viewer_read(output)
    except EngineError as exc:
        return [{"code": exc.code, "detail": exc.detail}]
    issues = []
    for name in sorted(set(before["types"]) | set(after["types"]) | set(added)):
        want = before["types"].get(name, 0) + added.get(name, 0)
        got = after["types"].get(name, 0)
        if got != want:
            issues.append({"code": "VIEWER_COUNT", "detail": f"El visor lee {got} entidades {name}; se esperaban {want}."})
    by_handle = {item["handle"]: item for item in after["texts"]}
    for handle, value in expected_texts.items():
        item = by_handle.get(handle)
        if item is not None and item["text"] != value:
            issues.append({"code": "VIEWER_TEXT", "detail": f"El visor no lee el texto nuevo de la entidad {handle}.", "element": handle})
    return issues


_SIGNATURE_FLAGS = ("tipo", "capa", "color", "texto", "posición")


def _entry(handle: str, entity, flags=(), reason=None) -> dict:
    """A diff entry in the shape of the IFC report (guid, class, name), so the change card lists it the same way."""
    entry = {"guid": handle, "handle": handle, "class": entity.dxftype() if entity is not None else None,
             "name": {"text": texts.clean(entity.dxf.get("layer", "0"), 255)} if entity is not None else None, "flags": list(flags)}
    if reason:
        entry["reason"] = reason
    return entry


def _diff(base, revised, declared: set, applied: dict) -> dict:
    """Layer 6: model space entities that changed, appeared or disappeared, against what the operations declared."""
    old, new = model_entities(base), model_entities(revised)
    notes = {done.after.get(key) for done in applied.values() for key in ("note", "cloud") if done.after.get(key)}
    changed, added, deleted, unexpected = [], [], [], []
    for handle, entity in old.items():
        other = new.get(handle)
        if other is None:
            deleted.append(_entry(handle, entity))
            unexpected.append(_entry(handle, entity, reason="DELETED"))
            continue
        before, after = signature(base, entity), signature(revised, other)
        if before != after:
            flags = [name for name, a, b in zip(_SIGNATURE_FLAGS, before, after) if a != b]
            changed.append(_entry(handle, other, flags))
            if handle not in declared:
                unexpected.append(_entry(handle, other, flags, "UNDECLARED"))
    for handle, entity in new.items():
        if handle in old:
            continue
        added.append(_entry(handle, entity, ["nota de revisión"] if handle in notes else []))
        if handle not in notes:
            unexpected.append(_entry(handle, entity, reason="ADDED"))
    # Declared entities inside blocks or attributes are not in model space: they count as changed.
    for handle in sorted(declared - set(old)):
        changed.append(_entry(handle, find(revised, handle), ["definición de bloque o atributo"]))
    total = len(changed) + len(added) + len(deleted) + len(unexpected)
    return {"changed": changed[:LIMIT], "added": added[:LIMIT], "deleted": deleted[:LIMIT], "unexpected": unexpected[:LIMIT],
            "openings": {"changed": [], "added": [], "deleted": [], "unfilled": []}, "drawing": True,
            "truncated": any(len(items) > LIMIT for items in (changed, added, deleted, unexpected)),
            "summary": {"changed": len(changed), "added": len(added), "deleted": len(deleted), "unexpected": len(unexpected),
                        "entities": len(new), "total": total}}
