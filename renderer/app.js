// Capri — pixel desktop companion renderer.
// Draws the sprite on a transparent full-screen canvas and gives it a life:
// lightning intro, teleports, walking/dashing with afterimages, charge-ups, glitches,
// drag & poke reactions, emotes, and voice chat with a digital voice + a lip-synced zigzag mouth.
import META from '../assets/capri/sheet.js';
import { FX } from './fx.js';
import * as sfx from './sfx.js';
import { initNotes } from './notes.js';

const api = window.companion;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cfg = await api.getConfig();
if (cfg.__testBg) document.body.classList.add('test-bg');
sfx.configure({ enabled: cfg.sfxEnabled, volume: cfg.sfxVolume, voice: cfg.voiceEnabled });
await sfx.loadCustom(api);

const [SW, SH] = META.size;
const [AX, AY] = META.anchor;
const [OXo, OYo] = META.offset || [0, 0]; // design-space origin inside a sheet cell
const CORE_Y = 48 + OYo, TOP_Y = 16 + OYo; // her chest and the top of her head, in cell pixels
const HOVER = 9; // how high she levitates, in sprite pixels

// ------------------------------------------------------------------ sprite sheet
async function loadSheet() {
  const bytes = await api.readAsset('capri/sheet.png');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}
const sheet = await loadSheet();
const sheetCanvas = document.createElement('canvas');
sheetCanvas.width = sheet.width; sheetCanvas.height = sheet.height;
const sheetCtx = sheetCanvas.getContext('2d', { willReadFrequently: true });
sheetCtx.drawImage(sheet, 0, 0);
const sheetData = sheetCtx.getImageData(0, 0, sheet.width, sheet.height).data;
function alphaAt(frame, x, y) {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return 0;
  const [rx, ry] = META.rects[frame];
  return sheetData[((ry + y) * sheet.width + rx + x) * 4 + 3];
}

// her "chill" pose: a wider strip of baked frames (tools/capri_lounge.py)
const LG = META.lounge || null;
let lsheet = null, ldata = null;
if (LG) {
  try {
    const bytes = await api.readAsset(LG.file);
    lsheet = new Image();
    lsheet.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    await lsheet.decode();
    const c = document.createElement('canvas');
    c.width = lsheet.width; c.height = lsheet.height;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(lsheet, 0, 0);
    ldata = cx.getImageData(0, 0, lsheet.width, lsheet.height).data;
  } catch (e) { console.warn('lounge pose missing', e); lsheet = null; }
}
const [LW, LH] = LG ? LG.size : [0, 0];
const [LAX, LAY] = LG ? LG.anchor : [0, 0];
function lAlpha(name, x, y) {
  if (!ldata || x < 0 || y < 0 || x >= LW || y >= LH) return 0;
  const [rx, ry] = LG.rects[name];
  return ldata[((ry + y) * lsheet.width + rx + x) * 4 + 3];
}
const lEdges = [];
if (ldata) {
  const n0 = LG.loop[0];
  for (let y = 1; y < LH - 1; y++) for (let x = 1; x < LW - 1; x++) {
    if (lAlpha(n0, x, y) > 120 && (!lAlpha(n0, x - 1, y) || !lAlpha(n0, x + 1, y) || !lAlpha(n0, x, y - 1) || !lAlpha(n0, x, y + 1))) lEdges.push([x, y]);
  }
}

// outline pixels per body frame (for the crawling sparks)
const edgeCache = {};
function edgePixel(frame) {
  if (!edgeCache[frame]) {
    const list = [];
    for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
      if (alphaAt(frame, x, y) > 120 && (!alphaAt(frame, x - 1, y) || !alphaAt(frame, x + 1, y) || !alphaAt(frame, x, y - 1) || !alphaAt(frame, x, y + 1))) list.push([x, y]);
    }
    edgeCache[frame] = list;
  }
  const l = edgeCache[frame];
  return l.length ? l[(Math.random() * l.length) | 0] : null;
}

// the composed current frame (body + eyes + mouth) at native resolution
const fc = document.createElement('canvas');
fc.width = SW; fc.height = SH;
const fctx = fc.getContext('2d', { willReadFrequently: true });
fctx.imageSmoothingEnabled = false;

// ------------------------------------------------------------------ stage
const canvas = $('stage');
const ctx = canvas.getContext('2d');
let W = window.innerWidth, H = window.innerHeight, DPR = window.devicePixelRatio || 1;
let S = 6; // CSS px per sprite pixel (snapped so it is a whole number of device pixels)

function resize() {
  W = window.innerWidth; H = window.innerHeight; DPR = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  applyScale();
}
function applyScale() {
  const dev = Math.max(2, Math.round(clamp(cfg.scale || 6, 2, 14) * DPR));
  S = dev / DPR;
  fx.S = S;
  clampPos();
}
const snapD = (v) => Math.round(v * DPR) / DPR;

const fx = new FX();
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ state
const st = {
  pos: { x: 0, y: 0 }, // feet anchor; y measured up from the bottom of the screen
  visible: false,
  mode: 'intro', // intro | idle | walking | dragging | listening | thinking | speaking | teleport
  flip: 1, // 1 = facing right, -1 = mirrored
  t: 0,
  walk: null, // { target, speed, dash, phase, ghostT }
  action: null, // { name, t, dur }
  emotion: 'neutral',
  emotionUntil: 0,
  blinkT: -1, nextBlink: 2,
  lookDx: 0, lookUntil: 0, lookOverride: null,
  cursor: { x: 0, y: 0 },
  mouth: 0,
  sx: 1, sy: 1, vsx: 0, vsy: 0, // squash & stretch spring
  rot: 0, hop: 0, hopV: 0,
  whiten: 0, glitchT: 0, shake: 0,
  drag: null,
  pokes: [],
  lastInteraction: performance.now(),
  arcT: 0, ringT: 0,
  levitate: 1,
  red: 0, // 0..1: her red electric moving form
  chill: null, // lounging in mid-air: { until, peekUntil, nextPeek, zzT, slashT }
  slashes: [], // zigzag pink sparks around her while she chills
};
resize();
st.pos.x = cfg.posX == null ? W - 30 * S - 40 : cfg.posX;
st.pos.y = cfg.posY || 0;
clampPos();

function clampPos() {
  const half = (SW / 2) * S;
  st.pos.x = clamp(st.pos.x, half * 0.6, W - half * 0.6);
  st.pos.y = clamp(st.pos.y, 0, Math.max(0, H - SH * S - HOVER * S - S * 4));
}

// ---------------------------------------------------------------- levitation
// She floats HOVER sprite pixels above the ground and bobs gently; st.levitate eases in/out (0..1).
function hoverY() {
  const bob = Math.sin(st.t * 2.1) * 1.6 + Math.sin(st.t * 0.9) * 0.5;
  return (HOVER + bob) * S * st.levitate;
}
function lift() { return st.hop + hoverY() + (st.duoLift || 0) * S; }
function ground() { return { x: st.pos.x, y: H - st.pos.y }; }

// sprite pixel → screen (CSS px), ignoring rotation
function toScreen(px, py) {
  return {
    x: st.pos.x + (px - AX) * S * st.flip * st.sx,
    y: H - st.pos.y - lift() + (py - AY) * S * st.sy,
  };
}
function frameMeta() { return META.frames[currentFrame] || META.frames.idle0; }
// lounge pixel → screen
function lToScreen(px, py) {
  return { x: st.pos.x + (px - LAX) * S * st.flip, y: H - st.pos.y - lift() + (py - LAY) * S };
}
function headScreen() {
  if (st.chill) return lToScreen(LG.head[0], LG.head[1] - 8);
  const f = frameMeta(); return toScreen(f.head[0], f.head[1]);
}
function orbScreen() {
  if (st.chill) return lToScreen(LG.core[0], LG.core[1]);
  const f = frameMeta(); return f.orb ? toScreen(f.orb[0], f.orb[1]) : headScreen();
}

// ------------------------------------------------------------------ tweens
const tweens = [];
function tween(obj, to, dur, ease = (t) => t) {
  return new Promise((resolve) => {
    const from = {};
    for (const k in to) from[k] = obj[k];
    tweens.push({ obj, from, to, dur, t: 0, ease, resolve });
  });
}
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;

// ------------------------------------------------------------------ expressions
const EMOTES = { happy: 'note', angry: 'anger', surprised: '!', sad: null, relaxed: null, neutral: null };
function setEmotion(name, seconds = 4, withEmote = true) {
  st.emotion = ['happy', 'sad', 'angry', 'surprised', 'relaxed'].includes(name) ? name : 'neutral';
  st.emotionUntil = performance.now() + seconds * 1000;
  if (withEmote && EMOTES[st.emotion]) fx.showEmote(EMOTES[st.emotion], 1.6);
  if (st.emotion === 'surprised') hop(0.8);
  if (st.emotion === 'angry') { st.shake = 0.5; manyEyes(2.5); }
}
function eyeVariant() {
  if (performance.now() < (st.winkUntil || 0) && META.rects.eyes_wink) return 'wink';
  if (st.blinkT >= 0) return 'blink';
  if (st.mode === 'thinking') return 'relaxed';
  if (st.mode === 'dragging') return st.drag && Math.abs(st.drag.vx) > 900 ? 'surprised' : 'neutral';
  if (st.mode === 'listening') return 'neutral';
  return st.emotion === 'neutral' ? 'neutral' : st.emotion;
}

// ------------------------------------------------------------------ animation helpers
// mostly pink, sometimes violet like her rim, rarely green like her mask
function boltHue() { const r = Math.random(); return r < 0.8 ? 'pink' : r < 0.95 ? 'violet' : 'green'; }

// open all her extra eyes for a while
function manyEyes(seconds = 2) {
  const now = performance.now();
  if (now >= (st.manyUntil || 0)) { st.manyStart = now; sfx.glitch(); st.glitchT = Math.max(st.glitchT, 0.08); }
  st.manyUntil = Math.max(st.manyUntil || 0, now + seconds * 1000);
}

function hop(k = 1) { if (st.hop < 1) st.hopV = 520 * k * (S / 6); }
function squash(sx, sy) { st.sx = sx; st.sy = sy; }
function play(name, dur) { st.action = { name, t: 0, dur }; }

function framePixels(step = 1, boost = 1) {
  // opaque pixels of the composed frame, in screen space (for shatter / converge)
  const d = fctx.getImageData(0, 0, SW, SH).data;
  const out = [];
  for (let y = 0; y < SH; y += step) {
    for (let x = 0; x < SW; x += step) {
      const i = (y * SW + x) * 4;
      if (d[i + 3] > 200) {
        const p = toScreen(x, y);
        const r = Math.min(255, d[i] * boost + 20 * (boost - 1)), gg = Math.min(255, d[i + 1] * boost), bb = Math.min(255, d[i + 2] * boost + 40 * (boost - 1));
        out.push({ x: p.x, y: p.y, c: `rgb(${r | 0},${gg | 0},${bb | 0})` });
      }
    }
  }
  return out;
}

function feet() { return { x: st.pos.x, y: H - st.pos.y - lift() }; }

// ------------------------------------------------------------------ big moves
async function teleportOut() {
  if (!st.visible) return;
  const prev = st.mode;
  st.mode = 'teleport';
  st.walk = null;
  st.glitchT = 0.2;
  sfx.glitch();
  await sleep(180);
  await tween(st, { sx: 0.08, sy: 1.25, whiten: 1 }, 0.16, easeIn);
  // shatter using the real colours (spread at full width) so the pixels fly off pink
  const keep = { sx: st.sx, sy: st.sy, whiten: st.whiten };
  st.sx = 1; st.sy = 1; st.whiten = 0.25;
  compose();
  fx.shatter(framePixels(1, 2.2), { up: 220 * (S / 6), spread: 150 * (S / 6) });
  Object.assign(st, keep);
  const h = headScreen();
  fx.bolt(h.x, h.y, h.x + rand(-40, 40), -20, { life: 0.3, width: 1.3, branches: 2 });
  fx.doFlash(0.35);
  sfx.zap(1.2);
  st.visible = false;
  st.sx = 1; st.sy = 1; st.whiten = 0;
  await sleep(260);
  if (st.mode === 'teleport') st.mode = prev === 'teleport' ? 'idle' : 'idle';
}

