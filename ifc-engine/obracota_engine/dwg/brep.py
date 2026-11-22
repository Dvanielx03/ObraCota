"""SAB topology and geometry as an IFC4 ``IfcAdvancedBrep``, which IfcOpenShell meshes with OpenCASCADE.

The mapping is the one validated in docs/mvp/fase-h/acis-poc/sab2ifc.py (1,355/1,355 bodies of the Autodesk
files), extended with the analytic geometry of the ODA files (Hven):

=====================  ===========================================================================
ACIS                   IFC4
=====================  ===========================================================================
plane-surface          IfcPlane
spline-surface         IfcBSplineSurfaceWithKnots / IfcRationalBSplineSurfaceWithKnots
  (exact_spl_sur)        end multiplicities +1, control points with u varying fastest
cone-surface           IfcCylindricalSurface (sine 0) / exact IfcRationalBSplineSurfaceWithKnots
                         (IFC4 has no conical surface), limited to the face's angle
torus-surface          exact IfcRationalBSplineSurfaceWithKnots limited to the face's angles
sphere-surface         IfcSphericalSurface
intcurve-curve         IfcBSplineCurveWithKnots / IfcRationalBSplineCurveWithKnots
straight-curve         IfcLine
ellipse-curve          IfcCircle (ratio 1) / IfcEllipse
face / loop / coedge   IfcAdvancedFace / IfcFaceOuterBound, IfcFaceBound / IfcOrientedEdge
edge / vertex          IfcEdgeCurve / IfcVertexPoint
=====================  ===========================================================================

Senses: an ``IfcAdvancedFace`` keeps the surface's orientation when the face is not reversed and the surface
itself is not reversed (``SameSense = (not face.reversed) != surface.reversed``); a coedge runs along its edge
unless it is reversed, and an edge along its curve unless it is reversed. Edges without a curve (the
degenerate ones at a pole) are left out of their loop. Tolerant entities (``tedge``, ``tcoedge``,
``tvertex``) keep the same pointers; their tolerance is not needed, OCCT recomputes it.

A face whose geometry is not supported is left out and counted; the body still meshes with the rest.
"""
import math
import re

import numpy as np

from .sab import Sab, SabError


class Unsupported(SabError):
    """Geometry this reader does not convert yet."""


def _unit(v) -> list:
    a = np.asarray(v, dtype=float)
    n = float(np.linalg.norm(a))
    if not n or not math.isfinite(n):
        raise Unsupported("Vector nulo.")
    return (a / n).tolist()


def _ref_direction(z, x) -> list:
    z = np.asarray(_unit(z))
    x = np.asarray(x, dtype=float)
    x = x - x.dot(z) * z
    if np.linalg.norm(x) < 1e-12:
        x = np.cross(z, [1.0, 0.0, 0.0] if abs(z[0]) < 0.9 else [0.0, 1.0, 0.0])
    return _unit(x)


# OpenCASCADE's B-splines go up to degree 25. The DWG comes from the user, so a spline is checked before it
# reaches OCCT (which runs inside the engine process): degree, increasing knots, positive multiplicities and
# finite numbers. Anything else leaves the face out instead of handing OCCT a malformed surface.
MAX_DEGREE = 25


def _degree(value) -> int:
    d = int(value)
    if not 1 <= d <= MAX_DEGREE:
        raise Unsupported("Grado de B-spline fuera de rango.")
    return d


def _knots(toks, j, n):
    ks, ms = [], []
    for _ in range(n):
        ks.append(float(toks[j][1])); ms.append(int(toks[j + 1][1])); j += 2
    if n < 2 or any(m < 1 for m in ms) or any(not math.isfinite(k) for k in ks) \
            or any(b <= a for a, b in zip(ks, ks[1:])):
        raise Unsupported("Nudos de B-spline inválidos.")
    return ks, ms, j


def _finite(vals) -> None:
    if any(not isinstance(v, float) for v in vals):
        raise SabError("Puntos de control incompletos.")
    if not all(math.isfinite(v) for v in vals):
        raise Unsupported("Puntos de control no finitos.")


