import './styles.css'
import { CHARSETS, type CharsetName } from './charset'
import {
  autoRows,
  buildCandidates,
  type CandTable,
  fsDitherQuads,
  matchCells,
  matchTruecolor,
  quadsFromImage,
  type TrueResult,
} from './convert'
import { ansBytes, download, siteJson, siteJsonUsesExtendedGlyphs, txtString } from './exports'
import { DEFAULT_NOISE_K } from './palette'
import { CH, CW, drawPacked, drawTruecolor } from './render'
import { applyTheme, DEFAULT_THEME, PRESET_THEMES } from './themes'

interface Settings {
  cols: number
  charset: CharsetName
  compare: boolean
  palette: 'vga16' | 'truecolor'
  dither: 'none' | 'fs'
  noiseK: number
  zoom: 'fit' | '1' | '2'
  theme: string
}

const S_KEY = 'koan-ansi-settings'
const defaults: Settings = {
  cols: 120,
  charset: 'classic',
  compare: false,
  palette: 'vga16',
  dither: 'none',
  noiseK: DEFAULT_NOISE_K,
  zoom: 'fit',
  theme: DEFAULT_THEME,
}
// storage can be unavailable (sandboxed embeds, private mode) — settings just don't persist
function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(S_KEY) ?? '{}')
  } catch {
    return {}
  }
}
const S: Settings = { ...defaults, ...loadSettings() }
const save = () => {
  try {
    localStorage.setItem(S_KEY, JSON.stringify(S))
  } catch {
    /* not persistable here */
  }
}

let bmp: ImageBitmap | null = null
let artId = 'untitled'
let rows = 0
const packedBy: Partial<Record<CharsetName, Int32Array>> = {}
const trueBy: Partial<Record<CharsetName, TrueResult>> = {}
const candCache = new Map<string, CandTable>()

