// Pixel-style effects layer: lightning, particles, rings, afterimages, emotes, flashes.
// All coordinates are CSS pixels; `S` is the size of one sprite pixel in CSS pixels.

const rand = (a, b) => a + Math.random() * (b - a);

// Capri's electricity is hot pink with white-pink cores
// bolt palettes: glow → bright → core
const HUES = {
  pink: { bloom: 'rgba(255,42,109,0.9)', glow: 'rgba(255,42,109,0.45)', mid: '#FF5C9A', core: '#FFF4F9', spark: '#FFB3D1' },
  violet: { bloom: 'rgba(150,64,255,0.9)', glow: 'rgba(150,64,255,0.45)', mid: '#B48CFF', core: '#F6F0FF', spark: '#D9C2FF' },
  green: { bloom: 'rgba(46,255,140,0.8)', glow: 'rgba(46,255,140,0.4)', mid: '#6BFFB0', core: '#F2FFF8', spark: '#B9FFD9' },
  red: { bloom: 'rgba(255,16,48,0.95)', glow: 'rgba(255,16,48,0.5)', mid: '#FF1A3C', core: '#FFE8EC', spark: '#FF6B7F' },
};

export const COLORS = {
  core: '#FFF2F8',
  bolt: '#FFB3D1',
  glow: 'rgba(255, 42, 109, 0.42)',
  glow2: 'rgba(200, 16, 78, 0.24)',
  purple: '#FF2A6D', // main pink (key name kept from the original effects code)
  deep: '#B0124E',
  cyan: '#62E6FF',
};