async function teleportIn(x = st.pos.x, { dramatic = false } = {}) {
  st.mode = 'teleport';
  st.pos.x = x;
  clampPos();
  const f0 = ground();
  if (dramatic) {
    for (let i = 0; i < 2; i++) {
      const fxX = f0.x + rand(-260, 260);
      fx.bolt(fxX + rand(-60, 60), -10, fxX, f0.y - rand(0, 120), { life: 0.16, branches: 2 });
      fx.doFlash(0.25);
      sfx.zap(0.7);
      await sleep(rand(160, 260));
    }
  }
  // pixels gather first…
  st.sx = 1; st.sy = 1; st.whiten = 0;
  compose();
  fx.converge(framePixels(1, 2.2), { from: 160 * (S / 6), life: 0.3 });
  sfx.crackle(0.3, 40);
  await sleep(300);
  // …then the strike
  fx.bolt(f0.x + rand(-80, 80), -20, f0.x, f0.y - S * 4, { life: 0.28, width: 1.6, branches: 3 });
  fx.doFlash(dramatic ? 0.9 : 0.55);
  fx.ring(f0.x, f0.y, { r0: S * 2, r1: S * 26, life: 0.5 });
  fx.burst(f0.x, f0.y - S * 2, 26, { speed: 320 * (S / 6), up: 120, life: 0.7 });
  sfx.thunder();
  st.visible = true;
  st.sx = 0.08; st.sy = 1.3; st.whiten = 1;
  await tween(st, { sx: 1, sy: 1, whiten: 0 }, 0.2, easeOut);
  st.glitchT = 0.12;
  squash(1.15, 0.85);
  st.mode = 'idle';
}

async function teleportTo(x) {
  await teleportOut();
  await sleep(rand(150, 400));
  await teleportIn(x);
  savePos();
}

function startWalk(target, dash = false, boost = 1) {
  if (st.mode !== 'idle') return;
  const half = (SW / 2) * S;
  target = clamp(target, half, W - half);
  if (Math.abs(target - st.pos.x) < S * 6) return;
  st.walk = { target, dash, phase: 0, ghostT: 0, stepT: 0, boost };
  st.flip = target > st.pos.x ? 1 : -1;
  st.mode = 'walking';
  if (dash) { sfx.zap(0.6); st.glitchT = 0.08; }
}

function charge(dur = 1.5) {
  if (!['idle', 'speaking'].includes(st.mode)) return;
  play('charge', dur);
  manyEyes(dur + 0.3);
  sfx.powerUp(dur * 0.9);
}

function cast(towardX) {
  st.flip = towardX >= st.pos.x ? 1 : -1;
  play('cast', 1.1);
  setTimeout(() => {
    const o = orbScreen();
    const edge = st.flip > 0 ? W + 20 : -20;
    fx.bolt(o.x, o.y, edge, o.y + rand(-60, 60), { life: 0.35, width: 1.4, branches: 3 });
    fx.doFlash(0.2);
    sfx.zap(1.1);
  }, 160);
}

// ------------------------------------------------------------------ Call D: her companion (pure decoration)
// D stands on the ground next to Capri. She drifts around him, looms behind him while talking, sometimes
// stands back to back or perches on his head, and when she moves she becomes pink electricity coiling around him.
const DUO = META.duo || null;
let dsheet = null, ddata = null;
if (DUO) {
  try {
    const bytes = await api.readAsset(DUO.file);
    dsheet = new Image();
    dsheet.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    await dsheet.decode();
    const c = document.createElement('canvas');
    c.width = dsheet.width; c.height = dsheet.height;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(dsheet, 0, 0);
    ddata = cx.getImageData(0, 0, dsheet.width, dsheet.height).data;
  } catch (e) { console.warn('D sprite missing', e); dsheet = null; }
}
const [DW, DH] = DUO ? DUO.size : [0, 0];
const [DAX, DAY] = DUO ? DUO.anchor : [0, 0];
function dAlpha(name, x, y) {
  if (!ddata || x < 0 || y < 0 || x >= DW || y >= DH) return 0;
  const [rx, ry] = DUO.rects[name];
  return ddata[((ry + y) * dsheet.width + rx + x) * 4 + 3];
}
const dPixCache = {};
function dPixels(name) {   // [all opaque pixels, outline pixels]
  if (!dPixCache[name]) {
    const all = [], edge = [];
    for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
      if (dAlpha(name, x, y) < 120) continue;
      all.push([x, y]);
      if (!dAlpha(name, x - 1, y) || !dAlpha(name, x + 1, y) || !dAlpha(name, x, y - 1)) edge.push([x, y]);
    }
    dPixCache[name] = [all, edge];
  }
  return dPixCache[name];
}
const dTintCache = {};
function dTinted(name, color) {
  const key = name + color;
  if (!dTintCache[key]) {
    const c = document.createElement('canvas');
    c.width = DW; c.height = DH;
    const g = c.getContext('2d');
    const [rx, ry] = DUO.rects[name];
    g.drawImage(dsheet, rx, ry, DW, DH, 0, 0, DW, DH);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, DW, DH);
    dTintCache[key] = c;
  }
  return dTintCache[key];
}

const duo = {
  on: false, shown: false, x: 0, phase: 0, pose: 'orbit', poseUntil: 0, nextPose: 25,
  cdx: 26, clift: 10, behind: false, frame: 'normal', arrive: 0, leave: 0, glitch: 0, coil: 0,
  emoteUntil: 0, blinkT: -1, nextBlink: 3, pokeUntil: 0, boltT: 0, sparkT: 0, wasTeleport: false,
  coilUntil: 0, chargeUntil: 0,
};
// duo moves from the Actions menu
function duoAction(name) {
  if (!duoShown() || duo.arrive > 0.2 || duo.leave > 0) return false;
  const now = performance.now();
  if (st.chill && name !== 'chill') endChill();
  if (['loom', 'b2b', 'perch'].includes(name)) {
    duo.pose = name; duo.poseUntil = now + rand(9, 12) * 1000;
    if (name === 'perch') duo.emoteUntil = now + 1400;
    sfx.zap(0.35);
    return true;
  }
  if (name === 'coil') {           // she turns red and becomes electricity winding around him, then bursts out
    const c = toScreen(AX, CORE_Y);
    fx.ring(c.x, c.y, { r0: S * 4, r1: S * 24, life: 0.3, color: '#FF1A3C' });
    fx.burst(c.x, c.y, 16, { speed: 260, life: 0.35, gravity: 0, color: '#FF1A3C' });
    st.glitchT = Math.max(st.glitchT, 0.1);
    sfx.zap(0.8); sfx.crackle(0.5, 40);
    duo.coilUntil = now + 2800;
    return true;
  }
  if (name === 'duo_charge') {     // both power up: his hair shoots up, lightning runs between them
    duo.chargeUntil = now + 1700;
    duo.pose = 'loom'; duo.poseUntil = now + 2200;
    charge(1.6);
    return true;
  }
  return false;
}
st.duo = duo;
st.duoLift = 0;
const dGround = () => H - st.pos.y;
function dScreen(px, py) { return { x: duo.x + (px - DAX) * S, y: dGround() + (py - DAY) * S }; }
const duoShown = () => duo.shown && st.visible;
const duoCoil = () => duoShown() && duo.coil > 0.5;

async function callD(quiet = false) {
  if (!dsheet || duo.on) return;
  duo.on = true;
  await ensureVisible();
  const side = st.pos.x > W / 2 ? -1 : 1;           // D appears on the roomier side
  duo.x = clamp(st.pos.x + side * 26 * S, 24 * S, W - 24 * S);
  duo.phase = side > 0 ? Math.PI : 0;              // so Capri starts on his other side
  duo.cdx = side > 0 ? -26 : 26; duo.clift = 10;
  duo.pose = 'orbit'; duo.nextPose = rand(20, 35);
  if (!quiet) { play('cast', 0.9); setEmotion('happy', 3, false); }
  const g = dGround();
  fx.bolt(duo.x, -20, duo.x, g - S * 2, { life: 0.35, width: 2, branches: 3 });
  fx.ring(duo.x, g, { r0: S * 3, r1: S * 22, life: 0.4 });
  fx.doFlash(0.25);
  sfx.zap(1.1);
  duo.shown = true; duo.arrive = 1; duo.leave = 0;
}
function uncallD() {
  if (!duo.on) return;
  duo.on = false;
  if (!duoShown()) { duo.shown = false; return; }
  duo.leave = 1;
  st.winkUntil = performance.now() + 1200;
  setEmotion('happy', 2.5, false);
  sfx.crackle(0.4, 40);
}
const D_POKE_LINES = ['Hey! Hands off my D.', 'He does not talk much, but he is cool.', 'Careful, he bites. Kidding! Mostly.', 'D says hi. Probably.', 'Poke him again and he gets my voltage.'];
function pokeD() {
  const now = performance.now();
  st.lastInteraction = now;
  duo.pokeUntil = now + 1600; duo.emoteUntil = now + 1500;
  const h = dScreen(DAX, DUO.head[1]);
  fx.burst(h.x, h.y, 10, { speed: 180, up: 50, life: 0.4 });
  sfx.zap(0.4);
  if (['listening', 'thinking', 'speaking', 'teleport'].includes(st.mode)) return;
  if (st.chill) endChill();
  speak(pick(D_POKE_LINES), 'happy', { quick: true });
}
function overD(x, y) {
  if (!duoShown() || duo.arrive > 0.45 || duo.leave > 0) return false;
  const sx = Math.floor((x - duo.x) / S + DAX), sy = Math.floor((y - dGround()) / S + DAY);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dAlpha(duo.frame, sx + dx, sy + dy) > 120) return true;
  return false;
}

