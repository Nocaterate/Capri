const api = window.companion;
const form = document.getElementById('form');
const $ = (id) => document.getElementById(id);

const PRESETS = {
  groq: { apiBaseUrl: 'https://api.groq.com/openai/v1', chatModel: 'openai/gpt-oss-120b', sttModel: 'whisper-large-v3-turbo' },
  ollama: { apiBaseUrl: 'http://localhost:11434/v1', chatModel: 'qwen2.5:3b' },
  claude: { apiBaseUrl: 'https://api.anthropic.com/v1', chatModel: 'claude-haiku-5-5' },
  gemini: { apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', chatModel: 'gemini-3.8-flash' },
  openrouter: { apiBaseUrl: 'https://openrouter.ai/api/v1', chatModel: 'deepseek/deepseek-v4.1-flash' },
  openai: { apiBaseUrl: 'https://api.openai.com/v1', chatModel: 'gpt-4o-mini', sttModel: 'whisper-1' },
};

function fill(cfg) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in cfg)) continue;
    const v = cfg[el.name];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT' && v != null && ![...el.options].some((o) => o.value === String(v))) {
      el.add(new Option(String(v), String(v)));
      el.value = String(v);
    } else el.value = v ?? '';
  }
  $('scaleOut').textContent = `${cfg.scale}× (${cfg.scale * 80}px tall)`;
  markPreset();
}

// her size can also change with the mouse wheel while this window is open: Save only sends the size if you
// moved the slider here, otherwise it would put back whatever size she had when Settings opened
let scaleTouched = false;
function read() {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.name === 'scale' && !scaleTouched) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'range') out[el.name] = Number(el.value);
    else out[el.name] = el.value.trim();
  }
  return out;
}

function markPreset() {
  const url = form.elements.apiBaseUrl.value;
  const norm = (u) => String(u || '').replace(/\/+$/, '');
  document.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('active', norm(PRESETS[b.dataset.preset].apiBaseUrl) === norm(url)));
}

