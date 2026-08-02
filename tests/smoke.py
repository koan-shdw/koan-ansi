"""Smoke tests — run: python tests/smoke.py"""

import json
import os
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from koan_ansi import (  # noqa: E402
    CHARSETS,
    CLASSIC,
    EXTENDED,
    PALETTE_U8,
    convert_image,
    match,
    match_truecolor,
    quad_grid,
    render_cells,
    unpack,
)
from koan_ansi.ans import write_ans  # noqa: E402
from koan_ansi.sitejson import write_site_json  # noqa: E402
from koan_ansi.txt import write_txt  # noqa: E402

PASS = 0


def ok(name: str, cond: bool) -> None:
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok {name}")


def img_from_quads(q: np.ndarray) -> Image.Image:
    """rows*2 x cols*2 array (h2,w2,3) -> PIL, so every pixel is one quadrant."""
    return Image.fromarray(q.astype(np.uint8))


# 1. gradient sanity ---------------------------------------------------------
grad = np.linspace(0, 255, 64, dtype=np.uint8)
grad_img = Image.fromarray(np.repeat(grad[None, :, None], 32, axis=0).repeat(3, axis=2))
packed = convert_image(grad_img, cols=16, rows=8)
g, f, b = unpack(packed)
ok("gradient shape", packed.shape == (8, 16))
ok("gradient glyph range", int(g.max()) < len(CLASSIC))
ok("gradient palette range", int(f.max()) < 16 and int(b.max()) < 16)
ok("gradient uses shades or blocks", len(np.unique(g)) >= 2)

# 2. half-block: top red / bottom blue inside one cell row --------------------
h2 = np.zeros((8, 16, 3), dtype=np.uint8)  # 4 rows x 8 cols of cells
h2[:3] = (170, 0, 0)   # exact palette red (4)
h2[3:] = (0, 0, 170)   # exact palette blue (1) — boundary mid-cell-row 1
quads = quad_grid(img_from_quads(h2), 8, 4)
pk = match(quads, CLASSIC)
cell = int(pk[1, 3])
want = {(5 << 8) | (4 << 4) | 1, (6 << 8) | (1 << 4) | 4}  # ▀ red/blue or ▄ blue/red
ok("half-block split cell", cell in want)
solid_top = int(pk[0, 0])
ok("solid red cell", solid_top in {(0 << 8) | (0 << 4) | 4, (4 << 8) | (4 << 4) | 0})

# 3. quarter block only in extended ------------------------------------------
q1 = np.zeros((2, 2, 3), dtype=np.uint8)
q1[0, 0] = (0, 170, 0)  # TL green, one single cell
quads1 = quad_grid(img_from_quads(q1), 1, 1)
pk_c = match(quads1, CLASSIC)
pk_e = match(quads1, EXTENDED)
gc = int(pk_c[0, 0]) >> 8
ge = int(pk_e[0, 0]) >> 8
ok("classic stays in 9 glyphs", gc < len(CLASSIC))
ok("extended picks a quarter", ge >= len(CLASSIC))
ge_g, ge_f, ge_b = unpack(pk_e)
arr = render_cells(ge_g, ge_f, ge_b, EXTENDED)
ok("extended TL quad is green", tuple(arr[0, 0]) == (0, 170, 0) and tuple(arr[15, 7]) == (0, 0, 0))

# 4. truecolor ---------------------------------------------------------------
tg, tf, tb = match_truecolor(quads1, EXTENDED)
arr_t = render_cells(tg, tf, tb, EXTENDED)
ok("truecolor TL quad green-ish", arr_t[0, 0, 1] > 120 and arr_t[15, 7, 1] < 50)

# 5. exports -----------------------------------------------------------------
tmp = tempfile.mkdtemp(prefix="ansiconv-smoke-")
ans_path = os.path.join(tmp, "t.ans")
write_ans(ans_path, pk, CLASSIC, title="T", author="a", group="g")
raw = open(ans_path, "rb").read()
ok("ans starts with SGR", raw[:2] == b"\x1b[")
ok("ans has SAUCE", raw[-128:-121] == b"SAUCE00" and raw[-129] == 0x1A)
ok("ans body is CP437 printable", 0xB0 in raw or 0xDB in raw or 0xDF in raw or 0xDC in raw)

txt_path = os.path.join(tmp, "t.txt")
write_txt(txt_path, *unpack(pk), CLASSIC)
lines = open(txt_path, encoding="utf-8").read().rstrip("\n").split("\n")
ok("txt line count", len(lines) == pk.shape[0])
ok("txt resets per line", all(ln.endswith("\x1b[0m") for ln in lines))

js_path = os.path.join(tmp, "t.json")
write_site_json(js_path, "t", "T", 8, 4, 0, [pk])
art = json.load(open(js_path, encoding="utf-8"))
ok("json shape", art["cols"] == 8 and art["rows"] == 4 and len(art["frames"][0]) == 32)
ok("json packing", art["frames"][0][pk.shape[1] * 1 + 3] == cell)

print(f"PASS ({PASS} checks)")
