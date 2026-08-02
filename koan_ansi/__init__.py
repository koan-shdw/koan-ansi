"""KOAN.ansi — image/video → authentic BBS-scene ANSI art."""

from .charset import CHARSETS, CLASSIC, EXTENDED, QUARTERS, SITE_GLYPH_COUNT, Glyph
from .convert import (
    auto_rows,
    convert_image,
    fs_dither_quads,
    match,
    match_truecolor,
    quad_grid,
    unpack,
)
from .palette import DEFAULT_NOISE_K, PALETTE, PALETTE_U8
from .render import render_cells, save_previews

__version__ = "1.0.0"
