"""/dwg/solids: the ACIS solids of a stored DWG version as one mesh, cached on disk (ACIS-LECTOR.md §5).

Order of a request:

1. ``reading.version_ref`` validates project, version and SHA-256 (400 ``PARAMS_INVALID``);
   ``store.require_original`` proves the original exists with that SHA-256 (404 / 409).
2. A cached mesh ``{ENGINE_SOLIDS_CACHE}/{sha256}.{TESSELLATOR}.ocsolid.gz`` is answered as it is: the cache
   key is the content of the original plus the version of the tessellator, so a new tessellator never
   serves an old mesh. A hit takes neither the geometry slot nor the size limit.
3. Otherwise: 422 ``MODEL_TOO_LARGE`` above ``ENGINE_SOLIDS_MAX_BYTES``; 422 ``NOT_DWG`` when the file does not
   start with ``AC10``; then the global geometry slot of ``build`` (503 ``ENGINE_BUSY``), reading (``reader``),
   meshing (``tessellate``) and encoding (``meshfile``) (503 ``DEADLINE_EXCEEDED``).

   Every request has one budget, ``ENGINE_BUSY_WAIT_S + ENGINE_SOLIDS_DEADLINE_S`` (170 s by default) from the
   moment it arrives, below the backend's ``dwg.solids.timeout`` (180 s). Two requests for the same SHA-256
   compute it once: the second waits for the first, which costs no CPU, for as long as its budget lasts (not
   only ``ENGINE_BUSY_WAIT_S``: Rug Dots takes 21 s) and then reads its file. The wait for the global slot and
   the meshing take what is left, each within its own limit. The locks per SHA-256 live while someone holds
   or waits for them (a weak dictionary), so they do not pile up.
4. The file is written to a temporary name and renamed, so a reader never sees half a mesh. Above
   ``ENGINE_SOLIDS_CACHE_MAX_BYTES`` the least recently used meshes are deleted.
"""
import logging
import os
import tempfile
import threading
import time
import weakref
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .. import ENGINE_VERSION, settings, store
from ..build import geometry_slot
from ..errors import EngineError
from . import meshfile, reader, tessellate, units

log = logging.getLogger(__name__)

NOT_DWG = "La versión no es un DWG."
TOO_LARGE = "El DWG supera el tamaño que el motor puede teselar ({mb} MB)."

BUSY = "El motor está teselando este DWG; vuelve a intentarlo en un momento."

_locks = weakref.WeakValueDictionary()
_locks_guard = threading.Lock()


@dataclass(frozen=True)
class Solids:
    path: Path
    sha256: str
    hit: bool

    @property
    def etag(self) -> str:
        return etag(self.sha256)


def etag(sha256: str) -> str:
    """The strong validator of the mesh of an original: its SHA-256 and the tessellator."""
    return f'"{sha256}.{tessellate.TESSELLATOR}"'


def matches(if_none_match, sha256: str) -> bool:
    """RFC 9110 §13.1.2: ``If-None-Match`` names the current mesh (weak comparison, a list or ``*``)."""
    if not if_none_match:
        return False
    current = etag(sha256)
    tags = [tag.strip() for tag in if_none_match.split(",")]
    return any(tag == "*" or (tag[2:] if tag.startswith("W/") else tag) == current for tag in tags)


def not_modified(ref, if_none_match) -> bool:
    """True when the caller already holds the current mesh: answered 304 without meshing or reading the cache.
    The original is checked first (404 / 409), as for a full answer."""
    if not if_none_match:
        return False
    store.require_original(ref.project, ref.version, ref.sha256)
    return matches(if_none_match, ref.sha256)


def cache_path(sha256: str) -> Path:
    return Path(settings.ENGINE_SOLIDS_CACHE) / f"{sha256}.{tessellate.TESSELLATOR}.ocsolid.gz"


def _lock(sha256: str) -> threading.Lock:
    with _locks_guard:
        lock = _locks.get(sha256)
        if lock is None:
            lock = threading.Lock()
            _locks[sha256] = lock
        return lock


