"""Capri sprite generator ("Spark" design).

Writes assets/capri/sheet.png, sheet.json and sheet.js in the format renderer/app.js reads:
  - body frames (no eyes / mouth): idle0 idle1 walk0-3 charge held cast
  - eye overlays: eyes_<neutral|blink|happy|surprised|angry|sad|relaxed|glow>
  - mouth overlays: mouth_<neutral|happy|angry|surprised|sad|relaxed|talk1|talk2|talk3>
  - the "chill" lounge pose (tools/capri_lounge.py): assets/capri/lounge.png
Shapes are drawn in a 64x80 design space and placed into larger CWxCH cells (offset OFF) so the
shattered-glass hair fits. Overlays are drawn at the frame's `dy` by the app.

Edit colours, shapes and poses below, then run:
    pip install pillow
    python tools/capri_sprite.py
"""
import json, math, os, random
from PIL import Image, ImageDraw, ImageChops

W, H = 64, 80        # design space: every body / face coordinate below is in this 64x80 space
ANCHOR = (32, 78)    # feet, in design space
# the shattered-glass hair is bigger than the body, so each sheet cell is larger than the design space
OFF = (14, 16)       # where design space (0, 0) sits inside a cell
CW, CH = 96, 100      # cell size
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "capri")

C = dict(
    out=(10, 4, 16, 255), black=(30, 17, 42, 255),
    pink=(255, 30, 104, 255), pink_d=(200, 16, 78, 255), pink_l=(255, 112, 162, 255),
    pink_w=(255, 214, 230, 255), red=(232, 20, 60, 255),
    green=(46, 255, 140, 255), green_d=(12, 176, 92, 255), navy=(14, 30, 120, 255),
    blue=(28, 96, 255, 255), blue_l=(126, 214, 255, 255), white=(248, 242, 252, 255),
    rim=(150, 64, 255, 255), mouth=(70, 14, 46, 255),
)
RIM_R, RIM_L, RIM_T = (196, 70, 230, 255), (110, 52, 190, 255), (84, 44, 120, 255)

# eye sockets / mouth anchor (sprite pixels, before dy)
EYES = (27, 37)
EYE_Y = 28
EYE_R = 4
MASK = (22, 23, 42, 33)  # the green rectangle across her eyes: x0, y0, x1, y1
MASK_MANY = (21, 21, 43, 34)  # it grows to this size in many-eyes mode
MOUTH_Y = 36

# ------------------------------------------------------------------ hair (fixed design)
_r = random.Random(7)
N_SPIKES = 22
SPIKES = []
for i in range(N_SPIKES):
    a = -math.pi / 2 + i * 2 * math.pi / N_SPIKES + _r.uniform(-0.09, 0.09)
    SPIKES.append((a, _r.uniform(0.78, 1.16), _r.uniform(0.74, 0.86)))
CUTS = [2, 9, 13, 19]
SHARDS = [(-0.35, 1.32, 3), (0.55, 1.28, 2), (2.5, 1.3, 3), (3.4, 1.25, 2), (-2.0, 1.34, 2), (1.0, 1.35, 2)]


def poly(d, pts, col, ox=0, oy=0):
    d.polygon([(x + ox, y + oy) for x, y in pts], fill=col)


