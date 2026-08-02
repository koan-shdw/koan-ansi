// DOS/VGA 16-color palette, classic ordering — keep in sync with ansiconv/palette.py.
export const PALETTE: [number, number, number][] = [
  [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170],
  [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
  [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255],
  [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255],
]

export const PALETTE_HEX = PALETTE.map(
  ([r, g, b]) => `rgb(${r},${g},${b})`,
)

// channel weights for squared-RGB error (rough luma sensitivity)
export const CHANNEL_W = [2, 4, 3]

// shade chroma-noise penalty weight (hard-won default from koan-site tuning)
export const DEFAULT_NOISE_K = 0.12

// opponent space with luma removed — distance drives the shade noise penalty
const OP = PALETTE.map(([r, g, b]) => [r - g, g - b, b - r])
export const OP_DIST2 = new Float32Array(256)
for (let a = 0; a < 16; a++)
  for (let b = 0; b < 16; b++) {
    const d0 = OP[a][0] - OP[b][0]
    const d1 = OP[a][1] - OP[b][1]
    const d2 = OP[a][2] - OP[b][2]
    OP_DIST2[a * 16 + b] = d0 * d0 + d1 * d1 + d2 * d2
  }