def _find_bs(toks, j):
    while j < len(toks) and not (toks[j][0] == "ident" and toks[j][1] in ("nubs", "nurbs", "nullbs")):
        j += 1
    if j >= len(toks):
        raise Unsupported("Subtipo sin B-spline explícita.")
    return j


def _end_multiplicities(m, degree):
    # ACIS stores the end knots with multiplicity = degree; IFC, STEP and OCCT expect degree + 1.
    m = list(m)
    m[0] += 1
    m[-1] += 1
    return m


def _arc_net(start: float, span: float) -> tuple:
    """The unit-circle arc from ``start`` over ``span`` radians as a rational quadratic B-spline: control points
    ``(x, y, weight)``, multiplicities and knots. Each piece covers at most a quarter turn; the middle point
    of a piece of angle d sits at distance 1/cos(d/2) with weight cos(d/2)."""
    pieces = max(1, math.ceil(span / (math.pi / 2) - 1e-9))
    d = span / pieces
    far, weight = 1 / math.cos(d / 2), math.cos(d / 2)
    net = []
    for i in range(pieces):
        a = start + i * d
        net.append((math.cos(a), math.sin(a), 1.0))
        net.append((far * math.cos(a + d / 2), far * math.sin(a + d / 2), weight))
    end = start + span
    net.append((math.cos(end), math.sin(end), 1.0))
    return net, [3] + [2] * (pieces - 1) + [3], [float(i) for i in range(pieces + 1)]


def _cover(angles: list, margin: float = math.radians(3)) -> tuple:
    """``(start, span)`` of the smallest arc that holds ``angles``, widened by ``margin`` on each side. A face
    that goes all the way round has no seam to put the B-spline's ends on and is not converted."""
    if not angles:
        raise Unsupported("cara sin puntos")
    a = sorted(x % (2 * math.pi) for x in angles)
    gaps = [(a[(i + 1) % len(a)] - a[i]) % (2 * math.pi) or (2 * math.pi if len(a) == 1 else 0.0) for i in range(len(a))]
    i = max(range(len(a)), key=gaps.__getitem__)
    if gaps[i] < math.radians(5):
        raise Unsupported("cara periódica completa")
    gap = gaps[i]
    pad = min(margin, (gap - math.radians(1)) / 2)
    start = a[(i + 1) % len(a)] - pad
    return start, 2 * math.pi - gap + 2 * pad


def _bs3_surface(toks, j):
    rational = toks[j][1] == "nurbs"; j += 1
    du, dv = _degree(toks[j][1]), _degree(toks[j + 1][1]); j += 2
    if rational:
        j += 1  # 'both', 'u' or 'v': which directions are rational
    j += 4  # closure and singularity of u and v
    nku, nkv = int(toks[j][1]), int(toks[j + 1][1]); j += 2
    ku, mu, j = _knots(toks, j, nku)
    kv, mv, j = _knots(toks, j, nkv)
    ncu, ncv = sum(mu) - du + 1, sum(mv) - dv + 1
    if ncu <= du or ncv <= dv:
        raise Unsupported("Red de control de B-spline incompleta.")
    dim = 4 if rational else 3
    count = dim * ncu * ncv
    if j + count > len(toks):
        raise SabError("Puntos de control incompletos.")
    vals = [toks[j + k][1] for k in range(count)]
    _finite(vals)
    # Control points are stored with u varying fastest (ACIS-LECTOR §2): grid[i_u, i_v].
    grid = np.array(vals).reshape(ncv, ncu, dim).transpose(1, 0, 2)
    return dict(rational=rational, du=du, dv=dv, ku=ku, mu=mu, kv=kv, mv=mv, grid=grid)


def _bs3_curve(toks, j):
    rational = toks[j][1] == "nurbs"; j += 1
    d = _degree(toks[j][1]); j += 1
    j += 1  # closure
    nk = int(toks[j][1]); j += 1
    k, m, j = _knots(toks, j, nk)
    nc = sum(m) - d + 1
    if nc <= d:
        raise Unsupported("Red de control de B-spline incompleta.")
    dim = 4 if rational else 3
    if j + dim * nc > len(toks):
        raise SabError("Puntos de control incompletos.")
    vals = [toks[j + i][1] for i in range(dim * nc)]
    _finite(vals)
    return dict(rational=rational, d=d, k=k, m=m, cp=np.array(vals).reshape(nc, dim))


