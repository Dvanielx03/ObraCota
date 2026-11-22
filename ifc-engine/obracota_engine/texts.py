"""Untrusted text from the IFC, bounded and without control characters (H1-ESPECIFICACION §5.2).

Names, ``ObjectType``, property values and the messages of ``validate`` are data written by whoever made the
file. They leave the engine with at most ``TEXT_MAX`` characters, with control characters turned into spaces
and the bidirectional overrides removed, and they are never interpreted (invariant 5 of PROPUESTA §3.0).

- ``clean`` bounds one value; ``reading.text`` wraps it as ``{"text": ...}``.
- ``short`` bounds a value that goes *inside* one of our sentences (an explanation, a detail, a basis), so the
  sentence keeps its end; ``bounded`` is the last cap of the whole sentence.

This module imports nothing from the engine, so ``operations.base`` can use it without an import cycle.
"""
import unicodedata

TEXT_MAX = 512
SHORT_MAX = 120
_BIDI_CONTROLS = dict.fromkeys(map(ord, "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"))


def clean(value, maximum: int = TEXT_MAX) -> str:
    cleaned = "".join(" " if unicodedata.category(ch) == "Cc" else ch for ch in str(value))
    cleaned = cleaned.translate(_BIDI_CONTROLS)
    return cleaned if len(cleaned) <= maximum else cleaned[:maximum - 1] + "…"


def short(value) -> str:
    """An IFC value quoted inside one of our sentences."""
    return clean(value, SHORT_MAX)


def bounded(sentence: str) -> str:
    """Any detail or explanation the engine reports: at most ``TEXT_MAX`` characters, no control characters."""
    return clean(sentence, TEXT_MAX)
