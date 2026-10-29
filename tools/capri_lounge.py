"""Capri's "chill" pose: lounging back in mid-air with an arm behind her head and a knee up.

Drawn with the same shapes as the main sprite (capri_sprite.py), but every shape goes through a
rotation before it is drawn, so the pixels stay crisp at an angle. Eyes and mouth are baked in.
Called by capri_sprite.py; writes assets/capri/lounge.png and returns its metadata.
"""
import math, random
from PIL import Image, ImageDraw
import capri_sprite as cs

C = cs.C
LW, LH = 104, 104                # lounge cell (wider than the standing one)
NECK_L = (32, 42)               # neck in standing coordinates
NECK = (54, 64)                 # where the neck sits in the lounge cell
HEAD_TILT, BODY_TILT = 22, 65   # degrees: head tipped back a little, body reclined a lot
ANCHOR = (48, 86)               # lines up with the standing sprite's feet anchor (same visual center)
N_LOOP = 8                      # closed-eye frames in the loop


class TD:
    """ImageDraw stand-in that rotates shapes around `piv` by `a` radians, then shifts them by `off`."""
    def __init__(self, img, a, piv, off=(0, 0)):
        self.d, self.a, self.piv, self.off = ImageDraw.Draw(img), a, piv, off

    def t(self, p):
        dx, dy = p[0] - self.piv[0], p[1] - self.piv[1]
        c, s = math.cos(self.a), math.sin(self.a)
        return (self.piv[0] + dx * c - dy * s + self.off[0], self.piv[1] + dx * s + dy * c + self.off[1])

    def inv(self, p):
        x, y = p[0] - self.off[0] - self.piv[0], p[1] - self.off[1] - self.piv[1]
        c, s = math.cos(-self.a), math.sin(-self.a)
        return (self.piv[0] + x * c - y * s, self.piv[1] + x * s + y * c)

    def polygon(self, pts, fill=None):
        self.d.polygon([self.t(p) for p in pts], fill=fill)

    def line(self, pts, fill=None, width=1, joint=None):
        self.d.line([self.t(p) for p in pts], fill=fill, width=width, joint=joint)

    def point(self, pts, fill=None):
        self.d.point([tuple(round(v) for v in self.t(p)) for p in pts], fill=fill)

    def rectangle(self, box, fill=None):
        x0, y0, x1, y1 = box
        self.d.polygon([self.t(p) for p in ((x0, y0), (x1 + 0.5, y0), (x1 + 0.5, y1 + 0.5), (x0, y1 + 0.5))], fill=fill)

    def ellipse(self, box, fill=None):
        x0, y0, x1, y1 = box
        cx, cy = self.t(((x0 + x1) / 2, (y0 + y1) / 2))
        rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
        self.d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill)


def hair(img, T, sway, seed, spark=0.08):
    """her shattered-glass hair (capri_sprite.hair_shattered), rotated with her head"""
    layer, _ = cs.hair_shattered(img.size, sway, 1.0, seed, spark,
                                 xf=lambda x, y: T.t((x, y)), inv=lambda x, y: T.inv((x, y)))
    img.alpha_composite(layer)


def head(T):
    T.polygon([(31, 39), (33, 39), (33, 44), (31, 44)], C["black"])
    for t in [[(26, 22), (24, 13), (30, 20)], [(30, 21), (32, 9), (34, 21)], [(34, 20), (40, 13), (38, 22)],
              [(23, 27), (17, 23), (23, 31)], [(41, 27), (47, 23), (41, 31)]]:
        T.polygon(t, C["black"])
    T.polygon([(23, 21), (41, 21), (42, 30), (38.5, 37), (32, 42), (25.5, 37), (22, 30)], C["black"])
    x0, y0, x1, y1 = cs.MASK
    T.rectangle([x0, y0, x1, y1], fill=C["green"])
    T.line([(x0, y1), (x1, y1)], fill=C["green_d"])


def face(T, peek):
    for n, ex in enumerate(cs.EYES):
        inner = 1 if n == 0 else -1
        if peek and n == 0:  # one sleepy eye open, glancing at you
            cs.target_eye(T, ex, cs.EYE_Y, inner=inner, look=(1, 0))
            T.rectangle([ex - 4, cs.EYE_Y - 5, ex + 4, cs.EYE_Y - 2], fill=C["out"])
        else:
            cs.closed_eye(T, ex, cs.EYE_Y, inner)
    my = cs.MOUTH_Y
    if peek:  # little smirk
        T.polygon([(28.5, my - 1.5), (35.5, my - 1.5), (32.5, my + 1.5), (31.5, my + 1.5)], fill=C["white"])
    else:     # calm zigzag
        T.line([(29, my), (30, my - 1), (32, my), (33, my - 1), (35, my)], fill=C["white"])