def _transform(sab: Sab, index: int):
    """The body's ACIS transform as a 4x4 matrix acting on column vectors, or None for the identity."""
    if index < 0:
        return None
    rec = sab[index]
    numbers = []
    for text in rec.values("str"):
        numbers += [float(x) for x in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", text)]
    numbers += [v for v in rec.values("double")]
    if len(numbers) < 13:
        return None
    a = np.array(numbers[:9]).reshape(3, 3)  # rows: images of the x, y and z axes (row-vector convention)
    t = np.array(numbers[9:12])
    s = numbers[12] or 1.0
    m = np.eye(4)
    m[:3, :3] = a.T * s
    m[:3, 3] = t
    return None if np.allclose(m, np.eye(4)) else m


class BrepBuilder:
    """Builds the IFC entities of every body of one SAB block inside ``ifc``."""

    def __init__(self, ifc, sab: Sab):
        self.ifc = ifc
        self.sab = sab
        self.points = {}
        self.curves = {}
        self.edges = {}
        self.surfaces = {}
        self.skipped_faces = 0
        self.reasons = {}

    # --- geometry -----------------------------------------------------------------------------------

    def _p(self, xyz):
        return self.ifc.createIfcCartesianPoint([float(c) for c in xyz])

    def _d(self, xyz):
        return self.ifc.createIfcDirection([float(c) for c in _unit(xyz)])

    def _axis(self, origin, z, x):
        return self.ifc.createIfcAxis2Placement3D(self._p(origin), self._d(z), self._d(_ref_direction(z, x)))

    def vertex(self, vi):
        if vi not in self.points:
            rec = self.sab[vi]
            point = self.sab[rec.ptrs[-1]]
            xyz = point.values("pos")[0]
            self.points[vi] = (self.ifc.createIfcVertexPoint(self._p(xyz)), np.asarray(xyz, dtype=float))
        return self.points[vi]

    def curve(self, ci):
        if ci in self.curves:
            return self.curves[ci]
        rec = self.sab[ci]
        if rec.name == "intcurve-curve":
            toks, start = self.sab.subtype(ci)
            j = _find_bs(toks, start)
            if toks[j][1] == "nullbs":
                j = _find_bs(toks, j + 1)
            c = _bs3_curve(toks, j)
            cps = [self._p(p[:3]) for p in c["cp"]]
            mult = _end_multiplicities(c["m"], c["d"])
            args = (c["d"], cps, "UNSPECIFIED", False, False, mult, c["k"], "UNSPECIFIED")
            if c["rational"]:
                e = self.ifc.createIfcRationalBSplineCurveWithKnots(*args, [float(w) for w in c["cp"][:, 3]])
            else:
                e = self.ifc.createIfcBSplineCurveWithKnots(*args)
        elif rec.name == "straight-curve":
            root = rec.values("pos")[0]
            direction = rec.values("vec")[0]
            e = self.ifc.createIfcLine(self._p(root), self.ifc.createIfcVector(self._d(direction), 1.0))
        elif rec.name == "ellipse-curve":
            centre = rec.values("pos")[0]
            normal, major = rec.values("vec")[:2]
            ratio = abs(rec.values("double")[0])
            radius = float(np.linalg.norm(major))
            placement = self._axis(centre, normal, major)
            if abs(ratio - 1.0) < 1e-9:
                e = self.ifc.createIfcCircle(placement, radius)
            else:
                e = self.ifc.createIfcEllipse(placement, radius, radius * ratio)
        else:
            raise Unsupported(f"curva {rec.name}")
        self.curves[ci] = e
        return e

    def edge(self, ei):
        if ei in self.edges:
            return self.edges[ei]
        rec = self.sab[ei]
        ptrs = rec.ptrs
        start, end, ci = ptrs[2], ptrs[3], ptrs[5]
        if ci < 0:
            self.edges[ei] = None
            return None
        reversed_ = bool(rec.bools[0]) if rec.bools else False
        e = self.ifc.createIfcEdgeCurve(self.vertex(start)[0], self.vertex(end)[0], self.curve(ci), not reversed_)
        self.edges[ei] = e
        return e

    def surface(self, si, face_points):
        """``(IfcSurface, reversed)``. ``face_points`` are the face's vertices (to orient a cone)."""
        if si in self.surfaces:
            return self.surfaces[si]
        rec = self.sab[si]
        name = rec.name
        if name == "plane-surface":
            root = rec.values("pos")[0]
            normal, u = rec.values("vec")[:2]
            result = (self.ifc.createIfcPlane(self._axis(root, normal, u)), False)
        elif name == "spline-surface":
            toks = rec.tokens
            brace = next(k for k, t in enumerate(toks) if t[0] == "{")
            flags = [v for k, v in toks[:brace] if k == "bool"]
            sub, start = self.sab.subtype(si)
            s = _bs3_surface(sub, _find_bs(sub, start))
            g = s["grid"]
            cps = [[self._p(g[i, j, :3]) for j in range(g.shape[1])] for i in range(g.shape[0])]
            args = (s["du"], s["dv"], cps, "UNSPECIFIED", False, False, False,
                    _end_multiplicities(s["mu"], s["du"]), _end_multiplicities(s["mv"], s["dv"]),
                    s["ku"], s["kv"], "UNSPECIFIED")
            if s["rational"]:
                weights = [[float(g[i, j, 3]) for j in range(g.shape[1])] for i in range(g.shape[0])]
                e = self.ifc.createIfcRationalBSplineSurfaceWithKnots(*args, weights)
            else:
                e = self.ifc.createIfcBSplineSurfaceWithKnots(*args)
            result = (e, bool(flags[0]) if flags else False)
        elif name == "cone-surface":
            result = self._cone(rec, face_points)
        elif name == "torus-surface":
            result = self._torus(rec, face_points)
        elif name == "sphere-surface":
            centre = rec.values("pos")[0]
            radius = rec.values("double")[0]
            vecs = rec.values("vec")
            origin, pole = (vecs + [(1.0, 0.0, 0.0), (0.0, 0.0, 1.0)])[:2]
            e = self.ifc.createIfcSphericalSurface(self._axis(centre, pole, origin), abs(float(radius)))
            result = (e, radius < 0)
        else:
            raise Unsupported(f"superficie {name}")
        if name not in ("cone-surface", "torus-surface"):
            self.surfaces[si] = result
        return result

    def _rational(self, grid, weights, u_mult, u_knots, v_mult, v_knots, v_degree):
        """IfcRationalBSplineSurfaceWithKnots of degree 2 in u; ``grid[i][j]`` are 3D points."""
        cps = [[self._p(p) for p in row] for row in grid]
        return self.ifc.createIfcRationalBSplineSurfaceWithKnots(
            2, v_degree, cps, "UNSPECIFIED", False, False, False, u_mult, v_mult, u_knots, v_knots,
            "UNSPECIFIED", [[float(w) for w in row] for row in weights])

    def _cone(self, rec, samples):
        root = np.asarray(rec.values("pos")[0], dtype=float)
        normal, major = (np.asarray(v, dtype=float) for v in rec.values("vec")[:2])
        doubles = rec.values("double")
        ratio = abs(doubles[0])
        sine, cosine = doubles[-3], doubles[-2]
        if abs(ratio - 1.0) > 1e-9:
            raise Unsupported("cono elíptico")
        radius = float(np.linalg.norm(major))
        reversed_ = cosine < 0
        if abs(sine) < 1e-12:
            return self.ifc.createIfcCylindricalSurface(self._axis(root, normal, major), radius), reversed_
        # IFC4 has no conical surface: the cone is written as its exact rational B-spline (a circle swept
        # along a segment of the generator), long enough to hold the face. Its normal points away from the
        # axis, like an ACIS cone with a positive cosine. The seam of the B-spline goes where the face is
        # not (ACIS faces of periodic surfaces arrive split, so there is a gap).
        n = np.asarray(_unit(normal))
        m = np.asarray(_ref_direction(n, major))
        w = np.cross(n, m)
        slope = abs(sine / cosine)
        rel = [p - root for p in samples]
        heights = [float(r.dot(n)) for r in rel] or [0.0]
        # Which way the radius grows along the axis is read from the face's own points.
        grows = 0.0
        for r, h in zip(rel, heights):
            rho = float(np.linalg.norm(r - h * n))
            grows += abs(rho - (radius + h * slope)) - abs(rho - (radius - h * slope))
        k = slope if grows <= 0 else -slope
        low, high = min(heights), max(heights)
        margin = 0.25 * (high - low) + 0.05 * radius + 1e-6
        low, high = low - margin, high + margin
        apex = -radius / k  # height where the radius is zero
        if k > 0:
            low = max(low, apex)
        else:
            high = min(high, apex)
        net, u_mult, u_knots = _arc_net(*_cover([math.atan2(float(r.dot(w)), float(r.dot(m))) for r in rel]))
        grid, weights = [], []
        for x, y, wt in net:
            grid.append([root + h * n + (radius + k * h) * (x * m + y * w) for h in (low, high)])
            weights.append([wt, wt])
        return self._rational(grid, weights, u_mult, u_knots, [2, 2], [0.0, 1.0], 1), reversed_

    def _torus(self, rec, samples):
        """The torus as an exact rational B-spline patch (biquadratic) that covers the face and no more: the
        angles of the face's points around the axis (u) and around the tube (v), plus a small margin. On a
        spindle torus (major radius below the minor one: the rounded tips of ODA solids) the patch stops
        where the tube meets the axis, so it never reaches the inner sheet; OCCT's own toroidal surface gave
        the wrong area and 23,000 triangles for a 14 mm tip."""
        centre = np.asarray(rec.values("pos")[0], dtype=float)
        normal, origin = rec.values("vec")[:2]
        major, minor = (float(x) for x in rec.values("double")[:2])
        n = np.asarray(_unit(normal))
        m = np.asarray(_ref_direction(n, origin))
        w = np.cross(n, m)
        big, small = major, abs(minor)
        rel = [p - centre for p in samples]
        u_net, u_mult, u_knots = _arc_net(*_cover([math.atan2(float(r.dot(w)), float(r.dot(m))) for r in rel]))
        tube = []
        for r in rel:
            h = float(r.dot(n))
            rho = float(np.linalg.norm(r - h * n))
            tube.append(math.atan2(h, rho - big))
        v_start, v_span = _cover(tube)
        if big < small:
            limit = math.acos(-big / small)  # the tube reaches the axis at +-limit
            centre_angle = math.remainder(v_start + v_span / 2, 2 * math.pi)
            lo = max(centre_angle - v_span / 2, -limit)
            hi = min(centre_angle + v_span / 2, limit)
            v_start, v_span = lo, hi - lo
        v_net, v_mult, v_knots = _arc_net(v_start, v_span)
        grid, weights = [], []
        for x, y, wu in u_net:
            row, row_w = [], []
            for a, b, wv in v_net:
                row.append(centre + (big + small * a) * (x * m + y * w) + small * b * n)
                row_w.append(wu * wv)
            grid.append(row)
            weights.append(row_w)
        return self._rational(grid, weights, u_mult, u_knots, v_mult, v_knots, 2), minor < 0

    # --- topology -----------------------------------------------------------------------------------

    def _loops(self, face):
        """Each loop of a face as a list of (IfcEdgeCurve, coedge reversed), plus the indices of its edges."""
        loops, points = [], []
        lo = face.ptrs[3]
        guard = 0
        while lo >= 0:
            loop = self.sab[lo]
            first = loop.ptrs[3]
            ce = first
            edges = []
            steps = 0
            while ce >= 0:
                coedge = self.sab[ce]
                cptrs = coedge.ptrs
                edge = self.edge(cptrs[5])
                if edge is not None:
                    points.append(cptrs[5])
                    edges.append((edge, bool(coedge.bools[0]) if coedge.bools else False))
                ce = cptrs[2]
                steps += 1
                if ce == first or steps > 100000:
                    break
            loops.append(edges)
            lo = loop.ptrs[2]
            guard += 1
            if guard > 100000:
                break
        return loops, points

    def _edge_samples(self, ei, count=8):
        """Points along an edge: its vertices, the control points of a B-spline curve and ``count`` points of
        an ellipse arc. The arc's range is the edge's, negated when the edge runs against its curve (ACIS);
        of the two readings, the one whose ends meet the vertices is kept."""
        rec = self.sab[ei]
        ptrs = rec.ptrs
        a, b = self.vertex(ptrs[2])[1], self.vertex(ptrs[3])[1]
        out = [a, b]
        curve = self.sab[ptrs[5]]
        if curve.name == "intcurve-curve":
            try:
                toks, start = self.sab.subtype(ptrs[5])
                j = _find_bs(toks, start)
                if toks[j][1] == "nullbs":
                    j = _find_bs(toks, j + 1)
                out += list(_bs3_curve(toks, j)["cp"][:, :3])
            except (SabError, ValueError, IndexError):
                pass
        elif curve.name == "ellipse-curve":
            centre = np.asarray(curve.values("pos")[0], dtype=float)
            normal, major = (np.asarray(v, dtype=float) for v in curve.values("vec")[:2])
            ratio = abs(curve.values("double")[0])
            minor = np.cross(_unit(normal), major) * ratio

            def at(t):
                return centre + math.cos(t) * major + math.sin(t) * minor

            params = rec.values("double")
            if len(params) >= 2:
                t0, t1 = params[0], params[1]
                best = None
                for lo, hi in ((t0, t1), (-t0, -t1)):
                    error = float(np.linalg.norm(at(lo) - a) + np.linalg.norm(at(hi) - b))
                    if best is None or error < best[0]:
                        best = (error, lo, hi)
                _, lo, hi = best
                out += [at(t) for t in np.linspace(lo, hi, count + 2)[1:-1]]
        return out

    def face(self, fi):
        face = self.sab[fi]
        loops, edge_ids = self._loops(face)
        si = face.ptrs[6]
        samples = []
        if self.sab[si].name in ("cone-surface", "torus-surface"):
            for ei in edge_ids:
                samples += self._edge_samples(ei)
        surface, surface_reversed = self.surface(si, samples)
        bounds = []
        for edges in loops:
            if not edges:
                continue
            oriented = [self.ifc.createIfcOrientedEdge(None, None, e, not rev) for e, rev in edges]
            loop = self.ifc.createIfcEdgeLoop(oriented)
            bounds.append(self.ifc.createIfcFaceOuterBound(loop, True) if not bounds else self.ifc.createIfcFaceBound(loop, True))
        if not bounds:
            raise Unsupported("cara sin contorno")
        face_reversed = bool(face.bools[0]) if face.bools else False
        return self.ifc.createIfcAdvancedFace(bounds, surface, (not face_reversed) != surface_reversed)

    def bodies(self):
        """``[(IfcAdvancedBrep or None, transform or None)]``, one per ``body`` record."""
        out = []
        for bi in self.sab.bodies():
            body = self.sab[bi]
            bptrs = body.ptrs
            faces = []
            lump = bptrs[2] if len(bptrs) > 2 else -1
            for _lump in self._chain(lump, 2):
                for shell in self._chain(self.sab[_lump].ptrs[3], 2):
                    for fi in self._chain(self.sab[shell].ptrs[4], 2):
                        try:
                            faces.append(self.face(fi))
                        except (SabError, ValueError, IndexError, KeyError, StopIteration, TypeError) as exc:
                            self.skipped_faces += 1
                            reason = str(exc) or type(exc).__name__
                            self.reasons[reason] = self.reasons.get(reason, 0) + 1
            brep = self.ifc.createIfcAdvancedBrep(self.ifc.createIfcClosedShell(faces)) if faces else None
            out.append((brep, _transform(self.sab, bptrs[4] if len(bptrs) > 4 else -1)))
        return out

    def _chain(self, first, next_index):
        """Indices of a linked list of records (lumps, shells, faces), starting at ``first``."""
        out = []
        seen = set()
        i = first
        while i >= 0 and i not in seen:
            seen.add(i)
            out.append(i)
            i = self.sab[i].ptrs[next_index]
        return out
