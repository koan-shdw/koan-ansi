// Export writers — byte-compatible with the Python exporters.

import { type Glyph, SITE_GLYPH_COUNT } from './charset'

const ESC = 0x1b

function isSpace(g: Glyph): boolean {
  return g.cov.every((c) => c === 0)
}
function isFull(g: Glyph): boolean {
  return g.cov.every((c) => c === 1)
}

function sauce(title: string, author: string, group: string, filesize: number, cols: number, rows: number): Uint8Array {
  const rec = new Uint8Array(128)
  let o = 0
  const put = (s: string, n: number) => {
    for (let i = 0; i < n; i++) rec[o + i] = i < s.length ? Math.min(127, s.charCodeAt(i)) : 0x20
    o += n
  }
  put('SAUCE00', 7)
  put(title, 35)
  put(author, 20)
  put(group, 20)
  const d = new Date()
  put(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`, 8)
  new DataView(rec.buffer).setUint32(o, filesize, true)
  o += 4
  rec[o++] = 1 // DataType: Character
  rec[o++] = 1 // FileType: ANSi
  const dv = new DataView(rec.buffer)
  dv.setUint16(o, cols, true)
  dv.setUint16(o + 2, rows, true)
  o += 8 // TInfo1..4
  rec[o++] = 0 // comment lines
  rec[o++] = 0x01 // ANSiFlags: iCE colors
  const font = 'IBM VGA'
  for (let i = 0; i < font.length; i++) rec[o + i] = font.charCodeAt(i)
  return rec
}

/** Real .ans: CP437 bytes + SGR (bold fg / iCE blink bg) + SAUCE trailer. */
export function ansBytes(
  packed: Int32Array,
  cols: number,
  rows: number,
  charset: Glyph[],
  title: string,
  author = 'koan',
  group = '',
): Uint8Array {
  const out: number[] = []
  const sgr = (s: string) => {
    out.push(ESC, 0x5b)
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i))
    out.push(0x6d)
  }
  let cur: [number, number] | null = null
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = packed[y * cols + x]
      const g = charset[p >> 8]
      if (g.cp437 === null) throw new Error(`glyph ${g.ch} has no CP437 byte — .ans needs classic`)
      let f = (p >> 4) & 0xf
      let b = p & 0xf
      if (cur) {
        if (isSpace(g)) f = cur[0] // space shows only bg
        else if (isFull(g)) b = cur[1] // █ shows only fg
      }
      if (!cur || cur[0] !== f || cur[1] !== b) {
        const parts = ['0']
        if (f >= 8) parts.push('1')
        if (b >= 8) parts.push('5')
        parts.push(String(30 + (f & 7)), String(40 + (b & 7)))
        sgr(parts.join(';'))
        cur = [f, b]
      }
      out.push(g.cp437)
    }
    out.push(0x0d, 0x0a)
  }
  sgr('0')
  const bodyLen = out.length
  out.push(0x1a)
  const body = Uint8Array.from(out)
  const s = sauce(title, author, group, bodyLen, cols, rows)
  const all = new Uint8Array(body.length + s.length)
  all.set(body)
  all.set(s, body.length)
  return all
}

/** koan-site AnsiArtwork JSON (packed cells, classic glyph indices). */
export function siteJson(
  id: string,
  title: string,
  cols: number,
  rows: number,
  fps: number,
  frames: Int32Array[],
): string {
  return JSON.stringify({
    id,
    title,
    cols,
    rows,
    fps,
    frames: frames.map((f) => Array.from(f)),
  })
}

export function siteJsonUsesExtendedGlyphs(packed: Int32Array): boolean {
  for (let i = 0; i < packed.length; i++) if (packed[i] >> 8 >= SITE_GLYPH_COUNT) return true
  return false
}

/** UTF-8 ANSI text for modern terminals (16-color or 24-bit SGR). */
export function txtString(
  glyph: Int32Array,
  fg: Uint8ClampedArray | Int32Array,
  bg: Uint8ClampedArray | Int32Array,
  cols: number,
  rows: number,
  charset: Glyph[],
  truecolor: boolean,
): string {
  const lines: string[] = []
  for (let y = 0; y < rows; y++) {
    let line = ''
    let cur = ''
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      const g = charset[glyph[i]]
      let code: string
      if (truecolor) {
        code = `\x1b[38;2;${fg[i * 3]};${fg[i * 3 + 1]};${fg[i * 3 + 2]};48;2;${bg[i * 3]};${bg[i * 3 + 1]};${bg[i * 3 + 2]}m`
      } else {
        const f = fg[i] as number
        const b = bg[i] as number
        const fc = f < 8 ? 30 + f : 90 + f - 8
        const bc = b < 8 ? 40 + b : 100 + b - 8
        code = `\x1b[${fc};${bc}m`
      }
      if (code !== cur) {
        line += code
        cur = code
      }
      line += g.ch
    }
    lines.push(line + '\x1b[0m')
  }
  return lines.join('\n') + '\n'
}

export function download(data: BlobPart | Uint8Array, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
