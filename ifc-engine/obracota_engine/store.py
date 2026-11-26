"""Originals on disk: their path, their SHA-256 and a small cache of open read-only models (§5.2, §5.9).

- ``original_path`` is ``ENGINE_ORIGINALS/{project}/{version}``, without extension, as before H1.
- ``sha_of`` hashes in 1 MiB blocks and memoises by ``(path, size, mtime_ns)``. Versions are immutable
  (the backend writes them with CREATE_NEW), so a changed size or mtime can only mean another file.
  ``fresh=True`` reads the bytes again whatever the memo says (invariant 1d, §5.7).
- ``ModelCache`` keeps the last ``ENGINE_CACHE_MODELS`` models opened for reading, by SHA-256, each with
  its own lock. It is only for reading: anything that writes opens the file again from disk.
  A full preview holds the lock of its base for the whole build (validate, both IfcDiff passes and the
  quantities read it), so every lease waits at most ``ENGINE_BUSY_WAIT_S`` for it and then answers 503
  ``ENGINE_BUSY``: a reading of that model never waits without bound behind a preview (R3).
- ``preview_limit_reason`` says why an original is too large for a preview (``ENGINE_PREVIEW_MAX_BYTES``, or
  ``ENGINE_DATA_PREVIEW_MAX_BYTES`` for a recipe that changes no geometry); ``geometry_limit_reason`` says it for a
  change of geometry of an IFC. Reading such a model still works; only the operations are marked as not available.
"""
import hashlib
import os
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator, Optional

import ifcopenshell

from . import settings
from .errors import EngineError

_BLOCK = 1 << 20
_SHA_MEMO_MAX = 1024
MODEL_BUSY = "El motor IFC está ocupado verificando un cambio de este modelo; vuelve a intentarlo en un momento."

_sha_memo: "OrderedDict[tuple[str, int, int], str]" = OrderedDict()
_sha_guard = threading.Lock()


def original_path(project, version) -> Path:
    return Path(settings.ENGINE_ORIGINALS) / str(project) / str(version)


def sha_of(path, fresh: bool = False) -> str:
    """SHA-256 of a file, memoised by path, size and modification time; ``fresh`` skips the memo."""
    stat = os.stat(path)
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    with _sha_guard:
        known = None if fresh else _sha_memo.get(key)
        if known is not None:
            _sha_memo.move_to_end(key)
            return known
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(_BLOCK), b""):
            digest.update(block)
    value = digest.hexdigest()
    with _sha_guard:
        _sha_memo[key] = value
        while len(_sha_memo) > _SHA_MEMO_MAX:
            _sha_memo.popitem(last=False)
    return value


def require_original(project, version, sha256: str) -> Path:
    """Path of an existing original whose bytes have the SHA-256 the caller expects (checked every time;
    the memo makes it a ``stat`` once the file was hashed)."""
    path = original_path(project, version)
    if not path.is_file():
        raise EngineError(404, "VERSION_NOT_FOUND", "Versión IFC no disponible.")
    if sha_of(path) != sha256:
        raise EngineError(409, "SHA_MISMATCH", "El archivo de la versión no coincide con su SHA-256.")
    return path


def _megabytes(size: int) -> int:
    return max(1, round(size / 1_000_000))


def preview_limit_reason(path, geometry_free: bool = False) -> Optional[str]:
    """Why the original at ``path`` gets no preview, or None when it fits.

    The limit is ``ENGINE_PREVIEW_MAX_BYTES``, or ``ENGINE_DATA_PREVIEW_MAX_BYTES`` for a recipe that changes no
    geometry (``geometry_free``). The size is told in decimal megabytes, rounded: ReStage (189,817,172 bytes) reads
    «190 MB». DWG revisions and /diff keep this wording; an IFC recipe that changes geometry has its own
    (``geometry_limit_reason``).
    """
    size = os.stat(path).st_size
    if size <= (settings.ENGINE_DATA_PREVIEW_MAX_BYTES if geometry_free else settings.ENGINE_PREVIEW_MAX_BYTES):
        return None
    return f"El modelo supera el tamaño que H1 puede verificar ({_megabytes(size)} MB)."


def geometry_limit_reason(path) -> Optional[str]:
    """Why an IFC original takes no change of geometry (``ifc.change_type``), or None under ``ENGINE_PREVIEW_MAX_BYTES``.

    The same sentence as the backend and the app: the size, the limit, and what still works on that model."""
    size = os.stat(path).st_size
    if size <= settings.ENGINE_PREVIEW_MAX_BYTES:
        return None
    return geometry_limit_text(size)