function updateDuo(dt, now) {
  if (!duo.shown) { st.duoLift = lerp(st.duoLift, 0, Math.min(1, dt * 6)); return; }
  duo.arrive = Math.max(0, duo.arrive - dt / 0.9);
  duo.glitch = Math.max(0, duo.glitch - dt);
  if (duo.leave > 0) {
    duo.leave -= dt / 1.0;
    // pink pixels flying up off the line where he dissolves
    const cut = Math.floor((1 - Math.max(0, duo.leave)) * DH);
    const [all] = dPixels(duo.frame);
    for (let i = 0; i < 6; i++) {
      const p = pick(all);
      if (p && Math.abs(p[1] - cut) < 4) { const s = dScreen(p[0], p[1]); fx.spark(s.x, s.y); }
    }
    if (duo.leave <= 0) { duo.shown = false; duo.leave = 0; }
  }
  // blink
  duo.nextBlink -= dt;
  if (duo.nextBlink <= 0 && duo.blinkT < 0) { duo.blinkT = 0; duo.nextBlink = rand(2.5, 6); }
  if (duo.blinkT >= 0) { duo.blinkT += dt; if (duo.blinkT > 0.14) duo.blinkT = -1; }

  const moving = (st.mode === 'walking' && st.walk) || (st.mode === 'dragging' && st.drag && st.drag.moved);
  // moving: Capri becomes pink electricity coiling around D, and he travels with her
  const coilWas = duo.coil > 0.5;
  const forced = now < duo.coilUntil && st.mode === 'idle';
  const wantCoil = moving || forced;
  duo.redIn = wantCoil ? (duo.redIn || 0) + dt : 0;    // seconds she has been in red form with D
  const RED_SHOW = 0.5;                                 // she stays visibly red this long, then becomes electricity
  duo.coil += ((wantCoil && duo.redIn > RED_SHOW ? 1 : 0) - duo.coil) * Math.min(1, dt * (wantCoil ? 10 : 6));
  if (wantCoil && duo.redIn > 0.08 && duo.redIn < RED_SHOW + 0.2) {
    // red lightning streaming out of her into D's body
    if (Math.random() < dt * 30) {
      const c = toScreen(AX, CORE_Y + rand(-16, 10)), e = pick(dPixels(duo.frame)[1]);
      if (e) { const t = dScreen(e[0], e[1]); fx.bolt(c.x, c.y, t.x, t.y, { hue: 'red', life: rand(0.06, 0.12), branches: 0, rejitter: true }); }
    }
  }
  if ((duo.coil > 0.05 || (moving && duo.redIn > 0.15)) && !forced) duo.x = lerp(duo.x, st.pos.x, Math.min(1, dt * (st.mode === 'dragging' ? 14 : 8)));
  if (coilWas && duo.coil <= 0.5) {   // she bursts back out of him
    const c = dScreen(DAX, DH - 40);
    fx.burst(c.x, c.y, 22, { speed: 260, up: 60, life: 0.45, color: '#FF5C9A' });
    fx.ring(c.x, c.y, { r0: S * 3, r1: S * 20, life: 0.35, color: '#FF8FB6' });
    sfx.zap(0.6);
  }
  if (st.mode === 'teleport') duo.wasTeleport = true;
  else if (duo.wasTeleport) {         // she teleported: D zips over with a glitch
    duo.wasTeleport = false;
    duo.x = clamp(st.pos.x - duo.cdx * S, 24 * S, W - 24 * S);
    duo.glitch = 0.35; sfx.glitch();
  }

  // where Capri floats relative to him
  const calm = ['idle', 'listening', 'thinking', 'speaking'].includes(st.mode) && !st.drag && !st.walk && duo.coil < 0.5 && !forced && duo.leave <= 0;
  let tdx = duo.cdx, tlift = 0, behind = duo.behind;
  if (calm) {
    if (duo.pose !== 'orbit' && now > duo.poseUntil) { duo.pose = 'orbit'; duo.nextPose = rand(22, 40); }
    if (duo.pose === 'orbit' && !st.chill && st.mode === 'idle') {
      duo.nextPose -= dt;
      if (duo.nextPose <= 0) {
        duo.pose = Math.random() < 0.5 ? 'b2b' : 'perch';
        duo.poseUntil = now + rand(8, 12) * 1000;
        if (duo.pose === 'perch') { duo.emoteUntil = now + 1400; }
      }
    }
    const mode = st.mode === 'speaking' || st.mode === 'thinking' ? 'loom' : st.chill ? 'chill' : duo.pose;
    if (mode === 'loom') { tdx = 16; tlift = 30; behind = true; }
    else if (mode === 'chill') { tdx = 4; tlift = 46; behind = false; }
    else if (mode === 'b2b') { tdx = 17; tlift = 4; behind = true; }
    else if (mode === 'perch') { tdx = 0; tlift = 50; behind = false; }
    else {                              // orbit: right, up behind his head, left, passing in front
      duo.phase += dt * (Math.PI * 2) / 18;
      const s = Math.sin(duo.phase);
      tdx = 26 * Math.cos(duo.phase);
      tlift = 8 + 30 * Math.max(0, s);
      behind = s > 0.2;
    }
    duo.mode = mode;
    duo.cdx = lerp(duo.cdx, tdx, Math.min(1, dt * 2.5));
    duo.clift = lerp(duo.clift, tlift, Math.min(1, dt * 2.5));
    // only flip draw order where they don't overlap much
    if (behind !== duo.behind && (Math.abs(duo.cdx) > 14 || duo.clift > 22 || mode !== 'orbit')) duo.behind = behind;
    st.pos.x = lerp(st.pos.x, clamp(duo.x + duo.cdx * S, 10 * S, W - 10 * S), Math.min(1, dt * 6));
    st.duoLift = duo.clift;
  } else {
    duo.mode = moving ? 'coil' : 'other';
    st.duoLift = lerp(st.duoLift, 0, Math.min(1, dt * 8));
  }
  duo.x = clamp(duo.x, 20 * S, W - 20 * S);

  // his pose
  const sleepy = duo.mode === 'chill';
  const charging = now < duo.chargeUntil;
  const spiked = duo.coil > 0.3 || duo.mode === 'loom' || duo.mode === 'b2b' || charging;
  let f = spiked ? 'spiked' : 'normal';
  if (duo.mode === 'b2b') f = 'folded';
  if (duo.mode === 'perch' || now < duo.pokeUntil) f = 'lookup';
  if ((duo.blinkT >= 0 || sleepy) && (f === 'normal' || f === 'spiked')) f = f === 'spiked' ? 'spiked_blink' : 'blink';
  duo.frame = f;

  // her electricity all over him
  duo.sparkT -= dt;
  if (duo.sparkT <= 0 && duo.arrive < 0.2 && duo.leave <= 0) {
    duo.sparkT = duo.coil > 0.3 ? 0.02 : duo.mode === 'loom' ? 0.05 : 0.14;
    const e = pick(dPixels(f)[1]);
    if (e) { const s = dScreen(e[0] + 0.5, e[1] + 0.5); fx.spark(s.x, s.y); }
  }
  duo.boltT -= dt;
  if (duo.boltT <= 0 && duo.arrive < 0.2 && duo.leave <= 0 && duo.coil < 0.3) {
    if (charging) {                    // powering up together: lightning between them and up through his hair
      duo.boltT = rand(0.04, 0.09);
      const a = dScreen(rand(6, DW - 6), rand(4, 30)), c = toScreen(AX, CORE_Y);
      fx.bolt(a.x, a.y, c.x + rand(-S * 8, S * 8), c.y + rand(-S * 8, S * 8), { life: rand(0.06, 0.12), rejitter: true, branches: 1 });
      const top = dScreen(DAX + rand(-10, 10), 2);
      fx.bolt(top.x, top.y, top.x + rand(-S * 10, S * 10), top.y - rand(S * 6, S * 18), { life: 0.08, rejitter: false });
      if (duo.chargeUntil - now < 120) {
        const g = dScreen(DAX, DH - 30);
        fx.ring(g.x, g.y, { r0: S * 4, r1: S * 34, life: 0.45 });
        fx.burst(g.x, g.y, 18, { speed: 260, up: 60 });
        duo.chargeUntil = 0;
      }
    } else if (duo.mode === 'loom') {        // a bolt links his raised hand to hers
      duo.boltT = rand(0.08, 0.16);
      const a = dScreen(...DUO.hand);
      const hands = frameMeta().hands;
      if (hands) { const b2 = toScreen(...hands[1]); fx.bolt(a.x, a.y, b2.x, b2.y, { life: rand(0.08, 0.14), rejitter: true, branches: 1 }); }
    } else if (duo.mode === 'b2b') {  // arcs where their backs meet
      duo.boltT = rand(0.18, 0.4);
      const a = dScreen(DW - 6, rand(DH - 50, DH - 20)), c = toScreen(AX - 18, CORE_Y + rand(-14, 6));
      fx.arc(a.x, a.y, c.x, c.y, { hue: 'pink', life: 0.12 });
    } else duo.boltT = 0.5;
  }
}

