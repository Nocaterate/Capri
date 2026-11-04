// In Love With Myself: a duo action. A long, faceted, slightly broken red car pulls in along the taskbar and
// stops in the middle of the screen; Capri and D fly onto its roof as streams of pixels (D sits hugging his
// knees, she leans back on him, hair in the wind). The car never leaves the middle, but everything says it's
// flying down the road: spinning wheels, road dashes, speed lines, dust, bumps on the beat, pink electricity
// crawling over the body. Plays its own song on loop (<userData>/music, "in love with myself" in the name).
// It always runs at ONE size (sized to the screen), whatever size Capri and D are; when it ends they fly back
// to where they were, at their own size. Needs D (he's called if he isn't out) and he can't be sent away mid-ride.
// Stops with the stop box (bottom right, same spot as High Forever's), Esc, the menu, or asking her.
import { analyseBeats } from './beats.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const VIEW_W = 384;                  // the scene is designed for a screen 384 sprite pixels wide (1920 px at 5x)
const ARRIVE = 1.7, BOARD = 1.0, LEAVE = 0.9, DEPART = 1.5;   // seconds

export function initRide(env) {
  const { api, st, fx, sfx } = env;
  const box = document.getElementById('party-stop');
  const boxSong = document.getElementById('party-song');
  const boxLabel = document.getElementById('party-label');

  // ---------------------------------------------------------------- sprites
  let M = null, img = null, data = null, riderPix = null;
  async function loadSprites() {
    if (M) return true;
    const meta = JSON.parse(new TextDecoder().decode(await api.readAsset('capri/ride.json')));
    const bytes = await api.readAsset(meta.file);
    const im = new Image();
    im.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    data = g.getImageData(0, 0, im.width, im.height).data;
    // every pixel of the riders, and whether it's D's or Capri's (for the fly-on / fly-off transitions)
    const [RW, RH] = meta.rider, [rx, ry] = meta.rects.rider0, [mx, my] = meta.rects.dmask;
    riderPix = [];
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
      const i = ((ry + y) * im.width + rx + x) * 4;
      if (data[i + 3] < 120) continue;
      const d = data[((my + y) * im.width + mx + x) * 4 + 3] > 0;
      riderPix.push({ x, y, d, c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` });
    }
    M = meta; img = im;
    return true;
  }

  // ---------------------------------------------------------------- the song
  let ac = null, gain = null, src = null, song = null, songName = '', beats = null, startAt = 0, loading = null;
  async function loadSong() {
    if (song) return true;
    if (loading) return loading;
    loading = (async () => {
      const s = await api.partySong('in_love').catch(() => null);
      if (!s || !s.bytes) return false;
      ac = ac || new AudioContext();
      const buf = await ac.decodeAudioData(s.bytes.buffer.slice(s.bytes.byteOffset, s.bytes.byteOffset + s.bytes.byteLength));
      song = buf;
      songName = /in.?love.?with.?myself/i.test(s.name) ? 'In Love With Myself' : s.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      beats = analyseBeats(buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : null, buf.sampleRate);
      return true;
    })().catch(() => false).finally(() => { loading = null; });
    return loading;
  }
  function playSong() {
    if (!song) return;
    ac.resume();
    gain = ac.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.85, ac.currentTime + 1.2);
    gain.connect(ac.destination);
    src = ac.createBufferSource();
    src.buffer = song; src.loop = true;
    src.connect(gain);
    startAt = ac.currentTime + 0.05;
    src.start(startAt, 0);
  }
  function stopSong(fade = 1.5) {
    if (!src) return;
    const s = src, g = gain;
    src = null; gain = null;
    try { g.gain.cancelScheduledValues(ac.currentTime); g.gain.setValueAtTime(g.gain.value, ac.currentTime); g.gain.linearRampToValueAtTime(0, ac.currentTime + fade); } catch { /* closed */ }
    setTimeout(() => { try { s.stop(); s.disconnect(); g.disconnect(); } catch { /* already stopped */ } }, fade * 1000 + 100);
  }
  function clock(dt) {
    if (song && src) {
      const t = (ac.currentTime - startAt + 0.03) % song.duration;
      const bf = (t - beats.offset) / beats.period;
      const n = beats.strength.length, idx = Math.max(0, Math.floor(bf));
      let s = 0;
      for (let i = 0; i < 4; i++) s += beats.strength[Math.min(n - 1, idx + i)] || 0;
      return { bf, period: beats.period, energy: s / 4 };
    }
    r.ft = (r.ft || 0) + dt;
    return { bf: r.ft / (60 / 111), period: 60 / 111, energy: 0.6 };
  }

  // ---------------------------------------------------------------- state
  let r = null, starting = false;
  // one size for everyone, whatever size Capri and D are: the screen's width in design pixels (5x on 1920)
  function rideScale() {
    const { W, H } = env.dims(), dpr = window.devicePixelRatio || 1;
    let dev = Math.max(2, Math.round((W * dpr) / VIEW_W));
    while (dev > 2 && ((M.car[0] * dev) / dpr > W * 0.96 || (132 * dev) / dpr > H * 0.85)) dev--;
    return dev / dpr;
  }
  const snap = (v) => { const d = window.devicePixelRatio || 1; return Math.round(v * d) / d; };

  // where things are on screen right now
  function layout() {
    const { W, H } = env.dims();
    const RS = r.RS, [CWd, CHd] = M.car;
    const left = snap(r.carX - (CWd * RS) / 2);
    const top = snap(H - (CHd - 1) * RS - r.bump * RS);
    const rl = snap(left + (M.seat[0] - M.riderSeat[0]) * RS);
    const rt = snap(top + (M.seat[1] - M.riderSeat[1]) * RS - r.rbump * RS);
    return { W, H, RS, left, top, rl, rt };
  }

  async function start() {
    if (r || starting) return;
    starting = true;
    try {
      await env.ensureVisible();
      if (st.chill) env.endChill();
      env.closeNotes(); env.closeTypebox(); env.hideBubble();
      const [ok] = await Promise.all([loadSprites().catch((e) => { console.error('ride sprites missing', e); return false; }), loadSong()]);
      if (!ok) return;
      // D has to come along: call him if he isn't out, and wait until he's here
      if (!env.duoOn()) api.setConfig({ dOut: true });
      const t0 = performance.now();
      while (!env.duoReady() && performance.now() - t0 < 4000) await sleep(60);
      if (!env.duoReady()) { env.say("D didn't show up... try again?", { seconds: 3 }); return; }
      await sleep(250);
      const { W } = env.dims();
      r = {
        kind: 'ride', phase: 'arrive', t: 0, beat: -1, RS: 0, carX: 0, bump: 0, rbump: 0, wheel: 0, wheelV: 0, flow: 0,
        riders: false, glitch: 0, blinkAt: performance.now() + 3000, aura: 0.3, arcT: 0, ghosts: [],
        lines: [], dashes: [], dust: [], trail: [], flyers: [], stopAsked: false, fallback: !song,
        home: { x: st.pos.x, y: st.pos.y, flip: st.flip }, dHome: env.duoX(),
      };
      r.RS = rideScale();
      r.carX = W + (M.car[0] * r.RS) / 2 + 40;
      st.party = r;                      // the same "busy" flag as High Forever: no dragging, typing, idling or other actions
      st.mode = 'party'; st.walk = null; st.action = null; st.drag = null;
      st.lastInteraction = performance.now();
      playSong();
      api.partyState(true, 'ride');
      boxLabel.textContent = 'STOP IN LOVE WITH MYSELF';
      box.title = 'Stop In Love With Myself (Esc)';
      boxSong.textContent = song ? `♪ ${songName}` : '♪ no song yet';
      box.hidden = false;
      box.classList.remove('in'); void box.offsetWidth; box.classList.add('in');
      // both of them turn to watch the car pull in
      st.flip = 1;
      sfx.crackle(0.3, 30);
      if (!song) {
        env.say('Road trip! (Put the "In Love With Myself" mp3 in my music folder and the song plays too.)', {
          seconds: 8, buttons: [{ label: 'Open music folder', onClick: () => { env.hideBubble(); api.openMusicFolder(); } }],
        });
      }
    } catch (e) {
      console.error('In Love With Myself failed to start:', e && (e.stack || e.message || e));
      if (r) stop(true);
    } finally { starting = false; }
  }

  // ---------------------------------------------------------------- the transitions
  // pixels flying between where Capri / D are standing and their seats on the roof
  // home = a pixel of Capri / D where they stand (their own size), seat = the same kind of pixel on the roof (ride size).
  // Every pixel of both shapes gets a flyer (the lists are cycled), so neither end has holes: when the flyers land,
  // the real sprite takes over without a pop. Home pixels are kept relative to her feet / his ground, so they
  // follow her hover bob while they fly.
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function makeFlyers(dir) {
    const ca = env.capriAnchor(), da = env.dAnchor();
    const out = [];
    const pair = (seat, home, isD, an) => {
      if (!seat.length) return;
      const n = Math.max(seat.length, home.length);
      for (let i = 0; i < n; i++) {
        const p = seat[i % seat.length], h = home.length ? home[i % home.length] : null;
        out.push({
          tx: p.x, ty: p.y, d: isD, hx: h ? h.x - an.x : null, hy: h ? h.y - an.y : null, hs: h ? h.s : null,
          hc: h ? h.c : p.c, sc: p.c, mc: isD ? '#FF1E68' : '#FF1A3C',            // in flight they're red electricity
          delay: rand(0, 0.32) + (isD ? 0.08 : 0), lift: rand(0.15, 0.45), dir,
        });
      }
    };
    pair(shuffle(riderPix.filter((p) => !p.d)), shuffle(env.capriPixels()), false, ca);
    pair(shuffle(riderPix.filter((p) => p.d)), shuffle(env.dPixels()), true, da);
    return out;
  }
  function flyOn() { r.flyers = makeFlyers(1); r.flyT = 0; r.flyDur = BOARD; }
  function flyOff() { r.flyers = makeFlyers(-1); r.flyT = 0; r.flyDur = LEAVE; }
  // 'back': pixels sitting on the seat (drawn with the riders, under the car's roof line); 'front': the rest
  function drawFlyers(ctx, layer) {
    if (!r || !r.flyers.length) return;
    const L = layout(), ca = env.capriAnchor(), da = env.dAnchor();
    for (const f of r.flyers) {
      let k = clamp((r.flyT - f.delay) / (r.flyDur - 0.42), 0, 1);   // every pixel lands just before the phase ends
      if (f.dir < 0) k = 1 - k;                          // flying off: from the seat (k=1) back home (k=0)
      if ((k >= 0.96) !== (layer === 'back')) continue;
      const e = easeInOut(k);
      const tx = L.rl + f.tx * L.RS, ty = L.rt + f.ty * L.RS;
      const an = f.d ? da : ca;
      const hx = f.hx == null ? tx : an.x + f.hx, hy = f.hy == null ? ty : an.y + f.hy, hs = f.hs || L.RS;
      const x = hx + (tx - hx) * e;
      const y = hy + (ty - hy) * e - Math.sin(e * Math.PI) * f.lift * 260;   // an arc up and over
      const s = hs + (L.RS - hs) * e;
      ctx.fillStyle = k <= 0.04 ? f.hc : k >= 0.96 ? f.sc : (Math.random() < 0.12 ? '#FFE8F2' : f.mc);
      ctx.fillRect(x, y, s, s);
    }
  }

  // ---------------------------------------------------------------- stop
  async function stop(instant = false) {
    if (!r) return;
    if (instant) { finish(true); return; }
    if (r.stopAsked) return;
    r.stopAsked = true;
    api.partyState(false, 'ride');
    box.hidden = true;
    stopSong(2.2);
    if (r.phase === 'arrive') { r.phase = 'depart'; r.t = 0; r.departFrom = r.carX; showHome(); return; }
    if (r.phase === 'board') { r.flyers = []; }
    r.phase = 'leave'; r.t = 0; r.riders = false;
    st.flip = r.home.flip; st.action = null; st.partyRed = false;   // her pixels land exactly as she'll look
    flyOff();
    sfx.zap(0.9); sfx.crackle(0.4, 40);
    const L = layout();
    fx.burst(L.rl + 80 * L.RS, L.rt + 60 * L.RS, 30, { speed: 300, life: 0.5, gravity: 0 });
  }
  function showHome() {           // Capri and D back on their own, at their own size
    st.pos.x = r.home.x; st.pos.y = r.home.y; st.flip = r.home.flip;
    env.unhide();
    st.glitchT = 0.06;
    env.duoGlitch();
    const c = env.coreScreen();
    fx.ring(c.x, c.y, { r0: 8, r1: 120, life: 0.4, color: '#FF8FB6' });
    sfx.glitch();
  }
  function finish(instant) {
    const was = r;
    r = null;
    if (st.party === was) st.party = null;
    st.partyRed = false; st.partyFrame = null;
    stopSong(instant ? 0.3 : 1.2);
    if (!was.stopAsked) api.partyState(false, 'ride');
    box.hidden = true;
    env.unhide();
    if (st.mode === 'party') st.mode = 'idle';
    st.rot = 0;
    if (instant) { st.pos.x = was.home.x; st.pos.y = was.home.y; return; }
    st.winkUntil = performance.now() + 1100;
    env.setEmotion('happy', 3, false);
    env.say(pick(['Best drive ever. D drives like a maniac though.', 'Wind in my hair... I could do that all night.', 'That car is held together by my electricity, you know.', 'Okay, back to work. Sigh.']), { seconds: 3.5 });
  }

  box.addEventListener('click', (e) => { if (r) { e.stopPropagation(); stop(); } });
  window.addEventListener('keydown', (e) => { if (r && e.key === 'Escape') { e.preventDefault(); stop(); } });

  // ---------------------------------------------------------------- every frame
  function tick(dt) {
    if (!r) return;
    const { W, H } = env.dims();
    r.t += dt;
    const RS = r.RS;
    const { bf, period, energy } = clock(dt);
    const b = Math.floor(bf), ph = bf - b;
    const onBeat = b !== r.beat && bf >= 0;
    if (onBeat) r.beat = b;
    const loud = energy > 0.45;
    if (gain) gain.gain.value += ((['listening', 'speaking', 'thinking'].includes(st.mode) ? 0.25 : 0.85) - gain.gain.value) * Math.min(1, dt * 6);
    const cw = M.car[0] * RS;

    // the road rushes by (it fades in as the car arrives, out as it drives off)
    const flowTo = r.phase === 'depart' ? Math.max(0, 1 - r.t / (DEPART * 0.8)) : 1;
    r.flow += (flowTo - r.flow) * Math.min(1, dt * 3);
    let carSpeed = 0;   // how fast the car moves across the screen (px/s), for the wheels and dust

    if (r.phase === 'arrive') {
      const k = Math.min(1, r.t / ARRIVE);
      const x0 = W + cw / 2 + 40, x1 = W / 2;
      const prev = r.carX;
      r.carX = x0 + (x1 - x0) * easeOut(k);
      carSpeed = Math.abs(r.carX - prev) / Math.max(dt, 1e-3);
      if (k > 0.55 && Math.random() < dt * 40) r.dust.push(dust(r.carX + (M.wheels[1][0] - M.car[0] / 2) * RS, H - RS, 1.6));   // braking
      if (r.t > ARRIVE * 0.55 && !r.charged) { r.charged = true; env.charge(); }
      if (k >= 1) {
        r.phase = 'board'; r.t = 0;
        flyOn();
        env.hideForRide();
        fx.S = r.RS;                     // her effects at the ride's size while she's up there
        sfx.zap(1.1); sfx.crackle(0.5, 40);
        const c = env.coreScreen();
        fx.burst(c.x, c.y, 24, { speed: 260, life: 0.4, gravity: 0, color: '#FF1A3C' });
      }
    } else if (r.phase === 'board') {
      r.flyT = r.t;
      if (r.t >= BOARD) {
        r.phase = 'ride'; r.t = 0; r.flyers = []; r.riders = true; r.glitch = 0.25;
        const L = layout();
        fx.doFlash(0.3, '255,46,120');
        fx.ring(L.rl + 80 * RS, L.rt + 60 * RS, { r0: RS * 4, r1: RS * 60, life: 0.5, color: '#FF2E78' });
        fx.burst(L.rl + 80 * RS, L.rt + 60 * RS, 40, { speed: 380, life: 0.6, gravity: 0 });
        sfx.zap(1.2);
      }
    } else if (r.phase === 'leave') {
      r.flyT = r.t;
      if (r.t >= LEAVE) {
        r.flyers = [];
        showHome();
        r.phase = 'depart'; r.t = 0; r.departFrom = r.carX;
        sfx.zap(0.6);
      }
    } else if (r.phase === 'depart') {
      const k = Math.min(1, r.t / DEPART);
      const prev = r.carX;
      r.carX = r.departFrom - (r.departFrom + cw / 2 + 60) * (0.2 * k + 0.8 * k * k);   // pulls away at once, then speeds up
      carSpeed = Math.abs(r.carX - prev) / Math.max(dt, 1e-3);
      if (Math.random() < dt * 30) r.dust.push(dust(r.carX + (M.rear[0] - M.car[0] / 2) * RS, H - (M.car[1] - M.rear[1]) * RS, 1.2, true));
      if (k >= 1) { finish(false); return; }
    }

    // bumps on the beat while riding: the car hops every other beat, the riders a moment later
    const riding = r.phase === 'ride' || r.phase === 'board' || r.phase === 'leave';
    r.bump = riding && b % 2 === 0 && ph < 0.18 ? 2 : (Math.random() < dt * 3 ? 1 : 0) * (riding ? 1 : 0);
    r.rbump = riding && b % 2 === 0 && ph > 0.1 && ph < 0.3 ? 2 : 0;
    if (onBeat && riding) r.aura = 1;
    r.aura += (0.3 - r.aura) * Math.min(1, dt * 5);
    // wheels: the road speed while it's moving, plus the car's own speed
    r.wheelV = r.flow * 16 + carSpeed / (RS * 11);
    r.wheel = (r.wheel + r.wheelV * dt * (M.wheelFrames / (2 * Math.PI / 5))) % M.wheelFrames;
    r.glitch = Math.max(0, r.glitch - dt);

    // speed lines and road dashes stream to the right (the car faces left)
    const want = Math.round(30 * r.flow);
    while (r.lines.length < want) r.lines.push({ x: rand(-W * 0.3, W), y: rand(H * 0.04, H - 8 * RS), len: rand(8, 30) * RS, pink: Math.random() < 0.3 });
    if (r.lines.length > want) r.lines.length = want;
    for (const l of r.lines) {
      l.x += 15 * 15 * RS * dt;
      if (l.x > W + 30) { l.x = rand(-W * 0.25, -l.len); l.y = rand(H * 0.04, H - 8 * RS); }
    }
    r.dashOff = ((r.dashOff || 0) + 17 * 15 * RS * dt * r.flow) % (40 * RS);
    // dust off the back wheel, sparks streaming off the riders
    if (riding && Math.random() < dt * 8) r.dust.push(dust(r.carX + (M.wheels[1][0] + 10 - M.car[0] / 2) * RS, H - 2 * RS, 1.5));
    for (const p of r.dust) { p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.grow * dt; p.life -= dt; }
    r.dust = r.dust.filter((p) => p.life > 0);
    if (r.riders && Math.random() < dt * 22) {
      const L = layout();
      r.trail.push({ x: L.rl + rand(M.riderSeat[0] + 8, M.riderSeat[0] + 50) * RS, y: L.rt + rand(M.riderSeat[1] - 40, M.riderSeat[1] - 12) * RS, life: 0.55, max: 0.55 });
    }
    for (const s of r.trail) { s.x += 9 * 15 * RS * dt; s.y += rand(-1, 1) * RS; s.life -= dt; }
    r.trail = r.trail.filter((s) => s.life > 0);

    // pink electricity crawling over the car (D runs it on Capri's electricity), never from his hands
    if (r.phase !== 'depart' || r.t < 0.3) {
      r.arcT -= dt;
      if (r.arcT <= 0) {
        r.arcT = rand(0.05, 0.14) * (loud ? 0.7 : 1);
        const L = layout();
        const n = pick([1, 1, 2, 2, 3]);
        for (let i = 0; i < n; i++) {
          const [x, y] = pick(M.edges);
          let best = null, bd = 1e9;
          const want2 = x + rand(10, 26);
          for (const e of M.edges) { const dd = Math.abs(e[0] - want2) + Math.abs(e[1] - y) * 0.5 + Math.random() * 4; if (dd < bd) { bd = dd; best = e; } }
          fx.bolt(L.left + x * RS, L.top + y * RS, L.left + best[0] * RS, L.top + best[1] * RS, { life: rand(0.08, 0.14), branches: 0, impact: false, width: 1 });
        }
        if (Math.random() < 0.3) {                              // crackle round a wheel
          const [wx, wy] = pick(M.wheels), a = rand(0, Math.PI * 2);
          const cx = L.left + wx * RS, cy = L.top + wy * RS, R = (M.wheelR + 1) * RS;
          fx.bolt(cx + Math.cos(a) * R, cy + Math.sin(a) * R, cx + Math.cos(a + 0.6) * R * 1.25, cy + Math.sin(a + 0.6) * R * 1.25, { life: 0.08, branches: 0, impact: false });
        }
        if (r.riders && Math.random() < 0.08) {                // a small arc on the roof under D
          const sx = L.left + (M.seat[0] - rand(14, 30)) * RS, sy = L.top + (M.seat[1] + 2) * RS;
          fx.bolt(sx, sy, sx + rand(-12, 12) * RS, sy + 4 * RS, { life: 0.1, branches: 0, impact: false });
        }
      }
    }
    if (onBeat && riding) sfx.crackle(0.08, 25);
    if (onBeat && riding && loud && b % 8 === 0) { const L = layout(); fx.ring(L.left + cw / 2, L.top + 30 * RS, { r0: RS * 10, r1: RS * 90, life: 0.45, color: '#FF5C9A' }); }
    // D blinks now and then
    const now = performance.now();
    if (now > r.blinkAt) { r.blinkUntil = now + 140; r.blinkAt = now + rand(2500, 6000); }
    // her talking bubble sits over the riders
    if (r.riders || r.phase === 'board') { const L = layout(); r.anchor = { x: L.rl + (M.riderSeat[0] + 16) * RS, top: L.rt + 6 * RS }; } else r.anchor = null;
  }
  function dust(x, y, size, exhaust = false) {
    return { x, y, vx: (exhaust ? 6 : 12) * 15 * (r ? r.RS : 5) * 0.2 + rand(0, 60), vy: -rand(10, 50), r: size * (r ? r.RS : 5), grow: (r ? r.RS : 5) * 5, life: 0.6, max: 0.6, exhaust };
  }

  // ---------------------------------------------------------------- drawing
  // behind Capri and D: speed lines, road, dust, the car and the riders
  function drawBack(ctx) {
    if (!r || !M) return;
    const L = layout(), RS = L.RS;
    ctx.imageSmoothingEnabled = false;
    // speed lines
    for (const l of r.lines) {
      ctx.globalAlpha = (l.pink ? 0.5 : 0.35) * r.flow;
      ctx.fillStyle = l.pink ? '#FF70A2' : '#FFFFFF';
      ctx.fillRect(snap(l.x), snap(l.y), l.len, RS);
    }
    // road dashes along the top of the taskbar
    ctx.globalAlpha = 0.6 * r.flow;
    ctx.fillStyle = '#FFD6E6';
    for (let x = -40 * RS + r.dashOff; x < L.W + 40 * RS; x += 40 * RS) ctx.fillRect(snap(x), L.H - RS, 14 * RS, RS);
    // dust
    for (const p of r.dust) {
      ctx.globalAlpha = 0.32 * (p.life / p.max);
      ctx.fillStyle = p.exhaust ? '#C8BED2' : '#DCC8D2';
      const s = Math.max(RS, Math.round(p.r / RS) * RS);
      ctx.fillRect(snap(p.x - s / 2), snap(p.y - s / 2), s, s);
    }
    ctx.globalAlpha = 1;
    // the riders (drawn before the car so the roof sits over D's seat line)
    if (r.riders) {
      const name = performance.now() < (r.blinkUntil || 0) ? 'rider_blink' : `rider${Math.floor(st.t * 12) % M.riderFrames}`;
      const [sx, sy] = M.rects[name], [RW, RH] = M.rider;
      if (r.glitch > 0) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(img, sx, sy, RW, RH, L.rl - 2 * RS, L.rt, RW * RS, RH * RS);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(img, sx, sy, RW, RH, L.rl, L.rt, RW * RS, RH * RS);
    }
    drawFlyers(ctx, 'back');
    // the car, with a flickering pink aura that pulses on the beat
    const [cx, cy] = M.rects[`car${Math.floor(r.wheel) % M.wheelFrames}`], [CWd, CHd] = M.car;
    if (!glowCanvas) makeGlow();
    ctx.globalAlpha = clamp(r.aura * rand(0.6, 1), 0, 1) * 0.6;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1]]) ctx.drawImage(glowCanvas, 0, 0, CWd, CHd, L.left + ox * RS, L.top + oy * RS, CWd * RS, CHd * RS);
    ctx.globalAlpha = 1;
    ctx.drawImage(img, cx, cy, CWd, CHd, L.left, L.top, CWd * RS, CHd * RS);
    // sparks streaming back off the riders
    for (const s of r.trail) {
      ctx.globalAlpha = s.life / s.max;
      ctx.fillStyle = '#FF70A2';
      ctx.fillRect(snap(s.x), snap(s.y), RS, RS);
    }
    ctx.globalAlpha = 1;
  }
  let glowCanvas = null;
  function makeGlow() {
    const [CWd, CHd] = M.car, [cx, cy] = M.rects.car0;
    glowCanvas = document.createElement('canvas');
    glowCanvas.width = CWd; glowCanvas.height = CHd;
    const g = glowCanvas.getContext('2d');
    g.drawImage(img, cx, cy, CWd, CHd, 0, 0, CWd, CHd);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#FF2E78'; g.fillRect(0, 0, CWd, CHd);
  }
  // on top: the pixels flying on and off the car
  function drawFront(ctx) { if (r) drawFlyers(ctx, 'front'); }

  return {
    start, stop, tick, drawBack, drawFront, isOn: () => !!r, anchor: () => (r ? r.anchor : null),
    _r: () => r, _beats: () => beats,
  };
}
