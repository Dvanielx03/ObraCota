"""Area and outline of the manufacturer's FBX/OBJ meshes that ship next to each BIMobject DWG.

They are the reference of the ACIS tessellation (ACIS-LECTOR §4, «Verificación contra la referencia»).

- FBX: binary FBX 7.x, every ``Geometry`` node in its own local coordinates (no node transforms), polygons
  fanned into triangles. In this set the FBX coordinates are millimetres with the DWG's axes.
- OBJ: ``v`` and ``f`` lines (Hven: metres, Y up).
"""
import struct
import zlib

import numpy as np


def _fbx_nodes(data: bytes):
    if data[:20] != b"Kaydara FBX Binary  ":
        raise ValueError("Not a binary FBX")
    wide = struct.unpack_from("<I", data, 23)[0] >= 7500
    head = struct.Struct("<QQQ" if wide else "<III")

    def node(pos):
        end, nprops, plen = head.unpack_from(data, pos)
        pos += head.size
        nl = data[pos]
        name = data[pos + 1:pos + 1 + nl].decode("latin1")
        pos += 1 + nl
        if end == 0:
            return None, pos
        props, p = [], pos
        for _ in range(nprops):
            t = chr(data[p]); p += 1
            if t == "C": props.append(data[p]); p += 1
            elif t == "Y": props.append(struct.unpack_from("<h", data, p)[0]); p += 2
            elif t == "I": props.append(struct.unpack_from("<i", data, p)[0]); p += 4
            elif t == "F": props.append(struct.unpack_from("<f", data, p)[0]); p += 4
            elif t == "D": props.append(struct.unpack_from("<d", data, p)[0]); p += 8
            elif t == "L": props.append(struct.unpack_from("<q", data, p)[0]); p += 8
            elif t in "SR":
                ln = struct.unpack_from("<I", data, p)[0]; props.append(data[p + 4:p + 4 + ln]); p += 4 + ln
            elif t in "fdlib":
                n, enc, cl = struct.unpack_from("<III", data, p); p += 12
                raw = data[p:p + cl]; p += cl
                if enc:
                    raw = zlib.decompress(raw)
                props.append(np.frombuffer(raw, {"f": "<f4", "d": "<f8", "l": "<i8", "i": "<i4", "b": "u1"}[t], n))
            else:
                raise ValueError(f"FBX property type {t!r}")
        pos += plen
        kids = []
        while pos < end:
            kid, pos = node(pos)
            if kid is None:
                break
            kids.append(kid)
        return (name, props, kids), end

    pos, out = 27, []
    while pos < len(data) - 200:
        n, pos = node(pos)
        if n is None:
            break
        out.append(n)
    return out


def _walk(nodes):
    for n in nodes:
        yield n
        yield from _walk(n[2])


def _fan(polygon_index: np.ndarray) -> np.ndarray:
    """FBX PolygonVertexIndex (last corner of each polygon stored as ~i) as fanned triangles."""
    idx = polygon_index.astype(np.int64)
    ends = idx < 0
    corners = np.where(ends, ~idx, idx)
    pid = np.concatenate([[0], np.cumsum(ends)[:-1]])
    first = np.concatenate([[0], np.flatnonzero(ends)[:-1] + 1])
    j = np.arange(len(idx))
    middle = (j != first[pid]) & ~ends
    j = j[middle]
    return np.stack([corners[first[pid[j]]], corners[j], corners[j + 1]], axis=1)


def _measure(chunks):
    area = 0.0
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for v, t in chunks:
        if not len(v):
            continue
        lo = np.minimum(lo, v.min(axis=0))
        hi = np.maximum(hi, v.max(axis=0))
        if len(t):
            a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
            area += float(0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum())
    return area, lo, hi


def fbx(path):
    """``(area, min, max)`` of every mesh in a binary FBX, in the file's own units."""
    chunks = []
    for name, _props, kids in _walk(_fbx_nodes(open(path, "rb").read())):
        if name != "Geometry":
            continue
        fields = {k[0]: k[1] for k in kids}
        if "Vertices" not in fields or "PolygonVertexIndex" not in fields:
            continue
        v = np.asarray(fields["Vertices"][0], dtype=float).reshape(-1, 3)
        chunks.append((v, _fan(fields["PolygonVertexIndex"][0])))
    return _measure(chunks)


def obj(path):
    """``(area, min, max)`` of an OBJ, in its own units and axes."""
    vertices, triangles = [], []
    with open(path, encoding="latin1") as source:
        for line in source:
            if line.startswith("v "):
                vertices.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                ids = [int(part.split("/")[0]) for part in line.split()[1:]]
                ids = [i - 1 if i > 0 else len(vertices) + i for i in ids]
                triangles += [(ids[0], ids[k], ids[k + 1]) for k in range(1, len(ids) - 1)]
    return _measure([(np.array(vertices, dtype=float), np.array(triangles, dtype=np.int64).reshape(-1, 3))])