function drawCoil(front) {
  const g = dGround();
  const top = g - (DH - 6) * S, bot = g - 2 * S, rx = 22 * S;
  const turns = 4.2, n = 72, ph = st.t * 9;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = ph + t * turns * Math.PI * 2;
    pts.push([duo.x + Math.cos(a) * rx * (0.85 + 0.15 * Math.sin(t * 9 + st.t * 3)) + rand(-2.4, 2.4) * S * 0.5,
      bot - (bot - top) * t + Math.sin(a) * 4 * S + rand(-1, 1) * S * 0.5, Math.sin(a) > 0]);
  }
  ctx.globalAlpha = Math.min(1, duo.coil * 1.4);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const [x1, y1, f1] = pts[i], [x2, y2] = pts[i + 1];
    if (f1 !== front) continue;
    if (front) { ctx.strokeStyle = '#2A0614'; ctx.lineWidth = S * 2.4; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    ctx.strokeStyle = front ? '#FF1E68' : '#9C1048'; ctx.lineWidth = S * 1.3;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (front && i % 3 === 0) { ctx.strokeStyle = '#FFE8F2'; ctx.lineWidth = Math.max(1, S * 0.5); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}

function drawD() {
  if (!duoShown()) return;
  const name = duo.frame;
  const [rx, ry] = DUO.rects[name];
  const gx = snapD(duo.x - DAX * S), gy = snapD(dGround() - DAY * S);
  if (duo.coil > 0.05) drawCoil(false);
  if (duo.arrive > 0.45) {
    // his pixels gathering out of the sparks
    const k = (duo.arrive - 0.45) / 0.55;           // 1 → 0
    const [all] = dPixels('normal');
    ctx.fillStyle = '#FF1E68';
    for (const [x, y] of all) {
      if (Math.random() > 0.55 - k * 0.3) continue;
      ctx.fillStyle = Math.random() < 0.15 ? '#FFE8F2' : '#FF1E68';
      ctx.fillRect(gx + (x + rand(-2, 2) * k) * S, gy + (y - rand(0, 14) * k) * S, S, S);
    }
  } else if (duo.arrive > 0.15 || duo.glitch > 0) {
    // a split-second red / cyan glitch as he becomes solid
    ctx.globalAlpha = 0.6;
    ctx.drawImage(dTinted(name, '#FF2846'), gx - 2 * S, gy, DW * S, DH * S);
    ctx.drawImage(dTinted(name, '#3CDCFF'), gx + 2 * S, gy, DW * S, DH * S);
    ctx.globalAlpha = 1;
    ctx.drawImage(dsheet, rx, ry, DW, DH, gx, gy, DW * S, DH * S);
  } else if (duo.leave > 0) {
    // dissolving from the head down
    const cut = Math.floor((1 - duo.leave) * DH);
    if (cut < DH) ctx.drawImage(dsheet, rx, ry + cut, DW, DH - cut, gx, gy + cut * S, DW * S, (DH - cut) * S);
  } else {
    ctx.drawImage(dsheet, rx, ry, DW, DH, gx, gy, DW * S, DH * S);
  }
  if (duo.coil > 0.05) drawCoil(true);
  if (performance.now() < duo.emoteUntil) {   // "!" over his head
    const h = dScreen(DAX + 12, DUO.head[1] - 6);
    const x = snapD(h.x), y = snapD(h.y);
    ctx.fillStyle = '#140C1E'; ctx.fillRect(x - 5 * S, y - 8 * S, 10 * S, 12 * S);
    ctx.strokeStyle = '#FF1E68'; ctx.lineWidth = S; ctx.strokeRect(x - 5 * S, y - 8 * S, 10 * S, 12 * S);
    ctx.fillStyle = '#FFF0F6'; ctx.fillRect(x - S, y - 6 * S, 2 * S, 5 * S); ctx.fillRect(x - S, y + 0.5 * S, 2 * S, 2 * S);
  }
}

// ------------------------------------------------------------------ chill: lounging in mid-air
function startChill(seconds = rand(30, 75)) {
  if (!lsheet || st.chill || !st.visible || st.mode !== 'idle' || st.action || st.drag) return false;
  st.chill = { until: performance.now() + seconds * 1000, peekUntil: 0, nextPeek: rand(7, 14), zzT: 1.2, slashT: 0.1, near: false };
  const c = orbScreen();
  fx.burst(c.x, c.y, 16, { speed: 160, up: 40, life: 0.45, gravity: 0 });
  squash(1.08, 0.92);
  sfx.crackle(0.3, 30);
  return true;
}
function endChill() {
  if (!st.chill) return;
  const c = orbScreen();
  st.chill = null;
  st.slashes = [];
  fx.burst(c.x, c.y, 12, { speed: 200, up: 60, life: 0.4 });
  squash(0.9, 1.1);
  sfx.zap(0.35);
}
// a sharp zigzag slash (thick to thin, snapping back at hard angles), in lounge pixels
function newSlash() {
  const e = pick(lEdges);
  if (!e) return;
  const cx = LW / 2, cy = LH / 2;
  let ang = Math.atan2(e[1] - cy, e[0] - cx) + rand(-0.5, 0.5);
  const side = Math.random() < 0.5 ? -1 : 1;
  const pts = [[e[0], e[1]]];
  let x = e[0], y = e[1];
  const n = Math.random() < 0.5 ? 3 : 4;
  for (let k = 0; k < n; k++) {
    const L = k === 0 ? rand(9, 14) : rand(7, 12);
    const a = ang + (k === 0 ? 0 : k % 2 ? side * rand(1.9, 2.5) : -side * rand(0.3, 0.7));
    x += Math.cos(a) * L; y += Math.sin(a) * L;
    pts.push([x, y]);
    ang += rand(-0.25, 0.25);
  }
  const kink = 1 + ((Math.random() * (pts.length - 2)) | 0);
  st.slashes.push({ pts, life: 0.33, max: 0.33, front: Math.random() < 0.55, branch: { at: kink, a: rand(0, Math.PI * 2) }, dot: Math.random() < 0.6 ? rand(2, 4) : 0 });
}
function drawSlashes(front) {
  for (const sl of st.slashes) {
    if (sl.front !== front) continue;
    const fresh = sl.max - sl.life < 0.06;
    const P = sl.pts.map(([x, y], i) => {
      const j = i ? 0.6 : 0;
      const p = lToScreen(x + rand(-j, j), y + rand(-j, j));
      return [snapD(p.x), snapD(p.y)];
    });
    const taper = (w0, w1, color) => {
      const L = [], R = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[Math.min(i + 1, P.length - 1)], b = P[Math.max(i - 1, 0)];
        const dx = a[0] - b[0], dy = a[1] - b[1], len = Math.hypot(dx, dy) || 1;
        const w = ((w0 + (w1 - w0) * i / (P.length - 1)) * S) / 2;
        L.push([P[i][0] - (dy / len) * w, P[i][1] + (dx / len) * w]);
        R.push([P[i][0] + (dy / len) * w, P[i][1] - (dx / len) * w]);
      }
      ctx.beginPath();
      [...L, ...R.reverse()].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    };
    const w0 = fresh ? 4.6 : 3.8;
    ctx.globalAlpha = Math.min(1, sl.life / 0.12);
    taper(w0 + 1.6, 1.8, '#14061A');
    taper(w0, 0.8, '#FF1E68');
    ctx.strokeStyle = fresh ? '#FFE8F2' : '#FF96C4';
    ctx.lineWidth = Math.max(1, S * 0.9);
    ctx.beginPath(); ctx.moveTo(...P[0]); ctx.lineTo(...P[1]); if (P[2]) ctx.lineTo(...P[2]); ctx.stroke();
    const [bx, by] = P[sl.branch.at], ba = sl.branch.a;
    ctx.strokeStyle = '#FF1E68';
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(ba) * 4 * S, by + Math.sin(ba) * 4 * S);
    ctx.lineTo(bx + Math.cos(ba + 0.9) * 7 * S, by + Math.sin(ba + 0.9) * 7 * S); ctx.stroke();
    if (sl.dot) {
      const [ex, ey] = P[P.length - 1];
      ctx.fillStyle = '#FF1E68';
      ctx.beginPath(); ctx.arc(ex + sl.dot * S * st.flip, ey, S * 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
function updateChill(dt, now) {
  const c = st.chill;
  if (st.mode !== 'idle' || st.action || (st.drag && st.drag.moved) || now > c.until || !st.visible) { endChill(); return; }
  // peek with one eye when your cursor comes close, or now and then on her own
  const h = headScreen();
  const near = Math.hypot(st.cursor.x - h.x, st.cursor.y - h.y) < S * 34;
  if (near && !c.near) c.peekUntil = now + 1800;
  c.near = near;
  c.nextPeek -= dt;
  if (c.nextPeek <= 0) { c.nextPeek = rand(8, 16); c.peekUntil = now + 1600; }
  // z z while her eyes are closed
  c.zzT -= dt;
  if (c.zzT <= 0 && now > c.peekUntil) { c.zzT = rand(3.5, 5.5); fx.showEmote('zz', 2.4); }
  // zigzag sparks crackling around her
  c.slashT -= dt;
  if (c.slashT <= 0 && st.slashes.length < 4) { c.slashT = rand(0.08, 0.22); newSlash(); if (Math.random() < 0.25) sfx.crackle(0.06, 8); }
  for (const sl of st.slashes) sl.life -= dt;
  st.slashes = st.slashes.filter((sl) => sl.life > 0);
}
function chillFrame() {
  if (performance.now() < st.chill.peekUntil) return LG.peek[Math.floor(st.t * 2) % LG.peek.length];
  return LG.loop[Math.floor(st.t * 3.3) % LG.loop.length];
}

// ------------------------------------------------------------------ per frame
let currentFrame = 'idle0';
let last = performance.now();

function bodyFrame() {
  if (st.mode === 'dragging') {
    const d = st.drag;
    if (d && Math.abs(d.vx) > 150) return 'walk' + (Math.floor(st.t * 12) % 4);
    return Math.floor(st.t * 2) % 2 ? 'idle1' : 'idle0';
  }
  if (st.action && (st.action.name === 'charge' || st.action.name === 'cast')) return st.action.name;
  if (st.mode === 'walking' && st.walk) return 'walk' + (Math.floor(st.walk.phase) % 4);
  const rate = st.mode === 'speaking' ? 2.6 : 1.4;
  return Math.floor(st.t * rate) % 2 ? 'idle1' : 'idle0';
}

function mouthVariant() {
  if (st.mode === 'speaking' && st.mouth > 0.12) return st.mouth < 0.4 ? 'talk1' : st.mouth < 0.7 ? 'talk2' : 'talk3';
  if (st.action && st.action.name === 'charge') return 'happy';
  if (st.mode === 'dragging') return st.drag && Math.abs(st.drag.vx) > 900 ? 'surprised' : 'happy';
  if (st.mode === 'thinking' || st.mode === 'listening') return 'relaxed';
  return st.emotion;
}

// Her red electric form: the same silhouette turned into solid red energy, with her outline,
// ring eyes and mask kept as darker / lighter red lines so she still reads as Capri.
function redForm(k) {
  const img = fctx.getImageData(0, 0, SW, SH);
  const d = img.data;
  const flick = 0.92 + Math.random() * 0.08;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    let R2, G2, B2;
    if (r < 24 && g < 14 && b < 30) { R2 = 120; G2 = 0; B2 = 24; }            // outline
    else if (b > r + 40 && b > g) { R2 = 130; G2 = 0; B2 = 28; }              // ring eyes
    else if (g > r + 60) { R2 = 255; G2 = 70; B2 = 92; }                      // mask
    else if (lum > 0.8) { R2 = 255; G2 = 214; B2 = 220; }                     // highlights, grin
    else { R2 = 228 + 27 * lum; G2 = 12 + 44 * lum; B2 = 40 + 34 * lum; }     // body: solid red
    d[i] = r + (R2 * flick - r) * k;
    d[i + 1] = g + (G2 * flick - g) * k;
    d[i + 2] = b + (B2 * flick - b) * k;
  }
  fctx.putImageData(img, 0, 0);
}

function compose() {
  currentFrame = bodyFrame();
  const f = META.frames[currentFrame];
  const [rx, ry] = META.rects[currentFrame];
  fctx.clearRect(0, 0, SW, SH);
  fctx.globalAlpha = 1;
  fctx.drawImage(sheet, rx, ry, SW, SH, 0, 0, SW, SH);
  const charging = st.action && st.action.name === 'charge';
  const eyes = charging && st.blinkT < 0 ? 'glow' : eyeVariant();
  // many eyes: her green mask fills up with eyes (replaces the normal eyes while it lasts)
  const nowMs = performance.now();
  if (META.rects.eyes_many0 && nowMs < (st.manyUntil || 0)) {
    const age = nowMs - st.manyStart, left = st.manyUntil - nowMs;
    const shut = age < 90 || left < 110 || st.blinkT >= 0;
    const blinking = nowMs % 2600 < 160;
    const [qx, qy] = META.rects[shut ? 'eyes_many2' : blinking ? 'eyes_many1' : 'eyes_many0'];
    fctx.drawImage(sheet, qx, qy, SW, SH, 0, f.dy, SW, SH);
  } else {
    const [ex, ey] = META.rects['eyes_' + eyes];
    const dx = currentFrame === 'held' ? 0 : st.lookDx;
    fctx.drawImage(sheet, ex, ey, SW, SH, dx, f.dy, SW, SH);
  }
  const [mx, my] = META.rects['mouth_' + mouthVariant()] || META.rects.mouth_neutral;
  fctx.drawImage(sheet, mx, my, SW, SH, 0, f.dy, SW, SH);
  if (st.red > 0.02) redForm(st.red);
  if (st.whiten > 0.01) {
    fctx.globalCompositeOperation = 'source-atop';
    fctx.fillStyle = `rgba(255,228,240,${st.whiten})`;
    fctx.fillRect(0, 0, SW, SH);
    fctx.globalCompositeOperation = 'source-over';
  }
  if (st.emotion === 'sad' && st.mode !== 'teleport') {
    fctx.globalCompositeOperation = 'source-atop';
    fctx.fillStyle = 'rgba(10,8,30,0.18)';
    fctx.fillRect(0, 0, SW, SH);
    fctx.globalCompositeOperation = 'source-over';
  }
}

function update(dt) {
  const now = performance.now();
  st.t += dt;

  // tweens
  for (const tw of tweens) {
    tw.t += dt;
    const k = tw.ease(Math.min(1, tw.t / tw.dur));
    for (const key in tw.to) tw.obj[key] = lerp(tw.from[key], tw.to[key], k);
    if (tw.t >= tw.dur) tw.done = true;
  }
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].done) { tweens[i].resolve(); tweens.splice(i, 1); }

  if (now > st.emotionUntil && st.emotion !== 'neutral') st.emotion = 'neutral';

  // blink
  st.nextBlink -= dt;
  if (st.nextBlink <= 0 && st.blinkT < 0) { st.blinkT = 0; st.nextBlink = rand(2, 6); if (Math.random() < 0.2) st.nextBlink = 0.3; }
  if (st.blinkT >= 0) { st.blinkT += dt; if (st.blinkT > 0.12) st.blinkT = -1; }

  // eyes follow the cursor (one sprite pixel left/right)
  if (st.lookOverride && now < st.lookOverride.until) st.lookDx = st.lookOverride.dx;
  else {
    const h = headScreen();
    const d = (st.cursor.x - h.x) * st.flip;
    st.lookDx = Math.abs(d) > S * 14 ? Math.sign(d) : 0;
  }

  // squash & stretch spring
  const k = 220, damp = 14;
  st.vsx += (-(st.sx - 1) * k - st.vsx * damp) * dt;
  st.vsy += (-(st.sy - 1) * k - st.vsy * damp) * dt;
  if (!tweens.some((t) => 'sx' in t.to)) { st.sx += st.vsx * dt; st.sy += st.vsy * dt; }

  // hop
  if (st.hopV !== 0 || st.hop > 0) {
    st.hopV -= 2600 * (S / 6) * dt;
    st.hop = Math.max(0, st.hop + st.hopV * dt);
    if (st.hop === 0 && st.hopV < 0) { st.hopV = 0; squash(1.12, 0.88); }
  }

  st.glitchT = Math.max(0, st.glitchT - dt);
  st.shake = Math.max(0, st.shake - dt);

  // red electric form while she moves
  const dragging = st.mode === 'dragging' && st.drag;
  const coilOrder = st.duo && st.duo.shown && now < st.duo.coilUntil;
  const wantRed = (st.mode === 'walking' && st.walk) || dragging || coilOrder ? 1 : 0;
  if (wantRed && st.red < 0.05 && !st.redOn) {
    st.redOn = true;
    const c = toScreen(AX, CORE_Y);
    fx.ring(c.x, c.y, { r0: S * 4, r1: S * 26, life: 0.3, color: '#FF1A3C' });
    fx.burst(c.x, c.y, 14, { speed: 260, life: 0.35, gravity: 0, color: '#FF1A3C' });
    fx.doFlash(0.12, '255,40,64');
    st.glitchT = Math.max(st.glitchT, 0.08);
    sfx.zap(0.7);
  }
  if (!wantRed && st.redOn && st.red > 0.6) {
    st.redOn = false;
    const c = toScreen(AX, CORE_Y);
    fx.burst(c.x, c.y, 18, { speed: 220, life: 0.4, gravity: 0, color: '#FF6B7F' });
    st.glitchT = Math.max(st.glitchT, 0.06);
  }
  st.red += (wantRed - st.red) * Math.min(1, dt * (wantRed ? 16 : 7));
  if (st.red < 0.01) { st.red = 0; st.redOn = false; }

  if (dragging) {
    // calm down when the mouse stops; lean into the pull and face where she's going
    st.drag.vx *= Math.pow(0.02, dt);
    st.drag.vy = (st.drag.vy || 0) * Math.pow(0.02, dt);
    if (Math.abs(st.drag.vx) > 150) st.flip = st.drag.vx > 0 ? 1 : -1;
    st.rot = lerp(st.rot, clamp(st.drag.vx / 2600, -0.35, 0.35), 0.18);
  }
  const moveSpeed = dragging ? Math.hypot(st.drag.vx, st.drag.vy || 0) : 0;
  if (((st.mode === 'walking' && st.walk) || (dragging && moveSpeed > 120)) && st.red > 0.3) {
    const dir = dragging ? (Math.sign(st.drag.vx) || st.flip) : Math.sign(st.walk.target - st.pos.x) || st.flip;
    const fast = dragging ? moveSpeed > 900 : st.walk.dash;
    const top = toScreen(AX, TOP_Y).y, bot = feet().y;
    const back = st.pos.x - dir * S * 6;
    // speed streaks
    for (let i = 0; i < (fast ? 4 : 2); i++) {
      if (Math.random() > dt * (fast ? 60 : 26)) continue;
      const kind = pick(['white', 'white', 'dark', 'dark', 'red']);
      fx.speedLine(back - dir * rand(0, S * 10), rand(top, bot), rand(S * 14, S * (fast ? 60 : 34)), dir,
        { kind, life: rand(0.12, 0.26), thick: kind === 'red' ? 1 : pick([1, 1, 2]), drift: dir * S * 8 });
    }
    // jagged red lightning trailing behind her (opposite to the way she moves)
    st.redBoltT = (st.redBoltT || 0) - dt;
    if (st.redBoltT <= 0) {
      st.redBoltT = fast ? 0.05 : 0.11;
      const y0 = rand(top + S * 6, bot - S * 4);
      let ux = -dir, uy = 0;
      if (dragging) { const m = moveSpeed || 1; ux = -st.drag.vx / m; uy = (st.drag.vy || 0) / m; } // screen y is down
      const len = rand(S * 14, S * (fast ? 44 : 28));
      fx.bolt(st.pos.x + ux * S * 6, y0, st.pos.x + ux * (S * 6 + len), y0 + uy * len + rand(-S * 8, S * 8),
        { hue: 'red', life: rand(0.08, 0.16), branches: 1, rejitter: true, impact: false });
    }
    // red afterimages
    st.redGhostT = (st.redGhostT || 0) - dt;
    if (st.redGhostT <= 0) { st.redGhostT = fast ? 0.03 : 0.07; if (!duoCoil()) ghost('rgba(255,26,60,0.75)'); }
  }

  // walking / dashing
  if (st.mode === 'walking' && st.walk) {
    const w = st.walk;
    const speed = (w.dash ? 95 : 26) * S * (w.boost || 1);
    const dir = Math.sign(w.target - st.pos.x);
    st.pos.x += dir * speed * dt;
    w.phase += dt * (w.dash ? 16 : 7);
    w.stepT += dt;
    if (w.stepT > (w.dash ? 0.05 : 0.25)) {
      w.stepT = 0;
      const f = feet();
      fx.burst(f.x - dir * S * 6, f.y, w.dash ? 4 : 2, { speed: 50, up: -20, life: 0.4, gravity: 260 });
    }
    if (w.dash) {
      w.ghostT += dt;
      if (w.ghostT > 0.035 && st.red < 0.3) { w.ghostT = 0; ghost(); }
    }
    if ((dir > 0 && st.pos.x >= w.target) || (dir < 0 && st.pos.x <= w.target) || dir === 0) {
      st.pos.x = w.target;
      st.walk = null;
      st.mode = 'idle';
      if (w.dash) { squash(0.85, 1.12); fx.burst(feet().x, feet().y, 10, { speed: 180, up: 60 }); fx.ring(ground().x, ground().y, { r0: S * 2, r1: S * 16, life: 0.35 }); sfx.zap(0.4); }
      savePos();
    }
  }

  // action timers + their effects
  if (st.action) {
    const a = st.action;
    a.t += dt;
    if (a.name === 'charge') {
      const f = feet();
      fx.rise(f.x - S * 14, f.x + S * 14, f.y - rand(0, S * 30), 2);
      if (Math.random() < dt * 10) {
        const [h1, h2] = frameMeta().hands || [];
        if (h1 && h2) { const a = toScreen(...h1), b2 = toScreen(...h2); fx.arc(a.x, a.y, b2.x, b2.y, { hue: boltHue(), bulge: rand(0.2, 0.5), life: 0.1 }); }
      }
      if (Math.random() < dt * 14) {
        const o = orbScreen();
        fx.bolt(o.x, o.y, o.x + rand(-S * 24, S * 24), o.y + rand(-S * 30, S * 16), { life: 0.12, rejitter: false });
      }
      st.shake = 0.05;
    }
    if (a.t >= a.dur) {
      if (a.name === 'charge') {
        const f = feet();
        fx.ring(f.x, f.y - S * 20, { r0: S * 6, r1: S * 40, life: 0.5 });
        fx.burst(f.x, f.y - S * 28, 30, { speed: 300 * (S / 6), up: 80 });
        fx.doFlash(0.3);
        sfx.zap(1);
      }
      st.action = null;
    }
  }

  if (st.chill) updateChill(dt, now);
  updateDuo(dt, now);

  // ambient electricity: pink bolts keep jumping off her hair tips and hands
  st.arcT -= dt;
  if (st.visible && !st.orb && !st.chill && st.arcT <= 0 && st.mode !== 'teleport') {
    const moving = st.mode === 'walking' || st.mode === 'dragging';
    const intensity = st.emotion === 'angry' ? 3 : st.mode === 'speaking' ? 1.4 + st.mouth * 2 : st.emotion === 'sad' ? 0.4 : moving ? 2.2 : 1.2;
    st.arcT = rand(0.18, 0.8) / intensity;
    const f = frameMeta();
    const r = Math.random();
    const src = r < 0.55 && f.tips && f.tips.length ? pick(f.tips) : r < 0.8 && f.orb ? f.orb : f.claws || f.head;
    const hue = boltHue();
    if (Math.random() < 0.25 && f.hands && f.tips && f.tips.length) {
      // a curved arc jumping between her hand and a hair tip (or between her hands)
      const a = toScreen(...pick(f.hands));
      const b2 = toScreen(...(Math.random() < 0.5 ? pick(f.tips) : pick(f.hands)));
      if (Math.hypot(a.x - b2.x, a.y - b2.y) > S * 6) fx.arc(a.x, a.y, b2.x, b2.y, { hue, life: rand(0.08, 0.16) });
    } else if (src) {
      const p = toScreen(src[0], src[1]);
      const h = headScreen();
      // tips arc outward from the head, hands arc anywhere
      const out = src === f.orb || src === f.claws ? rand(0, Math.PI * 2) : Math.atan2(p.y - h.y, p.x - h.x) + rand(-0.6, 0.6);
      const len = rand(S * 4, S * 11) * (0.8 + intensity * 0.25);
      fx.bolt(p.x, p.y, p.x + Math.cos(out) * len, p.y + Math.sin(out) * len, { life: rand(0.07, 0.18), rejitter: Math.random() < 0.5, branches: Math.random() < 0.45 ? 1 : 0, hue });
    }
  }
  // levitation: sparkles rising from the ground, little bolts flicking from her toes to it
  if (st.visible && !st.orb && !st.hideSprite && st.mode !== 'teleport' && st.levitate > 0.5) {
    const g = ground();
    if (Math.random() < dt * 9) fx.rise(g.x - S * 8, g.x + S * 8, g.y - S * 3, 1);
    const toes = st.chill ? LG.toes : frameMeta().toes;
    if (toes && Math.random() < dt * 1.8) {
      const t = st.chill ? lToScreen(...pick(toes)) : toScreen(...pick(toes));
      fx.bolt(t.x, t.y, t.x + rand(-S * 4, S * 4), g.y - S * 3, { life: rand(0.05, 0.1), rejitter: false, branches: 0 });
    }
  }

  // tiny sparks crawling along her outline
  st.sparkT = (st.sparkT || 0) - dt;
  if (st.visible && !st.orb && !st.hideSprite && st.sparkT <= 0 && st.mode !== 'teleport') {
    st.sparkT = st.mode === 'walking' || st.mode === 'dragging' || st.mode === 'speaking' ? 0.04 : 0.09;
    const e = st.chill ? pick(lEdges) : edgePixel(currentFrame);
    if (e) {
      const p = st.chill ? lToScreen(e[0] + 0.5, e[1] + 0.5) : toScreen(e[0] + 0.5, e[1] + 0.5);
      fx.spark(p.x, p.y);
    }
  }

  // speaking: little pulses on loud syllables
  if (st.mode === 'speaking' && st.mouth > 0.65 && st.t - (st.lastPulse || 0) > 0.35) {
    st.lastPulse = st.t;
    const c = frameMeta().core;
    const p = toScreen(c[0], c[1]);
    fx.ring(p.x, p.y, { r0: S * 2, r1: S * 12, life: 0.3, color: '#FF5C9A' });
  }

  // listening rings
  if (st.mode === 'listening') {
    st.ringT -= dt;
    if (st.ringT <= 0) {
      st.ringT = 0.7;
      const h = headScreen();
      fx.ring(h.x, h.y, { r0: S * 6, r1: S * 26, life: 0.7, color: '#FF8FB6' });
    }
  }

  // electric orb form while she is being dragged
  if (st.orb) {
    const o = st.orb;
    o.t += dt;
    if (st.mode === 'dragging') {
      const nx = st.cursor.x, ny = st.cursor.y;
      o.vx = lerp(o.vx, (nx - o.x) / Math.max(dt, 0.001), 0.3);
      o.vy = lerp(o.vy, (ny - o.y) / Math.max(dt, 0.001), 0.3);
      o.x = nx; o.y = ny;
    }
    const speed = Math.hypot(o.vx, o.vy);
    // sparkling trail when she moves fast
    for (let i = 0; i < Math.min(6, speed / 250); i++) fx.spark(o.x + rand(-S * 4, S * 4), o.y + rand(-S * 4, S * 4));
    // bolts lashing out of the orb
    if (Math.random() < dt * (8 + speed / 300)) {
      const a2 = rand(0, Math.PI * 2), len = rand(S * 8, S * 18) * o.scale;
      fx.bolt(o.x, o.y, o.x + Math.cos(a2) * len, o.y + Math.sin(a2) * len, { life: rand(0.06, 0.12), rejitter: false, branches: Math.random() < 0.4 ? 1 : 0 });
    }
    if (Math.random() < dt * 3) sfx.crackle(0.12, 30);
  }
  if (st.mode !== 'dragging') st.rot = lerp(st.rot, 0, 0.2);

  fx.update(dt);
}