def hair(img, cx, cy, sway, lift, seed, spark=0.08):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rx, ry = 26.5 * lift, 23 * lift
    pts, tips = [], []
    for i, (a, L, inn) in enumerate(SPIKES):
        a2 = a + 0.07 * math.sin(sway + i * 1.37)
        down = max(0.0, math.sin(a2))
        Lf = L * (1 - 0.22 * down)
        o = (cx + math.cos(a2) * rx * Lf, cy + math.sin(a2) * ry * Lf)
        an = a2 + math.pi / N_SPIKES
        pts += [o, (cx + math.cos(an) * rx * inn, cy + math.sin(an) * ry * inn)]
        if math.sin(a2) < 0.45:  # bolts jump off the upper / side tips
            tips.append([round(min(W - 1, max(0, o[0])), 1), round(min(H - 1, max(0, o[1])), 1)])
    d.polygon(pts, fill=C["pink"])
    px = layer.load()
    for y in range(H):
        for x in range(W):
            if px[x, y][3] and y > cy + 9:
                px[x, y] = C["pink_d"]
    for i in CUTS:
        a, L, _ = SPIKES[i]
        a2 = a + 0.07 * math.sin(sway + i * 1.37)
        r0, r1 = 0.55, 0.9 * L
        p0 = (cx + math.cos(a2) * rx * r0, cy + math.sin(a2) * ry * r0)
        p1 = (cx + math.cos(a2 + 0.05) * rx * r1, cy + math.sin(a2 + 0.05) * ry * r1)
        pw = (cx + math.cos(a2 + 0.13) * rx * (r0 + 0.12), cy + math.sin(a2 + 0.13) * ry * (r0 + 0.12))
        d.polygon([p0, pw, p1], fill=C["black"])
    for k, (a, rr, s) in enumerate(SHARDS):
        a2 = a + 0.05 * math.sin(sway * 1.3 + k)
        r2 = rr + 0.04 * math.sin(sway + k * 2)
        x, y = cx + math.cos(a2) * rx * r2, cy + math.sin(a2) * ry * r2
        d.polygon([(x, y - s), (x + s, y + 1), (x - 1, y + s - 1)], fill=C["pink"] if k % 2 else C["pink_l"])
    rng = random.Random(seed)
    for y in range(H):
        for x in range(W):
            p = px[x, y]
            if p[3] and p[:3] != C["black"][:3]:
                r = rng.random()
                if r < spark * 0.35:
                    px[x, y] = C["pink_w"]
                elif r < spark:
                    px[x, y] = C["pink_l"]
    img.alpha_composite(layer)
    return tips


# ------------------------------------------------------------------ hair: shattered glass
# One big angular mass sweeping up-right, cut by straight glass cracks, with loose shards floating off.
HAIR_C = (32, 27)
HAIR_MASS = [(6, 34), (2, 22), (9, 17), (4, 6), (16, 9), (19, -2), (28, 5), (34, -5), (40, 5), (50, -2), (50, 9),
             (63, 4), (57, 16), (70, 18), (59, 26), (68, 36), (55, 34), (58, 45), (46, 40), (44, 48), (36, 41),
             (28, 41), (20, 48), (19, 40), (6, 46), (11, 37)]
HAIR_CRACKS = [[(50, -2), (43, 13), (46, 14), (51, 2)], [(63, 4), (49, 19), (52, 21), (64, 7)],
               [(68, 36), (51, 28), (51, 31), (65, 38)], [(4, 6), (16, 18), (18, 15), (7, 5)],
               [(2, 22), (14, 25), (14, 22), (3, 19)], [(20, 48), (25, 38), (22, 38), (17, 47)],
               [(34, -5), (33, 10), (35, 10), (37, -4)]]
HAIR_FLOAT = [([(64, -3), (72, -6), (67, 2)], "pink_l"), ([(-4, 12), (0, 9), (-1, 17)], "pink"),
              ([(66, 44), (72, 41), (69, 50)], "pink"), ([(9, -5), (14, -7), (12, -1)], "pink_l"),
              ([(-3, 38), (1, 36), (0, 42)], "pink_l")]
HAIR_SHADE_Y = 36   # below this (design y) the hair is the darker pink


def hair_points(pts, sway, amt, lift=1.0, xf=None):
    cx, cy = HAIR_C
    out = []
    for i, (x, y) in enumerate(pts):
        x = cx + (x - cx) * lift + amt * math.sin(sway + i * 1.7)
        y = cy + (y - cy) * lift + amt * math.cos(sway * 1.3 + i)
        out.append(xf(x, y) if xf else (x + OFF[0], y + OFF[1]))
    return out


def glitter(layer, seed, spark=0.08, inv=None):
    # dense sparkle like her reference art, heavier toward the top
    px = layer.load()
    rng = random.Random(seed)
    top, base = spark * 3.2, spark * 0.75
    for y in range(layer.height):
        for x in range(layer.width):
            c = px[x, y]
            if not c[3] or c[:3] not in (C["pink"][:3], C["pink_d"][:3]):
                continue
            dy = inv(x, y)[1] if inv else y - OFF[1]
            k = max(0.0, min(1.0, 1 - (dy + 6) / 56))
            r = rng.random()
            p = base + (top - base) * k
            if r < p * 0.45:
                px[x, y] = C["pink_w"]
            elif r < p:
                px[x, y] = C["pink_l"]


