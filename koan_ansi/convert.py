"""Core matcher: image → grid of (glyph, fg, bg) cells.

Model: each character cell is sampled as 2×2 quadrant mean colors [TL,TR,BL,BR].
Every candidate (glyph, fg, bg) reconstructs those four quadrants as
``fg*cov + bg*(1-cov)``; we pick the candidate minimizing channel-weighted
squared error plus, for shade glyphs, a chroma-noise penalty — a shade mixing
two hue-distant colors (green dots over blue) matches the *average* but reads
as speckle, so hue-clashing fg/bg pairs are penalized (opponent space, luma
removed). NOISE_K value inherited from koan-site's tuned converter.

The brute force is exact: all candidates are scored, vectorized as one matrix
product per block of cells (error = const(cand) - 2·q·recon, the q² term is
constant per cell and drops out of the argmin).
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from .charset import CHARSETS, Glyph
from .palette import CHANNEL_W, DEFAULT_NOISE_K, OP_DIST2, PALETTE


def auto_rows(width: int, height: int, cols: int) -> int:
    """Character cells are 1:2 (w:h): rows = cols * aspect / 2."""
    return max(1, round(cols * (height / width) / 2))


def quad_grid(img: Image.Image, cols: int, rows: int) -> np.ndarray:
    """(rows, cols, 4, 3) float32 quadrant mean colors, order [TL, TR, BL, BR]."""
    rgb = img.convert("RGB")
    w2, h2 = cols * 2, rows * 2
    # BOX = true area average when downscaling; BICUBIC avoids blockiness when
    # a small source is scaled up to the quadrant grid.
    resample = (
        Image.Resampling.BOX
        if rgb.width >= w2 and rgb.height >= h2
        else Image.Resampling.BICUBIC
    )
    small = rgb.resize((w2, h2), resample)
    a = np.asarray(small, dtype=np.float32)
    return a.reshape(rows, 2, cols, 2, 3).transpose(0, 2, 1, 3, 4).reshape(rows, cols, 4, 3)


def build_candidates(
    charset: list[Glyph], noise_k: float, include_shades: bool = True
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """All (glyph, fg, bg) candidates over the 16-color palette.

    Returns (rw, const, meta): weighted recon vectors (N,12), per-candidate
    constant term Σw·r² + noise penalty (N,), and meta int32 (N,3) rows of
    [glyph_index, fg, bg]. Glyph indices refer to the FULL charset list even
    when shades are excluded.
    """
    recon_list: list[np.ndarray] = []
    meta: list[tuple[int, int, int]] = []
    pen: list[float] = []
    for gi, g in enumerate(charset):
        if g.shade is not None and not include_shades:
            continue
        cov = np.asarray(g.cov, dtype=np.float32)[:, None]  # (4,1)
        mix = g.shade * (1.0 - g.shade) if g.shade is not None else 0.0
        fgs = (0,) if g.cov == (0, 0, 0, 0) else tuple(range(16))
        for fg in fgs:
            bgs = (0,) if g.cov == (1, 1, 1, 1) else tuple(range(16))
            for bg in bgs:
                recon_list.append(PALETTE[fg] * cov + PALETTE[bg] * (1.0 - cov))
                meta.append((gi, fg, bg))
                pen.append(noise_k * mix * 4.0 * float(OP_DIST2[fg, bg]))
    recon = np.stack(recon_list)  # (N,4,3)
    meta_a = np.asarray(meta, dtype=np.int32)
    const = (recon * recon * CHANNEL_W).sum(axis=(1, 2)) + np.asarray(pen, dtype=np.float32)
    rw = (recon * CHANNEL_W).reshape(len(meta), 12).astype(np.float32)
    return rw, const.astype(np.float32), meta_a


def match(
    quads: np.ndarray,
    charset: list[Glyph],
    noise_k: float = DEFAULT_NOISE_K,
    include_shades: bool = True,
    chunk: int = 16384,
) -> np.ndarray:
    """Best candidate per cell → packed int32 grid (glyph<<8)|(fg<<4)|bg."""
    rows, cols = quads.shape[:2]
    rw, const, meta = build_candidates(charset, noise_k, include_shades)
    q = quads.reshape(-1, 12).astype(np.float32)
    best = np.empty(q.shape[0], dtype=np.int64)
    for i in range(0, q.shape[0], chunk):
        score = const[None, :] - 2.0 * (q[i : i + chunk] @ rw.T)
        best[i : i + chunk] = score.argmin(axis=1)
    m = meta[best]
    glyph = m[:, 0].reshape(rows, cols)
    fg = m[:, 1].reshape(rows, cols)
    bg = m[:, 2].reshape(rows, cols)
    return ((glyph << 8) | (fg << 4) | bg).astype(np.int32)


def unpack(packed: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """packed → (glyph, fg, bg). Glyph is the high bits (no mask: extended
    charset indices exceed 4 bits; fg/bg are always 4-bit palette indices)."""
    return packed >> 8, (packed >> 4) & 0xF, packed & 0xF


def fs_dither_quads(quads: np.ndarray) -> np.ndarray:
    """Serpentine Floyd–Steinberg on the quadrant image, snapped to the
    16-color palette (channel-weighted nearest). Use with include_shades=False:
    FS already breaks gradients into structure, shades would fight it."""
    rows, cols = quads.shape[:2]
    h2, w2 = rows * 2, cols * 2
    img = (
        quads.reshape(rows, cols, 2, 2, 3)
        .transpose(0, 2, 1, 3, 4)
        .reshape(h2, w2, 3)
        .astype(np.float32)
        .copy()
    )
    out = np.empty_like(img)
    for y in range(h2):
        serp = (y & 1) == 1
        xs = range(w2 - 1, -1, -1) if serp else range(w2)
        for x in xs:
            c = np.clip(img[y, x], 0.0, 255.0)
            i = int((((PALETTE - c) ** 2) * CHANNEL_W).sum(axis=1).argmin())
            out[y, x] = PALETTE[i]
            e = c - PALETTE[i]
            xn = x - 1 if serp else x + 1  # next pixel in scan direction
            xp = x + 1 if serp else x - 1
            if 0 <= xn < w2:
                img[y, xn] += e * (7 / 16)
            if y + 1 < h2:
                img[y + 1, x] += e * (5 / 16)
                if 0 <= xp < w2:
                    img[y + 1, xp] += e * (3 / 16)
                if 0 <= xn < w2:
                    img[y + 1, xn] += e * (1 / 16)
    return (
        out.reshape(rows, 2, cols, 2, 3).transpose(0, 2, 1, 3, 4).reshape(rows, cols, 4, 3)
    )


def match_truecolor(
    quads: np.ndarray, charset: list[Glyph]
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Exact-color mode: spatial glyphs only. A flat cell already hits its
    target color exactly, so shade glyphs add nothing but texture (█ is the
    same dropped duplicate of space). Returns (glyph, fg_rgb u8, bg_rgb u8)."""
    rows, cols = quads.shape[:2]
    cand = [
        (i, g)
        for i, g in enumerate(charset)
        if g.shade is None and g.cov != (1, 1, 1, 1)
    ]
    errs, fgs, bgs, gidx = [], [], [], []
    for i, g in cand:
        cov = np.asarray(g.cov, dtype=bool)
        nf = int(cov.sum())
        if nf == 0:
            bg = quads.mean(axis=2)
            fg = bg
        else:
            fg = quads[:, :, cov, :].mean(axis=2)
            bg = quads[:, :, ~cov, :].mean(axis=2) if nf < 4 else fg
        recon = np.where(cov[None, None, :, None], fg[:, :, None, :], bg[:, :, None, :])
        errs.append((((quads - recon) ** 2) * CHANNEL_W).sum(axis=(2, 3)))
        fgs.append(fg)
        bgs.append(bg)
        gidx.append(i)
    E = np.stack(errs)  # (G, rows, cols)
    k = E.argmin(axis=0)
    glyph = np.asarray(gidx, dtype=np.int32)[k]
    FG = np.stack(fgs)
    BG = np.stack(bgs)
    ii, jj = np.meshgrid(np.arange(rows), np.arange(cols), indexing="ij")
    fg = np.clip(np.rint(FG[k, ii, jj]), 0, 255).astype(np.uint8)
    bg = np.clip(np.rint(BG[k, ii, jj]), 0, 255).astype(np.uint8)
    return glyph, fg, bg


def convert_image(
    img: Image.Image | str,
    cols: int = 120,
    rows: int = 0,
    charset: str = "classic",
    dither: str = "none",
    noise_k: float = DEFAULT_NOISE_K,
) -> np.ndarray:
    """High-level one-shot: image (path or PIL) → packed vga16 grid."""
    if isinstance(img, str):
        img = Image.open(img)
    if not rows:
        rows = auto_rows(img.width, img.height, cols)
    quads = quad_grid(img, cols, rows)
    cs = CHARSETS[charset]
    if dither == "fs":
        return match(fs_dither_quads(quads), cs, noise_k, include_shades=False)
    return match(quads, cs, noise_k)