const app = document.getElementById('app')!
app.innerHTML = `
  <header>
    <span class="logo">KOAN<b>.ansi</b></span>
    <span class="tag">image → bbs-scene ansi · runs 100% local</span>
    <span class="spacer"></span>
    <button id="tourBtn" class="ghost" title="replay the intro tour">?</button>
    <select id="theme" title="koan.design theme library">
      ${Object.keys(PRESET_THEMES).map((t) => `<option>${t}</option>`).join('')}
    </select>
  </header>
  <main>
    <div class="controls">
      <div class="group">
        <span class="legend">source</span>
        <div class="drop" id="drop" title="click = browse · or drop / paste an image">
          <div id="dropLabel">drop image here<br>paste · or click to browse</div>
        </div>
        <input type="file" id="file" accept="image/*" hidden>
      </div>
      <div class="group">
        <span class="legend">grid</span>
        <div class="row">
          <label for="cols" title="grid width in character cells — height follows the image (cells are 1:2)">cols</label>
          <input type="number" id="cols" min="20" max="300" step="4" style="width:70px">
          <span class="val" id="rowsVal">–</span>
        </div>
        <div class="row">
          <label for="zoom" title="fit scales to the panel · 1:1 and 2× show real pixels">zoom</label>
          <select id="zoom" style="width:70px">
            <option value="fit">fit</option><option value="1">1:1</option><option value="2">2×</option>
          </select>
        </div>
      </div>
      <div class="group">
        <span class="legend">render</span>
        <div class="row">
          <label for="charset" title="classic = pure cp437, real .ans capable · extended adds unicode quarter blocks">charset</label>
          <select id="charset">
            <option value="classic">classic (cp437)</option>
            <option value="extended">extended (+quarters)</option>
          </select>
        </div>
        <div class="row">
          <label for="compare" title="render both charsets side by side — click a preview to select it">compare both</label>
          <input type="checkbox" id="compare">
        </div>
        <div class="row">
          <label for="palette" title="vga16 = the authentic 16 colors · truecolor = exact colors, modern web look">palette</label>
          <select id="palette">
            <option value="vga16">vga16 (authentic)</option>
            <option value="truecolor">truecolor</option>
          </select>
        </div>
        <div class="row">
          <label for="dither" title="fs = floyd–steinberg error diffusion on the quadrant grid; replaces shade-glyph mixing">dither</label>
          <select id="dither">
            <option value="none">none (shades)</option>
            <option value="fs">floyd–steinberg</option>
          </select>
        </div>
        <div class="row">
          <label for="noiseK" title="penalty for hue-clashing shade dithers — higher = cleaner sky, flatter bands">noise-k</label>
          <input type="range" id="noiseK" min="0" max="0.5" step="0.01">
          <span class="val" id="noiseVal"></span>
        </div>
      </div>
      <div class="group">
        <span class="legend">export</span>
        <div class="row">
          <button id="dlPng" class="primary" title="1:1 png render (8×16px cells)">png</button>
          <button id="dlAns" title=".ans — cp437 + sauce record, opens in ansilove / pablodraw">.ans</button>
          <button id="dlJson" title="koan-site background engine format (packed cells)">.json</button>
          <button id="dlTxt" title="utf-8 ansi — cat it in a modern terminal">.txt</button>
        </div>
      </div>
    </div>
    <div class="well">
      <div class="canvases" id="canvases" hidden>
        <div class="slot" id="slotClassic" data-set="classic">
          <span class="cap">classic</span><canvas id="cvClassic"></canvas>
        </div>
        <div class="slot" id="slotExtended" data-set="extended">
          <span class="cap">extended</span><canvas id="cvExtended"></canvas>
        </div>
      </div>
      <div class="empty" id="empty">no image yet — drop one anywhere, paste from clipboard,<br>
        or click browse. nothing uploads; conversion runs in this tab.</div>
      <div class="status">
        <span id="stDims">–</span><span id="stTime"></span>
        <span class="spacer"></span><span class="msg" id="stMsg"></span>
      </div>
    </div>
  </main>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const el = {
  theme: $<HTMLSelectElement>('theme'),
  drop: $<HTMLDivElement>('drop'),
  dropLabel: $<HTMLDivElement>('dropLabel'),
  file: $<HTMLInputElement>('file'),
  cols: $<HTMLInputElement>('cols'),
  rowsVal: $<HTMLSpanElement>('rowsVal'),
  zoom: $<HTMLSelectElement>('zoom'),
  charset: $<HTMLSelectElement>('charset'),
  compare: $<HTMLInputElement>('compare'),
  palette: $<HTMLSelectElement>('palette'),
  dither: $<HTMLSelectElement>('dither'),
  noiseK: $<HTMLInputElement>('noiseK'),
  noiseVal: $<HTMLSpanElement>('noiseVal'),
  canvases: $<HTMLDivElement>('canvases'),
  empty: $<HTMLDivElement>('empty'),
  stDims: $<HTMLSpanElement>('stDims'),
  stTime: $<HTMLSpanElement>('stTime'),
  stMsg: $<HTMLSpanElement>('stMsg'),
  slots: {
    classic: { slot: $<HTMLDivElement>('slotClassic'), cv: $<HTMLCanvasElement>('cvClassic') },
    extended: { slot: $<HTMLDivElement>('slotExtended'), cv: $<HTMLCanvasElement>('cvExtended') },
  },
  dlPng: $<HTMLButtonElement>('dlPng'),
  dlAns: $<HTMLButtonElement>('dlAns'),
  dlJson: $<HTMLButtonElement>('dlJson'),
  dlTxt: $<HTMLButtonElement>('dlTxt'),
}

let msgTimer = 0
function msg(text: string, isErr = false): void {
  el.stMsg.textContent = text
  el.stMsg.className = isErr ? 'err' : 'msg'
  clearTimeout(msgTimer)
  msgTimer = window.setTimeout(() => (el.stMsg.textContent = ''), 4000)
}

function candTable(set: CharsetName): CandTable {
  const shades = S.dither !== 'fs'
  const key = `${set}|${S.noiseK}|${shades}`
  let t = candCache.get(key)
  if (!t) {
    t = buildCandidates(CHARSETS[set], S.noiseK, shades)
    candCache.set(key, t)
  }
  return t
}

function activeSets(): CharsetName[] {
  return S.compare ? ['classic', 'extended'] : [S.charset]
}

function convert(): void {
  if (!bmp) return
  const t0 = performance.now()
  rows = autoRows(bmp.width, bmp.height, S.cols)
  let quads = quadsFromImage(bmp, S.cols, rows)
  if (S.palette === 'vga16' && S.dither === 'fs') quads = fsDitherQuads(quads, S.cols, rows)
  const n = S.cols * rows
  for (const set of activeSets()) {
    if (S.palette === 'truecolor') {
      trueBy[set] = matchTruecolor(quads, n, CHARSETS[set])
      delete packedBy[set]
    } else {
      packedBy[set] = matchCells(quads, n, candTable(set))
      delete trueBy[set]
    }
  }
  draw()
  el.stDims.textContent = `${S.cols}×${rows} cells · ${S.cols * CW}×${rows * CH}px`
  el.stTime.textContent = `${Math.round(performance.now() - t0)}ms`
}

function draw(): void {
  el.empty.hidden = bmp !== null
  el.canvases.hidden = bmp === null
  const sets = activeSets()
  for (const set of ['classic', 'extended'] as CharsetName[]) {
    const { slot, cv } = el.slots[set]
    const on = sets.includes(set)
    slot.hidden = !on
    slot.classList.toggle('selected', S.compare && set === S.charset)
    if (!on || !bmp) continue
    if (S.palette === 'truecolor') {
      const t = trueBy[set]!
      drawTruecolor(cv, t.glyph, t.fg, t.bg, S.cols, rows, CHARSETS[set])
    } else {
      drawPacked(cv, packedBy[set]!, S.cols, rows, CHARSETS[set], set)
    }
    cv.style.width = S.zoom === 'fit' ? '' : `${cv.width * Number(S.zoom)}px`
  }
  el.canvases.classList.toggle('zoomed', S.zoom !== 'fit')
  updateExports()
}

function updateExports(): void {
  const has = bmp !== null
  const noImg = 'no image yet — drop, paste, or browse one first'
  el.dlPng.disabled = !has
  el.dlPng.title = has ? '1:1 png render (8×16px cells)' : noImg
  el.dlTxt.disabled = !has
  el.dlTxt.title = has ? 'utf-8 ansi — cat it in a modern terminal' : noImg
  const ansOk = has && S.charset === 'classic' && S.palette === 'vga16'
  el.dlAns.disabled = !ansOk
  el.dlAns.title = !has
    ? noImg
    : ansOk
      ? '.ans — cp437 + sauce record, opens in ansilove / pablodraw'
      : 'needs classic charset + vga16 palette — quarter blocks and truecolor don’t exist in cp437'
  const jsonOk = has && S.palette === 'vga16'
  el.dlJson.disabled = !jsonOk
  el.dlJson.title = !has
    ? noImg
    : jsonOk
      ? 'koan-site background engine format (packed cells)'
      : 'site json is 16-color packed — switch palette to vga16'
  const tcOff = S.palette === 'truecolor'
  el.dither.disabled = tcOff
  el.dither.title = tcOff ? 'dither is a 16-color feature' : el.dither.title
  const nkOff = tcOff || S.dither === 'fs'
  el.noiseK.disabled = nkOff
  el.noiseK.title = nkOff
    ? 'noise-k tunes shade glyphs — off while truecolor or fs dither'
    : 'penalty for hue-clashing shade dithers — higher = cleaner sky, flatter bands'
}

// ---- inputs ----------------------------------------------------------------
async function loadFile(f: File): Promise<void> {
  if (!f.type.startsWith('image/')) {
    msg(`can't read "${f.name}" — not an image (png / jpg / webp / gif)`, true)
    return
  }
  try {
    bmp = await createImageBitmap(f)
  } catch {
    msg(`can't decode "${f.name}" — corrupt or unsupported image`, true)
    return
  }
  artId = (f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'untitled')
  el.dropLabel.innerHTML = `<span class="name">${f.name}</span><br><span class="meta">${bmp.width}×${bmp.height}px — drop another to replace</span>`
  convert()
}

