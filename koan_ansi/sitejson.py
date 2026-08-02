"""Ansimation / site JSON writer — the AnsiArtwork shape the koan-site
background engine loads, and (with frames > 1) the Ansimation v1 format:

{ format: "ansimation/1", id, title, cols, rows, fps,
  frames: [ [packed, ...] per frame ] }
packed = (glyph << 8) | (fg << 4) | bg, glyph indices = classic charset order.

One payload, two extensions: .json for stills, .ansim for animations. The
format marker is informational — consumers may ignore it.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


def write_site_json(
    path: str,
    art_id: str,
    title: str,
    cols: int,
    rows: int,
    fps: float,
    frames_packed: list[np.ndarray],
) -> str:
    art = {
        "format": "ansimation/1",
        "id": art_id,
        "title": title,
        "cols": cols,
        "rows": rows,
        "fps": fps,
        "frames": [np.asarray(f).reshape(-1).astype(int).tolist() for f in frames_packed],
    }
    Path(path).write_text(json.dumps(art, separators=(",", ":")), encoding="utf-8")
    return path
