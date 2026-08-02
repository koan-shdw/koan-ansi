// Core matcher — TS port of ansiconv/convert.py (same math, same NOISE_K trick).
// Error = channel-weighted squared RGB over the cell's 4 quadrants
//       + chroma-noise penalty for shade glyphs mixing hue-distant pairs.
// Scored as konst(cand) - 2·(q·reconW): the q² term is per-cell constant.

import { type Glyph } from './charset'
import { CHANNEL_W, DEFAULT_NOISE_K, OP_DIST2, PALETTE } from './palette'

export function autoRows(w: number, h: number, cols: number): number {
  return Math.max(1, Math.round((cols * (h / w)) / 2))
}

/** Image → quadrant colors, cell-major Float32Array [cell][quad TL,TR,BL,BR][rgb]. */
export function quadsFromImage(
  src: CanvasImageSource & { width: number; height: number },
  cols: number,
  rows: number,
): Float32Array {
  const w2 = cols * 2
  const h2 = rows * 2
  const cv = document.createElement('canvas')
  cv.width = w2
  cv.height = h2
  const cx = cv.getContext('2d', { willReadFrequently: true })!
  cx.fillStyle = '#000' // transparent sources composite over black, like a terminal
  cx.fillRect(0, 0, w2, h2)
  cx.imageSmoothingEnabled = true
  cx.imageSmoothingQuality = 'high'
  cx.drawImage(src, 0, 0, w2, h2)
  const d = cx.getImageData(0, 0, w2, h2).data
  const q = new Float32Array(rows * cols * 12)
  for (let cy = 0; cy < rows; cy++)
    for (let cxi = 0; cxi < cols; cxi++) {
      const base = (cy * cols + cxi) * 12
      for (let k = 0; k < 4; k++) {
        const px = cxi * 2 + (k & 1)
        const py = cy * 2 + (k >> 1)
        const o = (py * w2 + px) * 4
        q[base + k * 3] = d[o]
        q[base + k * 3 + 1] = d[o + 1]
        q[base + k * 3 + 2] = d[o + 2]
      }
    }
  return q
}

export interface CandTable {
  reconW: Float32Array // N×12, premultiplied by channel weights
  konst: Float32Array // N — Σw·r² + noise penalty
  meta: Int32Array // N×3 — glyph index (in full charset), fg, bg
  n: number
}

export function buildCandidates(
  charset: Glyph[],
  noiseK: number = DEFAULT_NOISE_K,
  includeShades = true,
): CandTable {
  const reconW: number[] = []
  const konst: number[] = []
  const meta: number[] = []
  for (let gi = 0; gi < charset.length; gi++) {
    const g = charset[gi]
    if (g.shade !== null && !includeShades) continue
    const mix = g.shade !== null ? g.shade * (1 - g.shade) : 0
    const isSpace = g.cov.every((c) => c === 0)
    const isFull = g.cov.every((c) => c === 1)
    for (let fg = 0; fg < 16; fg++) {
      if (isSpace && fg > 0) break // space: fg irrelevant
      for (let bg = 0; bg < 16; bg++) {
        if (isFull && bg > 0) break // █: bg irrelevant
        let k0 = noiseK * mix * 4 * OP_DIST2[fg * 16 + bg]
        for (let k = 0; k < 4; k++) {
          const c = g.cov[k]
          for (let ch = 0; ch < 3; ch++) {
            const r = PALETTE[fg][ch] * c + PALETTE[bg][ch] * (1 - c)
            reconW.push(r * CHANNEL_W[ch])
            k0 += r * r * CHANNEL_W[ch]
          }
        }
        konst.push(k0)
        meta.push(gi, fg, bg)
      }
    }
  }
  return {
    reconW: Float32Array.from(reconW),
    konst: Float32Array.from(konst),
    meta: Int32Array.from(meta),
    n: konst.length,
  }
}

/** Best (glyph, fg, bg) per cell → packed Int32Array (glyph<<8)|(fg<<4)|bg. */
export function matchCells(quads: Float32Array, nCells: number, t: CandTable): Int32Array {
  const { reconW, konst, meta, n } = t
  const out = new Int32Array(nCells)
  for (let c = 0; c < nCells; c++) {
    const qb = c * 12
    let best = 0
    let bestScore = Infinity
    for (let i = 0; i < n; i++) {
      const rb = i * 12
      let dot = 0
      for (let j = 0; j < 12; j++) dot += quads[qb + j] * reconW[rb + j]
      const s = konst[i] - 2 * dot
      if (s < bestScore) {
        bestScore = s
        best = i
      }
    }
    out[c] = (meta[best * 3] << 8) | (meta[best * 3 + 1] << 4) | meta[best * 3 + 2]
  }
  return out
}

/** Serpentine Floyd–Steinberg on the quadrant grid, snapped to the 16-color
 * palette. Use with includeShades=false — FS already turns gradients into
 * structure, shade glyphs would fight it. */
