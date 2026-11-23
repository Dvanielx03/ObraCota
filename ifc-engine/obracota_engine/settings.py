"""Engine configuration, read once from the environment at import time (H1-ESPECIFICACION §5.1, §5.9).

Modules read these values as attributes of this module at call time (``settings.ENGINE_ORIGINALS``),
never with ``from settings import ...``, so the tests can point them elsewhere with ``monkeypatch``.
"""
import os
from pathlib import Path


def _path(name: str, default: str) -> Path:
    return Path(os.environ.get(name) or default)


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from None
    if value < 1:
        raise ValueError(f"{name} must be at least 1, got {value}")
    return value


# Shared secret with the backend. Empty leaves the engine open (tests, bare docker run); compose.yaml requires it.
ENGINE_TOKEN = (os.environ.get("ENGINE_TOKEN") or "").strip()

# Read-only volume with the originals, one file per version: {root}/{project}/{version}, no extension.
# Same default as the root that engine.py had fixed before H1.
ENGINE_ORIGINALS = _path("ENGINE_ORIGINALS", "/srv/originals")

# Verified preview artifacts. /tmp is writable by user 10001 inside the container.
ENGINE_ARTIFACTS = _path("ENGINE_ARTIFACTS", "/tmp/obracota-artifacts")

# Read-only models kept open, by SHA-256. Step 0: an open ReStage adds about 500 MB, the Duplex 13 MB.
ENGINE_CACHE_MODELS = _positive_int("ENGINE_CACHE_MODELS", 2)

# Artifact cache: at most this many files and bytes, each one alive for this many seconds.
ENGINE_ARTIFACT_MAX = _positive_int("ENGINE_ARTIFACT_MAX", 4)
ENGINE_ARTIFACT_MAX_BYTES = _positive_int("ENGINE_ARTIFACT_MAX_BYTES", 1 << 30)
ENGINE_ARTIFACT_TTL_S = _positive_int("ENGINE_ARTIFACT_TTL_S", 900)

# Originals above this size get no preview (422 MODEL_TOO_LARGE). Fixed by the step 0 measurements:
# 32 MiB keeps a cold preview around 67 s and 2.1 GB at worst, under half the 150 s deadline.
ENGINE_PREVIEW_MAX_BYTES = _positive_int("ENGINE_PREVIEW_MAX_BYTES", 33_554_432)

# A preview, a rebuilding /build or a /diff is aborted at the next phase boundary after this many seconds.
ENGINE_PREVIEW_DEADLINE_S = _positive_int("ENGINE_PREVIEW_DEADLINE_S", 150)

# How long a request waits for the geometry semaphore before answering 503 ENGINE_BUSY.
ENGINE_BUSY_WAIT_S = _positive_int("ENGINE_BUSY_WAIT_S", 20)
# A single active geometry job protects the container's memory. Waiting previews occupy neither geometry nor IFC leases.
ENGINE_GEOMETRY_QUEUE_LIMIT = _positive_int("ENGINE_GEOMETRY_QUEUE_LIMIT", 2)
ENGINE_PREVIEW_WAIT_S = _positive_int("ENGINE_PREVIEW_WAIT_S", 60)

# --- Solids of 3D DWG (ACIS), /dwg/solids (ACIS-LECTOR.md §5) ---------------------------------------------
# Node and the @mlightcad/libredwg-web package that obracota_engine/dwg/extract.mjs runs (Dockerfile).
ENGINE_NODE = os.environ.get("ENGINE_NODE") or "node"
ENGINE_LIBREDWG_WEB = _path("ENGINE_LIBREDWG_WEB", "/opt/libredwg-web")
# JavaScript heap of the Node process that reads the DWG. Rug Dots (8.8 MB, 1,257 solids) peaks at about 306 MB
# of resident memory in total. This bounds only the JavaScript heap: LibreDWG's WebAssembly memory grows
# outside it (up to 4 GB by the wasm32 address space), and an address-space limit (RLIMIT_AS) cannot be used
# because V8 reserves its WebAssembly guard regions as virtual memory. The real bound of the reader is the
# container's memory limit (ACIS-LECTOR §5, risks).
ENGINE_DWG_NODE_HEAP_MB = _positive_int("ENGINE_DWG_NODE_HEAP_MB", 512)

# DWG originals above this size get 422 MODEL_TOO_LARGE before anything is read (same bound as /preview).
ENGINE_SOLIDS_MAX_BYTES = _positive_int("ENGINE_SOLIDS_MAX_BYTES", 33_554_432)
# Reading plus meshing is aborted after this many seconds (503 DEADLINE_EXCEEDED). A request's whole budget
# is ENGINE_BUSY_WAIT_S + this (170 s by default), below the backend's dwg.solids.timeout (180 s).
ENGINE_SOLIDS_DEADLINE_S = _positive_int("ENGINE_SOLIDS_DEADLINE_S", 150)
# Above this many triangles the answer is 422 MESH_TOO_LARGE (about 24 bytes a triangle before gzip).
ENGINE_SOLIDS_MAX_TRIANGLES = _positive_int("ENGINE_SOLIDS_MAX_TRIANGLES", 4_000_000)

# Meshes on disk by SHA-256 of the original and tessellator version; the oldest go above this many bytes.
ENGINE_SOLIDS_CACHE = _path("ENGINE_SOLIDS_CACHE", "/tmp/obracota-solids")
ENGINE_SOLIDS_CACHE_MAX_BYTES = _positive_int("ENGINE_SOLIDS_CACHE_MAX_BYTES", 512 * 1024 * 1024)
