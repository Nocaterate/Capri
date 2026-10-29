// Finds the beat of a song so High Forever can dance on it: tempo, where the first beat is, and how loud each
// beat is (0..1, for the big moves on the drops). Works on raw samples, so it is quick and needs no library.

const FPS = 100; // analysis frames per second (10 ms)

export function analyseBeats(left, right, sampleRate) {
  const n = left.length;
  const hop = Math.round(sampleRate / FPS);
  const frames = Math.floor(n / hop);
  const low = new Float32Array(frames);   // bass energy (kick drum)
  const full = new Float32Array(frames);  // overall loudness
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  let y = 0;
  for (let f = 0; f < frames; f++) {
    let sl = 0, sf = 0;
    const end = (f + 1) * hop;
    for (let i = f * hop; i < end; i++) {
      const x = right ? (left[i] + right[i]) * 0.5 : left[i];
      y += a * (x - y);
      sl += y * y; sf += x * x;
    }
    low[f] = Math.sqrt(sl / hop); full[f] = Math.sqrt(sf / hop);
  }
  // onsets: how much the bass (and a bit of everything) jumps up from one frame to the next
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, low[f] - low[f - 1]) + 0.3 * Math.max(0, full[f] - full[f - 1]);
  // smooth a little and remove the local average so steady parts don't count
  const on = new Float32Array(frames);
  const W = 30;
  let run = 0;
  for (let f = 0; f < frames; f++) {
    run += onset[f] - (f >= W ? onset[f - W] : 0);
    on[f] = Math.max(0, onset[f] - run / Math.min(W, f + 1));
  }
  // tempo: autocorrelation between 70 and 180 BPM, gently preferring 100-140
  const N = Math.min(frames, 120 * FPS);
  let best = 0, bestLag = 50;
  const scores = {};
  for (let lag = Math.floor((60 * FPS) / 180); lag <= Math.ceil((60 * FPS) / 70); lag++) {
    let s = 0;
    for (let f = 0; f + lag < N; f++) s += on[f] * on[f + lag];
    const bpm = (60 * FPS) / lag;
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.6) ** 2);
    scores[lag] = s;
    if (s * w > best) { best = s * w; bestLag = lag; }
  }
  // refine to a fractional lag (parabola through the neighbours)
  const s0 = scores[bestLag - 1] || 0, s1 = scores[bestLag], s2 = scores[bestLag + 1] || 0;
  const den = s0 - 2 * s1 + s2;
  const lag = bestLag + (den ? Math.max(-0.5, Math.min(0.5, (0.5 * (s0 - s2)) / den)) : 0);
  // tempo and phase together over the whole song: try lags within ±1% and every phase, keep the grid that
  // lands on the most onsets (so the beat doesn't drift off by the end of the song)
  const grid = (L, ph) => {
    let s = 0;
    for (let t = ph; t < frames; t += L) { const i = Math.round(t); s += on[i] + 0.5 * ((on[i - 1] || 0) + (on[i + 1] || 0)); }
    return s;
  };
  let lagF = lag, phF = 0, bestSum = -1;
  for (let L = lag * 0.99; L <= lag * 1.01; L += lag * 0.0005) {
    for (let ph = 0; ph < L; ph += 0.5) {
      const s = grid(L, ph);
      if (s > bestSum) { bestSum = s; lagF = L; phF = ph; }
    }
  }
  const period = lagF / FPS, offset = phF / FPS;
  // loudness per beat, scaled 0..1 between the quiet 10% and the loud 95%
  const count = Math.max(1, Math.floor((frames / FPS - offset) / period));
  const strength = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    const c = Math.round((offset + b * period) * FPS);
    let s = 0, k = 0;
    for (let f = Math.max(0, c - 3); f < Math.min(frames, c + Math.round(lag * 0.5)); f++) { s += full[f] + low[f]; k++; }
    strength[b] = k ? s / k : 0;
  }
  const sorted = Array.from(strength).sort((x, y2) => x - y2);
  const lo = sorted[Math.floor(count * 0.1)] || 0, hi = sorted[Math.floor(count * 0.95)] || 1;
  for (let b = 0; b < count; b++) strength[b] = Math.max(0, Math.min(1, (strength[b] - lo) / (hi - lo || 1)));
  return { bpm: 60 / period, period, offset, strength };
}
