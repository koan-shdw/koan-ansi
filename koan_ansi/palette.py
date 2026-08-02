"""DOS/VGA 16-color palette + error-metric constants.

Palette ordering is classic DOS (matches koan-site src/ansi/palette.ts).
iCE colors convention: all 16 usable as foreground AND background.
"""

from __future__ import annotations

import numpy as np

PALETTE = np.array(
    [
        (0, 0, 0),        # 0 black
        (0, 0, 170),      # 1 blue
        (0, 170, 0),      # 2 green
        (0, 170, 170),    # 3 cyan
        (170, 0, 0),      # 4 red
        (170, 0, 170),    # 5 magenta
        (170, 85, 0),     # 6 brown
        (170, 170, 170),  # 7 light gray
        (85, 85, 85),     # 8 dark gray
        (85, 85, 255),    # 9 light blue
        (85, 255, 85),    # 10 light green
        (85, 255, 255),   # 11 light cyan
        (255, 85, 85),    # 12 light red
        (255, 85, 255),   # 13 light magenta
        (255, 255, 85),   # 14 yellow
        (255, 255, 255),  # 15 white
    ],
    dtype=np.float32,
)

PALETTE_U8 = PALETTE.astype(np.uint8)

# Per-channel weights for squared-RGB error — rough luma sensitivity (R,G,B).
CHANNEL_W = np.array([2.0, 4.0, 3.0], dtype=np.float32)

# Opponent space with luma removed, for the shade-glyph chroma-noise penalty:
# a shade mixing two hue-distant colors (green dots on blue) matches averages
# numerically but reads as speckle. Distance here scales that penalty.
_OP = np.stack(
    [
        PALETTE[:, 0] - PALETTE[:, 1],
        PALETTE[:, 1] - PALETTE[:, 2],
        PALETTE[:, 2] - PALETTE[:, 0],
    ],
    axis=1,
)
OP_DIST2 = ((_OP[:, None, :] - _OP[None, :, :]) ** 2).sum(axis=2).astype(np.float32)

# Default weight of that penalty (hard-won value from koan-site's converter).
DEFAULT_NOISE_K = 0.12