def hair_shattered(size, sway, lift=1.0, seed=1, spark=0.08, xf=None, inv=None):
    # draws the hair on its own layer of `size`; xf / inv map design space <-> layer (default: plain offset)
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.polygon(hair_points(HAIR_MASS, sway, 0.6, lift, xf), fill=C["pink"])
    for g in HAIR_CRACKS:
        d.polygon(hair_points(g, 0, 0, lift, xf), fill=(0, 0, 0, 0))
    px = layer.load()
    for y in range(layer.height):
        for x in range(layer.width):
            if px[x, y][3] and (inv(x, y)[1] if inv else y - OFF[1]) > HAIR_SHADE_Y:
                px[x, y] = C["pink_d"]
    for sh, col in HAIR_FLOAT:
        d.polygon(hair_points(sh, sway, 0.5, lift, xf), fill=C[col])
    glitter(layer, seed, spark, inv)
    # bolts jump off the upper / side points of the mass
    tips = [p for p, (_, y) in zip(hair_points(HAIR_MASS, sway, 0.6, lift, xf), HAIR_MASS) if y < 30]
    return layer, [[round(x, 1), round(y, 1)] for x, y in tips]


def to_cell(img):
    # place a design-space (64x80) image into a cell
    cell = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    cell.alpha_composite(img, OFF)
    return cell


def shift(p):
    return [round(p[0] + OFF[0], 1), round(p[1] + OFF[1], 1)]


# ------------------------------------------------------------------ body
def hand(d, x, y, ang):
    d.ellipse([x - 1, y - 1, x + 1, y + 1], fill=C["black"])
    d.line([(x, y), (x + math.cos(ang) * 2.5, y + math.sin(ang) * 2.5)], fill=C["black"], width=2)
    return (x + math.cos(ang) * 3, y + math.sin(ang) * 3)


def limb_quad(d, a, b, wa, wb, col):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L
    d.polygon([(a[0] + nx * wa / 2, a[1] + ny * wa / 2), (b[0] + nx * wb / 2, b[1] + ny * wb / 2),
               (b[0] - nx * wb / 2, b[1] - ny * wb / 2), (a[0] - nx * wa / 2, a[1] - ny * wa / 2)], fill=col)


def leg(d, hip, knee, ankle, toe, accent):
    limb_quad(d, hip, knee, 4, 3, C["black"])
    limb_quad(d, knee, ankle, 3, 2, C["black"])
    dx, dy = toe[0] - ankle[0], toe[1] - ankle[1]
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L
    d.polygon([(ankle[0] + nx * 1.6, ankle[1] + ny * 1.6), toe, (ankle[0] - nx * 1.6, ankle[1] - ny * 1.6)], fill=C["black"])
    # shard accents (pink on the thigh, pink / green on the shin)
    mx, my = (hip[0] + knee[0]) / 2, (hip[1] + knee[1]) / 2
    d.polygon([(mx - 1, my - 2), (mx + 1, my - 2), (mx, my + 2)], fill=C["pink"])
    sx, sy = (knee[0] + ankle[0]) / 2, (knee[1] + ankle[1]) / 2
    d.polygon([(sx - 1.5, sy - 2), (sx + 1.5, sy - 2), (sx, sy + 2)], fill=accent)


def arms_glide(flap=0.0):
    # arms swept back while gliding
    return [((27, 45), (22, 48 + flap), (17, 51 + flap), 2.9), ((37, 45), (39, 51), (36 - flap, 56), 2.2)]


def arms_rest(swing=0.0):
    return [((27, 45), (22 + swing * 0.5, 51), (19 + swing, 58), 1.9),
            ((37, 45), (42 - swing * 0.5, 51), (45 - swing, 58), 1.2)]


ARMS = {
    "rest": arms_rest(),
    "up": [((27, 45), (20, 41), (15, 33), -2.0), ((37, 45), (44, 41), (49, 33), -1.1)],
    "power": [((27, 45), (19, 45), (12, 40), -2.6), ((37, 45), (45, 45), (52, 40), -0.5)],
    "point": [((27, 45), (22, 51), (19, 58), 1.9), ((37, 45), (44, 46), (52, 44), 0.0)],
}