// 5x5-ish pixel icons shown above the head
const ICONS = {
  '!': ['..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '...#.', '.....', '..#..'],
  anger: ['#.#.#', '.#.#.', '#...#', '.#.#.', '#.#.#'],
  dots: ['.....', '.....', '#.#.#', '.....', '.....'],
  note: ['..##.', '..#.#', '..#..', '###..', '##...'],
  heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  zz: ['####.', '..#..', '.#...', '####.', '.....'],
};

export class FX {
  constructor() {
    this.particles = [];
    this.bolts = [];
    this.rings = [];
    this.ghosts = [];
    this.flares = [];
    this.lines = [];
    this.bloom = null;
    this.emote = null;
    this.flash = 0;
    this.flashColor = '255,255,255';
    this.S = 6;
  }

  // ---------------------------------------------------------------- spawners
  // jagged lightning between two points; persists for `life` seconds, flickers, re-jags
  // hue: 'pink' (default) | 'violet' | 'green'; bulge > 0 bends it into an arc; impact adds a spark spray at the end
  bolt(x0, y0, x1, y1, { life = 0.25, jag = 1, width = 1, branches = 1, rejitter = true, hue = 'pink', bulge = 0, impact = null } = {}) {
    const b = { x0, y0, x1, y1, life, max: life, jag, width, branches, rejitter, hue, bulge, pts: null, prev: null, t: 0, age: 0,
      side: Math.random() < 0.5 ? 1 : -1 };
    b.pts = this._jag(b);
    this.bolts.push(b);
    const big = Math.hypot(x1 - x0, y1 - y0) > this.S * 14;
    if (impact ?? big) {
      this.burst(x1, y1, big ? 6 : 3, { speed: 160, life: 0.3, gravity: 200, color: HUES[hue].spark });
      this.flares.push({ x: x1, y: y1, life: Math.min(0.18, life), max: Math.min(0.18, life), hue });
    }
    return b;
  }

  // a curved arc (e.g. hand to hand)
  arc(x0, y0, x1, y1, opts = {}) {
    return this.bolt(x0, y0, x1, y1, { life: 0.12, branches: 0, rejitter: true, bulge: 0.35, impact: false, ...opts });
  }

  _jag(b) {
    const S = this.S;
    const dx = b.x1 - b.x0, dy = b.y1 - b.y0;
    const len = Math.hypot(dx, dy);
    const segs = Math.max(3, Math.round(len / (S * 3.5)));
    const nx = -dy / (len || 1), ny = dx / (len || 1);
    const pts = [[b.x0, b.y0]];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const env = Math.sin(Math.PI * t);
      const off = rand(-1, 1) * S * 3 * b.jag * env + rand(-1, 1) * S + b.side * b.bulge * len * env;
      pts.push([b.x0 + dx * t + nx * off, b.y0 + dy * t + ny * off]);
    }
    pts.push([b.x1, b.y1]);
    const branches = [];
    const fork = (from, ang, bl, depth) => {
      const p2 = [from];
      const n = 3 + (depth === 0 ? 1 : 0);
      for (let j = 1; j <= n; j++) {
        const [px, py] = p2[p2.length - 1];
        p2.push([px + Math.cos(ang) * bl / n + rand(-1, 1) * S * 1.5, py + Math.sin(ang) * bl / n + rand(-1, 1) * S * 1.5]);
      }
      branches.push(p2);
      if (depth === 0 && Math.random() < 0.6) fork(p2[2], ang + rand(-0.9, 0.9), bl * 0.5, 1); // forks split again
    };
    for (let k = 0; k < b.branches; k++) {
      if (pts.length < 4) break;
      const i = 1 + Math.floor(Math.random() * (pts.length - 2));
      fork(pts[i], Math.atan2(dy, dx) + rand(-1.1, 1.1), len * rand(0.15, 0.35), 0);
    }
    return { main: pts, branches };
  }

  burst(x, y, n = 16, { speed = 220, color = null, life = 0.6, gravity = 300, up = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(0.3, 1) * speed;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up, life: rand(life * 0.5, life), max: life,
        size: Math.random() < 0.3 ? 2 : 1, color: color || (Math.random() < 0.5 ? COLORS.bolt : COLORS.purple), gravity, streak: s > 120,
      });
    }
  }

  // explode an image (pixel canvas) into particles: used for teleport-out
  shatter(pixels, { up = 260, spread = 160, life = 0.8 } = {}) {
    for (const p of pixels) {
      this.particles.push({
        x: p.x, y: p.y, vx: rand(-spread, spread), vy: -rand(up * 0.4, up), life: rand(life * 0.5, life), max: life,
        size: 1, color: p.c, gravity: -60, drag: 0.96,
      });
    }
  }

  // her pixels collapsing into one point: used when she turns into the electric orb
  implode(pixels, x, y, life = 0.2) {
    for (const p of pixels) {
      this.particles.push({ x: p.x, y: p.y, vx: (x - p.x) / life, vy: (y - p.y) / life, life, max: life, size: 1, color: p.c, gravity: 0 });
    }
  }

  // particles flying INTO target points: used for teleport-in
  converge(pixels, { from = 140, life = 0.35 } = {}) {
    for (const p of pixels) {
      const a = rand(0, Math.PI * 2), r = rand(from * 0.4, from);
      const sx = p.x + Math.cos(a) * r, sy = p.y + Math.sin(a) * r;
      this.particles.push({
        x: sx, y: sy, vx: (p.x - sx) / life, vy: (p.y - sy) / life, life, max: life, size: 1, color: p.c, gravity: 0,
      });
    }
  }

  // one tiny spark that pops off a point and fades fast
  spark(x, y) {
    const a = rand(0, Math.PI * 2), s = rand(20, 90);
    this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.08, 0.22), max: 0.22, size: 1,
      color: Math.random() < 0.5 ? COLORS.core : COLORS.purple, gravity: 0, streak: true });
  }

  // speed streak for the red moving form: kind 'white' | 'dark' | 'red' (jagged)
  speedLine(x, y, len, dir, { kind = 'white', life = 0.2, thick = 1, drift = 0 } = {}) {
    this.lines.push({ x, y, len, dir, kind, life, max: life, thick, drift });
  }

  rise(x0, x1, y, n = 6) {
    for (let i = 0; i < n; i++) {
      this.particles.push({ x: rand(x0, x1), y, vx: rand(-10, 10), vy: -rand(60, 160), life: rand(0.4, 0.9), max: 0.9, size: 1,
        color: Math.random() < 0.6 ? COLORS.purple : COLORS.bolt, gravity: -40 });
    }
  }

  ring(x, y, { r0 = 4, r1 = 90, life = 0.45, color = COLORS.bolt, thick = 1 } = {}) {
    this.rings.push({ x, y, r0, r1, life, max: life, color, thick });
  }

  ghost(canvas, x, y, w, h, flip, { life = 0.35, tint = 'rgba(255,42,109,0.6)' } = {}) {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    g.drawImage(canvas, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = tint;
    g.fillRect(0, 0, c.width, c.height);
    this.ghosts.push({ c, x, y, w, h, flip, life, max: life });
  }

  showEmote(kind, seconds = 1.6) {
    if (!ICONS[kind]) return;
    this.emote = { kind, life: seconds, max: seconds };
  }

  doFlash(strength = 0.5, color = '255,214,230') {
    this.flash = Math.max(this.flash, strength);
    this.flashColor = color;
  }

  // ---------------------------------------------------------------- update + draw
  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += (p.gravity || 0) * dt;
      if (p.drag) { p.vx *= p.drag; p.vy *= p.drag; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    // her bigger shattered-glass hair is ~5000 pixels: keep room for a whole teleport plus effects
    if (this.particles.length > 12000) this.particles.splice(0, this.particles.length - 12000);
    for (const b of this.bolts) {
      b.life -= dt; b.t += dt; b.age += dt;
      if (b.rejitter && b.t > 0.05) { b.t = 0; b.prev = b.pts; b.pts = this._jag(b); }
    }
    for (const l of this.lines) { l.life -= dt; l.x += l.drift * dt; }
    this.lines = this.lines.filter((l) => l.life > 0);
    for (const f of this.flares) f.life -= dt;
    this.flares = this.flares.filter((f) => f.life > 0);
    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const g of this.ghosts) g.life -= dt;
    this.ghosts = this.ghosts.filter((g) => g.life > 0);
    if (this.emote) { this.emote.life -= dt; if (this.emote.life <= 0) this.emote = null; }
    this.flash = Math.max(0, this.flash - dt * 3.2);
  }

  drawBehind(ctx) {
    const S = this.S;
    for (const l of this.lines) {
      const t = l.life / l.max;
      const len = l.len * (0.4 + 0.6 * t);
      // streaks extend backwards (opposite to dir) from x
      const x0 = l.dir > 0 ? l.x - len : l.x, x1 = l.dir > 0 ? l.x : l.x + len;
      if (l.kind === 'red') {
        ctx.globalAlpha = t;
        ctx.fillStyle = '#FF1A3C';
        const pts = [];
        for (let x = x0, i = 0; x <= x1; x += S * 3, i++) pts.push([x, l.y + (i % 2 ? -S : S) * (1 + (i % 3))]);
        if (pts.length > 1) pixelPolyline(ctx, pts, S, S * l.thick);
      } else {
        ctx.globalAlpha = t * (l.kind === 'white' ? 0.85 : 0.7);
        ctx.fillStyle = l.kind === 'white' ? '#FFFFFF' : '#1A1620';
        ctx.fillRect(snap(x0, S), snap(l.y, S), Math.max(S, snap(x1 - x0, S)), S * l.thick);
        if (l.kind === 'white') { ctx.globalAlpha = t * 0.35; ctx.fillStyle = '#FF1A3C'; ctx.fillRect(snap(x0, S), snap(l.y, S) + S * l.thick, Math.max(S, snap(x1 - x0, S)), S); }
      }
    }
    ctx.globalAlpha = 1;
    for (const g of this.ghosts) {
      ctx.save();
      ctx.globalAlpha = (g.life / g.max) * 0.55;
      if (g.flip) { ctx.translate(g.x + g.w, g.y); ctx.scale(-1, 1); ctx.drawImage(g.c, 0, 0, g.w, g.h); }
      else ctx.drawImage(g.c, g.x, g.y, g.w, g.h);
      ctx.restore();
    }
  }

  drawFront(ctx, W, H, head) {
    const S = this.S;
    // bolts: soft bloom (blurred, low-res, added on top), then crisp pixel layers
    if (this.bolts.length || this.flares.length) this._drawBloom(ctx, W, H);
    for (const b of this.bolts) {
      const hue = HUES[b.hue] || HUES.pink;
      let a = Math.min(1, b.life / Math.min(0.12, b.max));
      if (b.age < 0.09) a *= [1, 0.25, 1, 0.5, 1][Math.floor(b.age * 55) % 5]; // lightning strobe
      const paths = [b.pts.main, ...b.pts.branches];
      const sizeOf = (path, k) => Math.max(S * 0.75, k * S * (path === b.pts.main ? 1 : 0.7));
      // afterimage of the previous shape
      if (b.prev) {
        ctx.globalAlpha = a * 0.3;
        ctx.fillStyle = hue.mid;
        pixelPolyline(ctx, b.prev.main, S, S);
      }
      // chromatic fringe, like her violet rim
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = 'rgba(90,240,255,0.8)';
      for (const path of paths) pixelPolyline(ctx, path.map(([x, y]) => [x - S, y]), S, S);
      ctx.fillStyle = 'rgba(150,64,255,0.9)';
      for (const path of paths) pixelPolyline(ctx, path.map(([x, y]) => [x + S, y + S]), S, S);
      // glow, bright body, white-hot core
      ctx.globalAlpha = a;
      ctx.fillStyle = hue.glow;
      for (const path of paths) pixelPolyline(ctx, path, S, sizeOf(path, 3));
      ctx.fillStyle = hue.mid;
      for (const path of paths) pixelPolyline(ctx, path, S, sizeOf(path, 1.6 * b.width));
      ctx.fillStyle = b.age < 0.05 ? '#FFFFFF' : hue.core;
      pixelPolyline(ctx, b.pts.main, S, Math.max(S * 0.75, S * b.width));
    }
    // impact flares: a small bright cross where a bolt lands
    for (const f of this.flares) {
      const t = f.life / f.max;
      const hue = HUES[f.hue] || HUES.pink;
      const r = Math.round(1 + t * 2);
      ctx.globalAlpha = t;
      ctx.fillStyle = hue.mid;
      ctx.fillRect(snap(f.x, S) - r * S, snap(f.y, S), (r * 2 + 1) * S, S);
      ctx.fillRect(snap(f.x, S), snap(f.y, S) - r * S, S, (r * 2 + 1) * S);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(snap(f.x, S), snap(f.y, S), S, S);
    }
    ctx.globalAlpha = 1;

    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * easeOut(t);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = r.color;
      const n = Math.max(12, Math.floor((2 * Math.PI * rad) / S));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = r.x + Math.cos(a) * rad, y = r.y + Math.sin(a) * rad * 0.45;
        ctx.fillRect(snap(x, S), snap(y, S), S * r.thick, S * r.thick);
      }
    }
    ctx.globalAlpha = 1;

    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / (p.max * 0.5)));
      ctx.fillStyle = p.color;
      if (p.streak) pixelPolyline(ctx, [[p.x, p.y], [p.x - p.vx * 0.03, p.y - p.vy * 0.03]], S, S * p.size);
      else ctx.fillRect(Math.round(p.x), Math.round(p.y), S * p.size, S * p.size);
    }
    ctx.globalAlpha = 1;

    if (this.emote && head) {
      const icon = ICONS[this.emote.kind];
      const t = 1 - this.emote.life / this.emote.max;
      const pop = t < 0.15 ? t / 0.15 : 1;
      const fade = Math.min(1, this.emote.life / 0.25);
      const s = S * (0.8 + 0.4 * pop);
      const x0 = head.x + S * 13;
      const y0 = head.y - icon.length * s - S * 14 - Math.sin(t * Math.PI) * S * 2;
      ctx.globalAlpha = fade;
      // backing plate
      ctx.fillStyle = 'rgba(12,7,20,0.85)';
      ctx.fillRect(x0 - s, y0 - s, (icon[0].length + 2) * s, (icon.length + 2) * s);
      ctx.fillStyle = this.emote.kind === 'anger' ? '#FF5C8D' : this.emote.kind === 'heart' ? '#FF7AB6' : COLORS.bolt;
      icon.forEach((row, iy) => [...row].forEach((ch, ix) => { if (ch === '#') ctx.fillRect(x0 + ix * s, y0 + iy * s, s, s); }));
      ctx.globalAlpha = 1;
    }

    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashColor},${this.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // low-res copy of every bolt, blurred and added on top = cheap real glow
  _drawBloom(ctx, W, H) {
    const k = 4;
    const bw = Math.max(1, Math.ceil(W / k)), bh = Math.max(1, Math.ceil(H / k));
    if (!this.bloom) this.bloom = document.createElement('canvas');
    const c = this.bloom;
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bw, bh);
    g.filter = 'blur(3px)';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const b of this.bolts) {
      const hue = HUES[b.hue] || HUES.pink;
      const a = Math.min(1, b.life / Math.min(0.12, b.max));
      g.globalAlpha = a;
      g.strokeStyle = hue.bloom;
      for (const path of [b.pts.main, ...b.pts.branches]) {
        g.lineWidth = (path === b.pts.main ? 2.6 : 1.6) * b.width * (this.S / 6) + 1;
        g.beginPath();
        path.forEach(([x, y], i) => (i ? g.lineTo(x / k, y / k) : g.moveTo(x / k, y / k)));
        g.stroke();
      }
    }
    for (const f of this.flares) {
      g.globalAlpha = f.life / f.max;
      g.fillStyle = (HUES[f.hue] || HUES.pink).bloom;
      g.beginPath(); g.arc(f.x / k, f.y / k, 3 * (this.S / 6) + 1, 0, Math.PI * 2); g.fill();
    }
    g.filter = 'none';
    g.globalAlpha = 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(c, 0, 0, W, H);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  get busy() {
    return this.particles.length || this.bolts.length || this.flares.length || this.lines.length || this.rings.length || this.ghosts.length || this.emote || this.flash > 0.01;
  }
}

function snap(v, S) { return Math.round(v / S) * S; }
function easeOut(t) { return 1 - (1 - t) * (1 - t); }

// draw a polyline as stepped square "pixels" so lightning looks pixel-art
function pixelPolyline(ctx, pts, S, size) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / S));
    for (let k = 0; k <= steps; k++) {
      const x = x0 + ((x1 - x0) * k) / steps, y = y0 + ((y1 - y0) * k) / steps;
      ctx.fillRect(snap(x, S) - (size - S) / 2, snap(y, S) - (size - S) / 2, size, size);
    }
  }
}
