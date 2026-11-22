"""Reader of ACIS SAB blocks (binary ACIS, formats 21800 and 22300) as found in DWG 3DSOLID/BODY/REGION.

The grammar is the one documented in docs/mvp/fase-h/ACIS-LECTOR.md §1 (inferred and validated on the 1,385
blocks of the BIMobject set): one tag byte per token, little-endian values, ``0x11`` closing each record.
A record is a list of ``(kind, value)`` tokens; its name is the chain of ``identx`` prefixes and the first
``ident`` (``tcoedge-coedge``, ``spline-surface``...).

Sub-types (``{ ... }``) are numbered in file order, skipping the ``{ ref N }`` ones; ``ref N`` points to the
N-th sub-type already written (§2).
"""
import struct

MAGICS = (b"ACIS BinaryFile", b"ASM BinaryFile4")
END_MARKS = ("End-of-ACIS-data", "End-of-ASM-data")

_D = struct.Struct("<d")
_I = struct.Struct("<i")
_H = struct.Struct("<H")
_U = struct.Struct("<I")
_Q = struct.Struct("<q")
_3D = struct.Struct("<3d")
_2D = struct.Struct("<2d")


class SabError(ValueError):
    """The block is not SAB or breaks the grammar."""


def _tokens(buf: bytes, pos: int):
    n = len(buf)
    out = []
    append = out.append
    while pos < n:
        t = buf[pos]
        pos += 1
        if t == 0x06:
            append(("double", _D.unpack_from(buf, pos)[0])); pos += 8
        elif t == 0x0C:
            append(("ptr", _I.unpack_from(buf, pos)[0])); pos += 4
        elif t == 0x04:
            append(("int", _I.unpack_from(buf, pos)[0])); pos += 4
        elif t == 0x0D or t == 0x0E:
            ln = buf[pos]
            append(("ident" if t == 0x0D else "identx", buf[pos + 1:pos + 1 + ln].decode("latin1"))); pos += 1 + ln
        elif t == 0x11:
            append(("#", None))
        elif t == 0x0A:
            append(("bool", True))
        elif t == 0x0B:
            append(("bool", False))
        elif t == 0x15:
            append(("enum", _I.unpack_from(buf, pos)[0])); pos += 4
        elif t == 0x13:
            append(("pos", _3D.unpack_from(buf, pos))); pos += 24
        elif t == 0x14:
            append(("vec", _3D.unpack_from(buf, pos))); pos += 24
        elif t == 0x0F:
            append(("{", None))
        elif t == 0x10:
            append(("}", None))
        elif t == 0x07:
            ln = buf[pos]; append(("str", buf[pos + 1:pos + 1 + ln].decode("latin1"))); pos += 1 + ln
        elif t == 0x08:
            ln = _H.unpack_from(buf, pos)[0]; append(("str", buf[pos + 2:pos + 2 + ln].decode("latin1"))); pos += 2 + ln
        elif t == 0x09 or t == 0x12:
            ln = _U.unpack_from(buf, pos)[0]; append(("str", buf[pos + 4:pos + 4 + ln].decode("latin1"))); pos += 4 + ln
        elif t == 0x01 or t == 0x02:
            append(("byte", buf[pos])); pos += 1
        elif t == 0x03:
            append(("short", struct.unpack_from("<h", buf, pos)[0])); pos += 2
        elif t == 0x05:
            append(("float", struct.unpack_from("<f", buf, pos)[0])); pos += 4
        elif t == 0x16:
            append(("long", _Q.unpack_from(buf, pos)[0])); pos += 8
        elif t == 0x17:
            append(("vec2", _2D.unpack_from(buf, pos))); pos += 16
        else:
            raise SabError(f"Etiqueta SAB desconocida 0x{t:02x} en {pos - 1}.")
        if pos > n:  # a string whose length runs past the end (slicing would cut it silently)
            raise IndexError("cadena fuera del bloque")
        if t == 0x0D and out[-1][1] in END_MARKS:
            break
    return out


