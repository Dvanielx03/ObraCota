"""The mesh format of /dwg/solids: ``obracota.dwg-solids/1`` (ACIS-LECTOR.md §5).

The whole answer is gzip (RFC 1952) of::

    offset  size        content
    0       8           ASCII "OCSOLID1"
    8       4           uint32 LE: H, length of the JSON header in bytes (a multiple of 4)
    12      H           JSON header, UTF-8, padded with spaces
    12+H    12 x V      float32 LE positions x, y, z: millimetres, relative to header.origin_mm, drawing axes (Z up)
    ...     12 x T      uint32 LE triangle corners, indices into the positions, counter-clockwise from outside

V is ``header.vertex_count`` and T ``header.triangle_count``. Each entry of ``header.bodies`` is one placement
of one ACIS entity: ``handle``, ``type`` (3DSOLID, BODY, REGION), ``layer`` (after block inheritance),
``instance`` (0 for the first placement), its ranges ``first_vertex``/``vertex_count`` and
``first_triangle``/``triangle_count``, ``bbox_mm``, ``area_mm2``, ``faces_skipped``, ``reoriented`` (the ACIS
body came out inside out and was reversed) and ``mirrored`` (the placement mirrors, its triangles were reversed
so they still run counter-clockwise from outside). Vertices are not shared between the faces
of a body, so per-vertex normals computed from the triangles stay sharp at the edges.
"""
import gzip
import json
import struct

import numpy as np

MAGIC = b"OCSOLID1"
FORMAT = "obracota.dwg-solids/1"
MEDIA_TYPE = "application/gzip"


def encode(header: dict, positions: np.ndarray, indices: np.ndarray, level: int = 6) -> bytes:
    positions = np.ascontiguousarray(positions, dtype="<f4").reshape(-1, 3)
    indices = np.ascontiguousarray(indices, dtype="<u4").reshape(-1, 3)
    header = {**header, "format": FORMAT, "vertex_count": int(len(positions)), "triangle_count": int(len(indices))}
    text = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    raw = b"".join([MAGIC, struct.pack("<I", len(text)), text, positions.tobytes(), indices.tobytes()])
    return gzip.compress(raw, compresslevel=level, mtime=0)


def decode(payload: bytes) -> tuple:
    """``(header, positions (V, 3) float32, indices (T, 3) uint32)``; the inverse of ``encode``."""
    raw = gzip.decompress(payload)
    if raw[:8] != MAGIC:
        raise ValueError("Not an obracota.dwg-solids/1 mesh")
    size = struct.unpack_from("<I", raw, 8)[0]
    header = json.loads(raw[12:12 + size].decode("utf-8"))
    start = 12 + size
    v, t = header["vertex_count"], header["triangle_count"]
    positions = np.frombuffer(raw, dtype="<f4", count=3 * v, offset=start).reshape(-1, 3)
    indices = np.frombuffer(raw, dtype="<u4", count=3 * t, offset=start + 12 * v).reshape(-1, 3)
    return header, positions, indices