HIP_L, HIP_R = (30, 60), (34, 60)
LEGS = {
    "stand": [(HIP_L, (28.5, 69), (27.5, 76.5), (23.5, 78.5)), (HIP_R, (35.5, 69), (36.5, 76.5), (40.5, 78.5))],
    "walk0": [(HIP_L, (32, 68), (35, 76.5), (39, 78.5)), (HIP_R, (32, 69), (28, 76), (31.5, 78.5))],
    "walk1": [(HIP_L, (30, 69), (30, 76.5), (34, 78.5)), (HIP_R, (36, 66), (33, 72), (37, 73.5))],
    "walk2": [(HIP_L, (30, 69), (27, 76), (30.5, 78.5)), (HIP_R, (36, 68), (38, 76.5), (42, 78.5))],
    "walk3": [(HIP_L, (33, 66), (30, 72), (34, 73.5)), (HIP_R, (34, 69), (34, 76.5), (38, 78.5))],
    "dangle": [(HIP_L, (29.5, 69), (29, 76), (28.5, 79)), (HIP_R, (34.5, 69), (35, 76), (35.5, 79))],
    # levitating: toes pointed down, one knee drawn up a little
    "float0": [(HIP_L, (29, 68.5), (28.5, 75.5), (29.5, 79)), (HIP_R, (35.5, 67), (34, 73.5), (35.5, 77))],
    "float1": [(HIP_L, (29, 68.5), (29, 75.5), (30, 79)), (HIP_R, (35.5, 67.5), (34.5, 74), (36, 77.5))],
    # gliding (facing right): legs trail behind
    "glide0": [(HIP_L, (27.5, 67.5), (24, 73.5), (20.5, 76)), (HIP_R, (32, 68), (28.5, 75), (25, 78))],
    "glide1": [(HIP_L, (27.5, 68), (24, 74), (20.5, 76.5)), (HIP_R, (32, 68.5), (29, 75.5), (25.5, 78.5))],
}


def body(img, dy, arms, legs):
    d = ImageDraw.Draw(img)
    (lh, lk, la, lt), (rh, rk, ra, rt) = LEGS[legs]
    leg(d, lh, lk, la, lt, C["pink"])
    leg(d, rh, rk, ra, rt, C["green"])
    T = [(25, 43), (39, 43), (37.5, 50), (35, 55), (37, 60), (27, 60), (29, 55), (26.5, 50)]
    poly(d, T, C["black"], oy=dy)
    poly(d, [(32, 44), (36, 47.5), (32, 53), (28, 47.5)], C["red"], oy=dy)
    poly(d, [(32, 46), (33.5, 47.5), (32, 50), (30.5, 47.5)], C["pink_l"], oy=dy)
    poly(d, [(25, 43), (29, 43), (27, 46)], C["pink"], oy=dy)
    poly(d, [(35, 43), (39, 43), (37, 46)], C["pink"], oy=dy)
    poly(d, [(28, 56), (32, 60), (27.5, 60)], C["green"], oy=dy)
    poly(d, [(36, 56), (36.5, 60), (33, 60)], C["pink"], oy=dy)
    tips = []
    for (s, e, w, ang) in arms:
        s2, e2, w2 = (s[0], s[1] + dy), (e[0], e[1] + dy), (w[0], w[1] + dy)
        d.line([s2, e2, w2], fill=C["black"], width=2, joint="curve")
        d.point([(round((e2[0] + w2[0]) / 2), round((e2[1] + w2[1]) / 2))], fill=C["pink"])
        tips.append(hand(d, w2[0], w2[1], ang))
    return [[round(x, 1), round(y, 1)] for x, y in tips]


def socket(ex, ey, inner, w=5.5, h=4):
    """almond eye socket; inner = +1 if the inner (nose) side is to the right"""
    pts = [(-w, -1), (-w * 0.55, -h), (w * 0.45, -h + 0.5), (w, 2), (w * 0.45, h), (-w * 0.55, h - 0.5)]
    return [(ex + x * inner, ey + y) for x, y in pts]