def solids(ref) -> Solids:
    arrived = time.monotonic()
    budget_at = arrived + settings.ENGINE_BUSY_WAIT_S + settings.ENGINE_SOLIDS_DEADLINE_S
    original = store.require_original(ref.project, ref.version, ref.sha256)
    target = cache_path(ref.sha256)
    if target.is_file():
        _touch(target)
        return Solids(target, ref.sha256, True)
    size = os.stat(original).st_size
    if size > settings.ENGINE_SOLIDS_MAX_BYTES:
        raise EngineError(422, "MODEL_TOO_LARGE", TOO_LARGE.format(mb=max(1, round(size / 1_000_000))))
    with open(original, "rb") as source:
        head = source.read(6)
    if len(head) < 6 or not head.startswith(b"AC10") or not head[4:6].isdigit():
        raise EngineError(422, "NOT_DWG", NOT_DWG)
    lock = _lock(ref.sha256)
    if not lock.acquire(timeout=max(0.0, budget_at - time.monotonic())):
        raise EngineError(503, "ENGINE_BUSY", BUSY)
    try:
        if target.is_file():
            _touch(target)
            return Solids(target, ref.sha256, True)
        with geometry_slot(min(settings.ENGINE_BUSY_WAIT_S, max(0.0, budget_at - time.monotonic()))):
            left = min(settings.ENGINE_SOLIDS_DEADLINE_S, budget_at - time.monotonic())
            if left < 1:
                raise EngineError(503, "ENGINE_BUSY", BUSY)
            payload = build(original, ref.sha256, left)
        _store(target, payload)
        return Solids(target, ref.sha256, False)
    finally:
        lock.release()


def build(original: Path, sha256: str, deadline_s: float = None) -> bytes:
    """The encoded mesh of the DWG at ``original`` (no cache, no slot): what the tests call directly."""
    started = time.monotonic()
    deadline_at = started + (settings.ENGINE_SOLIDS_DEADLINE_S if deadline_s is None else deadline_s)
    extraction = reader.extract(original, deadline_at - time.monotonic())
    read_ms = round((time.monotonic() - started) * 1000)
    mesh = tessellate.tessellate(extraction, deadline_at, settings.ENGINE_SOLIDS_MAX_TRIANGLES)
    return encode(mesh, extraction, sha256, read_ms)


def encode(mesh, extraction, sha256: str, read_ms: int = 0) -> bytes:
    positions = mesh.positions
    if len(positions):
        lo, hi = positions.min(axis=0), positions.max(axis=0)
        origin = np.round((lo + hi) / 2, 3)
    else:
        lo = hi = origin = np.zeros(3)
    header = {
        "engine": ENGINE_VERSION,
        "tessellator": tessellate.TESSELLATOR,
        "source_sha256": sha256,
        "dwg_version": extraction.dwg_version,
        "units": {"insunits": extraction.insunits, "name": units.name(extraction.insunits), "to_mm": extraction.to_mm},
        "deflection": {"linear_mm": tessellate.LINEAR_DEFLECTION_MM, "angular_rad": tessellate.ANGULAR_DEFLECTION_RAD},
        "origin_mm": [float(x) for x in origin],
        "bbox_mm": {"min": [round(float(x), 4) for x in lo], "max": [round(float(x), 4) for x in hi]},
        "bodies": mesh.bodies,
        "failed": mesh.failed,
        "skipped": extraction.skipped,
        "faces_skipped": mesh.faces_skipped,
        "timings_ms": {"read": read_ms, **mesh.timings_ms},
    }
    return meshfile.encode(header, positions - origin, mesh.indices)


def _store(target: Path, payload: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=target.parent, prefix=".tmp-", suffix=".gz")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(payload)
        os.replace(temporary, target)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    _evict(target)


def _touch(path: Path) -> None:
    try:
        os.utime(path)
    except OSError:
        pass


def _evict(keep: Path) -> None:
    """Deletes the least recently used meshes until the cache fits; the one just written always stays."""
    try:
        entries = [(p.stat().st_mtime, p.stat().st_size, p) for p in Path(keep.parent).glob("*.ocsolid.gz")]
    except OSError:
        return
    total = sum(size for _, size, _ in entries)
    for _, size, path in sorted(entries):
        if total <= settings.ENGINE_SOLIDS_CACHE_MAX_BYTES:
            break
        if path == keep:
            continue
        try:
            path.unlink()
            total -= size
        except OSError:
            pass