document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  for (const [k, v] of Object.entries(PRESETS[b.dataset.preset])) form.elements[k].value = v;
  if (['ollama', 'claude', 'gemini', 'openrouter'].includes(b.dataset.preset)) {
    document.querySelector('details').open = true;
    if (!form.elements.sttBaseUrl.value) form.elements.sttBaseUrl.value = 'https://api.groq.com/openai/v1';
    if (form.elements.sttModel.value === 'whisper-1') form.elements.sttModel.value = 'whisper-large-v3-turbo';
  }
  markPreset();
}));
form.elements.apiBaseUrl.addEventListener('input', markPreset);
form.elements.scale.addEventListener('input', (e) => { scaleTouched = true; $('scaleOut').textContent = `${e.target.value}× (${e.target.value * 80}px tall)`; });
// keep the slider in step with her real size
if (api.onConfig) api.onConfig((c) => {
  if (!c || scaleTouched || c.scale == null) return;
  form.elements.scale.value = c.scale;
  $('scaleOut').textContent = `${c.scale}× (${c.scale * 80}px tall)`;
});
document.querySelectorAll('[data-link]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); api.openExternal(a.dataset.link); }));

$('test').addEventListener('click', async () => {
  const r = $('testResult');
  r.className = 'result';
  r.textContent = 'Testing…';
  const v = read();
  const res = await api.testApi({ apiBaseUrl: v.apiBaseUrl, apiKey: v.apiKey, chatModel: v.chatModel });
  r.className = 'result ' + (res.ok ? 'ok' : 'bad');
  r.textContent = res.message;
});

async function save() {
  await api.setConfig(read());
  scaleTouched = false;
  const s = $('saved');
  s.className = 'result ok';
  s.textContent = 'Saved ✓';
  setTimeout(() => { s.textContent = ''; }, 2500);
}
$('save').addEventListener('click', save);
function showProvider() {
  const fish = form.elements.ttsProvider.value === 'fish';
  $('fishBox').hidden = !fish;
}
form.elements.ttsProvider.addEventListener('change', showProvider);

function result(id, res) {
  $(id).className = 'result ' + (res.ok ? 'ok' : 'bad');
  $(id).textContent = res.message;
}

$('makeVoice').addEventListener('click', async () => {
  const btn = $('makeVoice');
  btn.disabled = true;
  $('voiceResult').className = 'result';
  $('voiceResult').textContent = 'Cloning her voice… (up to a minute)';
  const res = await api.createFishVoice({ fishApiKey: form.elements.fishApiKey.value.trim(), fishModel: form.elements.fishModel.value });
  btn.disabled = false;
  if (res.ok) {
    form.elements.fishVoiceId.value = res.id;
    form.elements.ttsProvider.value = 'fish';
    form.elements.voiceFx.checked = false;
    showProvider();
  }
  result('voiceResult', res);
});

async function spotifyStatus() {
  const s = await api.spotifyStatus();
  $('spotifyDisconnect').hidden = !s.connected;
  $('spotifyConnect').textContent = s.connected ? 'Reconnect Spotify' : 'Connect Spotify';
  if (!$('spotifyResult').textContent) {
    $('spotifyResult').className = 'result' + (s.connected ? ' ok' : '');
    $('spotifyResult').textContent = s.connected ? 'Connected ✓' : 'Not connected';
  }
}
$('copyRedirect').addEventListener('click', async () => {
  const text = $('redirectUri').textContent;
  try { await navigator.clipboard.writeText(text); $('copyRedirect').textContent = 'Copied'; }
  catch { const r = document.createRange(); r.selectNodeContents($('redirectUri')); getSelection().removeAllRanges(); getSelection().addRange(r); }
  setTimeout(() => { $('copyRedirect').textContent = 'Copy'; }, 1500);
});
$('spotifyConnect').addEventListener('click', async () => {
  $('spotifyResult').className = 'result';
  $('spotifyResult').textContent = 'Log in to Spotify in your browser…';
  const res = await api.spotifyConnect(form.elements.spotifyClientId.value.trim());
  result('spotifyResult', res);
  spotifyStatus();
});
$('spotifyDisconnect').addEventListener('click', async () => {
  await api.spotifyDisconnect();
  $('spotifyResult').textContent = '';
  spotifyStatus();
});

async function hermesRefresh() {
  const s = await api.hermesStatus();
  const dot = (on, yes, no) => `<div><span class="dot ${on ? 'on' : ''}"></span>${on ? yes : no}</div>`;
  $('hermesStatus').innerHTML = [
    dot(s.wsl, 'WSL is installed', 'WSL is not installed'),
    dot(s.hermes, 'Hermes is installed in WSL', 'Hermes is not installed in WSL'),
    dot(s.gateway, 'Hermes is running', 'Hermes is not running'),
    dot(s.bridge, `Capri's tool server is on (${s.mcpUrl})`, "Capri's tool server is off"),
  ].join('');
  $('hermesBrain').checked = s.brain;
  const m = await api.hermesManual();
  $('hermesYaml').textContent = m.yaml;
  $('hermesEnv').textContent = m.env;
}
$('hermesConnect').addEventListener('click', async () => {
  const btn = $('hermesConnect');
  btn.disabled = true;
  $('hermesResult').className = 'result';
  $('hermesResult').textContent = 'Connecting… (this can take a minute)';
  await api.setConfig({ hermesSetBrain: form.elements.hermesSetBrain.checked, hermesGeminiKey: form.elements.hermesGeminiKey.value.trim() });
  const res = await api.hermesConnect();
  btn.disabled = false;
  result('hermesResult', res);
  const list = $('hermesSteps');
  list.innerHTML = '';
  for (const t of res.steps || []) { const li = document.createElement('li'); li.textContent = t; list.appendChild(li); }
  list.hidden = !(res.steps || []).length;
  fill(await api.getFullConfig());
  showProvider();
  hermesRefresh();
});
$('hermesBrain').addEventListener('change', async (e) => {
  await api.hermesBrain(e.target.checked);
  fill(await api.getFullConfig());
  hermesRefresh();
});

let discordInvite = '';
function discordShow(st) {
  if (!st) return;
  const on = st.state === 'online';
  const label = on ? `${st.message} · in ${st.guilds} server${st.guilds === 1 ? '' : 's'}${st.owner ? ` · owner: ${st.owner}` : ''}` : st.message;
  $('discordStatus').innerHTML = `<div><span class="dot ${on ? 'on' : ''}"></span><span id="discordMsg"></span></div>`;
  $('discordMsg').textContent = label;
  $('discordStatus').classList.toggle('bad', st.state === 'error');
  discordInvite = st.invite || '';
  if (st.state !== 'connecting') $('discordStart').disabled = false;
  $('discordInvite').hidden = !discordInvite;
}
$('discordStart').addEventListener('click', async () => {
  if (!form.elements.discordToken.value.trim()) { discordShow({ state: 'error', message: 'Paste your bot token first.' }); return; }
  form.elements.discordEnabled.checked = true;
  const btn = $('discordStart');
  btn.disabled = true;
  discordShow({ state: 'connecting', message: 'Connecting to Discord…' });
  await save();
  discordShow(await api.discordRestart());
  btn.disabled = false;
});
// keep the status fresh (it changes when she finishes connecting, reconnects, joins servers…)
setInterval(async () => { try { discordShow(await api.discordStatus()); } catch { /* window closing */ } }, 2000);
$('discordInvite').addEventListener('click', () => { if (discordInvite) api.openExternal(discordInvite); });
if (api.onDiscordState) api.onDiscordState(discordShow);

$('samplesFolder').addEventListener('click', (e) => { e.preventDefault(); api.openVoiceSamplesFolder(); });

$('preview').addEventListener('click', async () => {
  await save();
  $('previewResult').className = 'result';
  $('previewResult').textContent = 'Testing…';
  result('previewResult', await api.testVoice({}));
  api.previewVoice();
});
$('soundsFolder').addEventListener('click', async () => {
  const dir = await api.openSoundsFolder();
  $('soundsResult').className = 'result';
  $('soundsResult').textContent = dir || '';
});

(async () => {
  const sel = $('voiceSelect');
  for (const v of await api.listVoices()) sel.add(new Option(v.label, v.id));
  fill(await api.getFullConfig());
  showProvider();
  spotifyStatus();
  hermesRefresh();
  discordShow(await api.discordStatus());
})();

// ---------- browser link
function browserShow(st) {
  if (!st) return;
  const list = st.browsers || [];
  const lines = list.length
    ? list.map((b) => `<div><span class="dot on"></span>${b.name} linked</div>`)
    : [`<div><span class="dot"></span>${st.listening ? 'No browser linked yet' : 'Browser link is off'}</div>`];
  if (st.defaultBrowser) lines.push(`<div><span class="dot"></span>Your default browser: ${st.defaultBrowser}</div>`);
  $('browserStatus').innerHTML = lines.join('');
}
$('extOpen').addEventListener('click', () => api.openExtensionFolder('chromium'));
$('extOpenFx').addEventListener('click', () => api.openExtensionFolder('firefox'));
if (api.onBrowserState) api.onBrowserState(browserShow);
(async () => { try { browserShow(await api.browserStatus()); } catch { /* old Capri */ } })();
setInterval(async () => { try { browserShow(await api.browserStatus()); } catch { /* closing */ } }, 3000);