class Record:
    """One SAB record: its name and the tokens after the name."""

    __slots__ = ("name", "tokens", "_ptrs", "_bools")

    def __init__(self, raw: list):
        parts = []
        i = 0
        while i < len(raw) and raw[i][0] == "identx":
            parts.append(raw[i][1]); i += 1
        if i < len(raw) and raw[i][0] == "ident":
            parts.append(raw[i][1]); i += 1
        self.name = "-".join(parts)
        self.tokens = raw[i:]
        self._ptrs = None
        self._bools = None

    @property
    def ptrs(self) -> list:
        if self._ptrs is None:
            self._ptrs = [v for k, v in self.tokens if k == "ptr"]
        return self._ptrs

    @property
    def bools(self) -> list:
        if self._bools is None:
            self._bools = [v for k, v in self.tokens if k == "bool"]
        return self._bools

    def values(self, kind: str) -> list:
        return [v for k, v in self.tokens if k == kind]

    @property
    def kind(self) -> str:
        """The last part of the name: ``tedge-edge`` is an ``edge``, ``spline-surface`` a ``surface``."""
        return self.name.rsplit("-", 1)[-1]


class Sab:
    """A parsed SAB block: header fields and records, with the sub-type table resolved for ``ref``."""

    def __init__(self, buf: bytes):
        magic = next((m for m in MAGICS if buf.startswith(m)), None)
        if magic is None:
            raise SabError("El bloque ACIS no es SAB.")
        self.magic = magic.decode()
        pos = len(magic)
        if len(buf) < pos + 16:
            raise SabError("Cabecera SAB incompleta.")
        self.version, self.record_count, self.body_count, self.flags = struct.unpack_from("<4i", buf, pos)
        try:
            toks = _tokens(buf, pos + 16)
        except (struct.error, IndexError) as exc:
            # A value or a length that runs past the end of the block: a truncated or corrupt SAB (the DWG comes
            # from the user), reported as this body's failure and not as an error of the whole request.
            raise SabError("Bloque SAB truncado.") from exc
        if len(toks) < 6:
            raise SabError("Cabecera SAB incompleta.")
        head = [v for _, v in toks[:6]]
        self.product, self.acis, self.date = head[0], head[1], head[2]
        self.units, self.resabs, self.resnor = head[3], head[4], head[5]
        records = []
        cur = []
        for tok in toks[6:]:
            cur.append(tok)
            if tok[0] == "#":
                records.append(Record(cur)); cur = []
            elif tok[0] == "ident" and tok[1] in END_MARKS:
                break
        self.records = records
        self.subtypes = []
        for ri, rec in enumerate(records):
            toks_ = rec.tokens
            for ti, t in enumerate(toks_):
                if t[0] == "{" and not (ti + 1 < len(toks_) and toks_[ti + 1] == ("ident", "ref")):
                    self.subtypes.append((ri, ti))

    def __getitem__(self, index: int) -> Record:
        if index < 0 or index >= len(self.records):
            raise SabError(f"Puntero SAB fuera de rango: {index}.")
        return self.records[index]

    def subtype(self, index: int) -> tuple:
        """Tokens and start of the first sub-type of record ``index``, following ``ref``."""
        rec = self[index]
        toks = rec.tokens
        ti = next((k for k, t in enumerate(toks) if t[0] == "{"), None)
        if ti is None:
            raise SabError(f"{rec.name} sin subtipo.")
        seen = 0
        while ti + 2 < len(toks) and toks[ti + 1] == ("ident", "ref"):
            n = toks[ti + 2][1]
            if not isinstance(n, int) or n < 0 or n >= len(self.subtypes) or seen > 64:
                raise SabError("Referencia de subtipo inválida.")
            ri, ti = self.subtypes[n]
            toks = self.records[ri].tokens
            seen += 1
        return toks, ti

    def bodies(self) -> list:
        return [i for i, r in enumerate(self.records) if r.name == "body"]
