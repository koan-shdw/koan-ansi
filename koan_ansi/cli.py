"""CLI: images / frame sequences / video → ANSI art in every export format.

Examples:
    koan-ansi art.png                     (or: python -m koan_ansi art.png)
    koan-ansi art.png --charset both --cols 100
    koan-ansi --frames-glob "clip/*.png" --fps 12 --id myloop
    koan-ansi --video clip.mp4 --video-fps 10 --id myloop

Animated conversions write the Ansimation format (.ansim) — the same packed
JSON payload as still .json exports, plus a format marker; stills stay .json.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image

from .ans import write_ans
from .charset import CHARSETS, SITE_GLYPH_COUNT
from .convert import auto_rows, fs_dither_quads, match, match_truecolor, quad_grid, unpack
from .palette import DEFAULT_NOISE_K
from .render import render_cells, save_previews
from .sitejson import write_site_json
from .txt import write_txt
from .video import extract_video, frames_from_glob

ALL_FORMATS = ("json", "ans", "png", "txt")


def _auto_formats(charset_name: str, palette: str, animated: bool) -> list[str]:
    if palette == "truecolor":
        return ["png", "txt"]
    fmts = ["json", "png", "txt"]
    if charset_name == "classic" and not animated:
        fmts.insert(1, "ans")
    return fmts


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="koan-ansi",
        description="KOAN.ansi — image/video to authentic BBS-scene ANSI art (CP437 blocks, DOS 16 colors).",
    )
    p.add_argument("inputs", nargs="*", help="image file(s); each converts separately")
    p.add_argument("--video", help="video file, one animated artwork (needs ffmpeg on PATH)")
    p.add_argument("--frames-glob", help='image glob as one animated artwork, e.g. "frames/*.png"')
    p.add_argument("--cols", type=int, default=120, help="grid width in character cells (default 120)")
    p.add_argument("--rows", type=int, default=0, help="grid height; 0 = auto from aspect (cells are 1:2)")
    p.add_argument("--charset", choices=["classic", "extended", "both"], default="classic",
                   help="classic = pure CP437; extended adds Unicode quarter blocks; both = render and compare")
    p.add_argument("--palette", choices=["vga16", "truecolor"], default="vga16")
    p.add_argument("--dither", choices=["none", "fs"], default="none",
                   help="fs = Floyd-Steinberg on the quadrant grid (shade glyphs disabled)")
    p.add_argument("--noise-k", type=float, default=DEFAULT_NOISE_K,
                   help=f"shade chroma-noise penalty weight (default {DEFAULT_NOISE_K})")
    p.add_argument("--formats", default="auto",
                   help="comma list of json,ans,png,txt (default: all valid for the mode)")
    p.add_argument("--id", dest="art_id", help="artwork id (default: input stem)")
    p.add_argument("--title", help="artwork title (default: id)")
    p.add_argument("--author", default="koan", help="SAUCE author for .ans")
    p.add_argument("--group", default="", help="SAUCE group for .ans")
    p.add_argument("--fps", type=float, default=12.0, help="playback fps written to animated JSON")
    p.add_argument("--video-fps", type=float, default=12.0, help="frame extraction rate for --video")
    p.add_argument("-o", "--out", help="output directory (default: alongside the input)")
    args = p.parse_args(argv)

    # ---- gather jobs: (id, frame paths, animated) -------------------------
    jobs: list[tuple[str, list[str]]] = []
    if args.video:
        frames = extract_video(args.video, tempfile.mkdtemp(prefix="ansiconv-"), args.video_fps)
        jobs.append((args.art_id or Path(args.video).stem, frames))
    elif args.frames_glob:
        frames = frames_from_glob(args.frames_glob)
        jobs.append((args.art_id or Path(frames[0]).parent.name or "frames", frames))
    if args.inputs:
        for inp in args.inputs:
            jobs.append((args.art_id or Path(inp).stem, [inp]))
    if not jobs:
        p.error("no input: give image file(s), --frames-glob, or --video")
    if args.art_id and (len(jobs) > 1 or (args.inputs and (args.video or args.frames_glob))):
        p.error("--id only makes sense with a single artwork")

    charsets = ["classic", "extended"] if args.charset == "both" else [args.charset]
    if args.dither == "fs" and args.palette == "truecolor":
        print("note: --dither fs is a 16-color feature; ignored in truecolor mode")

    status = 0
    for art_id, frame_paths in jobs:
        t0 = time.perf_counter()
        title = args.title or art_id
        outdir = Path(args.out) if args.out else Path(frame_paths[0]).resolve().parent
        outdir.mkdir(parents=True, exist_ok=True)
        animated = len(frame_paths) > 1
        fps = args.fps if animated else 0

        with Image.open(frame_paths[0]) as im0:
            w0, h0 = im0.size
        cols = args.cols
        rows = args.rows or auto_rows(w0, h0, cols)

        far_paths: dict[str, str] = {}
        for cs_name in charsets:
            cs = CHARSETS[cs_name]
            base = f"{art_id}.{cs_name}" if args.charset == "both" else art_id

            if args.formats == "auto":
                fmts = _auto_formats(cs_name, args.palette, animated)
            else:
                # "ansim" is the animated json — accept it as an alias
                fmts = [
                    "json" if f.strip() == "ansim" else f.strip()
                    for f in args.formats.split(",")
                    if f.strip()
                ]
                bad = [f for f in fmts if f not in ALL_FORMATS]
                if bad:
                    p.error(f"unknown format(s): {', '.join(bad)}")

            # ---- convert all frames ---------------------------------------
            packed_frames: list[np.ndarray] = []
            true_frames: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
            for fp in frame_paths:
                with Image.open(fp) as im:
                    quads = quad_grid(im, cols, rows)
                if args.palette == "truecolor":
                    true_frames.append(match_truecolor(quads, cs))
                else:
                    if args.dither == "fs":
                        packed_frames.append(
                            match(fs_dither_quads(quads), cs, args.noise_k, include_shades=False)
                        )
                    else:
                        packed_frames.append(match(quads, cs, args.noise_k))

            # ---- exports ---------------------------------------------------
            written: list[str] = []
            for fmt in fmts:
                path = str(outdir / f"{base}.{fmt}")
                if fmt == "json":
                    if args.palette == "truecolor":
                        print(f"skip {base}.json: site JSON is 16-color only (packed 4-bit fg/bg)")
                        continue
                    if cs_name == "extended":
                        print(f"note: {base}.json uses glyph indices >= {SITE_GLYPH_COUNT} — "
                              "the site engine only renders the classic 9 today")
                    # animated → Ansimation (.ansim); still → .json. Same payload.
                    ext = "ansim" if animated else "json"
                    path = str(outdir / f"{base}.{ext}")
                    written.append(write_site_json(path, art_id, title, cols, rows, fps, packed_frames))
                elif fmt == "ans":
                    if args.palette == "truecolor" or cs_name == "extended":
                        print(f"skip {base}.ans: .ans requires classic charset + vga16 palette")
                        continue
                    if animated:
                        print(f"note: {base}.ans holds frame 0 only (.ans is a still format)")
                    written.append(write_ans(path, packed_frames[0], cs, title, args.author, args.group))
                elif fmt == "png":
                    if args.palette == "truecolor":
                        g, f, b = true_frames[0]
                    else:
                        g, f, b = unpack(packed_frames[0])
                    arr = render_cells(g, f, b, cs)
                    near, far = save_previews(arr, str(outdir / base))
                    far_paths[cs_name] = far
                    written += [near, far]
                elif fmt == "txt":
                    if args.palette == "truecolor":
                        g, f, b = true_frames[0]
                    else:
                        g, f, b = unpack(packed_frames[0])
                    if animated:
                        print(f"note: {base}.txt holds frame 0 only")
                    written.append(write_txt(path, g, f, b, cs))
            for w in written:
                print(f"wrote {w}")

        if len(far_paths) == 2:
            a = np.asarray(Image.open(far_paths["classic"]).convert("RGB"))
            b = np.asarray(Image.open(far_paths["extended"]).convert("RGB"))
            gap = np.zeros((a.shape[0], 8, 3), dtype=np.uint8)
            cmp_path = str(outdir / f"{art_id}.compare.png")
            Image.fromarray(np.hstack([a, gap, b])).save(cmp_path)
            print(f"wrote {cmp_path}  (left = classic, right = extended)")

        ms = (time.perf_counter() - t0) * 1000
        print(f"{art_id}: {cols}x{rows} cells, {len(frame_paths)} frame(s), "
              f"{'+'.join(charsets)}, {args.palette}, {ms:.0f}ms")

    return status


if __name__ == "__main__":
    sys.exit(main())