function ghost(tint) {
  compose();
  const left = st.flip > 0 ? st.pos.x - AX * S : st.pos.x - (SW - AX) * S;
  const top = H - st.pos.y - lift() - AY * S;
  fx.ghost(fc, left, top, SW * S, SH * S, st.flip < 0, tint ? { life: 0.28, tint } : { life: 0.32 });
}

// ------------------------------------------------------------------ electric orb (drag form)
const grid = (v) => Math.round(v / S) * S;
function pixelDisc(cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y += S) {
    const w = Math.sqrt(Math.max(0, r * r - y * y));
    const x0 = grid(cx - w), x1 = grid(cx + w);
    if (x1 > x0) ctx.fillRect(x0, grid(cy + y), x1 - x0, S);
  }
}
function drawOrb() {
  const o = st.orb;
  const pulse = 1 + Math.sin(st.t * 18) * 0.08 + (Math.random() - 0.5) * 0.08;
  const R = S * 11 * pulse * o.scale;
  if (R < S) return;
  ctx.globalAlpha = 0.22; pixelDisc(o.x, o.y, R + S * 4, '#FF2A6D');
  ctx.globalAlpha = 0.45; pixelDisc(o.x, o.y, R + S * 2, '#FF2A6D');
  ctx.globalAlpha = 1;
  pixelDisc(o.x, o.y, R, '#FF2A6D');
  pixelDisc(o.x, o.y, R * 0.72, '#FF8FB6');
  pixelDisc(o.x, o.y, R * 0.42, '#FFF2F8');
  // crackling rim
  ctx.fillStyle = '#FFD6E6';
  for (let i = 0; i < 12; i++) {
    const a = rand(0, Math.PI * 2), rr = R + rand(-S, S * 2);
    ctx.fillRect(grid(o.x + Math.cos(a) * rr), grid(o.y + Math.sin(a) * rr), S, S);
  }
  // orbiting sparks, one in her mask green
  for (let i = 0; i < 4; i++) {
    const a = st.t * 7 + (i * Math.PI) / 2;
    ctx.fillStyle = i === 0 ? '#2EFF8C' : '#FFF2F8';
    ctx.fillRect(grid(o.x + Math.cos(a) * (R + S * 5)), grid(o.y + Math.sin(a) * (R + S * 5) * 0.6), S, S);
  }
  // her ring eyes, peeking out of the plasma and looking where she's going
  if (o.scale > 0.7) {
    const lx = clamp(o.vx / 1200, -1, 1) * S, ly = clamp(o.vy / 1200, -1, 1) * S;
    const blink = Math.sin(st.t * 1.3) > 0.985;
    for (const sg of [-1, 1]) {
      const ex = grid(o.x + sg * S * 4 + lx), ey = grid(o.y - S * 2 + ly);
      ctx.fillStyle = '#1E112A';
      if (blink) { ctx.fillRect(ex - S * 2, ey, S * 4, S); continue; }
      ctx.fillRect(ex - S * 2, ey - S * 2, S * 4, S * 4);
      ctx.fillStyle = '#7ED6FF'; ctx.fillRect(ex - S, ey - S, S * 2, S * 2);
      ctx.fillStyle = '#1C60FF'; ctx.fillRect(ex - S, ey - S, S, S);
      ctx.fillStyle = '#F8F2FC'; ctx.fillRect(ex, ey, S, S);
    }
    // a little zigzag grin
    ctx.fillStyle = '#1E112A';
    for (let i = -2; i <= 2; i++) ctx.fillRect(grid(o.x + i * S + lx), grid(o.y + S * 2 + (i & 1 ? S : 0) + ly), S, S);
  }
}

