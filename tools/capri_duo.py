"""D, Capri's companion (decoration only). His sprite comes from tools/d_src (recovered from the concept sheet):
d_normal.png (hair down) and d_spiked.png (hair shot up, hand out). The other poses are painted from those.
Called by capri_sprite.py; writes assets/d/d.png and returns its metadata."""
import os
from PIL import Image
_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'd_src')
N = Image.open(os.path.join(_SRC, 'd_normal.png')).convert('RGBA')
SP = Image.open(os.path.join(_SRC, 'd_spiked.png')).convert('RGBA')
P = {'a': (11, 10, 20, 255), 'c': (36, 44, 66, 255), 'f': (246, 222, 208, 255), 't': (64, 100, 218, 255), 'u': (118, 150, 246, 255),
     'w': (40, 66, 168, 255), 'p': (236, 240, 250, 255), 'r': (176, 186, 210, 255), 'o': (92, 30, 44, 255), 's': (30, 34, 62, 255),
     'k': (250, 250, 255, 255), 'i': (104, 204, 84, 255), 'j': (36, 112, 48, 255), 'h': (196, 248, 150, 255), 'm': (216, 170, 158, 255)}
CLEAR = (0, 0, 0, 0)
# vertical offset of the body inside the spiked sprite (bottom-aligned)
SPY = SP.height - N.height

def _body_off(img):
    return SPY if img.height > N.height else 0

def folded(base):
    """arms crossed over his chest"""
    im = base.copy(); oy = _body_off(im); px = im.load()
    put = lambda x, y, c: px.__setitem__((x, y + oy), P[c] if c in P else c)
    for y in range(42, 50):            # forearms no longer hang at his sides
        for x in list(range(0, 12)) + list(range(28, 40)):
            if x < im.width: put(x, y, CLEAR)
        put(11, y, 'a'); put(28, y, 'a')
    for y in range(40, 54):            # his raised hand (spiked pose) goes too
        for x in range(34, im.width):
            put(x, y, CLEAR)
    for x in range(7, 33):             # the folded forearms across his chest
        put(x, 39, 'a'); put(x, 40, 'u'); put(x, 41, 't'); put(x, 42, 't'); put(x, 43, 'w'); put(x, 44, 'a')
    for y in range(40, 44): put(6, y, 'a'); put(33, y, 'a')
    for y in (40, 41, 42, 43): put(9, y, 'p' if y < 43 else 'r'); put(30, y, 'p' if y < 43 else 'r')   # cuff stripes
    for x, y in ((25, 41), (26, 41), (27, 41), (25, 42), (26, 42), (27, 42)): put(x, y, 'f')          # his hand tucked on top
    for x in range(25, 28): put(x, 40, 'a')
    for y in range(41, 43): put(24, y, 'a')
    for y in range(36, 39):             # sleeves end at the elbow
        put(4, y, 'a'); put(35, y, 'a')
    return im

def eyes_side(base, dx=-1):
    """glancing away: pupils shifted toward his right"""
    im = base.copy(); oy = _body_off(im); px = im.load()
    for (x0, x1) in ((14, 17), (22, 25)):
        row = [[px[x, y + oy] for x in range(x0, x1 + 1)] for y in range(18, 21)]
        for j, y in enumerate(range(18, 21)):
            for i, x in enumerate(range(x0, x1 + 1)):
                src = i - dx
                px[x, y + oy] = row[j][min(max(src, 0), len(row[j]) - 1)]
    return im

def look_up(base):
    """startled, looking up: glints at the top of his eyes, mouth open"""
    im = base.copy(); oy = _body_off(im); px = im.load()
    for (x0, x1) in ((14, 17), (22, 25)):
        for x in range(x0, x1 + 1):
            px[x, 18 + oy] = P['i']; px[x, 19 + oy] = P['j']; px[x, 20 + oy] = P['i']
        px[x0 + 1, 18 + oy] = P['k']; px[x0 + 2, 18 + oy] = P['k']
    for x in range(18, 22): px[x, 23 + oy] = P['f']; px[x, 24 + oy] = P['f']
    for x in (19, 20):
        px[x, 23 + oy] = P['o']; px[x, 24 + oy] = P['o']; px[x, 25 + oy] = P['o']
    return im

def blink(base):
    im = base.copy(); oy = _body_off(im); px = im.load()
    for (x0, x1) in ((14, 17), (22, 25)):
        for y in range(18, 21):
            for x in range(x0, x1 + 1): px[x, y + oy] = P['f']
        for x in range(x0, x1 + 1): px[x, 20 + oy] = P['a']
    return im

def poses():
    return {'normal': N, 'blink': blink(N), 'spiked': SP, 'folded': eyes_side(folded(SP)), 'lookup': look_up(N),
            'breathe': N}

def build(out_path):
    """all poses in one strip of equal cells, bottom-aligned (his feet on the bottom row)"""
    ps = {'normal': N, 'blink': blink(N), 'spiked': SP, 'spiked_blink': blink(SP), 'folded': eyes_side(folded(SP)), 'lookup': look_up(N)}
    cw = max(p.width for p in ps.values()); ch = max(p.height for p in ps.values())
    strip = Image.new('RGBA', (cw * len(ps), ch), (0, 0, 0, 0))
    rects = {}
    for i, (k, im) in enumerate(ps.items()):
        x = i * cw + (cw - im.width) // 2
        strip.alpha_composite(im, (x, ch - im.height))
        rects[k] = [i * cw, 0]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    strip.save(out_path)
    # where his raised hand is in the spiked pose (for the bolt that links him to Capri), and the top of his head
    return {"file": "d/d.png", "size": [cw, ch], "anchor": [cw // 2, ch], "rects": rects,
            "hand": [38, ch - 15], "head": [cw // 2, ch - 58], "headSpiked": [cw // 2, ch - 64]}
