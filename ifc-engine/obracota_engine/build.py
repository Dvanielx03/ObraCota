"""Build and verify a revision: the full /preview, and /build when it has to rebuild (H1-ESPECIFICACION §5.6).

``build_and_verify`` follows the order of §5.6:

    check -> open the file again from disk (never the cached model) -> apply -> write to the temporary
    directory -> reopen -> layer 1 (verify + invariants) -> layer 2 -> layer 6 -> quantities

The base the revision is compared with is the cached read-only model (``store.models``), held with its lock
for the whole build; nothing here writes on it. A reading of the same model waits for that lock at most
``ENGINE_BUSY_WAIT_S`` and then answers 503 ``ENGINE_BUSY`` (``store.ModelCache.lease``). The working copy
is released once written, before the file is reopened (step 0, R2: on a large model it no longer lives next
to IfcDiff's geometry).

**Failures.** Only the calls into IfcOpenShell and IfcDiff (checks, open, write, reopen, validate, diff) turn
a library exception into 422 ``MODEL_UNREADABLE``, with a message that says which step failed and the
traceback in the log (``errors.library``). An exception of ``apply`` is the rejection ``APPLY_FAILED``. Any
other exception is a fault of the engine, not of the file: it stays a 500, which the backend reads as a
contract error (502).

**Concurrency and time** (§5.9). ``geometry_slot`` admits geometry work one at a time in arrival order,
with a bounded queue. Full previews have their own queue wait, separate from the processing deadline.
At capacity or on wait expiry the engine returns 503 ``ENGINE_BUSY``. ``Deadline`` is checked between phases: past
``ENGINE_PREVIEW_DEADLINE_S`` the work stops with 503 ``DEADLINE_EXCEEDED`` and the slot is released. A
phase in progress (an IfcDiff pass) cannot be interrupted from Python, so the size limit is the main defence.

``/preview`` with ``checks_only`` and the readings do not take the slot: they read the cached model under its
own lock, as /inspect always did (R3: the slot serialises the heavy geometry, not every mesh of one opening).

``ok`` is true only when every operation was accepted and applied, layer 1 passes, layer 2 has no new
issue and nothing is outside the declared scope (openings included). With ``ok=false`` there is no artifact.
"""
import gc
import importlib.metadata
import logging
import threading
import time
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import ifcopenshell

from . import ENGINE_VERSION, invariants, quantities, reading, scope, settings, store, validation
from .errors import EngineError, library
from .operations import REGISTRY, Rejected, check_one
from .operations.base import by_guid
from .recipe import Recipe, recipe_sha256

log = logging.getLogger(__name__)

LIMIT = scope.LIMIT
TIMINGS = ("checks", "open", "apply", "write", "reopen", "verify", "validate", "diff", "quantities")
SKIPPED = [
    {"layer": 3, "reason": "Reglas WHERE desactivadas (express_rules=False)."},
    {"layer": 4, "reason": "El proyecto no tiene un IDS."},
    {"layer": 7, "reason": "La receta no mueve geometría."},
]
NOT_RUN = "No se ejecutó: una operación no superó sus comprobaciones."
ENGINE_BUSY = "El motor IFC está ocupado con otra vista previa; vuelve a intentarlo en un momento."
APPLY_FAILED = "No se pudo aplicar la operación en este IFC."
CHECKS_FAILED = "IfcOpenShell no pudo comprobar la receta en este IFC."
OPEN_FAILED = "IfcOpenShell no pudo abrir este IFC para aplicar la receta."
WRITE_FAILED = "IfcOpenShell no pudo escribir la revisión de este IFC."
REOPEN_FAILED = "IfcOpenShell no pudo volver a abrir la revisión escrita."
VALIDATE_FAILED = "IfcOpenShell no pudo validar el esquema de la revisión."

class GeometryQueue:
    """One active job. A waiting request cannot open a model or overtake another waiter."""

    def __init__(self, max_waiters: int):
        self.max_waiters = max_waiters
        self.condition = threading.Condition()
        self.waiters = deque()
        self.active = False

    def acquire(self, timeout: float) -> bool:
        with self.condition:
            if not self.active and not self.waiters:
                self.active = True
                return True
            if len(self.waiters) >= self.max_waiters:
                return False
            ticket = object()
            self.waiters.append(ticket)
            try:
                if not self.condition.wait_for(lambda: not self.active and self.waiters[0] is ticket, timeout):
                    return False
                self.active = True
                return True
            finally:
                self.waiters.remove(ticket)
                self.condition.notify_all()

    def release(self) -> None:
        with self.condition:
            self.active = False
            self.condition.notify_all()