el.drop.addEventListener('click', () => el.file.click())
el.file.addEventListener('change', () => el.file.files?.[0] && loadFile(el.file.files[0]))
for (const [ev, on] of [['dragover', true], ['dragleave', false]] as const) {
  window.addEventListener(ev, (e) => {
    e.preventDefault()
    el.drop.classList.toggle('armed', on)
  })
}
window.addEventListener('drop', (e) => {
  e.preventDefault()
  el.drop.classList.remove('armed')
  const f = e.dataTransfer?.files?.[0]
  if (f) void loadFile(f)
  else msg("nothing usable in that drop — need an image file", true)
})
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
  const f = item?.getAsFile()
  if (f) void loadFile(f)
})

// ---- controls --------------------------------------------------------------
let deb = 0
const schedule = () => {
  clearTimeout(deb)
  deb = window.setTimeout(convert, 120)
}

function bindControls(): void {
  el.cols.value = String(S.cols)
  el.zoom.value = S.zoom
  el.charset.value = S.charset
  el.compare.checked = S.compare
  el.palette.value = S.palette
  el.dither.value = S.dither
  el.noiseK.value = String(S.noiseK)
  el.noiseVal.textContent = S.noiseK.toFixed(2)
  el.theme.value = S.theme
}
bindControls()
applyTheme(S.theme)
updateExports()

