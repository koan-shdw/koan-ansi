// Glyph sets — keep in sync with ansiconv/charset.py.
// cov = fg coverage per quadrant [TL, TR, BL, BR]; shades are uniform mixes.
// CLASSIC's 9 entries and order are the koan-site engine's glyph indices.

export interface Glyph {
  ch: string
  cov: [number, number, number, number]
  cp437: number | null
  shade: number | null
}

const G = (
  ch: string,
  cov: [number, number, number, number],
  cp437: number | null,
  shade: number | null = null,
): Glyph => ({ ch, cov, cp437, shade })

export const CLASSIC: Glyph[] = [
  G(' ', [0, 0, 0, 0], 0x20),
  G('░', [0.25, 0.25, 0.25, 0.25], 0xb0, 0.25),
  G('▒', [0.5, 0.5, 0.5, 0.5], 0xb1, 0.5),
  G('▓', [0.75, 0.75, 0.75, 0.75], 0xb2, 0.75),
  G('█', [1, 1, 1, 1], 0xdb),
  G('▀', [1, 1, 0, 0], 0xdf),
  G('▄', [0, 0, 1, 1], 0xdc),
  G('▌', [1, 0, 1, 0], 0xdd),
  G('▐', [0, 1, 0, 1], 0xde),
]

export const QUARTERS: Glyph[] = [
  G('▘', [1, 0, 0, 0], null),
  G('▝', [0, 1, 0, 0], null),
  G('▖', [0, 0, 1, 0], null),
  G('▗', [0, 0, 0, 1], null),
  G('▚', [1, 0, 0, 1], null),
  G('▞', [0, 1, 1, 0], null),
  G('▙', [1, 0, 1, 1], null),
  G('▛', [1, 1, 1, 0], null),
  G('▜', [1, 1, 0, 1], null),
  G('▟', [0, 1, 1, 1], null),
]

export const EXTENDED: Glyph[] = [...CLASSIC, ...QUARTERS]

export type CharsetName = 'classic' | 'extended'
export const CHARSETS: Record<CharsetName, Glyph[]> = {
  classic: CLASSIC,
  extended: EXTENDED,
}

export const SITE_GLYPH_COUNT = CLASSIC.length