export function fsDitherQuads(quads: Float32Array, cols: number, rows: number): Float32Array {
  const w2 = cols * 2
  const h2 = rows * 2
  // unpack cell-major quads to a scanline image
  const img = new Float32Array(w2 * h2 * 3)
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++)
      for (let k = 0; k < 4; k++) {
        const src = ((cy * cols + cx) * 4 + k) * 3
        const dst = ((cy * 2 + (k >> 1)) * w2 + cx * 2 + (k & 1)) * 3
        img[dst] = quads[src]
        img[dst + 1] = quads[src + 1]
        img[dst + 2] = quads[src + 2]
      }
  const out = new Float32Array(img.length)
  for (let y = 0; y < h2; y++) {
    const serp = (y & 1) === 1
    for (let s = 0; s < w2; s++) {
      const x = serp ? w2 - 1 - s : s
      const o = (y * w2 + x) * 3
      const r = Math.min(255, Math.max(0, img[o]))
      const g = Math.min(255, Math.max(0, img[o + 1]))
      const b = Math.min(255, Math.max(0, img[o + 2]))
      let bi = 0
      let bd = Infinity
      for (let p = 0; p < 16; p++) {
        const dr = r - PALETTE[p][0]
        const dg = g - PALETTE[p][1]
        const db = b - PALETTE[p][2]
        const d = dr * dr * CHANNEL_W[0] + dg * dg * CHANNEL_W[1] + db * db * CHANNEL_W[2]
        if (d < bd) {
          bd = d
          bi = p
        }
      }
      out[o] = PALETTE[bi][0]
      out[o + 1] = PALETTE[bi][1]
      out[o + 2] = PALETTE[bi][2]
      const er = r - PALETTE[bi][0]
      const eg = g - PALETTE[bi][1]
      const eb = b - PALETTE[bi][2]
      const xn = serp ? x - 1 : x + 1
      const xp = serp ? x + 1 : x - 1
      const spread = (ox: number, oy: number, w: number) => {
        if (ox < 0 || ox >= w2 || oy >= h2) return
        const t = (oy * w2 + ox) * 3
        img[t] += er * w
        img[t + 1] += eg * w
        img[t + 2] += eb * w
      }
      spread(xn, y, 7 / 16)
      spread(xp, y + 1, 3 / 16)
      spread(x, y + 1, 5 / 16)
      spread(xn, y + 1, 1 / 16)
    }
  }
  // repack to cell-major
  const q2 = new Float32Array(quads.length)
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++)
      for (let k = 0; k < 4; k++) {
        const dst = ((cy * cols + cx) * 4 + k) * 3
        const src = ((cy * 2 + (k >> 1)) * w2 + cx * 2 + (k & 1)) * 3
        q2[dst] = out[src]
        q2[dst + 1] = out[src + 1]
        q2[dst + 2] = out[src + 2]
      }
  return q2
}

export interface TrueResult {
  glyph: Int32Array
  fg: Uint8ClampedArray // n×3
  bg: Uint8ClampedArray // n×3
}

/** Truecolor mode: spatial glyphs only (flat cells already hit their color
 * exactly; shades would only add texture, █ duplicates space). */
export function matchTruecolor(quads: Float32Array, nCells: number, charset: Glyph[]): TrueResult {
  const cands = charset
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.shade === null && !g.cov.every((c) => c === 1))
  const glyph = new Int32Array(nCells)
  const fg = new Uint8ClampedArray(nCells * 3)
  const bg = new Uint8ClampedArray(nCells * 3)
  for (let c = 0; c < nCells; c++) {
    const qb = c * 12
    let bestErr = Infinity
    let bg0 = 0, bg1 = 0, bg2 = 0, bf0 = 0, bf1 = 0, bf2 = 0, bgi = 0
    for (const { g, i } of cands) {
      let f0 = 0, f1 = 0, f2 = 0, b0 = 0, b1 = 0, b2 = 0, nf = 0
      for (let k = 0; k < 4; k++) {
        const r = quads[qb + k * 3]
        const gg = quads[qb + k * 3 + 1]
        const bb = quads[qb + k * 3 + 2]
        if (g.cov[k] === 1) {
          f0 += r; f1 += gg; f2 += bb; nf++
        } else {
          b0 += r; b1 += gg; b2 += bb
        }
      }
      if (nf > 0) {
        f0 /= nf; f1 /= nf; f2 /= nf
      }
      const nb = 4 - nf
      if (nb > 0) {
        b0 /= nb; b1 /= nb; b2 /= nb
      }
      if (nf === 0) {
        f0 = b0; f1 = b1; f2 = b2
      }
      let err = 0
      for (let k = 0; k < 4; k++) {
        const useF = g.cov[k] === 1
        const dr = quads[qb + k * 3] - (useF ? f0 : b0)
        const dg = quads[qb + k * 3 + 1] - (useF ? f1 : b1)
        const db = quads[qb + k * 3 + 2] - (useF ? f2 : b2)
        err += dr * dr * CHANNEL_W[0] + dg * dg * CHANNEL_W[1] + db * db * CHANNEL_W[2]
      }
      if (err < bestErr) {
        bestErr = err
        bgi = i
        bf0 = f0; bf1 = f1; bf2 = f2
        bg0 = b0; bg1 = b1; bg2 = b2
      }
    }
    glyph[c] = bgi
    fg[c * 3] = bf0; fg[c * 3 + 1] = bf1; fg[c * 3 + 2] = bf2
    bg[c * 3] = bg0; bg[c * 3 + 1] = bg1; bg[c * 3 + 2] = bg2
  }
  return { glyph, fg, bg }
}