def ring_eye(d, ex, ey, r=3, iris=None, ring=None, pupil=None, look=(0, 0)):
    """concentric eye: green ring, black ring, blue iris, white pupil"""
    lx, ly = look
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=ring or C["green"])
    d.ellipse([ex - r + 1, ey - r + 1, ex + r - 1, ey + r - 1], fill=C["out"])
    if r >= 3:
        d.ellipse([ex - 1 + lx, ey - 1 + ly, ex + 1 + lx, ey + 1 + ly], fill=iris or C["blue"])
    else:
        d.point([(ex + lx, ey + ly)], fill=iris or C["blue"])
    d.point([(ex + lx, ey + ly)], fill=pupil or C["white"])


def target_eye(d, ex, ey, r=4, ring=None, iris=None, look=(0, 0), ticks=True, pupil=True, inner=1):
    """Her eye, like the reference art: a black almond socket with sharp diagonal points,
    a green ring, a thin dark ring, a big blue iris and a big off-center white pupil."""
    lx, ly = look
    black, green = C["out"], ring or C["green"]
    if ticks:  # the socket's pointed tips: up toward the middle, down toward the outside
        for (sx, sy) in ((inner, -1), (-inner, 1)):
            t = r + (0.6 if sx == inner else 1.2)  # short tips; the inner one stops before the middle
            tip = (ex + sx * t, ey + sy * t)
            a = (ex + sx * (r - 1.5), ey + sy * (r - 0.2))
            b2 = (ex + sx * (r - 0.2), ey + sy * (r - 1.5))
            d.polygon([a, tip, b2, (ex + sx * r * 0.5, ey + sy * r * 0.5)], fill=black)
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=black)
    d.ellipse([ex - r + 1, ey - r + 1, ex + r - 1, ey + r - 1], fill=green)
    if iris is False:  # pinpoint (surprised)
        d.ellipse([ex - r + 2, ey - r + 2, ex + r - 2, ey + r - 2], fill=black)
        d.point([(ex, ey)], fill=C["white"])
        return
    blue = iris or C["blue"]
    d.ellipse([ex - r + 2 + lx, ey - r + 2 + ly, ex + r - 2 + lx, ey + r - 2 + ly], fill=C["navy"] if not iris else black)
    if r >= 4:
        d.ellipse([ex - 1 + lx, ey - 1 + ly, ex + 1 + lx, ey + 1 + ly], fill=blue)
        d.rectangle([ex - 1 + lx, ey - 1 + ly, ex + lx, ey + ly], fill=C["white"])     # big white pupil, up-left
    else:
        d.point([(ex + lx, ey + ly)], fill=blue)
        if pupil:
            d.point([(ex - 1 + lx, ey - 1 + ly)], fill=C["white"])


def closed_eye(d, ex, ey, inner):
    """closed / happy eye: black almond with a green curve"""
    d.rectangle([ex - 4, ey - 4, ex + 4, ey + 4], fill=C["green"])
    d.polygon(socket(ex, ey, inner, w=4.2, h=3.4), fill=C["black"])
    d.line([(ex - 3, ey + 1), (ex - 1, ey - 1), (ex + 1, ey - 1), (ex + 3, ey + 1)], fill=C["green"])


def x_eye(d, ex, ey, r=4):
    """closed / laughing eye: a curved black X, like the reference"""
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=C["green"])
    d.line([(ex - 4, ey - 3), (ex - 2, ey - 1), (ex, ey), (ex + 2, ey + 1), (ex + 4, ey + 3)], fill=C["out"])
    d.line([(ex + 4, ey - 3), (ex + 2, ey - 1), (ex, ey), (ex - 2, ey + 1), (ex - 4, ey + 3)], fill=C["out"])
    d.point([(ex - 1, ey), (ex + 1, ey)], fill=C["out"])


def head(img, dy):
    """face, crown and mask; eyes and mouth come from overlays"""
    d = ImageDraw.Draw(img)
    o = dy
    poly(d, [(31, 39), (33, 39), (33, 44), (31, 44)], C["black"], oy=o)
    for t in [[(26, 22), (24, 13), (30, 20)], [(30, 21), (32, 9), (34, 21)], [(34, 20), (40, 13), (38, 22)],
              [(23, 27), (17, 23), (23, 31)], [(41, 27), (47, 23), (41, 31)]]:
        poly(d, t, C["black"], oy=o)
    poly(d, [(23, 21), (41, 21), (42, 30), (38.5, 37), (32, 42), (25.5, 37), (22, 30)], C["black"], oy=o)
    x0, y0, x1, y1 = MASK
    d.rectangle([x0, y0 + o, x1, y1 + o], fill=C["green"])           # green rectangle mask
    d.line([(x0, y1 + o), (x1, y1 + o)], fill=C["green_d"])            # a darker bottom edge for depth
    for n, ex in enumerate(EYES):  # default open eyes baked in, so the face is never blank
        target_eye(d, ex, EYE_Y + o, inner=1 if n == 0 else -1)


