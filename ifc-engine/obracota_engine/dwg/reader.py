"""The ACIS blocks of a DWG and where they sit, read by ``extract.mjs`` (LibreDWG in WebAssembly, under Node).

The engine is Python, but no maintained Python library reads DWG R2013+ (the ACIS data of AC1027/AC1032
lives in the compressed AcDs section). ``@mlightcad/libredwg-web`` is the reader the viewer already uses and
the one ACIS-LECTOR.md §1 validated byte for byte against ACadSharp. Running it as WebAssembly keeps the
memory bugs LibreDWG admits to inside the module's sandbox, and the process has a time and memory limit.

``parse`` reads the stream ``extract.mjs`` writes (uint32 length, JSON manifest, ACIS blocks), so the tests can
feed it a saved stream without Node.
"""
import json
import os
import struct
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import units
from .. import settings
from ..errors import EngineError

SCRIPT = Path(__file__).with_name("extract.mjs")
UNREADABLE = "No se pudo leer el DWG para extraer sus sólidos."
TOO_SLOW = "La lectura del DWG superó el tiempo permitido."


@dataclass(frozen=True)
class Placement:
    matrix: np.ndarray  # 4x4, column vectors, drawing units
    layer: str


@dataclass(frozen=True)
class Body:
    handle: str
    type: str
    sab: bytes
    placements: tuple


@dataclass
class Extraction:
    dwg_version: str
    insunits: int
    bodies: list
    skipped: dict = field(default_factory=dict)

    @property
    def to_mm(self) -> float:
        return units.to_mm(self.insunits)


def parse(stream: bytes) -> Extraction:
    if len(stream) < 4:
        raise EngineError(422, "DWG_UNREADABLE", UNREADABLE)
    size = struct.unpack_from("<I", stream, 0)[0]
    if 4 + size > len(stream):
        raise EngineError(422, "DWG_UNREADABLE", UNREADABLE)
    try:
        manifest = json.loads(stream[4:4 + size].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EngineError(422, "DWG_UNREADABLE", UNREADABLE) from exc
    tail = memoryview(stream)[4 + size:]
    bodies = []
    for item in manifest.get("bodies", []):
        start, length = int(item["offset"]), int(item["size"])
        if start < 0 or start + length > len(tail):
            raise EngineError(422, "DWG_UNREADABLE", UNREADABLE)
        placements = tuple(Placement(np.array(p["matrix"], dtype=float).reshape(4, 4).T, str(p.get("layer") or "0"))
                           for p in item.get("placements", []))
        bodies.append(Body(str(item["handle"]), str(item["type"]), bytes(tail[start:start + length]), placements))
    return Extraction(str(manifest.get("dwg", "")), int(manifest.get("insunits") or 0), bodies,
                      dict(manifest.get("skipped") or {}))


def extract(path: Path, deadline_s: float) -> Extraction:
    """Runs ``extract.mjs`` on the DWG at ``path``."""
    package = settings.ENGINE_LIBREDWG_WEB
    if not (Path(package) / "dist" / "libredwg-web.js").is_file():
        raise EngineError(503, "DWG_READER_MISSING", "El lector DWG del motor no está instalado.")
    command = [settings.ENGINE_NODE, f"--max-old-space-size={settings.ENGINE_DWG_NODE_HEAP_MB}",
               str(SCRIPT), str(package), str(path)]
    try:
        done = subprocess.run(command, capture_output=True, timeout=max(1.0, deadline_s), check=False,
                              env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "NODE_OPTIONS": ""})
    except subprocess.TimeoutExpired as exc:
        raise EngineError(503, "DEADLINE_EXCEEDED", TOO_SLOW) from exc
    except OSError as exc:
        raise EngineError(503, "DWG_READER_MISSING", "El lector DWG del motor no está instalado.") from exc
    if done.returncode == 3:
        detail = UNREADABLE
        code = "DWG_UNREADABLE"
        try:
            failure = json.loads(done.stderr.decode("utf-8").strip().splitlines()[-1])
            code, detail = str(failure["code"]), str(failure["detail"])
        except (ValueError, KeyError, IndexError, UnicodeDecodeError):
            pass
        raise EngineError(422, code, detail)
    if done.returncode != 0:
        raise EngineError(422, "DWG_UNREADABLE", UNREADABLE)
    return parse(done.stdout)