el.cols.addEventListener('input', () => {
  S.cols = Math.max(20, Math.min(300, Number(el.cols.value) || 120))
  if (bmp) el.rowsVal.textContent = `×${autoRows(bmp.width, bmp.height, S.cols)}`
  save()
  schedule()
})
el.zoom.addEventListener('change', () => {
  S.zoom = el.zoom.value as Settings['zoom']
  save()
  draw()
})
el.charset.addEventListener('change', () => {
  S.charset = el.charset.value as CharsetName
  save()
  if (S.compare && (packedBy[S.charset] || trueBy[S.charset])) draw()
  else schedule()
})
el.compare.addEventListener('change', () => {
  S.compare = el.compare.checked
  save()
  schedule()
})
el.palette.addEventListener('change', () => {
  S.palette = el.palette.value as Settings['palette']
  save()
  schedule()
})
el.dither.addEventListener('change', () => {
  S.dither = el.dither.value as Settings['dither']
  save()
  schedule()
})
el.noiseK.addEventListener('input', () => {
  S.noiseK = Number(el.noiseK.value)
  el.noiseVal.textContent = S.noiseK.toFixed(2)
  save()
  schedule()
})
el.theme.addEventListener('change', () => {
  S.theme = el.theme.value
  applyTheme(S.theme)
  save()
})
for (const set of ['classic', 'extended'] as CharsetName[]) {
  el.slots[set].slot.addEventListener('click', () => {
    if (!S.compare) return
    S.charset = set
    el.charset.value = set
    save()
    draw()
    msg(`${set} selected for export`)
  })
}

// ---- exports ---------------------------------------------------------------
function stem(): string {
  return `${artId}.${S.charset}`
}
el.dlPng.addEventListener('click', () => {
  el.slots[S.charset].cv.toBlob((b) => {
    if (b) download(b, `${stem()}.png`, 'image/png')
  })
})
el.dlAns.addEventListener('click', () => {
  const p = packedBy[S.charset]
  if (!p) return
  download(ansBytes(p, S.cols, rows, CHARSETS[S.charset], artId), `${stem()}.ans`, 'application/octet-stream')
  msg(`${stem()}.ans written — sauce says ${S.cols}×${rows}, ice colors on`)
})
el.dlJson.addEventListener('click', () => {
  const p = packedBy[S.charset]
  if (!p) return
  if (siteJsonUsesExtendedGlyphs(p))
    msg('heads up: extended glyph indices — the site engine renders classic-only today')
  download(siteJson(artId, artId, S.cols, rows, 0, [p]), `${stem()}.json`, 'application/json')
})
el.dlTxt.addEventListener('click', () => {
  if (S.palette === 'truecolor') {
    const t = trueBy[S.charset]!
    download(txtString(t.glyph, t.fg, t.bg, S.cols, rows, CHARSETS[S.charset], true), `${stem()}.txt`, 'text/plain')
  } else {
    const p = packedBy[S.charset]!
    const n = S.cols * rows
    const glyph = new Int32Array(n)
    const fg = new Int32Array(n)
    const bg = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      glyph[i] = p[i] >> 8
      fg[i] = (p[i] >> 4) & 0xf
      bg[i] = p[i] & 0xf
    }
    download(txtString(glyph, fg, bg, S.cols, rows, CHARSETS[S.charset], false), `${stem()}.txt`, 'text/plain')
  }
})