_slot = GeometryQueue(settings.ENGINE_GEOMETRY_QUEUE_LIMIT)


def _clock() -> float:
    return time.monotonic()


@contextmanager
def geometry_slot(wait_s=None):
    """The global slot of the work that generates geometry, or 503 ``ENGINE_BUSY`` after ``wait_s`` seconds
    (``ENGINE_BUSY_WAIT_S`` by default)."""
    if not _slot.acquire(timeout=settings.ENGINE_BUSY_WAIT_S if wait_s is None else wait_s):
        raise EngineError(503, "ENGINE_BUSY", ENGINE_BUSY)
    try:
        yield
    finally:
        _slot.release()


class Deadline:
    """``ENGINE_PREVIEW_DEADLINE_S`` from the moment the work starts, checked between phases."""

    def __init__(self):
        self.started = _clock()
        self.limit = settings.ENGINE_PREVIEW_DEADLINE_S

    def check(self, phase: str) -> None:
        if _clock() - self.started >= self.limit:
            log.info("Preview deadline exceeded after phase %s", phase)
            raise EngineError(503, "DEADLINE_EXCEEDED",
                              f"La verificación superó el plazo de {self.limit} s; el modelo es demasiado grande para "
                              "verificarlo en el motor o el motor está cargado.")


class _Timer:
    def __init__(self, deadline: Deadline):
        self.deadline = deadline
        self.timings = dict.fromkeys(TIMINGS, 0)

    @contextmanager
    def phase(self, name: str):
        started = time.perf_counter()
        try:
            yield
        finally:
            self.timings[name] += round((time.perf_counter() - started) * 1000)
        self.deadline.check(name)


@dataclass
class Built:
    report: dict
    output: Optional[Path] = None
    sha256: Optional[str] = None

    @property
    def ok(self) -> bool:
        return bool(self.report["ok"])


# Operations that never touch an element's shape: its quantity before and after is the same.
GEOMETRY_FREE = frozenset({"ifc.set_material", "ifc.set_property"})


def geometry_free(recipe: Recipe, owners: dict) -> frozenset:
    """GlobalIds whose every declaring operation leaves the geometry as it was."""
    kinds = {op.id: op.op for op in recipe.operations}
    return frozenset(guid for guid, ids in owners.items() if ids and all(kinds.get(i) in GEOMETRY_FREE for i in ids))


def engine_versions() -> dict:
    return {"version": ENGINE_VERSION, "ifcopenshell": ifcopenshell.version,
            "ifcdiff": importlib.metadata.version("ifcdiff")}


def _result(op) -> dict:
    return {"id": op.id, "op": op.op, "ok": True, "element": op.element, "errors": [], "before": {}, "after": {},
            "findings": [], "declared": []}


def _layer1(issues: list) -> dict:
    return {"layer": 1, "name": "Comprobaciones de la operación", "status": "PASS" if not issues else "FAIL",
            "issues": issues[:LIMIT], "truncated": len(issues) > LIMIT}


def _rejected_report(report: dict, results: list) -> dict:
    """ok=false before anything was written: no diff, no layers 2 and 6, no quantities."""
    issues = [{"code": error["code"], "detail": error["detail"], "element": result["element"],
               "operation": result["id"]} for result in results for error in result["errors"]]
    report["validation"] = {"layers": [_layer1(issues),
                                       {"layer": 2, "name": validation.NAME, "status": "NOT_RUN", "reason": NOT_RUN},
                                       {"layer": 6, "name": "Alcance del cambio", "status": "NOT_RUN", "reason": NOT_RUN}],
                            "skipped": list(SKIPPED)}
    rejected = sum(1 for result in results if not result["ok"])
    report["errors"] = [{"code": "OPERATIONS_REJECTED",
                         "detail": f"{rejected} de {len(results)} operaciones no superaron sus comprobaciones."}]
    report["ok"] = False
    return report


def _affected(base, revised, declared: dict, owners: dict) -> list:
    found = []
    for guid in sorted(declared):
        element = by_guid(revised, guid) or by_guid(base, guid)
        found.append({"guid": guid, "class": element.is_a() if element is not None else None,
                      "name": reading.text(element.Name) if element is not None else None,
                      "operations": owners[guid]})
    return found[:LIMIT]


