"""Verified preview artifacts, kept for /build (H1-ESPECIFICACION §5.6, §5.9).

An artifact is the IFC that a successful /preview wrote and verified. It lives in
``ENGINE_ARTIFACTS/{id}.ifc`` next to ``{id}.json``, its metadata ``{id, base_sha, recipe_sha, sha256, size,
created, expires_at}``, and is tied to the SHA-256 of its base and of its recipe:

- at most ``ENGINE_ARTIFACT_MAX`` files and ``ENGINE_ARTIFACT_MAX_BYTES`` bytes, each alive for
  ``ENGINE_ARTIFACT_TTL_S`` seconds; the least recently stored one is evicted first;
- ``take`` hands an artifact out once: /build sends those bytes and the artifact leaves the cache;
- the index lives in memory, so ``reset`` empties the directory when the engine starts. Files left by a
  previous process would otherwise never be evicted. A lost artifact breaks nothing: /build rebuilds.

Nothing unverified is ever stored here: only build.py's output of a preview with ``ok=true``.
"""
import json
import os
import shutil
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import settings

_guard = threading.Lock()
_index: "OrderedDict[str, Meta]" = OrderedDict()


def _now() -> float:
    return time.time()


@dataclass(frozen=True)
class Meta:
    id: str
    base_sha: str
    recipe_sha: str
    sha256: str
    size: int
    created: float

    @property
    def expires(self) -> float:
        return self.created + settings.ENGINE_ARTIFACT_TTL_S

    def public(self) -> dict:
        """The ``artifact`` object of the /preview report."""
        expires = datetime.fromtimestamp(self.expires, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return {"id": self.id, "sha256": self.sha256, "size": self.size, "expires_at": expires}


def directory() -> Path:
    return Path(settings.ENGINE_ARTIFACTS)


def _paths(artifact_id: str) -> tuple[Path, Path]:
    root = directory()
    return root / f"{artifact_id}.ifc", root / f"{artifact_id}.json"


def _drop(artifact_id: str) -> None:
    """Remove an artifact's files and index entry. The caller holds the guard."""
    _index.pop(artifact_id, None)
    for path in _paths(artifact_id):
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def _evict(now: float) -> None:
    for artifact_id in [key for key, meta in _index.items() if meta.expires <= now]:
        _drop(artifact_id)
    while _index and (len(_index) > settings.ENGINE_ARTIFACT_MAX
                      or sum(meta.size for meta in _index.values()) > settings.ENGINE_ARTIFACT_MAX_BYTES):
        _drop(next(iter(_index)))


def reset() -> None:
    """Empty ``ENGINE_ARTIFACTS`` and the index. Called when the engine starts."""
    with _guard:
        _index.clear()
        root = directory()
        if root.exists():
            shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True, exist_ok=True)


def put(source: Path, base_sha: str, recipe_sha: str, sha256: str) -> Meta:
    """Move the verified file at ``source`` into the cache and return its metadata.

    An artifact larger than ``ENGINE_ARTIFACT_MAX_BYTES`` is not kept (its metadata is still returned):
    /build will find nothing under that id and rebuild, which is the documented fallback.
    """
    size = os.stat(source).st_size
    meta = Meta(uuid.uuid4().hex, base_sha, recipe_sha, sha256, size, _now())
    with _guard:
        _evict(meta.created)
        if size > settings.ENGINE_ARTIFACT_MAX_BYTES:
            return meta
        root = directory()
        root.mkdir(parents=True, exist_ok=True)
        target, metadata = _paths(meta.id)
        shutil.move(str(source), str(target))
        metadata.write_text(json.dumps({**asdict(meta), "expires_at": meta.public()["expires_at"]}), encoding="utf-8")
        _index[meta.id] = meta
        _evict(meta.created)
    return meta


def take(artifact_id: Optional[str], base_sha: str, recipe_sha: str, destination: Path) -> Optional[Meta]:
    """Move the artifact out of the cache to ``destination`` when it exists, is alive and is tied to this
    base and this recipe. Anything else returns None and the caller rebuilds; an artifact tied to another
    base or recipe stays where it is."""
    if not artifact_id:
        return None
    with _guard:
        _evict(_now())
        meta = _index.get(artifact_id)
        if meta is None or meta.base_sha != base_sha or meta.recipe_sha != recipe_sha:
            return None
        source, _ = _paths(artifact_id)
        try:
            shutil.move(str(source), str(destination))
        except FileNotFoundError:
            _drop(artifact_id)
            return None
        _drop(artifact_id)
        return meta


def known() -> dict:
    """A copy of the index, for the tests (§5.11: the directory only holds artifacts of ok previews)."""
    with _guard:
        return dict(_index)
