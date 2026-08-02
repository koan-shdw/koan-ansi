// Procedural canvas renderer — same geometry as the koan-site engine and the
// Python preview renderer: blocks are rects, shades are a 4×4 Bayer dither.

import { type Glyph } from './charset'
import { PALETTE_HEX } from './palette'

export const CW = 8
export const CH = 16

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]
const SHADE_T: Record<string, number> = { '0.25': 4, '0.5': 8, '0.75': 12 }

// tile cache: one small canvas per (charsetKey|packed) — vga16 path only
const tiles = new Map<string, HTMLCanvasElement>()

function drawGlyph(
  cx: CanvasRenderingContext2D,
  g: Glyph,
  x: number,
  y: number,
  fgCss: string,
  bgCss: string,
): void {
  cx.fillStyle = bgCss
  cx.fillRect(x, y, CW, CH)
  cx.fillStyle = fgCss
  if (g.shade !== null) {
    const t = SHADE_T[String(g.shade)]
    for (let py = 0; py < CH; py++)
      for (let px = 0; px < CW; px++)
        if (BAYER[py & 3][px & 3] < t) cx.fillRect(x + px, y + py, 1, 1)
    return
  }
  const hw = CW / 2
  const hh = CH / 2
  const qx = [0, hw, 0, hw]
  const qy = [0, 0, hh, hh]
  for (let k = 0; k < 4; k++)
    if (g.cov[k] === 1) cx.fillRect(x + qx[k], y + qy[k], hw, hh)
}

function tileFor(packed: number, charset: Glyph[], key: string): HTMLCanvasElement {
  const k = `${key}|${packed}`
  const hit = tiles.get(k)
  if (hit) return hit
  const cv = document.createElement('canvas')
  cv.width = CW
  cv.height = CH
  const cx = cv.getContext('2d')!
  drawGlyph(cx, charset[packed >> 8], 0, 0, PALETTE_HEX[(packed >> 4) & 0xf], PALETTE_HEX[packed & 0xf])
  tiles.set(k, cv)
  return cv
}

export function drawPacked(
  cv: HTMLCanvasElement,
  packed: Int32Array,
  cols: number,
  rows: number,
  charset: Glyph[],
  charsetKey: string,
): void {
  cv.width = cols * CW
  cv.height = rows * CH
  const cx = cv.getContext('2d')!
  for (let cy = 0; cy < rows; cy++)
    for (let cxi = 0; cxi < cols; cxi++)
      cx.drawImage(tileFor(packed[cy * cols + cxi], charset, charsetKey), cxi * CW, cy * CH)
}

export function drawTruecolor(
  cv: HTMLCanvasElement,
  glyph: Int32Array,
  fg: Uint8ClampedArray,
  bg: Uint8ClampedArray,
  cols: number,
  rows: number,
  charset: Glyph[],
): void {
  cv.width = cols * CW
  cv.height = rows * CH
  const cx = cv.getContext('2d')!
  for (let cy = 0; cy < rows; cy++)
    for (let cxi = 0; cxi < cols; cxi++) {
      const i = cy * cols + cxi
      drawGlyph(
        cx,
        charset[glyph[i]],
        cxi * CW,
        cy * CH,
        `rgb(${fg[i * 3]},${fg[i * 3 + 1]},${fg[i * 3 + 2]})`,
        `rgb(${bg[i * 3]},${bg[i * 3 + 1]},${bg[i * 3 + 2]})`,
      )
    }
}