// ---- intro tour -------------------------------------------------------------
const TOUR_KEY = 'koan-ansi-tour-done'
const TOUR: { target: string; text: string }[] = [
  { target: 'drop', text: 'feed it here — drop an image anywhere, paste from clipboard, or tap to browse. nothing uploads; conversion runs in this tab.' },
  { target: 'charset', text: 'classic = pure cp437 blocks, real .ans capable. extended adds unicode quarter blocks for finer detail.' },
  { target: 'compare', text: 'render both charsets side by side — click a preview to choose which one exports.' },
  { target: 'palette', text: 'vga16 = the authentic 16 dos colors. truecolor = exact colors, the modern web look.' },
  { target: 'noiseK', text: 'the anti-speckle knob — higher kills hue-clashing dither dots, at the cost of flatter gradients.' },
  { target: 'dlPng', text: 'exports: png render, real .ans with a sauce record, site json / .ansim, terminal .txt. a dimmed button carries its reason in the tooltip.' },
]

let tourAt = -1
let bubble: HTMLDivElement | null = null
let marked: HTMLElement | null = null

function tourDone(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === '1'
  } catch {
    return false
  }
}

function endTour(): void {
  tourAt = -1
  bubble?.remove()
  bubble = null
  marked?.classList.remove('tour-mark')
  marked = null
  try {
    localStorage.setItem(TOUR_KEY, '1')
  } catch {
    /* fine */
  }
}

function showTour(i: number): void {
  if (i >= TOUR.length) {
    endTour()
    return
  }
  tourAt = i
  marked?.classList.remove('tour-mark')
  const t = document.getElementById(TOUR[i].target)!
  marked = t
  t.classList.add('tour-mark')
  t.scrollIntoView({ block: 'nearest' })
  if (!bubble) {
    bubble = document.createElement('div')
    bubble.className = 'tour-bubble'
    document.body.appendChild(bubble)
  }
  bubble.innerHTML = `
    <div class="tour-text">${TOUR[i].text}</div>
    <div class="tour-row">
      <span class="tour-step">${i + 1}/${TOUR.length}</span>
      <span class="tour-spacer"></span>
      <button class="tour-skip" id="tourSkip">skip</button>
      <button class="primary" id="tourNext">${i === TOUR.length - 1 ? 'done' : 'next'}</button>
    </div>`
  bubble.querySelector('#tourNext')!.addEventListener('click', () => showTour(tourAt + 1))
  bubble.querySelector('#tourSkip')!.addEventListener('click', endTour)
  const r = t.getBoundingClientRect()
  const bw = Math.min(270, window.innerWidth - 16)
  bubble.style.width = `${bw}px`
  const narrow = window.innerWidth < 760
  let x = narrow ? r.left : r.right + 10
  let y = narrow ? r.bottom + 8 : r.top
  x = Math.max(8, Math.min(x, window.innerWidth - bw - 8))
  y = Math.max(8, Math.min(y, window.innerHeight - 140))
  bubble.style.left = `${x}px`
  bubble.style.top = `${y}px`
}

document.getElementById('tourBtn')!.addEventListener('click', () => showTour(0))
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tourAt >= 0) endTour()
})
window.addEventListener('resize', () => {
  if (tourAt >= 0) showTour(tourAt)
})
if (!tourDone()) window.setTimeout(() => showTour(0), 600)
