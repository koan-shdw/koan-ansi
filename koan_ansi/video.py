"""Frame-sequence input: glob of images, or ffmpeg extraction from a video."""

from __future__ import annotations

import glob as _glob
import shutil
import subprocess
from pathlib import Path


def frames_from_glob(pattern: str) -> list[str]:
    paths = sorted(_glob.glob(pattern))
    if not paths:
        raise FileNotFoundError(f"no frames match {pattern!r}")
    return paths


def extract_video(video: str, out_dir: str, fps: float = 12.0) -> list[str]:
    """Decode a video to PNG frames at the given rate. Needs ffmpeg on PATH."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "ffmpeg not found on PATH — extract frames yourself and use --frames-glob"
        )
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    pattern = str(out / "frame%05d.png")
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", video,
         "-vf", f"fps={fps}", pattern],
        check=True,
    )
    return frames_from_glob(str(out / "frame*.png"))