def finish(img):
    return cs.finish(img)


TORSO = [([(25, 43), (39, 43), (37.5, 50), (35, 55), (37, 60), (27, 60), (29, 55), (26.5, 50)], "black"),
         ([(32, 44), (36, 47.5), (32, 53), (28, 47.5)], "red"),
         ([(32, 46), (33.5, 47.5), (32, 50), (30.5, 47.5)], "pink_l"),
         ([(25, 43), (29, 43), (27, 46)], "pink"), ([(35, 43), (39, 43), (37, 46)], "pink"),
         ([(28, 56), (32, 60), (27.5, 60)], "green"), ([(36, 56), (36.5, 60), (33, 60)], "pink")]


def lounge(t=0.0, peek=False, seed=21):
    """t: 0..1 through the loop (hair sway, foot swing, breathing hand)"""
    sw = math.sin(2 * math.pi * t)
    img = Image.new("RGBA", (LW, LH), (0, 0, 0, 0))
    off = (NECK[0] - NECK_L[0], NECK[1] - NECK_L[1])
    Th = TD(img, -math.radians(HEAD_TILT), NECK_L, off)
    Tb = TD(img, -math.radians(BODY_TILT), NECK_L, off)
    d = ImageDraw.Draw(img)
    sh_r, sh_l = Tb.t((37, 45)), Tb.t((27, 45))
    hip_l, hip_r = Tb.t(cs.HIP_L), Tb.t(cs.HIP_R)
    # pillow arm: forearm tucked behind her head (under the hair), upper arm drawn over it
    elbow = (sh_r[0] + 15, sh_r[1] - 9 + 0.4 * sw)
    d.line([elbow, Th.t((40, 22))], fill=C["black"], width=2)
    hair(img, Th, sway=1.0 + 0.5 * sw, seed=seed)
    d = ImageDraw.Draw(img)
    # legs: one stretched out underneath, the other knee up with the shin hanging (it swings)
    cs.leg(d, hip_l, (hip_l[0] + 10, hip_l[1] + 5), (hip_l[0] + 18 + 0.3 * sw, hip_l[1] + 10),
           (hip_l[0] + 22 + 0.3 * sw, hip_l[1] + 11), C["pink"])
    knee = (hip_r[0] + 10, hip_r[1] - 7)
    cs.leg(d, hip_r, knee, (knee[0] + 2 + sw, knee[1] + 9), (knee[0] + 3.5 + sw, knee[1] + 13), C["green"])
    for pts, col in TORSO:
        Tb.polygon(pts, C[col])
    d.line([sh_r, elbow], fill=C["black"], width=2)
    d.point([(round((sh_r[0] + elbow[0]) / 2), round((sh_r[1] + elbow[1]) / 2))], fill=C["pink"])
    # resting arm: hand on her tummy
    belly = Tb.t((31, 52))
    el = (sh_l[0] - 3, sh_l[1] + 6)
    d.line([sh_l, el, (belly[0], belly[1] + 0.4 * sw)], fill=C["black"], width=2, joint="curve")
    d.ellipse([belly[0] - 1, belly[1] - 1, belly[0] + 1, belly[1] + 1], fill=C["black"])
    head(Th)
    face(Th, peek)
    meta = {
        "head": [round(v, 1) for v in Th.t((32, 30))],
        "core": [round(v, 1) for v in Tb.t((32, 50))],
        "toes": [[round(hip_l[0] + 22, 1), round(hip_l[1] + 11, 1)], [round(knee[0] + 3.5, 1), round(knee[1] + 13, 1)]],
    }
    return finish(img), meta


def build(out_path):
    """write the lounge strip; returns the metadata block for sheet.json"""
    frames = [("lounge%d" % i, lounge(i / N_LOOP, seed=21 + i % 4)) for i in range(N_LOOP)]
    frames += [("lounge_peek%d" % i, lounge(i / 2, peek=True, seed=31 + i)) for i in range(2)]
    strip = Image.new("RGBA", (LW * len(frames), LH), (0, 0, 0, 0))
    rects = {}
    for i, (name, (img, _)) in enumerate(frames):
        strip.alpha_composite(img, (i * LW, 0))
        rects[name] = [i * LW, 0]
    strip.save(out_path)
    m = frames[0][1][1]
    return {"file": "capri/lounge.png", "size": [LW, LH], "anchor": list(ANCHOR), "rects": rects,
            "loop": [n for n, _ in frames[:N_LOOP]], "peek": [n for n, _ in frames[N_LOOP:]],
            "head": m["head"], "core": m["core"], "toes": m["toes"]}
