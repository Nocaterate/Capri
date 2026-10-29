// High Forever: Capri's party mode. Plays her party song on loop (from <userData>/music) and goes wild on the beat:
// pinball bounces, beat jumps and a storm-DJ light show, mixed in 16-beat sections, with size pops, zaps,
// lightning, strobing red electric form and shard confetti. With D out he floats in the middle of the screen,
// arms flung wide, hair spiked, grinning, while she circles him. Runs only when asked, loops until stopped
// (the stop box at the bottom right, Esc, the menu, or asking her).
import { analyseBeats } from './beats.js';

const PINK = ['#FF2E78', '#FF5C9A', '#FFB3D1', '#FF8FB6'];
const CONFETTI = ['#FF2E78', '#FFB3D1', '#2EFF8C', '#FF5C9A', '#FFFFFF'];
const STYLES = ['pinball', 'jumper', 'storm'];

export function initParty(env) {
  const { api, st, fx, sfx } = env;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const box = document.getElementById('party-stop');
  const boxSong = document.getElementById('party-song');

  let ac = null, gain = null, src = null, song = null, songName = '', beats = null, startAt = 0, loading = null;
  let p = null, starting = false;

  async function loadSong() {
    if (song) return true;
    if (loading) return loading;
    loading = (async () => {
      const s = await api.partySong().catch(() => null);
      if (!s || !s.bytes) return false;
      ac = ac || new AudioContext();
      const buf = await ac.decodeAudioData(s.bytes.buffer.slice(s.bytes.byteOffset, s.bytes.byteOffset + s.bytes.byteLength));
      song = buf; songName = s.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      beats = analyseBeats(buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : null, buf.sampleRate);
      return true;
    })().catch(() => false).finally(() => { loading = null; });
    return loading;
  }

  let songAt = 0;   // where in the song to start (seconds)
  function playSong() {
    if (!song) return;
    ac.resume();
    gain = ac.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.85, ac.currentTime + 0.4);
    gain.connect(ac.destination);
    src = ac.createBufferSource();
    src.buffer = song; src.loop = true;
    src.connect(gain);
    startAt = ac.currentTime + 0.05;
    src.start(startAt, songAt % song.duration);
  }
  function stopSong() {
    if (!src) return;
    const s = src, g = gain;
    src = null; gain = null;
    try { g.gain.cancelScheduledValues(ac.currentTime); g.gain.setValueAtTime(g.gain.value, ac.currentTime); g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.5); } catch { /* closed */ }
    setTimeout(() => { try { s.stop(); s.disconnect(); g.disconnect(); } catch { /* already stopped */ } }, 600);
  }

  // ---------------------------------------------------------------- start / stop
  async function start({ at = 0 } = {}) {
    if (p || starting) return;
    songAt = at;
    starting = true;
    try {
      await begin();
    } catch (e) {
      console.error('High Forever failed to start:', e && (e.stack || e.message || e));
      if (p) stop(true);
    } finally { starting = false; }
  }
  async function begin() {
    {
      await env.ensureVisible();
      if (st.chill) env.endChill();
      env.closeNotes();
      env.closeTypebox();
      env.hideBubble();
      const have = await loadSong();
      const S0 = env.baseS();
      const size = env.sizeSetting();   // her size before the party: exactly what she goes back to
      p = {
        t: 0, beat: -1, lastBf: -1, S0, size: 1, sizeTo: 1, vx: 520, vy: 0, style: 'storm', styleUntil: 16, spin: 0, hold: 0,
        from: null, to: null, jumpH: 0, ghostT: 0, sizeSetting: size, home: { x: st.pos.x, y: st.pos.y }, fallback: !have,
      };
      st.party = p;
      st.mode = 'party'; st.walk = null; st.action = null; st.drag = null;
      st.partyRed = true;
      st.lastInteraction = performance.now();
      playSong();
      api.partyState(true);
      box.hidden = false;
      boxSong.textContent = have ? `♪ ${songName}` : '♪ no song yet';
      box.classList.remove('in'); void box.offsetWidth; box.classList.add('in');
      // the drop: a pink flash and a burst as she powers up
      const c = env.coreScreen();
      fx.doFlash(0.35, '255,46,120');
      fx.ring(c.x, c.y, { r0: S0 * 4, r1: S0 * 60, life: 0.5, color: '#FF2E78' });
      fx.burst(c.x, c.y, 40, { speed: 420, life: 0.6, gravity: 0 });
      sfx.zap(1.2);
      env.manyEyes(1.2);
      if (!have) {
        env.say('Party time! (Put the High Forever mp3 in my music folder and the song plays too.)', {
          seconds: 8, buttons: [{ label: 'Open music folder', onClick: () => { env.hideBubble(); api.openMusicFolder(); } }],
        });
      }
    }
  }

  async function stop(instant = false) {
    if (!p) return;
    const was = p;
    p = null;
    st.party = null; st.partyRed = false; st.partyFrame = null;
    stopSong();
    api.partyState(false);
    box.hidden = true;
    env.restoreScale(was.sizeSetting);
    if (st.mode === 'party') st.mode = 'idle';
    st.rot = 0;
    env.partyEnded(instant);
    if (instant) return;
    // she drifts back down, lands, catches her breath and winks
    const c = env.coreScreen();
    fx.burst(c.x, c.y, 30, { speed: 300, life: 0.5, gravity: 0 });
    fx.ring(c.x, c.y, { r0: was.S0 * 4, r1: was.S0 * 30, life: 0.4, color: '#FF8FB6' });
    st.glitchT = 0.1;
    await env.tween(st.pos, { y: 0 }, 0.5, (k) => k * k);
    env.squash(1.25, 0.75);
    const f = env.feet();
    fx.ring(f.x, f.y, { r0: was.S0 * 3, r1: was.S0 * 26, life: 0.4 });
    sfx.zap(0.5);
    env.savePos();
    await sleep(350);
    st.winkUntil = performance.now() + 1100;
    env.setEmotion('happy', 3, false);
    env.say(pick(['Phew... that was electric!', 'Okay okay, I\'m calm now. Mostly.', 'Best. Party. Ever.', 'My circuits are still buzzing!']), { seconds: 3.5 });
  }

  box.addEventListener('click', (e) => { e.stopPropagation(); stop(); });
  window.addEventListener('keydown', (e) => { if (p && e.key === 'Escape') { e.preventDefault(); stop(); } });

  // ---------------------------------------------------------------- the beat
  function clock(dt) {
    if (song && src) {
      const period = beats.period;
      const t = (ac.currentTime - startAt + songAt + 0.03) % song.duration;   // a hair early so moves hit with the sound
      const bf = (t - beats.offset) / period;
      const n = beats.strength.length;
      const idx = Math.max(0, Math.floor(bf));
      // average loudness over the next couple of beats: quiet intro vs. the drop
      let s = 0;
      for (let i = 0; i < 4; i++) s += beats.strength[Math.min(n - 1, idx + i)] || 0;
      return { bf, period, energy: s / 4 };
    }
    p.t += dt;
    const period = 60 / 128;
    const bf = p.t / period;
    return { bf, period, energy: 0.55 + 0.45 * Math.max(0, Math.sin(bf / 32 * Math.PI)) };
  }

  function tick(dt) {
    if (!p) return;
    const { W, H } = env.dims();
    const { bf, period, energy } = clock(dt);
    const b = Math.floor(bf);
    const onBeat = b !== p.beat && bf >= 0;
    if (onBeat) {
      if (b < p.beat) { p.styleUntil = b + 16; }       // the song looped back to the start
      p.beat = b;
    }
    const ph = bf - Math.floor(bf);
    const loud = energy > 0.45;
    p.energy = energy;
    // a new style every 16 beats (quiet parts stay floaty)
    if (onBeat && b >= p.styleUntil) {
      p.styleUntil = b + 16;
      const options = loud ? STYLES.filter((s) => s !== p.style) : ['storm'];
      setStyle(pick(options));
    }
    // ducks the music while she listens or talks
    if (gain) gain.gain.value += ((['listening', 'speaking', 'thinking'].includes(st.mode) ? 0.25 : 0.85) - gain.gain.value) * Math.min(1, dt * 6);

    // size: eased toward the target, a pump on every beat; never bigger than the screen can hold
    p.sizeTo = Math.min(p.sizeTo, (H * 0.82) / (112 * p.S0 * 1.12));
    p.size += (p.sizeTo - p.size) * Math.min(1, dt * 10);
    const pump = 1 + (loud ? 0.12 : 0.05) * Math.max(0, 1 - ph * 4);
    env.setS(Math.max(2, Math.round(p.S0 * p.size * pump * 2) / 2));
    const S = env.S();
    const halfW = 30 * S, topH = 112 * S;
    const dx = env.duoX();

    if (p.style === 'pinball') pinball(dt, onBeat, b, W, H, S, halfW, topH, loud);
    else if (p.style === 'jumper') jumper(dt, onBeat, b, W, H, S, halfW, topH, ph, loud);
    else storm(dt, onBeat, b, W, H, S, halfW, topH, ph, loud, dx, period);

    st.pos.y = Math.max(0, Math.min(Math.max(0, H - topH), st.pos.y));
    st.pos.x = Math.max(halfW, Math.min(W - halfW, st.pos.x));
    if (!st.partyRed) st.red *= Math.pow(0.0005, dt);   // snap back to her colors in time with the beat

    // everywhere: a bolt on the beat, the big drops flash, bolts to D, afterimages, sparks, music notes
    if (onBeat) {
      const c = env.coreScreen();
      if (loud || b % 2 === 0) fx.bolt(c.x, c.y, pick([-20, W + 20]), rand(0, H), { life: 0.16, width: 1.5, branches: 2 });
      if (dx != null && b % 2 === 1) { const d = env.duoCore(); fx.bolt(c.x, c.y, d.x, d.y, { life: 0.14, width: 1.2, branches: 1 }); }
      if (b % 16 === 0 && loud) fx.doFlash(0.22, '255,46,120');
      if (b % 8 === 3) fx.showEmote('note', 0.8);
      if (loud && b % 8 === 0) env.manyEyes(period * 3);
      sfx.crackle(0.12, 30);
    }
    if (loud && Math.random() < dt * 30) fx.burst(rand(0, W), -10, 1, { speed: 40, up: -120, life: 1.8, gravity: 200, color: pick(CONFETTI) });
    p.ghostT -= dt;
    if (p.ghostT <= 0 && !st.hideSprite) { p.ghostT = 0.045; env.ghost(pick(['rgba(255,26,60,0.7)', 'rgba(255,46,120,0.6)', 'rgba(255,180,210,0.5)'])); }
    if (Math.random() < dt * 30) { const q = env.toScreen(env.AX + rand(-20, 20), env.CORE_Y + rand(-30, 20)); fx.spark(q.x, q.y); }
  }

  function setStyle(s) {
    p.style = s; p.from = null; p.hold = 0;
    if (s === 'pinball') { p.vx = pick([-1, 1]) * rand(450, 650); p.vy = rand(300, 700); }
    st.partyRed = true;
  }

  function strike(x, y, S) {   // lightning from the top of the screen down onto a spot
    fx.bolt(x + rand(-60, 60), -20, x, y, { life: 0.25, width: 2, branches: 3 });
    fx.ring(x, y, { r0: S * 3, r1: S * 26, life: 0.4, color: pick(PINK) });
  }
  function zapTo(x, y) {       // blink to a new spot with a bolt between
    const a = env.coreScreen();
    fx.burst(a.x, a.y, 24, { speed: 300, life: 0.35, gravity: 0, color: '#FF1A3C' });
    st.pos.x = x; st.pos.y = y;
    const c = env.coreScreen();
    fx.bolt(a.x, a.y, c.x, c.y, { life: 0.22, width: 2, branches: 2 });
    fx.burst(c.x, c.y, 24, { speed: 300, life: 0.35, gravity: 0 });
    st.glitchT = 0.12;
    sfx.zap(0.8);
  }

  // A · pinball: bounces off every edge of the screen
  function pinball(dt, onBeat, b, W, H, S, halfW, topH, loud) {
    st.partyRed = true;
    p.vy -= 1500 * dt;
    st.pos.x += p.vx * dt; st.pos.y += p.vy * dt;
    const wall = (x) => {
      const f = env.coreScreen();
      for (let i = 0; i < 3; i++) fx.bolt(x, f.y, x + rand(-S * 20, S * 20), f.y + rand(-S * 30, S * 30), { life: 0.15, branches: 1 });
      fx.burst(x, f.y, 16, { speed: 260, life: 0.3, gravity: 0 });
      env.squash(0.75, 1.25);
    };
    if (st.pos.x < halfW) { st.pos.x = halfW; p.vx = Math.abs(p.vx); wall(st.pos.x - halfW * 0.6); }
    if (st.pos.x > W - halfW) { st.pos.x = W - halfW; p.vx = -Math.abs(p.vx); wall(st.pos.x + halfW * 0.6); }
    if (st.pos.y <= 0 && p.vy < 0) { st.pos.y = 0; p.vy = rand(900, 1250); env.squash(1.3, 0.7); const f = env.feet(); fx.ring(f.x, f.y, { r0: S * 3, r1: S * 30, life: 0.35 }); }
    if (st.pos.y > H - topH) { st.pos.y = H - topH; p.vy = -Math.abs(p.vy) * 0.5; }
    st.flip = p.vx > 0 ? 1 : -1;
    st.rot = Math.sin(st.t * 9) * 0.25;
    st.partyFrame = 'walk' + (Math.floor(st.t * 14) % 4);
    if (onBeat) {
      if (b % 4 === 0) p.sizeTo = pick(loud ? [0.7, 1, 1.5] : [0.85, 1]);
      if (b % 8 === 4 && loud) { zapTo(rand(W * 0.2, W * 0.8), rand(0, H * 0.4)); p.vx = pick([-1, 1]) * rand(450, 700); }
    }
  }

  // B · jumper: a big jump every 2 beats, landing on the beat with a lightning strike; giant, then tiny
  function jumper(dt, onBeat, b, W, H, S, halfW, topH, ph, loud) {
    const k = ((b % 2) + ph) / 2;                  // 0..1 across two beats
    if (onBeat && b % 2 === 0) {
      const f = env.feet();
      env.squash(1.35, 0.65);
      if (p.from != null) { strike(f.x, f.y, S); fx.burst(f.x, f.y, 18, { speed: 280, up: 120, life: 0.45 }); sfx.zap(0.7); }
      p.from = st.pos.x; p.fromY = st.pos.y;
      p.to = Math.max(halfW, Math.min(W - halfW, st.pos.x + pick([-1, 1]) * rand(W * 0.12, W * 0.3)));
      if (Math.abs(p.to - p.from) < S * 10) p.to = W - p.from;
      p.jumpH = Math.min(rand(H * 0.18, H * 0.42), H - topH);
      st.flip = p.to > p.from ? 1 : -1;
      const bar = b % 16;
      if (loud && bar === 0) p.sizeTo = 1.9;
      else if (bar === 4) p.sizeTo = 0.6;
      else if (bar === 8 || !loud) p.sizeTo = 1;
      if (loud && b % 4 === 0) env.manyEyes(0.9);
    }
    if (p.from != null) {
      st.pos.x = p.from + (p.to - p.from) * k;
      st.pos.y = Math.max(0, (p.fromY || 0) * (1 - k) + 4 * p.jumpH * k * (1 - k));
    }
    st.rot = (k - 0.5) * 0.6 * st.flip;
    st.partyRed = k > 0.12 && k < 0.88;           // her normal colors on each landing, red electric in the air
    st.partyFrame = k < 0.1 ? 'charge' : k > 0.9 ? 'cast' : 'walk' + (Math.floor(st.t * 16) % 4);
  }

  // C · storm DJ: figure-8 over the screen (or circling D), light-show bolts to the corners, spins, strobe
  function storm(dt, onBeat, b, W, H, S, halfW, topH, ph, loud, dx, period) {
    const a = (st.t * (2 * Math.PI)) / (period * 16);
    let cx, cy;
    if (dx != null) {                               // circle around D in the middle
      const d = env.duoCore();
      cx = d.x + Math.cos(a) * W * 0.26; cy = (H - d.y) - 40 * S + Math.sin(a) * H * 0.2;
    } else { cx = W / 2 + Math.sin(a) * W * 0.32; cy = H * 0.28 + Math.sin(a * 2) * H * 0.16; }
    if (performance.now() > p.hold) {
      st.pos.x += (cx - st.pos.x) * Math.min(1, dt * 6);
      st.pos.y += (cy - st.pos.y) * Math.min(1, dt * 6);
    }
    st.flip = Math.cos(a) > 0 ? 1 : -1;
    p.spin *= Math.pow(0.02, dt);
    st.rot = Math.sin(st.t * 6) * 0.2 + p.spin;
    st.partyFrame = ph < 0.25 ? 'cast' : (Math.floor(st.t * 4) % 2 ? 'idle1' : 'idle0');
    if (Math.random() < dt * 2) env.manyEyes(0.6);
    if (onBeat) {
      st.partyRed = loud ? b % 2 === 0 : true;      // strobes between red electric and her colors
      if (loud) {
        const c = env.coreScreen();
        const { W: w, H: h } = env.dims();
        for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) if (Math.random() < 0.6) fx.bolt(c.x, c.y, x, y, { life: 0.16, width: 1.3, branches: 1 });
        fx.ring(c.x, c.y, { r0: S * 6, r1: S * 40, life: 0.3, color: pick(PINK) });
      }
      if (b % 8 === 0) { p.spin = pick([-1, 1]) * Math.PI * 2; p.sizeTo = pick(loud ? [0.6, 1.2, 1.7] : [0.9, 1.1]); }
      if (loud && b % 16 === 12) { zapTo(rand(W * 0.15, W * 0.85), rand(H * 0.05, H * 0.5)); p.hold = performance.now() + period * 1500; }
    }
  }

  return { start, stop, tick, isOn: () => !!p, _beats: () => beats, _p: () => p };
}
