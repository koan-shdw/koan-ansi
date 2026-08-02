"""PNG preview renderer — pure geometry, no font asset.

Cell geometry matches the koan-site canvas renderer (and the CP437 originals):
half/quarter blocks are rects, shades are a 4×4 Bayer ordered dither at
25/50/75%. Always writes a preview pair:

- ``*.preview.png``      1:1 pixels — do NOT judge dither color on this; most
                         image viewers alias the Bayer pattern when scaling.
- ``*.preview-far.png``  half-scale through a real filter — averages the
                         dither like distance viewing does. Judge THIS one.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from .charset import Glyph
from .palette import PALETTE_U8

CW, CH = 8, 16

BAYER = np.array(
    [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5],
    ]
)

_SHADE_T = {0.25: 4, 0.50: 8, 0.75: 12}


def glyph_masks(charset: list[Glyph], cw: int = CW, ch: int = CH) -> np.ndarray:
    """(G, ch, cw) bool — True where the glyph shows foreground."""
    yy, xx = np.mgrid[0:ch, 0:cw]
    quad = (yy >= ch // 2).astype(int) * 2 + (xx >= cw // 2).astype(int)
    bay = BAYER[yy % 4, xx % 4]
    masks = np.zeros((len(charset), ch, cw), dtype=bool)
    for i, g in enumerate(charset):
        if g.shade is not None:
            masks[i] = bay < _SHADE_T[g.shade]
        else:
            masks[i] = np.asarray(g.cov)[quad] > 0.5
    return masks


def render_cells(
    glyph: np.ndarray, fg: np.ndarray, bg: np.ndarray, charset: list[Glyph]
) -> np.ndarray:
    """Cell grid → uint8 image (rows*CH, cols*CW, 3).

    fg/bg are either palette indices (rows, cols) or truecolor (rows, cols, 3).
    """
    rows, cols = glyph.shape
    m = glyph_masks(charset)[glyph]  # (rows, cols, CH, CW)
    if fg.ndim == 2:
        F = PALETTE_U8[fg]
        B = PALETTE_U8[bg]
    else:
        F, B = fg, bg
    img = np.where(m[..., None], F[:, :, None, None, :], B[:, :, None, None, :])
    return img.transpose(0, 2, 1, 3, 4).reshape(rows * CH, cols * CW, 3).astype(np.uint8)


def save_previews(arr: np.ndarray, stem: str) -> tuple[str, str]:
    """Write the 1:1 and judge-safe half-scale previews. Returns their paths."""
    im = Image.fromarray(arr)
    near = f"{stem}.preview.png"
    im.save(near)
    far = f"{stem}.preview-far.png"
    im.resize(
        (max(1, arr.shape[1] // 2), max(1, arr.shape[0] // 2)),
        Image.Resampling.LANCZOS,
    ).save(far)
    return near, far
