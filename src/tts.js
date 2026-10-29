// Text-to-speech.
//  - Fish Audio: Capri's own cloned voice (made from her sample clips), so everything she says
//    sounds like her. Needs a Fish Audio API key; the `s2.1-pro-free` model is their free tier.
//  - Microsoft Edge neural voices (msedge-tts): free fallback, no key needed.
// Returns an MP3 as Uint8Array, or null so the renderer can fall back to the OS voice.
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const FISH = 'https://api.fish.audio';

const VOICES = [
  { id: 'en-US-AnaNeural', label: 'Ana — US English, young and bright (closest to Capri)' },
  { id: 'en-US-AriaNeural', label: 'Aria — US English, bright' },
  { id: 'en-US-JennyNeural', label: 'Jenny — US English, friendly' },
  { id: 'en-US-AvaNeural', label: 'Ava — US English, warm' },
  { id: 'en-US-EmmaNeural', label: 'Emma — US English, cheerful' },
  { id: 'en-GB-MaisieNeural', label: 'Maisie — UK English, young girl' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia — UK English' },
  { id: 'en-AU-NatashaNeural', label: 'Natasha — Australian English' },
];

let engine = null;
let engineVoice = null;
let lastError = '';

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

// accepts a bare id or a fish.audio link like https://fish.audio/m/<id>/
function voiceIdOf(v) {
  const s = String(v || '').trim();
  const m = s.match(/fish\.audio\/(?:[a-z-]+\/)*m\/([A-Za-z0-9]+)/) || s.match(/([0-9a-f]{32})/i);
  return m ? m[1] : s;
}

async function fishError(res) {
  let msg = '';
  try { const j = await res.json(); msg = j.message || j.reason || JSON.stringify(j); } catch { msg = ''; }
  if (res.status === 401) msg = 'the API key was rejected';
  if (res.status === 402) msg = 'no credits left for this model (try the free model, or add credits on fish.audio)';
  return new Error(`Fish Audio ${res.status}: ${msg}`.trim());
}

async function fishSynthesize(text, cfg) {
  const res = await fetch(`${FISH}/v1/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.fishApiKey}`,
      'Content-Type': 'application/json',
      model: cfg.fishModel || 's2.1-pro-free',
    },
    body: JSON.stringify({
      text,
      reference_id: voiceIdOf(cfg.fishVoiceId),
      format: 'mp3',
      mp3_bitrate: 128,
      latency: 'balanced',
      normalize: true,
      language: 'en',
      prosody: { speed: Math.min(2, Math.max(0.5, Number(cfg.fishSpeed) || 1)), volume: 0 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw await fishError(res);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) throw new Error('Fish Audio returned no audio');
  return buf;
}

async function edgeSynthesize(text, cfg) {
  if (!engine || engineVoice !== cfg.ttsVoice) {
    engine = new MsEdgeTTS();
    await engine.setMetadata(cfg.ttsVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    engineVoice = cfg.ttsVoice;
  }
  const { audioStream } = engine.toStream(escapeXml(text), { pitch: cfg.ttsPitch, rate: cfg.ttsRate });
  const chunks = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TTS timeout')), 20000);
    audioStream.on('data', (c) => chunks.push(c));
    audioStream.on('end', () => { clearTimeout(timer); resolve(); });
    audioStream.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  const buf = Buffer.concat(chunks);
  if (!buf.length) throw new Error('TTS returned no audio');
  return new Uint8Array(buf);
}

const useFish = (cfg) => cfg.ttsProvider === 'fish' && cfg.fishApiKey && cfg.fishVoiceId;

async function synthesize(text, cfg) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  if (useFish(cfg)) {
    try {
      const out = await fishSynthesize(clean, cfg);
      lastError = '';
      return out;
    } catch (e) {
      lastError = e.message;
      console.warn('Fish Audio failed, falling back to Edge voice:', e.message);
    }
  }
  try {
    return await edgeSynthesize(clean, cfg);
  } catch (e) {
    console.warn('Edge TTS failed, falling back to system voice:', e.message);
    engine = null; // reconnect next time
    return null;
  }
}

// Clone her voice: upload the sample clips and get back a voice model id.
async function createFishVoice(cfg, samples) {
  if (!cfg.fishApiKey) throw new Error('Add your Fish Audio API key first.');
  if (!samples.length) throw new Error('No voice clips yet. Click "Open the voice samples folder", add 10-60 seconds of clean clips of a voice you have permission to use, then try again.');
  const form = new FormData();
  form.append('type', 'tts');
  form.append('title', `${cfg.characterName || 'Capri'} voice`);
  form.append('train_mode', 'fast');
  form.append('visibility', 'private');
  form.append('enhance_audio_quality', 'true');
  for (const s of samples) form.append('voices', new Blob([s.data], { type: s.type }), s.name);
  const res = await fetch(`${FISH}/model`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.fishApiKey}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw await fishError(res);
  const json = await res.json();
  if (!json._id) throw new Error('Fish Audio did not return a voice id.');
  return json._id;
}

async function testVoice(cfg) {
  if (cfg.ttsProvider !== 'fish') return { ok: true, message: 'Using the Microsoft Edge voice.' };
  if (!cfg.fishApiKey) return { ok: false, message: 'Add your Fish Audio API key.' };
  if (!cfg.fishVoiceId) return { ok: false, message: 'Create her voice first (or paste a voice model ID).' };
  try {
    await fishSynthesize('Voice check!', cfg);
    return { ok: true, message: 'Her cloned voice works.' };
  } catch (e) {
    return { ok: false, message: `${e.message}. She will use the Edge voice until this is fixed.` };
  }
}

module.exports = { synthesize, createFishVoice, testVoice, voiceIdOf, VOICES, lastError: () => lastError };
