"""Glyph sets.

Every glyph is described by its foreground coverage per cell quadrant
[TL, TR, BL, BR]. Half/quarter blocks are exact 0/1 coverage; the shade
glyphs are a uniform fg/bg mix at 25/50/75%.

CLASSIC is pure CP437 — the first 9 entries and their order are the site
engine's glyph indices (koan-site src/ansi/types.ts GLYPHS). Do not reorder.
EXTENDED appends the Unicode quadrant blocks, which do NOT exist in CP437:
they render in modern terminals and the PNG/JSON paths, but can't go in .ans.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Glyph:
    char: str
    cov: tuple[float, float, float, float]  # fg coverage [TL, TR, BL, BR]
    cp437: int | None  # byte value in CP437, None if not representable
    shade: float | None = None  # mix fraction for ░▒▓, else None


CLASSIC: list[Glyph] = [
    Glyph(" ", (0, 0, 0, 0), 0x20),
    Glyph("░", (0.25, 0.25, 0.25, 0.25), 0xB0, shade=0.25),
    Glyph("▒", (0.50, 0.50, 0.50, 0.50), 0xB1, shade=0.50),
    Glyph("▓", (0.75, 0.75, 0.75, 0.75), 0xB2, shade=0.75),
    Glyph("█", (1, 1, 1, 1), 0xDB),
    Glyph("▀", (1, 1, 0, 0), 0xDF),
    Glyph("▄", (0, 0, 1, 1), 0xDC),
    Glyph("▌", (1, 0, 1, 0), 0xDD),
    Glyph("▐", (0, 1, 0, 1), 0xDE),
]

QUARTERS: list[Glyph] = [
    Glyph("▘", (1, 0, 0, 0), None),
    Glyph("▝", (0, 1, 0, 0), None),
    Glyph("▖", (0, 0, 1, 0), None),
    Glyph("▗", (0, 0, 0, 1), None),
    Glyph("▚", (1, 0, 0, 1), None),
    Glyph("▞", (0, 1, 1, 0), None),
    Glyph("▙", (1, 0, 1, 1), None),
    Glyph("▛", (1, 1, 1, 0), None),
    Glyph("▜", (1, 1, 0, 1), None),
    Glyph("▟", (0, 1, 1, 1), None),
]

EXTENDED: list[Glyph] = CLASSIC + QUARTERS

CHARSETS: dict[str, list[Glyph]] = {"classic": CLASSIC, "extended": EXTENDED}

# Number of glyphs the koan-site renderer knows how to draw today.
SITE_GLYPH_COUNT = len(CLASSIC)
