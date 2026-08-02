"""Real .ans writer: CP437 bytes + SGR color codes + SAUCE trailer.

Classic charset + vga16 palette only (quarter blocks have no CP437 byte).
Bright backgrounds use the scene's iCE convention: SGR blink (5) carries the
bright bit and the SAUCE ANSiFlags iCE bit tells viewers to render it as
bright-background instead of blinking.
"""

from __future__ import annotations

import datetime
import struct
from pathlib import Path

import numpy as np

from .charset import Glyph

_ESC = b"\x1b["


def _sauce(title: str, author: str, group: str, filesize: int, cols: int, rows: int) -> bytes:
    def field(s: str, n: int) -> bytes:
        b = s.encode("cp437", "replace")[:n]
        return b + b" " * (n - len(b))

    rec = b"SAUCE00"
    rec += field(title, 35) + field(author, 20) + field(group, 20)
    rec += datetime.date.today().strftime("%Y%m%d").encode()
    rec += struct.pack("<I", filesize)
    rec += bytes([1, 1])  # DataType=Character, FileType=ANSi
    rec += struct.pack("<HHHH", cols, rows, 0, 0)  # TInfo1=width, TInfo2=height
    rec += bytes([0])  # comment lines
    rec += bytes([0x01])  # ANSiFlags: iCE colors
    font = b"IBM VGA"
    rec += font + b"\x00" * (22 - len(font))
    assert len(rec) == 128
    return rec


def write_ans(
    path: str,
    packed: np.ndarray,
    charset: list[Glyph],
    title: str = "",
    author: str = "koan",
    group: str = "",
) -> str:
    rows, cols = packed.shape
    out = bytearray()
    cur: tuple[int, int] | None = None
    for y in range(rows):
        for x in range(cols):
            p = int(packed[y, x])
            g = charset[p >> 8]
            if g.cp437 is None:
                raise ValueError(f"glyph {g.char!r} has no CP437 byte — .ans needs the classic charset")
            f, b = (p >> 4) & 0xF, p & 0xF
            # space shows only bg, █ only fg — inherit the other channel from
            # the current state to avoid pointless SGR churn.
            if cur is not None:
                if g.cov == (0, 0, 0, 0):
                    f = cur[0]
                elif g.cov == (1, 1, 1, 1):
                    b = cur[1]
            if cur != (f, b):
                parts = ["0"]
                if f >= 8:
                    parts.append("1")  # bold = bright fg
                if b >= 8:
                    parts.append("5")  # blink = bright bg under iCE
                parts.append(str(30 + (f & 7)))
                parts.append(str(40 + (b & 7)))
                out += _ESC + ";".join(parts).encode() + b"m"
                cur = (f, b)
            out.append(g.cp437)
        out += b"\r\n"
    out += _ESC + b"0m"
    body_len = len(out)
    out.append(0x1A)  # DOS EOF before SAUCE
    out += _sauce(title, author, group, body_len, cols, rows)
    Path(path).write_bytes(bytes(out))
    return path
