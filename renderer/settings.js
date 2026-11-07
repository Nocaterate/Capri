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
    else if (el.type === 'number') {          // kept inside its min..max (an empty or silly value goes back to the last one)
      const n = Math.round(Number(el.value));
      if (Number.isFinite(n) && el.value !== '') out[el.name] = Math.min(Number(el.max || n), Math.max(Number(el.min || n), n));
    }
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
    document.getElementById('sttMore').open = true;
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

// ---- AI usage: today / this month / last 7 days, per brain, with optional prices
const BRAIN_COLORS = ['#ff2e78', '#5ec8ff', '#2eff8c', '#ffb347', '#b48cff', '#ff70a2', '#f8e81c'];
let usagePrices = {};
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const money = (c) => (c == null ? '' : ` · ≈ $${c < 0.01 ? c.toFixed(4) : c.toFixed(2)}`);
async function showUsage() {
  if (!api.usageGet || !$('usage')) return;
  let u;
  try { u = await api.usageGet(); } catch { return; }
  if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest('#prices')) usagePrices = { ...(u.prices || {}) };
  const t = u.today, m = u.month;
  const colorOf = (name) => BRAIN_COLORS[Math.max(0, u.brains.indexOf(name)) % BRAIN_COLORS.length];
  const max = Math.max(1, ...u.last7.map((d) => d.total));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  $('usage').innerHTML = `
    <div class="totals"><div><div class="sub">Today</div><div class="big">${fmt(t.total)}</div><div class="sub">tokens${money(t.cost)}</div></div>
      <div><div class="sub">This month</div><div class="big">${fmt(m.total)}</div><div class="sub">tokens${money(m.cost)}</div></div></div>
    ${t.total ? `<div class="sub">By brain (today)</div><div class="stack">${t.brains.map((b) => `<span style="width:${(b.total / t.total) * 100}%;background:${colorOf(b.name)}"></span>`).join('')}</div>
      <div class="legend">${t.brains.map((b) => `<span><i style="background:${colorOf(b.name)}"></i>${b.name} ${fmt(b.total)} (${b.calls} calls)${money(b.cost)}</span>`).join('')}</div>` : '<div class="sub">No AI calls yet today.</div>'}
    <div class="days">${u.last7.map((d, i) => `<div class="${i === 6 ? 'today' : ''}" title="${d.date}: ${fmt(d.total)} tokens"><b style="height:${(d.total / max) * 52}px"></b>${days[new Date(d.date + 'T12:00').getDay()]}</div>`).join('')}</div>`;
  const pr = $('prices');
  if (pr && !pr.contains(document.activeElement)) {
    const brains = [...new Set([...u.brains, ...Object.keys(usagePrices)])];
    pr.innerHTML = brains.length ? `<span class="sub">Brain</span><span class="sub">$ per 1M input</span><span class="sub">$ per 1M output</span>` + brains.map((b) =>
      `<span>${b}</span><input type="number" min="0" step="0.01" data-brain="${b}" data-kind="in" value="${usagePrices[b] && usagePrices[b].in != null ? usagePrices[b].in : ''}" placeholder="—" />` +
      `<input type="number" min="0" step="0.01" data-brain="${b}" data-kind="out" value="${usagePrices[b] && usagePrices[b].out != null ? usagePrices[b].out : ''}" placeholder="—" />`).join('') : '';
  }
}
function readPrices() {
  const out = {};
  document.querySelectorAll('#prices input[data-brain]').forEach((el) => {
    const v = el.value === '' ? null : Number(el.value);
    if (v == null || !Number.isFinite(v) || v < 0) return;
    (out[el.dataset.brain] = out[el.dataset.brain] || {})[el.dataset.kind] = v;
  });
  return out;
}
showUsage();
setInterval(showUsage, 5000);

async function save() {
  await api.setConfig({ ...read(), usagePrices: readPrices() });
  showUsage();
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

// ---------- permissions (what she may do without asking)
const permBoxes = [...document.querySelectorAll('[data-perm]')];
function permShow(p) { for (const b of permBoxes) b.checked = !!(p && p[b.dataset.perm]); }
async function permSave() {
  const p = {};
  for (const b of permBoxes) p[b.dataset.perm] = b.checked;
  permShow(await api.setPermissions(p));
  $('permSaved').className = 'result ok'; $('permSaved').textContent = 'Saved ✓';
  setTimeout(() => { $('permSaved').textContent = ''; }, 2000);
}
for (const b of permBoxes) b.addEventListener('change', permSave);
$('permAll').addEventListener('click', () => { for (const b of permBoxes) b.checked = b.dataset.perm !== 'commands' || b.checked; permSave(); });
$('permNone').addEventListener('click', () => { for (const b of permBoxes) b.checked = false; permSave(); });
if (api.onPermissions) api.onPermissions(permShow);
(async () => { try { permShow(await api.getPermissions()); } catch { /* old Capri */ } })();

// ---------- categories: one shows at a time (sidebar), the find box searches all of them
const cats = [...document.querySelectorAll('.cat')];
const catBtns = [...document.querySelectorAll('#cats [data-cat]')];
let catNow = 'ai';
function showCat(id) {
  if (!cats.some((c) => c.dataset.cat === id)) id = cats[0].dataset.cat;
  catNow = id;
  $('find').value = '';
  for (const s of document.querySelectorAll('.cat section')) s.hidden = false;
  $('nothing').hidden = true;
  for (const b of catBtns) b.classList.toggle('active', b.dataset.cat === id);
  for (const c of cats) c.hidden = c.dataset.cat !== id;
  window.scrollTo(0, 0);
  try { localStorage.setItem('capriSettingsCat', id); } catch { /* no storage */ }
}
function find() {
  const q = $('find').value.trim().toLowerCase();
  if (!q) { showCat(catNow); return; }
  let any = false;
  for (const c of cats) {
    let hit = false;
    for (const s of c.querySelectorAll('section')) { const ok = s.textContent.toLowerCase().includes(q); s.hidden = !ok; hit = hit || ok; }
    c.hidden = !hit; any = any || hit;
  }
  for (const b of catBtns) b.classList.remove('active');
  $('nothing').hidden = any;
}
for (const b of catBtns) b.addEventListener('click', () => showCat(b.dataset.cat));
$('find').addEventListener('input', find);
try { catNow = localStorage.getItem('capriSettingsCat') || 'ai'; } catch { /* no storage */ }
showCat(catNow);

// setup steps stay folded once that thing is set up
(async () => {
  try {
    const c = await api.getFullConfig();
    if (!c.discordToken) $('howtoDiscord').open = true;
    if (!(await api.spotifyStatus()).connected) $('howtoSpotify').open = true;
    if (!((await api.browserStatus()).browsers || []).length) $('howtoBrowser').open = true;
  } catch { /* older Capri */ }
})();