def finish(char, glow=False):
    """rim light on dark edges + outline + violet chromatic rim (+ optional pink aura)"""
    Wc, Hc = char.size
    src = char.copy().load()
    cp = char.load()
    for y in range(Hc):
        for x in range(Wc):
            p = src[x, y]
            if p[3] and p[:3] == C["black"][:3]:
                if x + 1 >= Wc or src[x + 1, y][3] == 0:
                    cp[x, y] = RIM_R
                elif x - 1 < 0 or src[x - 1, y][3] == 0:
                    cp[x, y] = RIM_L
                elif y - 1 < 0 or src[x, y - 1][3] == 0:
                    cp[x, y] = RIM_T
    a = char.getchannel("A").point(lambda v: 255 if v else 0)

    def dilate(m):
        out = m.copy()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            out = ImageChops.lighter(out, ImageChops.offset(m, dx, dy))
        return out

    dil = dilate(a)
    out = Image.new("RGBA", (Wc, Hc), (0, 0, 0, 0))
    if glow:
        g2 = dilate(dilate(dil))
        out.paste(Image.new("RGBA", (Wc, Hc), (255, 42, 109, 120)), (0, 0), g2)
        out.paste(Image.new("RGBA", (Wc, Hc), (255, 140, 190, 200)), (0, 0), dilate(dil))
    out.paste(Image.new("RGBA", (Wc, Hc), C["rim"]), (0, 0), ImageChops.offset(dil, -1, 0))
    out.paste(Image.new("RGBA", (Wc, Hc), C["out"]), (0, 0), dil)
    out.alpha_composite(char)
    return out


def body_frame(dy, arms, legs, sway, seed, lift=1.0, spark=0.08, glow=False):
    img = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    layer, tips = hair_shattered((CW, CH), sway, lift, seed, spark,
                                 xf=lambda x, y: (x + OFF[0], y + OFF[1] + dy), inv=lambda x, y: (x - OFF[0], y - OFF[1] - dy))
    img.alpha_composite(layer)
    fig = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hands = body(fig, dy, arms, legs)
    head(fig, dy)
    img.alpha_composite(fig, OFF)
    img = finish(img, glow)
    return img, tips, [shift(h) for h in hands]


# ------------------------------------------------------------------ overlays
def eyes(kind):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ey = EYE_Y
    for n, ex in enumerate(EYES):
        inner = 1 if n == 0 else -1  # +1: the inner side is to the right
        eye = lambda **k: target_eye(d, ex, ey, inner=inner, **k)
        if kind == "neutral":
            eye()
        elif kind == "glow":
            eye(ring=C["pink_w"], iris=C["pink"])
        elif kind == "surprised":       # pinpoint pupil
            eye(iris=False)
        elif kind == "sad":             # looking down, outer lid drooping
            eye(look=(0, 1))
            d.polygon([(ex - inner * 4.5, ey - 4.5), (ex + inner * 4.5, ey - 4.5), (ex - inner * 4.5, ey - 0.5)], fill=C["out"])
        elif kind == "angry":           # lid slanting down toward the nose
            eye()
            d.polygon([(ex - inner * 4.5, ey - 4.5), (ex + inner * 4.5, ey - 4.5), (ex + inner * 4.5, ey - 0.5)], fill=C["out"])
        elif kind == "relaxed":         # half-closed
            eye()
            d.rectangle([ex - 4, ey - 5, ex + 4, ey - 1], fill=C["out"])
        elif kind in ("blink", "happy"):  # black almond with a green curve (the closed eye you picked)
            closed_eye(d, ex, ey, inner)
        elif kind == "wink":            # left eye open, right eye closed
            eye() if n == 0 else closed_eye(d, ex, ey, inner)
    return img