function becomeOrb(x, y) {
  compose();
  fx.implode(framePixels(2, 1.8), x, y, 0.2);
  st.orb = { x, y, vx: 0, vy: 0, t: 0, scale: 0 };
  tween(st.orb, { scale: 1 }, 0.2, easeOut);
  fx.ring(x, y, { r0: S * 2, r1: S * 16, life: 0.3 });
  fx.doFlash(0.12);
  st.glitchT = 0.08;
  sfx.zap(0.8);
  sfx.crackle(0.3, 30);
}

async function dropRed(fast) {
  st.mode = 'idle';
  const g = ground(), c = toScreen(AX, CORE_Y);
  squash(fast ? 1.25 : 1.12, fast ? 0.75 : 0.88);
  fx.burst(c.x, c.y, fast ? 26 : 14, { speed: 260, life: 0.4, gravity: 0, color: '#FF1A3C' });
  if (fast) {
    fx.bolt(c.x, c.y, g.x + rand(-S * 4, S * 4), g.y - S * 3, { hue: 'red', life: 0.2, width: 1.3, branches: 2 });
    fx.ring(g.x, g.y - S * 3, { r0: S * 3, r1: S * 30, life: 0.45, color: '#FF1A3C' });
    fx.doFlash(0.25, '255,40,64');
    sfx.thunder();
  } else sfx.zap(0.5);
  setEmotion(fast ? 'surprised' : 'happy', 2, fast);
  savePos();
  if (Math.random() < 0.45) say(pick(DROP_LINES), { seconds: 2.6 });
}

async function dropOrb(fast) {
  const o = st.orb;
  if (!o) { st.mode = 'idle'; return; }
  st.mode = 'teleport';
  const f = ground();
  // the orb strikes down to where she lands, then her pixels pull back together
  fx.bolt(o.x, o.y, f.x, f.y - S, { life: 0.22, width: 1.4, branches: 2 });
  sfx.zap(fast ? 1.1 : 0.8);
  await tween(o, { scale: 0 }, 0.12, easeIn);
  st.orb = null;
  st.hideSprite = true;
  compose();
  fx.converge(framePixels(2, 2.2), { from: 90 * (S / 6), life: 0.2 });
  await sleep(180);
  st.hideSprite = false;
  st.whiten = 1;
  tween(st, { whiten: 0 }, 0.25, easeOut);
  squash(fast ? 1.3 : 1.2, fast ? 0.7 : 0.8);
  fx.ring(f.x, f.y, { r0: S * 3, r1: S * (fast ? 34 : 22), life: 0.45 });
  fx.burst(f.x, f.y - S * 2, fast ? 26 : 14, { speed: 240, up: 80 });
  fx.doFlash(fast ? 0.35 : 0.18);
  if (fast) sfx.thunder(); else sfx.zap(0.5);
  st.mode = 'idle';
  setEmotion(fast ? 'surprised' : 'happy', 2, fast);
  savePos();
  if (Math.random() < 0.45) say(pick(DROP_LINES), { seconds: 2.6 });
}

// the pink glow on the ground under her; it tightens and brightens as she dips down
function pixelEllipse(cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  for (let y = -ry; y <= ry; y += S) {
    const w = rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry)));
    const x0 = grid(cx - w), x1 = grid(cx + w);
    if (x1 > x0) ctx.fillRect(x0, grid(cy + y), x1 - x0, S);
  }
}
function drawHoverField() {
  const g = ground();
  const h = hoverY() / S; // 0 .. ~11 sprite pixels
  const near = clamp(1 - (h - HOVER + 2) / 4, 0, 1); // 1 when she is lowest
  const rx = S * (9 + near * 2), ry = S * 1.5;
  const a = (0.18 + near * 0.18) * st.levitate;
  ctx.globalAlpha = a;
  pixelEllipse(g.x, g.y - S * 3, rx + S * 3, ry + S, '#FF2A6D');
  ctx.globalAlpha = Math.min(1, a * 2.2);
  pixelEllipse(g.x, g.y - S * 3, rx * 0.6, ry, '#FF8FB6');
  ctx.globalAlpha = 1;
  // a flickering ring of sparks on the ground
  ctx.fillStyle = '#FFF2F8';
  for (let i = 0; i < 6; i++) {
    const an = st.t * 3 + (i * Math.PI) / 3;
    if (Math.random() < 0.35) continue;
    ctx.fillRect(grid(g.x + Math.cos(an) * (rx + S)), grid(g.y - S * 3 + Math.sin(an) * ry), S, S);
  }
}

function drawCapri() {
  if (duoCoil()) return;   // she is electricity coiling around D right now
  const fade = duoShown() && duo.coil > 0.02 ? 1 - duo.coil * 1.8 : 1;   // red Capri dissolving into the coil
  if (fade <= 0.03) return;
  ctx.globalAlpha = fade;
  drawCapriBody();
  ctx.globalAlpha = 1;
}
function drawCapriBody() {
  if (st.visible && !st.orb && !st.hideSprite && st.chill) {
    drawSlashes(false);
    const f = feet();
    const [rx, ry] = LG.rects[chillFrame()];
    ctx.save();
    ctx.translate(snapD(f.x), snapD(f.y));
    ctx.scale(st.flip * st.sx, st.sy);
    ctx.drawImage(lsheet, rx, ry, LW, LH, -LAX * S, -LAY * S, LW * S, LH * S);
    ctx.restore();
    drawSlashes(true);
  } else if (st.visible && !st.orb && !st.hideSprite) {
    compose();
    const f = feet();
    let ox = 0, oy = 0;
    if (st.shake > 0) { ox = Math.round(rand(-1, 1)) * S; oy = Math.round(rand(-1, 1)) * S * 0.5; }
    ctx.save();
    ctx.translate(snapD(f.x + ox), snapD(f.y + oy));
    if (Math.abs(st.rot) > 0.001) {
      // pivot around the raised hands while being dragged
      const pivotY = -(AY - CORE_Y) * S;
      ctx.translate(0, pivotY); ctx.rotate(st.rot); ctx.translate(0, -pivotY);
    }
    ctx.scale(st.flip * st.sx, st.sy);

    // soft glow behind the body while talking or charging
    const glowAmt = (st.mode === 'speaking' ? st.mouth * 0.5 : 0) + (st.action && st.action.name === 'charge' ? 0.5 : 0);
    if (glowAmt > 0.02) {
      const g = ctx.createRadialGradient(0, -SH * S * 0.45, 0, 0, -SH * S * 0.45, SH * S * 0.6);
      g.addColorStop(0, `rgba(255,42,109,${0.35 * glowAmt})`);
      g.addColorStop(1, 'rgba(255,42,109,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-SW * S, -SH * S * 1.1, SW * S * 2, SH * S * 1.2);
    }

    const x0 = -AX * S, y0 = -AY * S;
    if (st.glitchT > 0) {
      // horizontal slice glitch with chromatic fringes
      for (let y = 0; y < SH; y += 3) {
        const off = Math.random() < 0.45 ? Math.round(rand(-4, 4)) : 0;
        const h = Math.min(3, SH - y);
        if (off) {
          ctx.globalAlpha = 0.6;
          ctx.globalCompositeOperation = 'lighter';
          ctx.filter = 'none';
          ctx.drawImage(fc, 0, y, SW, h, x0 + (off - 1) * S, y0 + y * S, SW * S, h * S);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(fc, 0, y, SW, h, x0 + off * S, y0 + y * S, SW * S, h * S);
      }
    } else {
      ctx.drawImage(fc, x0, y0, SW * S, SH * S);
    }
    ctx.restore();
  }

}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;

  fx.drawBehind(ctx);

  if (st.visible && !st.orb && !st.hideSprite && st.levitate > 0.05 && !duoCoil()) drawHoverField();

  if (duoShown() && duo.behind) { drawCapri(); drawD(); }
  else { drawD(); drawCapri(); }

  if (st.orb) drawOrb();

  // thinking: orbiting sparks around the head
  if (st.visible && st.mode === 'thinking') {
    const h = headScreen();
    ctx.fillStyle = '#FFD6E6';
    for (let i = 0; i < 3; i++) {
      const a = st.t * 4 + (i * Math.PI * 2) / 3;
      ctx.fillRect(Math.round(h.x + Math.cos(a) * S * 12), Math.round(h.y + Math.sin(a) * S * 5), S, S);
    }
  }

  fx.drawFront(ctx, W, H, st.visible ? headScreen() : null);
  positionUi();
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ UI: bubble & typebox
const bubble = $('bubble');
const typebox = $('typebox');
let typeTimer = null;
let bubbleTimer = null;

function spriteTop() {
  if (st.chill) return lToScreen(LAX, 6).y;
  const f = frameMeta();
  return toScreen(AX, f.bbox ? f.bbox[1] : 0).y;
}

function positionUi() {
  if (!bubble.hidden) {
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    const left = clamp(st.pos.x - bw / 2, 8, W - bw - 8);
    const top = clamp(spriteTop() - bh - 18, 8, H - bh - 8);
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
    bubble.style.setProperty('--tail-x', clamp(st.pos.x - left, 22, bw - 22) + 'px');
  }
  if (!typebox.hidden) {
    const tw = typebox.offsetWidth;
    typebox.style.left = clamp(st.pos.x - tw / 2, 8, W - tw - 8) + 'px';
    typebox.style.top = clamp(H - st.pos.y + 10, 8, H - 60) + 'px';
    if (H - st.pos.y + 60 > H) typebox.style.top = clamp(spriteTop() - 60, 8, H - 60) + 'px';
  }
}

function say(text, { heard = '', seconds = null, label = null, listening = false, thinking = false, buttons = null, cps = 45 } = {}) {
  clearTimeout(bubbleTimer);
  clearInterval(typeTimer);
  $('bubble-label').textContent = label || `${(cfg.characterName || 'CAPRI').toUpperCase()} //`;
  $('bubble-heard').hidden = !heard;
  $('bubble-heard').textContent = heard ? `> ${heard}` : '';
  $('bubble-meter').hidden = !listening;
  bubble.classList.toggle('listening', listening);
  const el = $('bubble-text');
  el.classList.toggle('thinking', thinking);
  const acts = $('bubble-actions');
  acts.innerHTML = '';
  acts.hidden = !buttons;
  for (const b of buttons || []) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b.secondary) btn.className = 'secondary';
    btn.onclick = (ev) => { ev.stopPropagation(); b.onClick(); };
    acts.appendChild(btn);
  }
  // typewriter effect
  if (cps && text) {
    let i = 0;
    el.textContent = '';
    el.classList.add('typing');
    typeTimer = setInterval(() => {
      i = Math.min(text.length, i + Math.max(1, Math.round(cps / 30)));
      el.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(typeTimer); el.classList.remove('typing'); }
    }, 1000 / 30);
  } else {
    el.textContent = text;
    el.classList.remove('typing');
  }
  if (bubble.hidden) {
    bubble.hidden = false;
    bubble.classList.remove('in'); void bubble.offsetWidth; bubble.classList.add('in');
  }
  positionUi();
  if (seconds !== null) bubbleTimer = setTimeout(hideBubble, seconds * 1000);
}
function hideBubble() { clearTimeout(bubbleTimer); clearInterval(typeTimer); bubble.hidden = true; }
const readTime = (t) => clamp(2.5 + t.length / 14, 3, 14);

