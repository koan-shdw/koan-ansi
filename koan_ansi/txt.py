"""UTF-8 ANSI text writer — `type`/`cat` it in any modern terminal.

Works for both charsets (Unicode glyphs) and both palettes: vga16 uses the
16-color SGR codes (bright via 90–97 / 100–107), truecolor uses 24-bit SGR.
Each line ends with a reset so backgrounds don't bleed past the art.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .charset import Glyph


def write_txt(
    path: str,
    glyph: np.ndarray,
    fg: np.ndarray,
    bg: np.ndarray,
    charset: list[Glyph],
) -> str:
    truecolor = fg.ndim == 3
    rows, cols = glyph.shape
    lines: list[str] = []
    for y in range(rows):
        parts: list[str] = []
        cur = None
        for x in range(cols):
            g = charset[int(glyph[y, x])]
            f = tuple(int(v) for v in fg[y, x]) if truecolor else int(fg[y, x])
            b = tuple(int(v) for v in bg[y, x]) if truecolor else int(bg[y, x])
            if cur is not None:
                if g.cov == (0, 0, 0, 0):
                    f = cur[0]
                elif g.cov == (1, 1, 1, 1):
                    b = cur[1]
            if cur != (f, b):
                if truecolor:
                    parts.append(f"\x1b[38;2;{f[0]};{f[1]};{f[2]};48;2;{b[0]};{b[1]};{b[2]}m")
                else:
                    fc = 30 + f if f < 8 else 90 + f - 8
                    bc = 40 + b if b < 8 else 100 + b - 8
                    parts.append(f"\x1b[{fc};{bc}m")
                cur = (f, b)
            parts.append(g.char)
        parts.append("\x1b[0m")
        lines.append("".join(parts))
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