# "many eyes" mode: the green rectangle fills up with eyes (drawn instead of the normal eye overlay)
MANY_SMALL = [(25, 23), (32, 23), (39, 23), (25, 33), (32, 33), (39, 33)]  # rows above and below her main eyes


def small_eye(d, ex, ey, closed=False):
    """3-row pixel eye: black slit, blue iris, white glint"""
    d.line([(ex - 2, ey), (ex + 2, ey)], fill=C["out"])
    d.line([(ex - 1, ey - 1), (ex + 1, ey - 1)], fill=C["out"])
    d.line([(ex - 1, ey + 1), (ex + 1, ey + 1)], fill=C["out"])
    if not closed:
        d.point([(ex - 1, ey), (ex + 1, ey)], fill=C["blue"])
        d.point([(ex, ey)], fill=C["white"])


def many_eyes(blink=()):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = MASK_MANY
    d.rectangle([x0, y0, x1, y1], fill=C["green"])
    d.line([(x0, y1), (x1, y1)], fill=C["green_d"])
    closed_all = len(blink) >= len(MANY_SMALL) + 2
    for n, ex in enumerate(EYES):           # her two main eyes, a size smaller to make room
        if closed_all:
            d.line([(ex - 3, EYE_Y), (ex + 3, EYE_Y)], fill=C["out"])
        else:
            target_eye(d, ex, EYE_Y, r=3, ticks=False, inner=1 if n == 0 else -1)
    for i, (ex, ey) in enumerate(MANY_SMALL):
        small_eye(d, ex, ey, closed=i in blink)
    return img


def mouth(kind):
    """solid white mouth shapes (no inside, no tongue), like her reference art"""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    my = MOUTH_Y
    white = C["white"]
    zig = lambda pts: d.line(pts, fill=white)
    if kind == "neutral":       # thin white zigzag line (reference 1)
        zig([(28, my + 1), (30, my - 1), (31, my), (33, my - 1), (34, my + 1), (36, my - 1)])
    elif kind == "relaxed":     # shorter, calmer zigzag
        zig([(29, my), (30, my - 1), (32, my), (33, my - 1), (35, my)])
    elif kind == "sad":         # zigzag with drooping ends
        zig([(28, my + 1), (30, my - 1), (32, my), (34, my - 1), (36, my + 1)])
    elif kind == "happy":       # wide white triangle with a stepped notch on top (reference 2)
        poly(d, [(27.5, my - 1.5), (32.5, my - 1.5), (33.5, my - 0.5), (34, my - 1.5), (36.5, my - 1.5),
                 (32.5, my + 2.5), (31.5, my + 2.5)], white)
    elif kind == "angry":       # leaning jagged white shard (reference 3)
        poly(d, [(28.5, my - 1), (30.5, my), (31, my - 1.5), (35.5, my - 0.5), (33.5, my + 2.5), (29.5, my + 1.5)], white)
    elif kind == "surprised":   # small narrow shard
        poly(d, [(31, my - 1.5), (33.5, my - 1), (32.5, my + 2), (31.5, my + 2)], white)
    elif kind.startswith("talk"):  # notched triangle, wider and deeper as she talks louder
        h = int(kind[-1])
        w = 2.5 + h * 0.9
        top = my - 1.5
        notch = [(32 + w * 0.2, top), (32 + w * 0.4, top + 1), (32 + w * 0.55, top)] if h >= 2 else []
        poly(d, [(32 - w, top), *notch, (32 + w, top), (32.5, my + h - 0.5), (31.5, my + h - 0.5)], white)
    return img


# ------------------------------------------------------------------ build
def bbox(img):
    b = img.getchannel("A").getbbox() or (0, 0, W, H)
    return list(b)