def build_and_verify(ref, recipe: Recipe, workdir: Path, deadline: Deadline) -> Built:
    """Apply ``recipe`` on a fresh copy of the base, write it into ``workdir`` and verify it.

    The caller owns ``workdir`` (a temporary directory removed in every branch) and holds the geometry slot.
    On ``ok`` the verified file is ``Built.output`` with its SHA-256; it is the caller who moves it out.
    """
    timer = _Timer(deadline)
    path = store.require_original(ref.project, ref.version, ref.sha256)
    results = [_result(op) for op in recipe.operations]
    with store.models.lease(ref.project, ref.version, ref.sha256) as lease:
        base = lease.model
        report = {"ok": False, "engine": engine_versions(),
                  "base": {"version": ref.version, "sha256": ref.sha256, "schema": base.schema},
                  "recipe_sha256": recipe_sha256(recipe), "operations": results, "affected": [], "findings": [],
                  "quantities": [], "diff": None, "validation": None, "errors": [], "timings_ms": timer.timings}

        # The same checks as checks_only, which reads a model the same way (reading._model_errors).
        with timer.phase("checks"), library(CHECKS_FAILED):
            for op, result in zip(recipe.operations, results):
                result["errors"] = check_one(base, op, recipe.operations)
                result["ok"] = not result["errors"]
        if not all(result["ok"] for result in results):
            return Built(_rejected_report(report, results))

        declared, owners = {}, {}
        with library(CHECKS_FAILED):
            for op, result in zip(recipe.operations, results):
                allowed = REGISTRY[op.op].declare(base, op)
                result["declared"] = [{"guid": guid, "allow": list(flags)} for guid, flags in sorted(allowed.items())]
                for guid, flags in allowed.items():
                    declared[guid] = sorted(set(declared.get(guid, [])) | set(flags))
                    owners.setdefault(guid, []).append(op.id)

        with timer.phase("open"), library(OPEN_FAILED):
            work = ifcopenshell.open(str(path), format=".ifc")
        with timer.phase("apply"):
            for op, result in zip(recipe.operations, results):
                try:
                    applied = REGISTRY[op.op].apply(work, op)
                except Rejected as rejected:
                    result["errors"], result["ok"] = [rejected.body()], False
                    continue
                except reading._MODEL_FAILURES:
                    log.exception("Operation %s failed while applying", op.op)
                    result["errors"], result["ok"] = [{"code": "APPLY_FAILED", "detail": APPLY_FAILED}], False
                    continue
                result.update(before=applied.before, after=applied.after, findings=applied.findings)
        if not all(result["ok"] for result in results):
            return Built(_rejected_report(report, results))

        output = Path(workdir) / "revision.ifc"
        with timer.phase("write"):
            with library(WRITE_FAILED):
                work.write(str(output))
            del work
            gc.collect()
        output_sha = store.sha_of(output)
        with timer.phase("reopen"), library(REOPEN_FAILED):
            revised = ifcopenshell.open(str(output), format=".ifc")

        with timer.phase("verify"):
            issues = []
            for op in recipe.operations:
                issues += [{**found, "element": found.get("element", op.element), "operation": op.id}
                           for found in REGISTRY[op.op].verify(base, revised, op, recipe.operations)]
            issues += invariants.check(base, revised, declared)
            invariants.require_original_unchanged(path, ref.sha256)
        with timer.phase("validate"), library(VALIDATE_FAILED):
            schema = validation.layer(ref.sha256, base, revised, LIMIT)
        with timer.phase("diff"):
            diff = scope.diff(base, revised, declared)
        with timer.phase("quantities"):
            unchanged = geometry_free(recipe, owners)
            lines, notices = quantities.lines(base, revised, sorted(declared), lambda: deadline.check("quantities"),
                                              unchanged)

        layers = [_layer1(issues), schema, scope.layer(diff)]
        report.update(
            affected=_affected(base, revised, declared, owners),
            findings=([finding for result in results for finding in result["findings"]] + notices)[:LIMIT],
            quantities=lines[:LIMIT], diff=diff, validation={"layers": layers, "skipped": list(SKIPPED)})
        errors = []
        if issues:
            errors.append({"code": "LAYER_1_FAILED", "detail": f"La capa 1 encontró {len(issues)} incidencias."})
        if schema["status"] != "PASS":
            errors.append({"code": "SCHEMA_NEW_ISSUES",
                           "detail": f"La revisión tiene {len(schema['new_issues'])} problemas de esquema nuevos."})
        if diff["unexpected"]:
            errors.append({"code": "SCOPE_UNEXPECTED",
                           "detail": f"{len(diff['unexpected'])} cambios quedan fuera del alcance declarado."})
        report["errors"] = errors
        report["ok"] = not errors
        return Built(report, output if report["ok"] else None, output_sha if report["ok"] else None)