// ------------------------------------------------------------------ mouse
let ignoring = true;
// The overlay covers the whole screen but must let clicks through everywhere except Capri and her UI.
// main.js drops repeated values, so this is cheap to call often.
function setInteractive(on) {
  ignoring = !on;
  api.setIgnoreMouse(!on);
}
function refreshInteractive(x, y) {
  setInteractive(!!st.drag || !typebox.hidden || overCharacter(x, y) || overD(x, y) || overUi(x, y));
}
function overCharacter(x, y) {
  if (st.orb) return Math.hypot(x - st.orb.x, y - st.orb.y) < S * 15;
  if (st.chill && st.visible) {
    const fy = H - st.pos.y - lift();
    const sx = Math.floor(((x - st.pos.x) / (S * st.flip)) + LAX), sy = Math.floor((y - fy) / S + LAY);
    const name = chillFrame();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lAlpha(name, sx + dx, sy + dy) > 120) return true;
    return false;
  }
  if (!st.visible || st.mode === 'teleport' || st.hideSprite) return false;
  const fy = H - st.pos.y - lift();
  const sx = Math.floor(((x - st.pos.x) / (S * st.flip)) + AX);
  const sy = Math.floor((y - fy) / S + AY);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (alphaAt(currentFrame, sx + dx, sy + dy) > 120) return true;
  return false;
}
function overUi(x, y) { const el = document.elementFromPoint(x, y); return !!(el && el.closest('.interactive')); }

window.addEventListener('mousemove', (e) => {
  st.cursor = { x: e.clientX, y: e.clientY };
  if (st.drag) {
    const d = st.drag;
    const nx = e.clientX - d.offX, ny = H - e.clientY - d.offY;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
      d.moved = true;
      st.walk = null;
      st.action = null;
      st.mode = 'dragging';
      hideBubble();
      st.redOn = false; // the red transform flash plays in update()
      sfx.crackle(0.25, 30);
    }
    if (d.moved) {
      const now = performance.now();
      const secs = Math.max(0.008, (now - d.lastT) / 1000);
      d.vx = lerp(d.vx, (nx - st.pos.x) / secs, 0.5);
      d.vy = lerp(d.vy || 0, (ny - st.pos.y) / secs, 0.5);
      d.lastT = now;
      st.pos.x = nx; st.pos.y = ny;
      clampPos();
    }
    return;
  }
  refreshInteractive(e.clientX, e.clientY);
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && !overCharacter(e.clientX, e.clientY) && overD(e.clientX, e.clientY)) { sfx.audio(); pokeD(); return; }
  if (e.button !== 0 || !overCharacter(e.clientX, e.clientY)) return;
  sfx.audio();
  st.drag = { sx: e.clientX, sy: e.clientY, offX: e.clientX - st.pos.x, offY: (H - e.clientY) - st.pos.y, moved: false, vx: 0, lastT: performance.now() };
});

let pokeTimer = null;
window.addEventListener('mouseup', (e) => {
  if (!st.drag) return;
  const d = st.drag;
  st.drag = null;
  if (d.moved) {
    dropRed(Math.hypot(d.vx, d.vy || 0) > 900);
  } else if (e.detail === 1) {
    const at = { x: e.clientX, y: e.clientY };
    pokeTimer = setTimeout(() => poke(at), 230);
  }
});
canvas.addEventListener('dblclick', (e) => {
  if (!overCharacter(e.clientX, e.clientY)) return;
  clearTimeout(pokeTimer);
  openTypebox();
});
window.addEventListener('contextmenu', (e) => {
  if (overCharacter(e.clientX, e.clientY) || overD(e.clientX, e.clientY)) { e.preventDefault(); api.showMenu(); }
});
window.addEventListener('wheel', (e) => {
  if (!overCharacter(e.clientX, e.clientY)) return;
  cfg.scale = clamp((cfg.scale || 6) + (e.deltaY < 0 ? 1 : -1), 2, 14);
  applyScale();
  squash(1.1, 0.9);
  clearTimeout(window.__scaleSave);
  window.__scaleSave = setTimeout(() => api.setConfig({ scale: cfg.scale }), 400);
}, { passive: true });

function savePos() {
  api.savePosition({ x: st.pos.x, y: st.pos.y });
  cfg.posX = st.pos.x; cfg.posY = st.pos.y;
}

// ------------------------------------------------------------------ personality lines
const POKES = [
  ['surprised', 'Hey! That tickles. Static shock incoming!'],
  ['happy', 'Hi hi! Need something? I am fully charged.'],
  ['relaxed', 'Want to talk? Press Ctrl+Alt+Space.'],
  ['happy', 'All systems sparkling. How are you doing?'],
  ['surprised', 'Oops, did you feel that little zap? Hehe.'],
];
const POKES_ANGRY = [
  ['angry', 'One more poke and you get the full voltage.'],
  ['angry', 'Okay, okay! My circuits are not a toy!'],
];
const DROP_LINES = ['Whoa, smooth landing.', 'New spot? I like it.', 'Wheee! Again?', 'Careful, I am fragile... ish.'];
const IDLE_LINES = [
  ['relaxed', 'Drink some water. You need recharging too.'],
  ['relaxed', 'It is so quiet in here. Too quiet.'],
  ['happy', 'Call me anytime. I am right here.'],
  ['relaxed', 'Rest your eyes for a sec? Even screens need a break.'],
];

function poke(at) {
  const now = performance.now();
  st.lastInteraction = now;
  if (st.chill) {  // woken up from her nap
    endChill();
    setEmotion('surprised', 2.5);
    speak(pick(['Mm? I was just chilling.', 'Huh? Oh, hi! I was totally awake.', 'Five more minutes...', 'Recharged and ready!']), 'happy', { quick: true });
    return;
  }
  st.pokes = st.pokes.filter((p) => now - p < 6000).concat(now);
  if (['listening', 'thinking', 'teleport'].includes(st.mode)) return;
  const angry = st.pokes.length >= 4;
  const [emo, line] = pick(angry ? POKES_ANGRY : POKES);
  squash(0.82, 1.18);
  fx.burst(at.x, at.y, angry ? 22 : 12, { speed: angry ? 320 : 200, up: 60, life: 0.5 });
  sfx.zap(angry ? 1 : 0.5);
  if (angry) {
    const o = orbScreen();
    fx.bolt(o.x, o.y, at.x, at.y, { life: 0.2, branches: 2 });
    fx.doFlash(0.25);
    st.pokes = [];
  }
  setEmotion(emo, 3);
  if (emo === 'happy' && Math.random() < 0.6) st.winkUntil = performance.now() + 900; // a wink, like her reference art
  // her own recorded voice (sounds/poke*.mp3) wins over text-to-speech
  if (!playVoiceLine(angry ? 'poke_angry' : 'poke', emo) && !(angry && playVoiceLine('poke', emo))) speak(line, emo, { quick: true });
}

// ------------------------------------------------------------------ typing
const typeinput = $('typeinput');
function openTypebox() {
  typebox.hidden = false;
  setInteractive(true);
  positionUi();
  typeinput.focus();
  sfx.blip(true);
}
function closeTypebox() {
  typebox.hidden = true;
  typeinput.value = '';
  typeinput.blur();
  setInteractive(false);
}
typebox.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = typeinput.value.trim();
  closeTypebox();
  if (text) converse(text, false);
});
typeinput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTypebox(); });

// ------------------------------------------------------------------ voice in
let micStream = null;
let rec = null;
let recCancel = false;

async function ensureMic() {
  if (micStream && micStream.active) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return micStream;
}

function needKey() {
  if (cfg.hasApiKey) return false;
  setEmotion('sad', 6, false);
  fx.showEmote('?', 2);
  say('My brain is not plugged in yet. Add an API key in Settings first, okay?', {
    seconds: 14,
    buttons: [{ label: 'Open Settings', onClick: () => { hideBubble(); api.openSettings(); } }],
  });
  return true;
}

async function ensureVisible() {
  if (!st.visible && st.mode !== 'teleport') await teleportIn(st.pos.x);
}

async function startListening() {
  if (needKey()) return;
  await ensureVisible();
  stopSpeaking();
  st.walk = null;
  if (st.mode === 'walking') st.mode = 'idle';
  st.mode = 'listening';
  st.ringT = 0;
  manyEyes(20); // all eyes on you while she listens
  st.lastInteraction = performance.now();
  sfx.blip(true);
  say('', { listening: true, label: 'LISTENING_', cps: 0 });
  let stream;
  try {
    stream = await ensureMic();
  } catch {
    st.mode = 'idle';
    setEmotion('sad', 5, false);
    say('My mic is blocked. Check Windows Settings → Privacy & security → Microphone.', { seconds: 10 });
    return;
  }
  const ac = sfx.audio();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const chunks = [];
  recCancel = false;
  rec = new MediaRecorder(stream, { mimeType: mime });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const started = performance.now();
  let noiseFloor = 0.008, heard = false, lastVoice = performance.now();
  const bars = [...document.querySelectorAll('#bubble-meter span')];
  const vad = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    const el = performance.now() - started;
    if (el < 350) noiseFloor = Math.max(noiseFloor, rms * 1.2);
    if (rms > Math.max(0.015, noiseFloor * 2.5)) { heard = true; lastVoice = performance.now(); }
    bars.forEach((b, i) => { b.style.height = clamp(3 + rms * 320 * (0.6 + Math.sin(i * 1.7 + el / 90) * 0.4), 3, 18) + 'px'; });
    st.mouth = 0;
    if ((heard && performance.now() - lastVoice > 1300) || el > 15000) stop();
    else if (!heard && el > 7000) { recCancel = true; stop(); }
  }, 50);

  function stop() {
    clearInterval(vad);
    try { src.disconnect(); } catch {}
    if (rec && rec.state !== 'inactive') rec.stop();
  }
  rec.__stop = stop;
  rec.onstop = async () => {
    rec = null;
    st.manyUntil = Math.min(st.manyUntil || 0, performance.now() + 150);
    sfx.blip(false);
    if (recCancel) {
      st.mode = 'idle';
      fx.showEmote('?', 1.5);
      say(heard ? 'Okay, cancelled.' : 'I did not catch anything. Try again?', { seconds: 2.5 });
      return;
    }
    st.mode = 'thinking';
    fx.showEmote('dots', 30);
    say('PROCESSING', { thinking: true, cps: 0, label: 'SIGNAL //' });
    try {
      const text = await api.transcribe(await new Blob(chunks, { type: mime }).arrayBuffer(), mime);
      if (!text || text.length < 2) {
        st.mode = 'idle';
        fx.emote = null;
        fx.showEmote('?', 1.5);
        say('That came through all static. Say it again?', { seconds: 3 });
        return;
      }
      await converse(text, true);
    } catch (err) {
      handleError(err);
    }
  };
  rec.start(250);
}
function stopListening(cancel = false) { if (rec) { recCancel = cancel; rec.__stop(); } }

// ------------------------------------------------------------------ conversation
async function converse(text, spoken) {
  if (needKey()) return;
  await ensureVisible();
  stopSpeaking();
  st.walk = null;
  st.mode = 'thinking';
  st.lastInteraction = performance.now();
  fx.showEmote('dots', 30);
  say('PROCESSING', { heard: text, thinking: true, cps: 0, label: 'SIGNAL //' });
  try {
    const res = await api.chat(text, { context: spoken ? 'The user spoke this message, so the transcription may contain mistakes.' : '' });
    fx.emote = null;
    st.mode = 'idle';
    if (res.actions && res.actions.length) { cast(W / 2); await sleep(450); }
    await speak(res.text || '…', res.emotion, { heard: text });
  } catch (err) {
    handleError(err);
  }
}

