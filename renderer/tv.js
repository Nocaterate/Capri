// TV mode: Capri lives inside a little terminal-style TV on the desktop (pink chat log, green live feed, pink
// command line, in her colours). She can't roam while she's in it, but she still talks, listens, reacts and
// idles inside the screen: floating, blinking (the lid slides), glancing, and now and then chilling, getting
// sleepy, playing peekaboo, leaning into the camera, or flipping channels. Only her top half shows.
// Everything she says goes into the log instead of a bubble (questions with buttons still pop a bubble above it).
// D waits outside (hidden) until TV mode ends. Drag the TV by its green bar; ✕ or the menu turns it off.

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => k * k * (3 - 2 * k);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function initTv(env) {
  const { api, st, fx, sfx, META } = env;
  const [CW, CH] = META.size;
  const TOP = 6;                                   // first sprite row in the feed (above: empty)
  const LG = META.lounge || null;
  const el = {
    tv: document.getElementById('tv'), log: document.getElementById('tv-log'), tag: document.getElementById('tv-tag'),
    bar: document.getElementById('tv-bar'), screen: document.getElementById('tv-screen'), cv: document.getElementById('tv-cv'),
    form: document.getElementById('tv-cmd'), input: document.getElementById('tv-input'), off: document.getElementById('tv-off'),
  };
  const g = el.cv.getContext('2d');
  const comp = document.createElement('canvas'); comp.width = 128; comp.height = 128;
  const cg = comp.getContext('2d');

  let on = false, busy = false;
  let FW = 0, FH = 0, U = 1, SC = 3;               // feed size in device px, device px per CSS px, sprite scale (device px)
  let idle = { name: 'base', t: 0, next: rand(8, 14) };
  let lid = { t: -1, next: rand(2, 5) };           // her eyelid blink (slides down and up)
  let glance = { t: -1, dir: 1, next: rand(4, 9) };
  let flyers = [], flyT = 0, flyDur = 0.75;
  let drag = null;

  // ---------------------------------------------------------------- the log (what she and you said)
  const lines = [];                                // { cls, text, shown }
  let typing = null;
  function pushLine(cls, text, cps = 0) {
    lines.push({ cls, text, shown: cps ? 0 : text.length, cps });
    while (lines.length > 14) lines.shift();
    typing = cps ? lines[lines.length - 1] : typing;
    renderLog();
  }
  function renderLog() {
    el.log.innerHTML = '';
    for (const l of lines.slice(-8)) {
      const d = document.createElement('div');
      d.className = l.cls;
      d.textContent = l.text.slice(0, Math.floor(l.shown));
      el.log.appendChild(d);
    }
  }
  let lastHeard = '', thinkLine = null;
  // say() lands here while she's in the TV (anything without buttons)
  function say(text, { heard = '', label = null, listening = false, thinking = false, cps = 45 } = {}) {
    if (heard && heard !== lastHeard) { lastHeard = heard; pushLine('u', `> ${label && /DISCORD/.test(label) ? '' : 'user: '}${heard}`); }
    if (thinkLine) { const i = lines.indexOf(thinkLine); if (i >= 0) lines.splice(i, 1); thinkLine = null; }
    if (listening) { renderLog(); return; }
    if (thinking) { thinkLine = { cls: 'sys', text: '…', shown: 1, cps: 0, think: true }; lines.push(thinkLine); renderLog(); return; }
    if (!text) return;
    const last = lines[lines.length - 1];
    // speak() calls say() twice for one line (once to show, again with the real typing speed): keep one copy
    if (last && last.cls === 'say' && last.text === text) { last.cps = cps || last.cps; if (!cps) last.shown = text.length; typing = last; renderLog(); return; }
    if (label && /DISCORD/.test(label)) pushLine('sys', '[discord]');
    pushLine('who', `${(env.name() || 'CAPRI').toUpperCase()} >`);
    pushLine('say', text, cps || 0);
  }

  // ---------------------------------------------------------------- open / close
  function measure() {
    U = window.devicePixelRatio || 1;
    const r = el.screen.getBoundingClientRect();
    FW = Math.max(10, Math.round(r.width * U)); FH = Math.max(10, Math.round(r.height * U));
    if (el.cv.width !== FW || el.cv.height !== FH) { el.cv.width = FW; el.cv.height = FH; }
    SC = Math.max(2, Math.round(3 * U));
  }
  function place(x, y) {
    const W = window.innerWidth, H = window.innerHeight;
    const w = el.tv.offsetWidth || 400, h = el.tv.offsetHeight || 470;
    const px = clamp(x, 6, W - w - 6), py = clamp(y, 6, H - h - 6);
    el.tv.style.left = px + 'px'; el.tv.style.top = py + 'px';
    // her "position" follows the TV, so bubbles, notes and reminders appear next to it
    st.pos.x = px + w / 2; st.pos.y = H - (py + h);
    return { x: px, y: py };
  }
  function savedPos() {
    const p = env.cfg().tvPos;
    const W = window.innerWidth, H = window.innerHeight;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x * W, y: p.y * H };
    return { x: W - 400 - 28, y: H - 470 - 24 };
  }
  function anchor() {
    if (!on || el.tv.hidden) return null;
    const r = el.tv.getBoundingClientRect();
    return { x: r.left + r.width / 2, top: r.top };
  }

  async function enter({ instant = false } = {}) {
    if (on || busy) return;
    busy = true;
    try {
      await env.ensureVisible();
      if (st.chill) env.endChill();
      env.hideBubble(); env.closeTypebox();
      st.walk = null; st.action = null;
      el.tv.hidden = false;
      measure();
      const p = savedPos();
      // her pixels (and D's) fly into the dark screen before it switches on
      const from = instant ? [] : env.capriPixels();
      const dee = instant ? [] : env.dPixels();
      on = true; st.tv = true;
      env.setTvHidden(true);                        // her desktop sprite and D step aside
      place(p.x, p.y);
      st.lastInteraction = performance.now();
      if (!lines.length) pushLine('sys', 'CAPRI.TV // channel open');
      api.setConfig({ tvMode: true });
      if (instant) { el.tv.classList.add('on-anim'); setTimeout(() => el.tv.classList.remove('on-anim'), 500); return; }
      el.tv.classList.add('dark');
      startFly(from, dee, 1);
      sfx.zap(1.0); sfx.crackle(0.3, 30);
      await sleep(flyDur * 1000 + 60);
      el.tv.classList.remove('dark');
      el.tv.classList.remove('on-anim'); void el.tv.offsetWidth; el.tv.classList.add('on-anim');
      sfx.powerUp(0.5);
      setTimeout(() => el.tv.classList.remove('on-anim'), 500);
      idle = { name: 'base', t: 0, next: rand(6, 10) };
      env.setEmotion('happy', 2.5, false);
      setTimeout(() => { if (on) say(pick(["I'm on TV now~ Talk to me down there!", 'Live from inside the screen!', 'Cozy in here. Type or talk to me~']), { cps: 40 }); }, 500);
    } finally { busy = false; }
  }
  async function exit({ instant = false } = {}) {
    if (!on || busy) return;
    busy = true;
    try {
      el.input.blur();
      const r = el.tv.getBoundingClientRect();
      // she steps out just below the TV (or above it if the TV sits on the taskbar)
      st.pos.x = clamp(r.left + r.width / 2, 60, window.innerWidth - 60);
      st.pos.y = 0;
      if (!instant) {
        el.tv.classList.remove('off-anim'); void el.tv.offsetWidth; el.tv.classList.add('off-anim');
        sfx.glitch();
        await sleep(330);
      }
      on = false; st.tv = false;
      api.setConfig({ tvMode: false });
      if (!instant) {
        const sr = el.screen.getBoundingClientRect();
        env.setTvHidden(false, { hidden: true });   // sprites back, but invisible until the pixels land
        const to = env.capriPixels(), dee = env.dPixels();
        startFly(to, dee, -1, sr);
        el.tv.hidden = true; el.tv.classList.remove('off-anim');
        await sleep(flyDur * 1000 + 40);
        env.setTvHidden(false);
        env.landed();
      } else {
        el.tv.hidden = true; el.tv.classList.remove('off-anim');
        env.setTvHidden(false);
      }
    } finally { busy = false; }
  }
  function toggle() { return on ? exit() : enter(); }

  // pixels flying between her (and D) on the desktop and the TV screen
  function startFly(capPix, dPix, dir, rect) {
    const r = rect || el.screen.getBoundingClientRect();
    const tx = () => r.left + r.width * rand(0.25, 0.75), ty = () => r.top + r.height * rand(0.2, 0.95);
    flyers = capPix.map((p) => ({ x0: p.x, y0: p.y, x1: tx(), y1: ty(), s: p.s, c: p.c, d: rand(0, 0.25), lift: rand(40, 140), dir }))
      .concat(dPix.map((p) => ({ x0: p.x, y0: p.y, x1: tx(), y1: ty(), s: p.s, c: p.c, d: rand(0.05, 0.3), lift: rand(40, 140), dir, dee: true })));
    flyT = 0;
  }
  function drawFront(ctx) {
    if (!flyers.length) return;
    for (const f of flyers) {
      let k = clamp((flyT - f.d) / (flyDur - 0.3), 0, 1);
      if (f.dir < 0) k = 1 - k;                    // leaving the TV: from the screen back to the desktop
      const e = ease(k);
      const x = f.x0 + (f.x1 - f.x0) * e, y = f.y0 + (f.y1 - f.y0) * e - Math.sin(e * Math.PI) * f.lift;
      ctx.fillStyle = k < 0.05 || k > 0.95 ? f.c : (Math.random() < 0.15 ? '#ffe0ec' : f.dee ? '#ff5c9a' : '#ff1a3c');
      const s = f.s * (1 - 0.6 * e);
      ctx.fillRect(x, y, s, s);
    }
  }

  // ---------------------------------------------------------------- dragging the TV by its bar
  el.bar.addEventListener('pointerdown', (e) => {
    if (e.target === el.off) return;
    const r = el.tv.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    el.bar.setPointerCapture(e.pointerId);
    el.tv.classList.add('dragging');
  });
  el.bar.addEventListener('pointermove', (e) => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
  const endDrag = () => {
    if (!drag) return;
    drag = null; el.tv.classList.remove('dragging');
    const r = el.tv.getBoundingClientRect();
    api.setConfig({ tvPos: { x: r.left / window.innerWidth, y: r.top / window.innerHeight } });
  };
  el.bar.addEventListener('pointerup', endDrag);
  el.bar.addEventListener('pointercancel', endDrag);
  el.off.addEventListener('click', (e) => { e.stopPropagation(); exit(); });
  // tapping the screen: she leans in and taps back
  el.screen.addEventListener('click', () => {
    st.lastInteraction = performance.now();
    if (st.mode !== 'idle') return;
    idle = { name: 'closeup', t: 0, dur: 3.2 };
    sfx.blip(true);
    env.setEmotion('surprised', 2, false);
    setTimeout(() => { if (on && st.mode === 'idle') say(pick(["Hey! Don't tap the glass!", 'Boop. I felt that.', 'Hi! Yes, I can see you too.']), { cps: 50 }); }, 900);
  });
  // the command line: type to her like the typebox
  el.input.addEventListener('pointerdown', () => api.focusOverlay && api.focusOverlay());
  el.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.input.blur(); });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.input.value.trim();
    el.input.value = '';
    if (!text) return;
    if (/^(exit|tv off|quit)$/i.test(text)) { exit(); return; }
    env.converse(text);
  });
  function focusInput() { if (!on) return false; api.focusOverlay && api.focusOverlay(); el.input.focus(); return true; }

  // ---------------------------------------------------------------- the feed
  function cell(name) {
    const r = META.rects[name];
    if (!r) return;
    cg.drawImage(env.sheet, r[0], r[1], CW, CH, 0, 0, CW, CH);
  }
  // compose her (body + eyes + mouth, with the lid / tint) into the small canvas, then draw it scaled
  const eyeC = document.createElement('canvas'); eyeC.width = 128; eyeC.height = 128;
  const eg = eyeC.getContext('2d');
  function drawCapri(o) {
    const sc = o.sc || SC;
    cg.globalCompositeOperation = 'source-over';
    cg.clearRect(0, 0, 128, 128);
    cell(o.frame);
    if (!o.red) {
      if (o.many) cell(Math.floor(performance.now() / 100) % 2 ? 'eyes_many0' : 'eyes_many1');
      else if (o.lid >= 6.5) cell('eyes_blink');
      else {
        const r = META.rects['eyes_' + o.eyes] || META.rects.eyes_neutral;
        eg.globalCompositeOperation = 'source-over';
        eg.clearRect(0, 0, 128, 128);
        eg.drawImage(env.sheet, r[0], r[1], CW, CH, 0, 0, CW, CH);
        if (o.lid > 0) {                             // the lid slides down over the eyes (only over the eye pixels)
          const n = Math.round(o.lid);
          eg.globalCompositeOperation = 'source-atop';
          eg.fillStyle = '#0a0410'; eg.fillRect(0, 39, CW, n);
          eg.fillStyle = '#2eff8c'; eg.fillRect(0, 39 + n, CW, n > 1 ? 1 : 0);
        }
        cg.drawImage(eyeC, 0, 0, CW, CH, o.edx || 0, 0, CW, CH);
      }
      cell('mouth_' + o.mouth);
    }
    if (o.red || o.tint) {
      cg.globalCompositeOperation = 'source-atop';
      cg.fillStyle = o.red ? '#ff1a3c' : o.tint; cg.fillRect(0, 0, CW, CH);
      cg.globalCompositeOperation = 'source-over';
    }
    g.drawImage(comp, 0, 0, CW, CH, Math.round(o.x - (CW * sc) / 2), Math.round(o.y), CW * sc, CH * sc);
  }
  function drawLounge(name, x, y, sc) {
    if (!env.lsheet() || !LG) return false;
    const r = LG.rects[name]; if (!r) return false;
    const [lw, lh] = LG.size;
    g.drawImage(env.lsheet(), r[0], r[1], lw, lh, Math.round(x - (lw * sc) / 2), Math.round(y), lw * sc, lh * sc);
    return true;
  }
  function zig(x, y, ang, len, col, w) {
    g.strokeStyle = col; g.lineWidth = w; g.beginPath();
    const nx = Math.cos(ang), ny = Math.sin(ang);
    for (let i = 0; i <= 4; i++) { const a = (i / 4) * len, s = (i % 2 ? 1 : -1) * 4 * U; const X = x + nx * a - ny * s, Y = y + ny * a + nx * s; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.stroke();
  }
  function bolt(x0, y0, x1, y1, col = '#ff70a2', w = 3) {
    g.strokeStyle = col; g.lineWidth = w * U; g.beginPath(); g.moveTo(x0, y0);
    for (let i = 1; i < 7; i++) { const k = i / 7; g.lineTo(x0 + (x1 - x0) * k + rand(-9, 9) * U, y0 + (y1 - y0) * k + rand(-9, 9) * U); }
    g.lineTo(x1, y1); g.stroke();
  }
  function text(t, x, y, col, size) { g.fillStyle = col; g.font = `700 ${Math.round(size * U)}px ${getComputedStyle(el.tv).fontFamily}`; g.fillText(t, x, y); }
  function noise(alpha) {
    const s = Math.max(2, Math.round(3 * U));
    for (let y = 0; y < FH; y += s) for (let x = 0; x < FW; x += s) {
      const v = Math.random(); if (v < 0.5) continue;
      g.fillStyle = v > 0.93 ? `rgba(255,112,162,${alpha})` : `rgba(220,210,230,${alpha * (v - 0.4)})`; g.fillRect(x, y, s, s);
    }
  }
  const glitter = Array.from({ length: 14 }, () => ({ x: Math.random(), sp: 8 + Math.random() * 14, o: Math.random() * 300, g: Math.random() < 0.3 }));

  function pickIdle() {
    const quiet = performance.now() - st.lastInteraction > 60e3;
    const opts = [['chill', 35], ['peek', 20], ['closeup', 12], ['channel', 13]].concat(quiet ? [['sleepy', 25]] : []);
    let total = opts.reduce((a, [, w]) => a + w, 0), r = Math.random() * total;
    for (const [n, w] of opts) { r -= w; if (r <= 0) return n; }
    return 'chill';
  }
  const DUR = { chill: () => rand(7, 11), sleepy: () => 6.2, peek: () => 5, closeup: () => 3.4, channel: () => 2.9 };

  function tick(dt) {
    if (!on) { if (flyers.length) { flyT += dt; if (flyT > flyDur + 0.1) flyers = []; } return; }
    if (flyers.length) { flyT += dt; if (flyT > flyDur + 0.1) flyers = []; }
    el.tv.hidden = !st.visible;
    if (!st.visible) return;
    measure();
    // log typewriter
    if (typing && typing.shown < typing.text.length) { typing.shown = Math.min(typing.text.length, typing.shown + typing.cps * dt); renderLog(); }
    if (thinkLine) { thinkLine.text = '.'.repeat(1 + (Math.floor(performance.now() / 300) % 3)); renderLog(); }
    // blink lid + glances
    lid.next -= dt;
    if (lid.t < 0 && lid.next <= 0) { lid.t = 0; lid.next = rand(2.2, 5.5); }
    if (lid.t >= 0) { lid.t += dt; if (lid.t > 0.26) lid.t = -1; }
    glance.next -= dt;
    if (glance.t < 0 && glance.next <= 0) { glance.t = 0; glance.dir = Math.random() < 0.5 ? -1 : 1; glance.next = rand(5, 11); }
    if (glance.t >= 0) { glance.t += dt; if (glance.t > 1.1) glance.t = -1; }
    // idle states: only while she's idle; anything else (talking, listening, thinking) brings her back
    const busyNow = st.mode !== 'idle' || st.action;
    if (busyNow && idle.name !== 'base') idle = { name: 'base', t: 0, next: rand(8, 14), flash: 0.12 };
    idle.t += dt;
    if (idle.flash) idle.flash = Math.max(0, idle.flash - dt);
    if (idle.name === 'base' && !busyNow && idle.t > idle.next) { const n = pickIdle(); idle = { name: n, t: 0, dur: DUR[n]() }; }
    else if (idle.name !== 'base' && idle.t > idle.dur) idle = { name: 'base', t: 0, next: rand(10, 20), flash: idle.name === 'peek' || idle.name === 'channel' ? 0.1 : 0 };
    // tag
    const TAG = { listening: 'LISTENING', thinking: 'THINKING', speaking: 'TALKING' };
    const IDLE_TAG = { base: 'IDLE', chill: 'CHILLING', sleepy: idle.t > 5 ? 'WOKE UP!' : 'SLEEPY', peek: idle.t > 1.1 && idle.t < 2.2 ? 'NO SIGNAL' : 'PEEKABOO', closeup: 'CLOSE-UP', channel: idle.t < 0.8 ? 'CH 07' : 'CHARGING' };
    el.tag.textContent = 'CAPRI.TV // ' + (TAG[st.mode] || IDLE_TAG[idle.name] || 'IDLE');
    drawFeed();
  }

  function lidAmount() {
    if (lid.t < 0) return 0;
    if (lid.t < 0.07) return (lid.t / 0.07) * 6;
    if (lid.t < 0.15) return 7;
    return (1 - (lid.t - 0.15) / 0.11) * 6;
  }

  function drawFeed() {
    const t = st.t;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, FW, FH);
    const cx = FW / 2;
    // glow + glitter
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const grd = g.createRadialGradient(cx, FH * 0.52, 10, cx, FH * 0.52, FH * 0.6);
    grd.addColorStop(0, `rgba(255,46,120,${0.16 + 0.08 * pulse})`); grd.addColorStop(1, 'rgba(255,46,120,0)');
    g.fillStyle = grd; g.fillRect(0, 0, FW, FH);
    const gs = Math.max(2, Math.round(3 * U));
    for (const p of glitter) {
      const sy = FH - ((t * p.sp * 3 * U + p.o * U) % (FH + 20));
      g.fillStyle = p.g ? 'rgba(46,255,140,.7)' : 'rgba(255,112,162,.75)';
      g.fillRect(Math.round(p.x * FW / gs) * gs, Math.round(sy / gs) * gs, gs, gs);
    }

    const bob = Math.sin(t * 2.1) * 1.6 + Math.sin(t * 0.9) * 0.5;
    const baseY = -TOP * SC + Math.round(5 * U) + Math.round(bob * SC);
    const frame = env.bodyFrame();
    let eyes = env.eyes(); if (eyes === 'blink') eyes = 'neutral';
    const mouth = env.mouth();
    const many = env.many();
    const tint = env.tint();
    const gl = glance.t >= 0 ? Math.round(clamp(Math.min(glance.t, 1.1 - glance.t) / 0.12, 0, 1) * glance.dir) : 0;
    const k = idle.t;
    let dim = 0;
    const base = (o = {}) => drawCapri({ frame, eyes, mouth, many, tint, lid: lidAmount(), edx: gl, x: cx, y: baseY, ...o });

    switch (idle.name) {
      case 'chill': {
        const lean = ease(clamp(k / 0.5, 0, 1));
        if (k < 0.5) { g.globalAlpha = 1 - lean; base({ eyes: 'relaxed', mouth: 'relaxed' }); g.globalAlpha = lean; }
        const peek = k > idle.dur * 0.55 && k < idle.dur * 0.55 + 0.8;
        const lf = LG ? (peek ? (k < idle.dur * 0.55 + 0.6 ? 'lounge_peek1' : 'lounge_peek0') : LG.loop[Math.floor(t * 4) % LG.loop.length]) : null;
        if (!lf || !drawLounge(lf, cx + 6 * U, -2 * U + Math.round(Math.sin(t * 1.3) * 1.2 * SC), SC)) base({ eyes: 'relaxed', mouth: 'relaxed' });
        g.globalAlpha = 1;
        if (Math.random() < 0.08) { const a = rand(0, 6.28), R = rand(0.3, 0.38) * FW; zig(cx + Math.cos(a) * R, FH * 0.5 + Math.sin(a) * R * 0.55, a + 1.57, 24 * U, Math.random() < 0.25 ? '#ffe0ec' : '#ff2e78', 4 * U); }
        if (peek) text('♪', cx + 90 * U, (70 - (k - idle.dur * 0.55) * 30) * U, '#2eff8c', 22);
        break;
      }
      case 'sleepy': {
        if (k < 5) {
          const sink = Math.round(Math.min(5, k) * 3) * Math.round(U * 3);
          const l = k < 1.6 ? lidAmount() : k < 3.2 ? 3 + Math.sin(k * 5) * 0.8 : 7;
          dim = Math.min(0.32, k * 0.08);
          drawCapri({ frame: Math.floor(t * 0.8) % 2 ? 'idle1' : 'idle0', eyes: 'relaxed', mouth: 'relaxed', tint, lid: l, x: cx, y: baseY + sink });
          if (k > 2.6) for (let i = 0; i < 3; i++) { const z = (k - 2.6 + i * 0.6) % 1.8; text(i % 2 ? 'Z' : 'z', cx + (50 + z * 26) * U, (80 - z * 38) * U, `rgba(255,224,236,${1 - z / 1.8})`, 14 + i * 4); }
        } else {
          const j = k - 5, up = Math.round((1 - ease(clamp(j / 0.25, 0, 1))) * 15) * Math.round(U * 3);
          drawCapri({ frame: 'charge', eyes: 'surprised', mouth: 'surprised', tint, x: cx, y: baseY + up });
          if (j < 0.5) { bolt(cx - 60 * U, 40 * U, cx - 120 * U, 10 * U); bolt(cx + 60 * U, 40 * U, cx + 125 * U, 15 * U); text('!', cx + 70 * U, 60 * U, '#ffe0ec', 30); }
          if (j < 0.05 && !idle.woke) { idle.woke = true; sfx.zap(0.5); }
        }
        break;
      }
      case 'peek': {
        if (k < 0.4) { const e = ease(k / 0.4); drawCapri({ frame: 'walk1', red: true, x: cx - e * (FW / 2 + 160 * U), y: baseY }); }
        else if (k < 1.1) { /* empty screen */ }
        else if (k < 2.2) { noise(0.55); text('NO SIGNAL', cx - 48 * U, FH / 2 + 5 * U, '#2eff8c', 16); }
        else if (k < 4.2) { const e = ease(clamp((k - 2.2) / 0.45, 0, 1)); base({ x: FW + 70 * U - e * 120 * U, eyes: k > 3.2 && k < 3.6 ? 'wink' : 'happy', mouth: 'happy' }); }
        else { const e = ease(clamp((k - 4.2) / 0.35, 0, 1)); if (e < 1) drawCapri({ frame: 'walk2', red: true, x: FW - 50 * U - e * (FW / 2 - 50 * U), y: baseY }); else base({ eyes: 'happy', mouth: 'happy' }); }
        break;
      }
      case 'closeup': {
        const sc = k < 0.12 || k > idle.dur - 0.12 ? SC : k < 0.24 || k > idle.dur - 0.24 ? Math.round(SC * 4 / 3) : Math.round(SC * 5 / 3);
        const y = Math.round(FH / 2 - 46 * sc + 10 * U + bob * sc);
        base({ sc, y, eyes: k > 2.1 ? 'happy' : 'neutral', mouth: k > 2.1 ? 'happy' : 'surprised', many: k > 0.8 && k < 1.3 });
        if ((k > 0.1 && k < 0.14) || (k > idle.dur - 0.14 && k < idle.dur - 0.1)) noise(0.35);
        if (k > 1.5 && k < 2.0) { const rr = ((k - 1.5) % 0.25) / 0.25; g.strokeStyle = `rgba(255,224,236,${1 - rr})`; g.lineWidth = 3 * U; g.beginPath(); g.ellipse(cx + 70 * U, 60 * U, (6 + rr * 40) * U, (4 + rr * 26) * U, 0, 0, 6.283); g.stroke(); }
        break;
      }
      case 'channel': {
        if (k < 0.8) { noise(0.7); text('CH 07', 14 * U, 26 * U, '#2eff8c', 16); }
        else {
          const j = k - 0.8, casting = j > 1.2;
          base({ frame: casting ? 'cast' : 'charge', eyes: casting ? 'glow' : 'angry', mouth: casting ? 'happy' : 'neutral' });
          if (!casting && Math.random() < 0.6) { const a = rand(0, 6.28); bolt(cx + Math.cos(a) * 40 * U, FH * 0.55 + Math.sin(a) * 40 * U, cx + Math.cos(a) * 95 * U, FH * 0.55 + Math.sin(a) * 75 * U); }
          if (casting && j < 1.6) { bolt(cx + 30 * U, FH * 0.48, FW + 10, FH * 0.26, '#ffe0ec', 5); g.fillStyle = `rgba(255,224,236,${0.35 * (1 - (j - 1.2) / 0.4)})`; g.fillRect(0, 0, FW, FH); if (!idle.zapped) { idle.zapped = true; sfx.zap(0.7); } }
        }
        break;
      }
      default: {
        base();
        // sparks while she talks, a few when idle
        const chance = st.mode === 'speaking' ? 0.1 : 0.025;
        if (Math.random() < chance) { const side = Math.random() < 0.5 ? -1 : 1; zig(cx + side * rand(0.27, 0.42) * FW, rand(0.15, 0.7) * FH, 1.57 + side * 0.3, 22 * U, Math.random() < 0.2 ? '#ffe0ec' : '#ff70a2', 3 * U); }
        if (st.mode === 'thinking') { for (let i = 0; i < 3; i++) { const a = t * 4 + i * 2.09; g.fillStyle = '#ffd6e6'; g.fillRect(Math.round(cx + Math.cos(a) * 34 * U), Math.round(20 * U + Math.sin(a) * 8 * U), gs, gs); } }
      }
    }
    if (idle.flash) noise(0.5);
    if (dim) { g.fillStyle = `rgba(6,0,10,${dim})`; g.fillRect(0, 0, FW, FH); }
    // fade the waist cut into the dark
    const fg = g.createLinearGradient(0, FH - 22 * U, 0, FH);
    fg.addColorStop(0, 'rgba(12,4,16,0)'); fg.addColorStop(1, 'rgba(12,4,16,.7)');
    g.fillStyle = fg; g.fillRect(0, FH - 22 * U, FW, 22 * U);
  }

  window.addEventListener('resize', () => { if (on) { const r = el.tv.getBoundingClientRect(); place(r.left, r.top); } });

  return {
    enter, exit, toggle, tick, say, anchor, drawFront, focusInput,
    on: () => on, dragging: () => !!drag, busy: () => busy,
    _state: () => ({ on, idle: idle.name, lines: lines.map((l) => l.text) }), _idle: (n) => { idle = { name: n, t: 0, dur: DUR[n] ? DUR[n]() : 3 }; },
  };
}