def geometry_limit_text(size: int) -> str:
    limit = settings.ENGINE_PREVIEW_MAX_BYTES / 1_048_576
    return (f"El modelo pesa {_megabytes(size)} MB: el motor verifica cambios de geometría en el IFC, como el cambio de "
            f"tipo, hasta {limit:g} MiB. Las propiedades y los materiales sí se cambian en este modelo.")


def _open_ifc(path: Path) -> ifcopenshell.file:
    try:
        return ifcopenshell.open(str(path), format=".ifc")
    except (RuntimeError, OSError, ValueError, ifcopenshell.Error) as exc:
        raise EngineError(422, "MODEL_UNREADABLE", "El archivo de la versión no se pudo leer como IFC.") from exc


@dataclass
class CachedModel:
    sha256: str
    model: ifcopenshell.file
    lock: threading.Lock = field(default_factory=threading.Lock)


@dataclass(frozen=True)
class Lease:
    """A cached model while its reader holds the lock, with what the request cost.

    ``hit`` is False only for the request that opened the file; ``open_ms`` is the time that request spent
    opening it (0 on a hit). ``path`` is the checked original, for its size.
    """

    model: ifcopenshell.file
    path: Path
    hit: bool
    open_ms: int


class ModelCache:
    """LRU of open read-only models by SHA-256.

    Opening happens outside the cache guard, so models with different SHA-256 open in parallel; two
    requests for the same SHA-256 wait for one opening. Readers hold ``CachedModel.lock`` while they use
    the model; an evicted model stays alive for whoever still holds it. Every request checks the original
    against its SHA-256 first, also on a hit (a ``stat`` once the file was hashed).
    """

    def __init__(self, capacity: Optional[int] = None, opener: Callable[[Path], ifcopenshell.file] = _open_ifc):
        self._capacity = capacity
        self._opener = opener
        self._entries: "OrderedDict[str, CachedModel]" = OrderedDict()
        self._opening: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        self.opens = 0

    @property
    def capacity(self) -> int:
        return self._capacity if self._capacity is not None else settings.ENGINE_CACHE_MODELS

    def __len__(self) -> int:
        with self._guard:
            return len(self._entries)

    def __contains__(self, sha256: str) -> bool:
        with self._guard:
            return sha256 in self._entries

    def get(self, project, version, sha256: str) -> CachedModel:
        return self._fetch(project, version, sha256)[0]

    def _fetch(self, project, version, sha256: str) -> tuple[CachedModel, Path, bool, int]:
        path = require_original(project, version, sha256)
        with self._guard:
            entry = self._hit(sha256)
            if entry:
                return entry, path, True, 0
            opening = self._opening.setdefault(sha256, threading.Lock())
        with opening:
            with self._guard:
                entry = self._hit(sha256)
                if entry:
                    return entry, path, True, 0
            started = time.perf_counter()
            try:
                entry = CachedModel(sha256, self._opener(path))
            except BaseException:
                with self._guard:
                    self._opening.pop(sha256, None)
                raise
            open_ms = round((time.perf_counter() - started) * 1000)
            with self._guard:
                self._entries[sha256] = entry
                self.opens += 1
                while len(self._entries) > self.capacity:
                    self._entries.popitem(last=False)
                self._opening.pop(sha256, None)
            return entry, path, False, open_ms

    @contextmanager
    def reading(self, project, version, sha256: str) -> Iterator[ifcopenshell.file]:
        with self.lease(project, version, sha256) as lease:
            yield lease.model

    @contextmanager
    def lease(self, project, version, sha256: str) -> Iterator[Lease]:
        """The model with its lock held, plus whether this request found it open and what opening cost.

        The lock is waited for at most ``ENGINE_BUSY_WAIT_S``; then 503 ``ENGINE_BUSY``.
        """
        entry, path, hit, open_ms = self._fetch(project, version, sha256)
        if not entry.lock.acquire(timeout=settings.ENGINE_BUSY_WAIT_S):
            raise EngineError(503, "ENGINE_BUSY", MODEL_BUSY)
        try:
            yield Lease(entry.model, path, hit, open_ms)
        finally:
            entry.lock.release()

    def clear(self) -> None:
        with self._guard:
            self._entries.clear()

    def _hit(self, sha256: str) -> Optional[CachedModel]:
        entry = self._entries.get(sha256)
        if entry:
            self._entries.move_to_end(sha256)
        return entry


models = ModelCache()
