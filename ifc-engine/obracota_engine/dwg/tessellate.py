"""ACIS bodies of a DWG as one triangle mesh in millimetres (ACIS-LECTOR §3-§4).

Every SAB block becomes ``IfcAdvancedBrep`` entities in a scratch IFC4 file (``brep``) and IfcOpenShell meshes
each one with OpenCASCADE. The mesh of a body is then placed with the body's ACIS transform, each of the
entity's placements in model space (block inserts) and the drawing unit (``$INSUNITS``), never ACIS's own unit.

Deflection. OCCT's linear deflection is the largest distance between the mesh and the exact surface. It is
fixed in millimetres of the drawing (``LINEAR_DEFLECTION_MM``) and converted to the body's own coordinates:
divided by the drawing unit and by the largest scale of the ACIS transform and of the body's placements, so
an inch file, a block inserted at ten times its size and a millimetre file get the same precision. The
angular deflection bounds the facets of small curved parts. Measured against the FBX/OBJ in
tests/test_dwg_solids.py and ACIS-LECTOR §5.

Orientation. Triangles run counter-clockwise seen from outside. A body whose mesh encloses a negative volume
after its ACIS transform is reversed, and so is every placement that mirrors (negative determinant, such as
an insert with X scale -1).

Cache identity. ``TESSELLATOR`` names the meshes in the cache and in the ETag. It joins ``PIPELINE`` with a
fingerprint of the sources that decide the mesh (``extract.mjs``, the SAB reader, the B-rep builder, this
module, the mesh format), of the libredwg-web package and of IfcOpenShell, so changing any of them
invalidates the cached meshes by itself. ``PIPELINE`` is bumped by hand only for a change none of those
sources show.

A body that fails is reported with its handle and the reason; the others are still meshed. Faces this reader
does not convert are counted per body.
"""
import hashlib
import json
import logging
import struct
import time
from dataclasses import dataclass, field
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import numpy as np

from .. import settings
from ..errors import EngineError
from .brep import BrepBuilder
from .reader import Extraction
from .sab import Sab, SabError

log = logging.getLogger(__name__)

PIPELINE = 2
LINEAR_DEFLECTION_MM = 0.1
ANGULAR_DEFLECTION_RAD = 0.25
# Bounds of the scale used to refine the deflection: a block inserted at 10 000 times its size would ask OCCT
# for a mesh far finer than any screen needs; it is meshed as if inserted at 1 000.
_MAX_REFINE = 1000.0
MESH_TOO_LARGE = "El DWG genera más triángulos de los que el visor puede recibir ({n})."
DEADLINE = "El teselado de los sólidos superó el tiempo permitido."
_OCCT_FAILURES = (RuntimeError, ValueError, TypeError, AttributeError, IndexError, KeyError, ArithmeticError)
# A body whose SAB is truncated or malformed is one failed body, never a failed request.
_SAB_FAILURES = (SabError, ValueError, IndexError, KeyError, TypeError, AttributeError, ArithmeticError,
                 struct.error, RecursionError, UnicodeDecodeError)
_SOURCES = ("extract.mjs", "reader.py", "sab.py", "brep.py", "tessellate.py", "units.py", "meshfile.py")


def _fingerprint() -> str:
    digest = hashlib.sha256(f"pipeline {PIPELINE}|ifcopenshell {ifcopenshell.version}|".encode())
    here = Path(__file__).parent
    for name in _SOURCES:
        # Line endings are normalised so a checkout on Windows and the image hash the same text.
        text = (here / name).read_bytes().replace(b"\r\n", b"\n")
        digest.update(name.encode() + b"|" + hashlib.sha256(text).digest())
    try:
        package = json.loads((Path(settings.ENGINE_LIBREDWG_WEB) / "package.json").read_text(encoding="utf-8"))
        digest.update(f"{package.get('name')}@{package.get('version')}".encode())
    except (OSError, ValueError):
        digest.update(b"libredwg-web missing")
    return digest.hexdigest()[:10]


# Cache key and ETag: SHA-256 of the original + this (module docstring, «Cache identity»).
TESSELLATOR = f"acis-occt-{PIPELINE}-{_fingerprint()}"


@dataclass
class Mesh:
    positions: np.ndarray            # (V, 3) float64, millimetres, drawing world coordinates (Z up)
    indices: np.ndarray              # (T, 3) uint32, global vertex indices
    bodies: list                     # one dict per placed body
    failed: list = field(default_factory=list)
    faces_skipped: int = 0
    timings_ms: dict = field(default_factory=dict)


def _settings(deflection: float):
    s = ifcopenshell.geom.settings()
    s.set("mesher-linear-deflection", deflection)
    s.set("mesher-angular-deflection", ANGULAR_DEFLECTION_RAD)
    s.set("use-world-coords", True)
    s.set("weld-vertices", False)
    # The loops come from a valid ACIS B-rep; IfcOpenShell's check for self-intersecting wires (meant for
    # hand-made IFC profiles) took 85 % of the time on Rug Dots (6.7 s -> 1.0 s on 100 bodies) and changed
    # no triangle.
    s.set("no-wire-intersection-check", True)
    return s


def _area(v: np.ndarray, t: np.ndarray) -> float:
    if not len(t):
        return 0.0
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    return float(0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum())


