// Sound effects + "digital" voice chain.
// Every effect is synthesized by default. Drop your own mp3/wav/ogg files into the sounds folder
// (Settings → Open sounds folder) and they replace the matching effect; see SOUND_NAMES below.
let ac = null;
let master = null;
let settings = { enabled: true, volume: 0.6, voice: true };

// file name (without extension) → what it replaces. name_2.mp3, name_3.mp3 … add random variations.
export const SOUND_NAMES = {
  zap: 'small electric zaps (pokes, dashes, bolts)',
  thunder: 'big lightning strike when she appears',
  crackle: 'sizzling crackle while pixels gather',
  glitch: 'digital glitch stutter',
  powerup: 'power-up charge',
  blip_up: 'start listening',
  blip_down: 'stop listening',
  hello: 'her voice: greeting when she starts (replaces the spoken greeting)',
  poke: 'her voice: reaction when you click her',
  poke_angry: 'her voice: reaction after too many pokes',
};

let custom = {}; // name → [AudioBuffer]
export async function loadCustom(api) {
  let raw = {};
  try { raw = (await api.listSounds()) || {}; } catch { raw = {}; }
  const a = audio();
  const next = {};
  await Promise.all(Object.entries(raw).map(async ([name, files]) => {
    next[name] = [];
    for (const bytes of files) {
      try { next[name].push(await a.decodeAudioData(bytes.slice().buffer)); } catch (e) { console.warn('bad sound file', name, e && e.message); }
    }
  }));
  custom = next;
  return Object.keys(custom).filter((k) => custom[k].length);
}

let voiceOut = null, voiceAnalyser = null, currentClip = null;
function playBuffer(list, gain, toVoice) {
  const a = audio();
  const src = a.createBufferSource();
  src.buffer = list[(Math.random() * list.length) | 0];
  const g = a.createGain();
  g.gain.value = gain;
  if (toVoice) {
    if (!voiceOut) {
      voiceOut = a.createGain();
      voiceAnalyser = a.createAnalyser();
      voiceAnalyser.fftSize = 512;
      voiceOut.connect(voiceAnalyser);
      voiceAnalyser.connect(a.destination);
    }
    src.connect(g).connect(voiceOut);
  } else src.connect(g).connect(master);
  src.start();
  return src;
}

// returns true when a custom file was played (so the synth version is skipped)
function playCustom(name, gain = 1) {
  const list = custom[name];
  if (!list || !list.length) return false;
  playBuffer(list, Math.min(1.5, gain), false);
  return true;
}

// her recorded voice lines (hello / poke / poke_angry)
export function hasVoice(name) {
  return settings.voice !== false && !!(custom[name] && custom[name].length);
}
// plays one; returns { source, analyser, duration } for lip-sync, or null when there is no file
export function voiceClip(name) {
  if (!hasVoice(name)) return null;
  stopVoiceClip();
  const source = playBuffer(custom[name], 1, true);
  currentClip = source;
  source.addEventListener('ended', () => { if (currentClip === source) currentClip = null; });
  return { source, analyser: voiceAnalyser, duration: source.buffer.duration };
}
export function stopVoiceClip() {
  if (currentClip) { try { currentClip.stop(); } catch { /* already stopped */ } currentClip = null; }
}