function handleError(e) {
  console.error(e);
  fx.emote = null;
  st.mode = 'idle';
  st.glitchT = 0.4;
  sfx.glitch();
  setEmotion('sad', 6, false);
  const msg = String((e && e.message) || e);
  let human = 'Small short circuit: ' + msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 160);
  if (/401|invalid api key|unauthorized/i.test(msg)) human = 'My API key was rejected. Please check it in Settings.';
  else if (/429|rate limit/i.test(msg)) human = 'I hit the free usage limit for now. Try again in a minute.';
  else if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(msg)) human = 'I lost my connection. Check your internet?';
  else if (/\b404\b|no longer available|not found|does not exist/i.test(msg)) human = `My brain model "${cfg.chatModel || ''}" isn't available anymore. Pick another chat model in Settings (for Gemini, try gemini-3.8-flash).`;
  else if (/empty reply/i.test(msg)) human = 'My brain went quiet on that one. Try again?';
  say(human, { seconds: 9, buttons: [{ label: 'Settings', secondary: true, onClick: () => { hideBubble(); api.openSettings(); } }] });
}

// ------------------------------------------------------------------ voice out
let currentAudio = null, currentChain = null, lipTimer = null;

function stopSpeaking() {
  sfx.stopVoiceClip();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (currentChain) { currentChain.stop(); currentChain = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  clearInterval(lipTimer);
  st.mouth = 0;
  if (st.mode === 'speaking') st.mode = 'idle';
}

// her recorded voice lines (sounds/hello.mp3, poke.mp3, poke_angry.mp3) with the mouth following the audio
function playVoiceLine(name, emotion = 'happy') {
  if (!sfx.hasVoice(name)) return false;
  stopSpeaking();
  const clip = sfx.voiceClip(name);
  if (!clip) return false;
  setEmotion(emotion, clip.duration + 1, true);
  st.mode = 'speaking';
  const data = new Float32Array(clip.analyser.fftSize);
  lipTimer = setInterval(() => {
    clip.analyser.getFloatTimeDomainData(data);
    let s2 = 0;
    for (const v of data) s2 += v * v;
    st.mouth = clamp(Math.sqrt(s2 / data.length) * 3.5, 0, 1);
  }, 33);
  clip.source.addEventListener('ended', () => {
    clearInterval(lipTimer);
    st.mouth = 0;
    if (st.mode === 'speaking') st.mode = 'idle';
  });
  return true;
}

async function speak(text, emotion = 'neutral', { heard = '', quick = false } = {}) {
  stopSpeaking();
  setEmotion(emotion, Math.max(4, readTime(text)), !quick || emotion !== 'neutral');
  if (emotion === 'happy' && !quick && Math.random() < 0.4) charge(1.2);
  st.mode = 'speaking';
  say(text, { heard, cps: 0 });
  $('bubble-text').textContent = '';
  const done = () => {
    clearInterval(lipTimer);
    st.mouth = 0;
    if (st.mode === 'speaking') st.mode = 'idle';
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, 2500);
  };

  let mp3 = null;
  if (cfg.voiceEnabled) { try { mp3 = await api.tts(text); } catch { mp3 = null; } }
  if (st.mode !== 'speaking') return;

  if (mp3 && mp3.byteLength) {
    const url = URL.createObjectURL(new Blob([mp3], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    currentAudio = audio;
    const src = sfx.audio().createMediaElementSource(audio);
    const chain = sfx.voiceChain(src, { fx: cfg.voiceFx !== false });
    currentChain = chain;
    const data = new Float32Array(chain.analyser.fftSize);
    lipTimer = setInterval(() => {
      chain.analyser.getFloatTimeDomainData(data);
      let s = 0;
      for (const v of data) s += v * v;
      st.mouth = clamp(Math.sqrt(s / data.length) * 7, 0, 1);
    }, 33);
    audio.addEventListener('loadedmetadata', () => {
      const cps = audio.duration && isFinite(audio.duration) ? text.length / Math.max(0.6, audio.duration * 0.92) : 30;
      say(text, { heard, cps });
    });
    audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; done(); };
    audio.onerror = () => { say(text, { heard, cps: 40 }); done(); };
    try { await audio.play(); } catch { say(text, { heard, cps: 40 }); done(); }
    return;
  }

  say(text, { heard, cps: 32 });
  if (cfg.voiceEnabled && window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text);
    const lang = (cfg.ttsVoice || 'en-US').slice(0, 5);
    u.voice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.replace('_', '-').startsWith(lang)) || null;
    u.lang = lang;
    lipTimer = setInterval(() => { st.mouth = 0.2 + Math.random() * 0.6; }, 90);
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
    return;
  }
  lipTimer = setInterval(() => { st.mouth = 0.2 + Math.random() * 0.5; }, 90);
  setTimeout(done, Math.min(7000, text.length * 55));
}

// ------------------------------------------------------------------ notes & to-do hologram
const notes = initNotes({
  api, st, fx, sfx, play, startWalk, ensureVisible, endChill, setEmotion, orbScreen, setInteractive,
  S: () => S, W: () => W, H: () => H, name: () => cfg.characterName || 'Capri',
  duoX: () => (duoShown() ? duo.x : null),
  coreScreen: () => (st.chill ? orbScreen() : toScreen(AX, CORE_Y)),
});

// ------------------------------------------------------------------ events from main
api.onTalkToggle(async () => {
  sfx.audio();
  if (st.mode === 'listening') stopListening(false);
  else if (!['thinking', 'teleport'].includes(st.mode)) startListening();
});
api.onTypeOpen(async () => { await ensureVisible(); openTypebox(); });
api.onCursor((p) => { if (!st.drag) { st.cursor = p; refreshInteractive(p.x, p.y); } });
api.onReminder(async (msg) => {
  await ensureVisible();
  cast(W / 2);
  await sleep(500);
  speak(`Ping! Reminder: ${msg}`, 'surprised');
});
api.onToast((msg) => say(msg, { seconds: 3 }));
api.onSay(async ({ text, emotion }) => { await ensureVisible(); speak(text, emotion || 'neutral'); });
api.onDismiss(async () => { hideBubble(); stopSpeaking(); notes.close(true); await teleportOut(); });
api.onSummon(async () => { if (!st.visible) await teleportIn(st.pos.x, { dramatic: true }); });
if (api.onDuo) api.onDuo((on) => (on ? callD() : uncallD()));
api.onAction(async (name) => {
  await ensureVisible();
  if (duoAction(name)) return;
  if (name === 'charge') charge(1.6);
  if (name === 'teleport') teleportTo(rand(W * 0.15, W * 0.85));
  if (name === 'dash') startWalk(st.pos.x > W / 2 ? rand(W * 0.1, W * 0.4) : rand(W * 0.6, W * 0.9), true);
  if (name === 'recenter') teleportTo(W - 30 * S - 40);
  if (name === 'many_eyes') manyEyes(2.5);
  if (name === 'glitch') { st.glitchT = 0.4; sfx.glitch(); }
  if (name === 'chill') { if (st.chill) endChill(); else startChill(rand(45, 90)); }
});
// Hermes used one of her desktop powers: show it with a little cast
if (api.onRemoteTool) api.onRemoteTool(async () => {
  await ensureVisible();
  if (st.mode === 'idle' && !st.action) cast(W / 2);
  fx.showEmote('!', 1.2);
});
// Discord: show what's happening there, quietly (no voice on the desktop unless /say)
const EMOTE_OF = { happy: 'note', surprised: '!', angry: 'anger', sad: '?' };
if (api.onDiscordEvent) api.onDiscordEvent(async (ev) => {
  if (!ev) return;
  if (ev.zap) { await ensureVisible(); charge(1.6); say(`${ev.who} zapped me from Discord!`, { label: 'DISCORD //', seconds: 4 }); return; }
  if (ev.sayText) { await ensureVisible(); speak(ev.sayText, 'happy'); return; }
  if (['listening', 'thinking', 'speaking', 'teleport'].includes(st.mode)) return; // don't interrupt you
  if (!st.visible) return; // she's hidden: stay hidden
  if (st.mode === 'idle' && !st.action) cast(W / 2);
  setEmotion(ev.emotion || 'happy', 3, false);
  fx.showEmote(EMOTE_OF[ev.emotion] || '!', 1.2);
  const reply = String(ev.reply || '').replace(/```[\s\S]*?```/g, '[code]').replace(/[*_`#]/g, '').replace(/\s*\n+\s*/g, ' ');
  say(reply.length > 160 ? reply.slice(0, 157) + '…' : reply, { heard: `${ev.who}: ${String(ev.text || '').slice(0, 80)}`, label: 'DISCORD //', seconds: 5, cps: 90 });
});
// Discord voice: turn her mp3 into raw 48 kHz stereo 16-bit audio for the voice channel
if (api.onDecodeRequest) api.onDecodeRequest(async ({ id, bytes }) => {
  try {
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const n = buf.length;
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const out = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      out[i * 2] = Math.max(-1, Math.min(1, L[i])) * 32767;
      out[i * 2 + 1] = Math.max(-1, Math.min(1, R[i])) * 32767;
    }
    api.decodeResult({ id, pcm: new Uint8Array(out.buffer) });
  } catch (e) {
    api.decodeResult({ id, error: String(e && e.message || e) });
  }
});
api.onConfig((next) => {
  const scaleChanged = next.scale !== cfg.scale;
  const posReset = next.posX == null && cfg.posX != null;
  cfg = next;
  sfx.configure({ enabled: cfg.sfxEnabled, volume: cfg.sfxVolume, voice: cfg.voiceEnabled });
  sfx.loadCustom(api);
  if (scaleChanged) applyScale();
  if (posReset) teleportTo(W - 30 * S - 40);
});

// ------------------------------------------------------------------ autonomous life
function scheduleIdle() {
  setTimeout(() => { try { idleTick(); } finally { scheduleIdle(); } }, rand(7000, 15000));
}
let lastLineAt = performance.now();
function idleTick() {
  if (!st.visible || st.mode !== 'idle' || st.drag || !typebox.hidden || st.action || st.chill || st.notesOpen) return;
  const now = performance.now();
  const r = Math.random();
  // left alone for a while: sometimes she just leans back and chills
  if (now - st.lastInteraction > 45e3 && Math.random() < 0.22 && startChill()) return;
  const free = cfg.autonomy;
  if (free && r < 0.22) startWalk(st.pos.x + rand(10, 40) * S * (Math.random() < 0.5 ? -1 : 1));
  else if (free && r < 0.32) startWalk(rand(W * 0.1, W * 0.9), true);
  else if (free && r < 0.4) teleportTo(rand(W * 0.12, W * 0.88));
  else if (r < 0.55) charge(1.3);
  else if (r < 0.7) st.lookOverride = { dx: pick([-1, 1]), until: now + 2000 };
  else if (r < 0.78) { st.glitchT = 0.15; sfx.glitch(); }
  else if (r < 0.84) manyEyes(rand(1.4, 2.4));
  else if (free && now - lastLineAt > 6 * 60e3 && now - st.lastInteraction > 3 * 60e3) {
    lastLineAt = now;
    const [emo, line] = pick(IDLE_LINES);
    setEmotion(emo, 4, false);
    say(line, { seconds: 5 });
  }
}

async function greet() {
  const h = new Date().getHours();
  const time = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  if (!cfg.hasApiKey) {
    playVoiceLine('hello', 'happy');
    setEmotion('happy', 6);
    say(`${time}! ${cfg.characterName} is online. Add an API key in Settings so we can talk.`, {
      seconds: 16,
      buttons: [
        { label: 'Open Settings', onClick: () => { hideBubble(); api.openSettings(); } },
        { label: 'Later', secondary: true, onClick: hideBubble },
      ],
    });
    return;
  }
  const line = `${time}${cfg.userName ? ', ' + cfg.userName : ''}! ${cfg.characterName} is online and fully charged. What are we doing today?`;
  if (playVoiceLine('hello', 'happy')) return;
  speak(line, 'happy', { quick: true });
}

// ------------------------------------------------------------------ boot
requestAnimationFrame(loop);
window.__test = { notes, duoAction, callD, uncallD, pokeD, duo, startChill, endChill, manyEyes, st, fx, say, speak, setEmotion, charge, cast, teleportTo, teleportIn, teleportOut, startWalk, poke, hop, compose, converse, ghost, frameMeta: () => currentFrame };
window.__ready = true;
await sleep(500);
await teleportIn(st.pos.x, { dramatic: true });
setTimeout(greet, 300);
if (cfg.dOut) setTimeout(() => callD(true), 1600);
scheduleIdle();