def main():
    os.makedirs(OUT, exist_ok=True)
    frames = {}
    cells = []
    specs = [
        ("idle0", dict(dy=0, arms=ARMS["rest"], legs="float0", sway=0.0, seed=1)),
        ("idle1", dict(dy=1, arms=arms_rest(0.6), legs="float1", sway=1.6, seed=2)),
        # the app plays walk0-3 while she moves; she glides instead of walking
        ("walk0", dict(dy=0, arms=arms_glide(0), legs="glide0", sway=0.6, seed=3)),
        ("walk1", dict(dy=0, arms=arms_glide(1), legs="glide1", sway=1.2, seed=4)),
        ("walk2", dict(dy=1, arms=arms_glide(0), legs="glide0", sway=1.8, seed=5)),
        ("walk3", dict(dy=1, arms=arms_glide(-1), legs="glide1", sway=2.4, seed=6)),
        ("charge", dict(dy=0, arms=ARMS["power"], legs="float0", sway=0.9, seed=7, lift=1.07, spark=0.16, glow=True)),
        ("held", dict(dy=0, arms=ARMS["up"], legs="dangle", sway=2.2, seed=8)),
        ("cast", dict(dy=0, arms=ARMS["point"], legs="float0", sway=0.3, seed=9, spark=0.12)),
    ]
    for name, sp in specs:
        img, tips, hands = body_frame(sp["dy"], sp["arms"], sp["legs"], sp["sway"], sp["seed"],
                                      sp.get("lift", 1.0), sp.get("spark", 0.08), sp.get("glow", False))
        dy = sp["dy"]
        frames[name] = {
            "dy": dy,
            "core": shift((32, 48 + dy)),
            "claws": hands[0],
            "orb": hands[1],
            "head": shift((32, 30 + dy)),
            "bbox": bbox(img),
            "hands": hands,
            "tips": tips,
            "toes": [shift(LEGS[sp["legs"]][0][3]), shift(LEGS[sp["legs"]][1][3])],
        }
        cells.append((name, img))
    for k in ["neutral", "blink", "happy", "surprised", "angry", "sad", "relaxed", "glow", "wink"]:
        cells.append(("eyes_" + k, to_cell(eyes(k))))
    for k in ["neutral", "happy", "angry", "surprised", "sad", "relaxed", "talk1", "talk2", "talk3"]:
        cells.append(("mouth_" + k, to_cell(mouth(k))))
    cells.append(("eyes_many0", to_cell(many_eyes())))
    cells.append(("eyes_many1", to_cell(many_eyes(blink=(0, 2, 4)))))
    cells.append(("eyes_many2", to_cell(many_eyes(blink=tuple(range(len(MANY_SMALL) + 2))))))  # all shut: opening / closing

    cols = 8
    rows = math.ceil(len(cells) / cols)
    sheet = Image.new("RGBA", (CW * cols, CH * rows), (0, 0, 0, 0))
    rects = {}
    for i, (name, img) in enumerate(cells):
        x, y = (i % cols) * CW, (i // cols) * CH
        sheet.alpha_composite(img, (x, y))
        rects[name] = [x, y]
    sheet.save(os.path.join(OUT, "sheet.png"))
    meta = {"size": [CW, CH], "anchor": shift(ANCHOR), "offset": list(OFF),
            "eyes": {"left": shift((EYES[0], EYE_Y)), "right": shift((EYES[1], EYE_Y))},
            "eyeOrigin": [0, 0], "rects": rects, "frames": frames}
    # her "chill" pose lives in its own strip (it is wider): tools/capri_lounge.py
    import capri_lounge
    meta["lounge"] = capri_lounge.build(os.path.join(OUT, "lounge.png"))
    # D, her companion (Call D): tools/capri_duo.py
    import capri_duo
    meta["duo"] = capri_duo.build(os.path.join(ROOT, "assets", "d", "d.png"))
    with open(os.path.join(OUT, "sheet.json"), "w") as f:
        json.dump(meta, f, indent=1)
    with open(os.path.join(OUT, "sheet.js"), "w") as f:
        f.write("// generated by tools/capri_sprite.py — do not edit\nexport default " + json.dumps(meta) + ";\n")

    # app icons: a crop of her face
    face = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    base = dict(cells)["idle0"]
    face.alpha_composite(base)
    face.alpha_composite(dict(cells)["eyes_neutral"])
    face.alpha_composite(dict(cells)["mouth_neutral"])
    crop = face.crop((8 + OFF[0], 6 + OFF[1], 56 + OFF[0], 54 + OFF[1]))
    icon_dir = os.path.join(ROOT, "assets")
    crop.resize((256, 256), Image.NEAREST).save(os.path.join(icon_dir, "icon256.png"))
    crop.resize((32, 32), Image.NEAREST).save(os.path.join(icon_dir, "icon32.png"))
    print("wrote", OUT, sheet.size, len(cells), "cells")


if __name__ == "__main__":
    main()