def _signed_volume(v: np.ndarray, t: np.ndarray) -> float:
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def _scale(matrix) -> float:
    """The largest factor by which ``matrix`` (3x3 or 4x4) stretches a length: the largest column norm."""
    if matrix is None:
        return 1.0
    return float(np.linalg.norm(np.asarray(matrix, dtype=float)[:3, :3], axis=0).max())


def deflection(to_mm: float, acis_transform, placements) -> float:
    """OCCT's linear deflection in the body's own coordinates for ``LINEAR_DEFLECTION_MM`` in the drawing."""
    stretch = _scale(acis_transform) * max((_scale(p.matrix) for p in placements), default=1.0)
    if not np.isfinite(stretch) or stretch <= 0:
        stretch = 1.0
    return LINEAR_DEFLECTION_MM / (to_mm * min(stretch, _MAX_REFINE))


def tessellate(extraction: Extraction, deadline_at: float, max_triangles: int) -> Mesh:
    to_mm = extraction.to_mm
    settings_by_deflection = {}
    ifc = ifcopenshell.file(schema="IFC4")
    positions, indices, bodies, failed = [], [], [], []
    vertex_count = triangle_count = faces_skipped = 0
    parse_s = mesh_s = 0.0

    def fail(body, reason):
        for placement in body.placements:
            failed.append({"handle": body.handle, "type": body.type, "layer": placement.layer, "reason": reason})

    for body in extraction.bodies:
        if time.monotonic() > deadline_at:
            raise EngineError(503, "DEADLINE_EXCEEDED", DEADLINE)
        started = time.perf_counter()
        try:
            builder = BrepBuilder(ifc, Sab(body.sab))
            breps = builder.bodies()
        except _SAB_FAILURES as exc:
            parse_s += time.perf_counter() - started
            fail(body, f"ACIS ilegible: {exc}")
            continue
        parse_s += time.perf_counter() - started
        faces_skipped += builder.skipped_faces
        for brep, acis_transform in breps:
            if brep is None:
                fail(body, "Cuerpo sin caras convertibles" + _reasons(builder))
                continue
            started = time.perf_counter()
            linear = float(f"{deflection(to_mm, acis_transform, body.placements):.3g}")
            if linear not in settings_by_deflection:
                settings_by_deflection[linear] = _settings(linear)
            try:
                shape = ifcopenshell.geom.create_shape(settings_by_deflection[linear], brep)
                v = np.asarray(shape.verts, dtype=float).reshape(-1, 3)
                t = np.asarray(shape.faces, dtype=np.int64).reshape(-1, 3)
            except _OCCT_FAILURES as exc:
                mesh_s += time.perf_counter() - started
                fail(body, f"OpenCASCADE no pudo teselar el cuerpo: {type(exc).__name__}")
                continue
            mesh_s += time.perf_counter() - started
            if not len(t):
                fail(body, "El teselado no produjo triángulos" + _reasons(builder))
                continue
            if acis_transform is not None:
                v = v @ acis_transform[:3, :3].T + acis_transform[:3, 3]
            # A solid whose triangles enclose a negative volume came out inside out (seen on a tolerant ODA
            # body): its winding is reversed so that the normals point outwards.
            reoriented = _signed_volume(v, t) < 0
            if reoriented:
                t = t[:, ::-1]
            homogeneous = np.c_[v, np.ones(len(v))]
            for instance, placement in enumerate(body.placements):
                world = (homogeneous @ placement.matrix.T)[:, :3] * to_mm
                # A mirroring placement (X scale -1...) turns the triangles inside out: reverse them back.
                mirrored = bool(np.linalg.det(placement.matrix[:3, :3]) < 0)
                placed = t[:, ::-1] if mirrored else t
                if triangle_count + len(t) > max_triangles:
                    raise EngineError(422, "MESH_TOO_LARGE", MESH_TOO_LARGE.format(n=f"{max_triangles:,}".replace(",", ".")))
                lo, hi = world.min(axis=0), world.max(axis=0)
                bodies.append({
                    "handle": body.handle, "type": body.type, "layer": placement.layer, "instance": instance,
                    "first_vertex": vertex_count, "vertex_count": int(len(world)),
                    "first_triangle": triangle_count, "triangle_count": int(len(t)),
                    "bbox_mm": {"min": [round(float(x), 4) for x in lo], "max": [round(float(x), 4) for x in hi]},
                    "area_mm2": round(_area(world, placed), 3),
                    "faces_skipped": builder.skipped_faces,
                    "reoriented": bool(reoriented),
                    "mirrored": mirrored,
                })
                positions.append(world)
                indices.append(placed + vertex_count)
                vertex_count += len(world)
                triangle_count += len(t)
        del builder
    mesh = Mesh(
        positions=np.concatenate(positions) if positions else np.zeros((0, 3)),
        indices=(np.concatenate(indices) if indices else np.zeros((0, 3), dtype=np.int64)).astype(np.uint32),
        bodies=bodies, failed=failed, faces_skipped=faces_skipped,
        timings_ms={"brep": round(parse_s * 1000), "occt": round(mesh_s * 1000)})
    return mesh


def _reasons(builder: BrepBuilder) -> str:
    if not builder.reasons:
        return ""
    return " (" + ", ".join(f"{k}: {n}" for k, n in sorted(builder.reasons.items())) + ")"