export function audio() {
  if (!ac) {
    ac = new AudioContext();
    master = ac.createGain();
    master.gain.value = settings.volume;
    master.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

export function configure({ enabled, volume, voice }) {
  settings = { enabled: enabled !== false, volume: volume ?? 0.6, voice: voice !== false };
  if (master) master.gain.value = settings.volume;
}

let noiseBuf = null;
function noise() {
  const a = audio();
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 1.5, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = a.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

// electric zap: falling square chirp + filtered noise crack
export function zap(strength = 1) {
  if (!settings.enabled) return;
  if (playCustom('zap', 0.5 + strength * 0.5)) return;
  const a = audio(); const t = a.currentTime;
  const o = a.createOscillator(); o.type = 'square';
  o.frequency.setValueAtTime(1400 * strength, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.22);
  const og = a.createGain(); env(og, t, 0.005, 0.12 * strength, 0.22);
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
  o.connect(f).connect(og).connect(master);
  o.start(t); o.stop(t + 0.3);
  const n = noise();
  const nb = a.createBiquadFilter(); nb.type = 'bandpass'; nb.Q.value = 0.8;
  nb.frequency.setValueAtTime(5000, t); nb.frequency.exponentialRampToValueAtTime(600, t + 0.18);
  const ng = a.createGain(); env(ng, t, 0.002, 0.35 * strength, 0.18);
  n.connect(nb).connect(ng).connect(master);
  n.start(t, Math.random()); n.stop(t + 0.25);
}

// big lightning strike: crack + low rumble
export function thunder() {
  if (!settings.enabled) return;
  if (playCustom('thunder')) return;
  zap(1.3);
  const a = audio(); const t = a.currentTime;
  const n = noise();
  const lp = a.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(90, t + 0.9);
  const g = a.createGain(); env(g, t, 0.01, 0.5, 0.9);
  n.connect(lp).connect(g).connect(master);
  n.start(t, Math.random()); n.stop(t + 1.1);
}

// sizzling crackle for `dur` seconds
export function crackle(dur = 1, density = 26) {
  if (!settings.enabled) return;
  if (playCustom('crackle')) return;
  const a = audio(); const t0 = a.currentTime;
  const count = Math.floor(dur * density);
  for (let i = 0; i < count; i++) {
    const t = t0 + Math.random() * dur;
    const n = noise();
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500 + Math.random() * 4000;
    const g = a.createGain(); env(g, t, 0.001, 0.08 + Math.random() * 0.12, 0.02 + Math.random() * 0.04);
    n.connect(hp).connect(g).connect(master);
    n.start(t, Math.random()); n.stop(t + 0.08);
  }
}

// UI blip (up = start listening, down = stop)
export function blip(up = true) {
  if (!settings.enabled) return;
  if (playCustom(up ? 'blip_up' : 'blip_down')) return;
  const a = audio(); const t = a.currentTime;
  const o = a.createOscillator(); o.type = 'square';
  o.frequency.setValueAtTime(up ? 520 : 880, t);
  o.frequency.setValueAtTime(up ? 880 : 520, t + 0.06);
  const g = a.createGain(); env(g, t, 0.004, 0.07, 0.12);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.16);
}

// short digital glitch stutter
export function glitch() {
  if (!settings.enabled) return;
  if (playCustom('glitch')) return;
  const a = audio(); const t0 = a.currentTime;
  for (let i = 0; i < 4; i++) {
    const t = t0 + i * 0.035;
    const o = a.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = 200 + Math.random() * 1600;
    const g = a.createGain(); env(g, t, 0.002, 0.05, 0.025);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.04);
  }
}

// rising power-up whine
export function powerUp(dur = 1.2) {
  if (!settings.enabled) return;
  if (playCustom('powerup')) return;
  const a = audio(); const t = a.currentTime;
  const o = a.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(900, t + dur);
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(4000, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
  o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + dur + 0.1);
  crackle(dur, 20);
}

// ---------------------------------------------------------------- voice chain
// Turns a plain TTS voice into a slightly robotic, electric AI voice.
export function voiceChain(source, { fx = true } = {}) {
  const a = audio();
  const out = a.createGain();
  const analyser = a.createAnalyser();
  analyser.fftSize = 512;
  out.connect(analyser);
  analyser.connect(a.destination);
  if (!fx) {
    source.connect(out);
    return { analyser, stop() {} };
  }
  const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
  const presence = a.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2600; presence.gain.value = 4;
  source.connect(hp).connect(presence);

  const dry = a.createGain(); dry.gain.value = 0.82;
  presence.connect(dry).connect(out);

  // ring modulator (metallic edge)
  const ring = a.createGain(); ring.gain.value = 0;
  const osc = a.createOscillator(); osc.frequency.value = 55;
  const depth = a.createGain(); depth.gain.value = 1;
  osc.connect(depth).connect(ring.gain);
  const ringMix = a.createGain(); ringMix.gain.value = 0.22;
  presence.connect(ring).connect(ringMix).connect(out);
  osc.start();

  // light bit-crush style distortion
  const shaper = a.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.round(x * 10) / 10;
  }
  shaper.curve = curve;
  const crushMix = a.createGain(); crushMix.gain.value = 0.12;
  presence.connect(shaper).connect(crushMix).connect(out);

  // short comb delay = "helmet speaker" resonance
  const delay = a.createDelay(0.05); delay.delayTime.value = 0.011;
  const fb = a.createGain(); fb.gain.value = 0.28;
  const delayMix = a.createGain(); delayMix.gain.value = 0.2;
  presence.connect(delay); delay.connect(fb).connect(delay); delay.connect(delayMix).connect(out);

  return { analyser, stop() { try { osc.stop(); } catch {} } };
}
