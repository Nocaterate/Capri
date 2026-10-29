// Spotify for Capri.
// Connected mode (Spotify Web API, needs Spotify Premium + your own free developer app / Client ID):
//   search and play exact songs, artists, albums and playlists; queue; now playing; shuffle; volume.
// Free mode (no setup): open a search in the Spotify app, media keys, and "now playing" from the
//   Spotify window title on Windows.
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const os = require('os');

const PORT = 43821;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private',
].join(' ');
const API = 'https://api.spotify.com/v1';

let store = null; // { get(): config, set(patch), log?(...parts) }
function init(s) { store = s; }
const notify = (text) => { try { if (store && store.notify) store.notify(text); } catch { /* ignore */ } };
const dbg = (...p) => { try { if (store && store.log) store.log('spotify', ...p); } catch { /* never break playback */ } };
const cfg = () => store.get();
const connected = () => !!(cfg().spotifyClientId && cfg().spotifyRefreshToken);

// ---------------------------------------------------------------- login (Authorization Code + PKCE)
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function connect(clientId, openUrl) {
  clientId = String(clientId || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(clientId)) return Promise.resolve({ ok: false, message: 'That Client ID looks wrong. Copy it from your app page on developer.spotify.com.' });
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(12));
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });

  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => { if (done) return; done = true; clearTimeout(timer); setTimeout(() => server.close(), 500); resolve(res); };
    const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="background:#140A16;color:#FBE9F2;font-family:Consolas,monospace;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:440px;border:1px solid #FF2A6D;padding:24px"><h2 style="color:#FF2A6D;margin-top:0">${title}</h2><p>${text}</p></div></body>`;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const err = u.searchParams.get('error');
      if (err || u.searchParams.get('state') !== state) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('Not connected', 'Spotify did not give permission. You can close this tab and try again from Capri\'s Settings.'));
        finish({ ok: false, message: err === 'access_denied' ? 'You cancelled the Spotify login.' : `Spotify login failed${err ? ': ' + err : ''}.` });
        return;
      }
      try {
        const tok = await tokenRequest({
          grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: REDIRECT_URI,
          client_id: clientId, code_verifier: verifier,
        });
        store.set({ spotifyClientId: clientId, spotifyRefreshToken: tok.refresh_token, spotifyAccessToken: tok.access_token, spotifyExpires: Date.now() + tok.expires_in * 1000 });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('Capri is connected to Spotify', 'You can close this tab. Ask her to play something!'));
        finish({ ok: true, message: 'Connected to Spotify.' });
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('Not connected', 'Something went wrong. Check Capri\'s Settings for details.'));
        finish({ ok: false, message: e.message });
      }
    });
    server.on('error', (e) => finish({ ok: false, message: e.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Close whatever uses it and try again.` : e.message }));
    server.listen(PORT, '127.0.0.1', () => openUrl(url));
    const timer = setTimeout(() => finish({ ok: false, message: 'Spotify login timed out. Try again.' }), 5 * 60 * 1000);
  });
}

function disconnect() {
  store.set({ spotifyRefreshToken: '', spotifyAccessToken: '', spotifyExpires: 0 });
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Spotify login error: ${json.error_description || json.error || res.status}`);
  return json;
}

async function accessToken(force = false) {
  const c = cfg();
  if (!force && c.spotifyAccessToken && Date.now() < (c.spotifyExpires || 0) - 60000) return c.spotifyAccessToken;
  const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.spotifyRefreshToken, client_id: c.spotifyClientId });
  store.set({
    spotifyAccessToken: tok.access_token,
    spotifyExpires: Date.now() + tok.expires_in * 1000,
    ...(tok.refresh_token ? { spotifyRefreshToken: tok.refresh_token } : {}),
  });
  return tok.access_token;
}

class SpotifyError extends Error {
  constructor(status, reason, message) { super(message); this.status = status; this.reason = reason; }
}

async function api(method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(attempt > 0);
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 && attempt === 0) continue;
    if (!path.startsWith('/search') && !path.startsWith('/me/player/devices')) dbg(method, path.split('?')[0], '->', res.status);
    if (res.status === 204) return null;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const e = json && json.error;
      throw new SpotifyError(res.status, e && e.reason, (e && e.message) || `Spotify error ${res.status}`);
    }
    return json;
  }
  throw new SpotifyError(401, '', 'Spotify login expired. Reconnect in Settings.');
}

function explain(e) {
  if (e.reason === 'PREMIUM_REQUIRED' || e.status === 403) return 'Spotify only lets apps control playback with Spotify Premium.';
  if (e.status === 401) return 'Spotify login expired. Reconnect Spotify in Settings.';
  if (e.status === 429) return 'Spotify says too many requests. Try again in a moment.';
  return e.message;
}

// ---------------------------------------------------------------- free helpers
function openUri(uri) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '""', uri]]
    : process.platform === 'darwin' ? ['open', [uri]] : ['xdg-open', [uri]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (e) => console.warn('could not open', uri, e.message));
  child.unref();
}

function windowTitle() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const ps = "(Get-Process Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle";
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? null : String(out || '').trim()));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- open-and-play
// Spotify on Windows starts playing a song it is LAUNCHED with, but only shows the page when it's
// already running. So to switch songs we close Spotify and reopen it on the new song.
function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 6000 }, (err, out) => resolve(err ? '' : String(out || ''))));
}
async function spotifyRunning() {
  if (process.platform !== 'win32') return false;
  return /spotify\.exe/i.test(await run('tasklist', ['/FI', 'IMAGENAME eq Spotify.exe', '/NH']));
}
async function openAndPlay(uri) {
  if (await spotifyRunning()) {
    dbg('restarting Spotify to play', uri);
    await run('taskkill', ['/IM', 'Spotify.exe', '/F']);
    for (let i = 0; i < 15 && (await spotifyRunning()); i++) await sleep(200); // wait until it's really gone
    await sleep(300);
  }
  openUri(uri);
}

// Pick the Spotify app on THIS computer (Spotify names it after the PC), opening it if needed.
// Falls back to whatever device is active, so it still works if Spotify uses a different name.
async function pickDevice() {
  const list = async () => ((await api('GET', '/me/player/devices')) || {}).devices || [];
  const host = os.hostname().toLowerCase();
  const thisPc = (ds) => ds.find((d) => /computer/i.test(d.type) && !d.is_restricted && String(d.name).toLowerCase() === host);
  const best = (ds) => { const u = ds.filter((d) => !d.is_restricted); return thisPc(ds) || u.find((d) => /computer/i.test(d.type)) || u.find((d) => d.is_active) || u[0] || null; };
  let devices = await list();
  if (!best(devices)) {
    openUri('spotify:'); // nothing to play on: start Spotify and give it a few seconds to appear
    for (let i = 0; i < 10 && !best(devices); i++) { await sleep(700); devices = await list(); }
  }
  dbg('devices', devices.map((d) => ({ name: d.name, type: d.type, active: d.is_active, restricted: d.is_restricted })), 'this pc:', host);
  return best(devices);
}

async function playerState() {
  try { return await api('GET', '/me/player'); } catch { return null; }
}

// ---------------------------------------------------------------- actions the AI can call
// Find the exact song (or artist / album / playlist) and open it straight in the Spotify app.
// Fast and reliable: no remote "press play" commands, which some PCs' Spotify apps ignore.
async function play({ query, type = 'track' } = {}) {
  query = String(query || '').trim();
  if (!query) return 'Tell me what to play.';
  if (!['track', 'artist', 'album', 'playlist'].includes(type)) type = 'track';
  if (!connected()) {
    openUri(`spotify:search:${encodeURIComponent(query)}`);
    return `I opened a Spotify search for "${query}". Connect Spotify in Settings and I'll open the exact song for you.`;
  }
  try {
    const res = await api('GET', `/search?${new URLSearchParams({ q: query, type, limit: '5' })}`);
    const item = (((res && res[type + 's']) || {}).items || []).find(Boolean);
    if (!item) {
      openUri(`spotify:search:${encodeURIComponent(query)}`);
      return `I couldn't find "${query}" exactly, so I opened a Spotify search for it.`;
    }
    await openAndPlay(item.uri);
    const by = item.artists ? ` by ${item.artists.map((a) => a.name).join(', ')}` : item.owner ? ` by ${item.owner.display_name}` : '';
    dbg('opened', item.uri);
    return `Playing ${type === 'track' ? '' : type + ' '}"${item.name}"${by} on Spotify.`;
  } catch (e) {
    openUri(`spotify:search:${encodeURIComponent(query)}`);
    return `${explain(e)} I opened a Spotify search for "${query}" instead.`;
  }
}

async function nowPlaying() {
  if (connected()) {
    try {
      const cur = await api('GET', '/me/player/currently-playing');
      if (!cur || !cur.item) return 'Nothing is playing on Spotify right now.';
      const it = cur.item;
      const by = it.artists ? ` by ${it.artists.map((a) => a.name).join(', ')}` : it.show ? ` from ${it.show.name}` : '';
      return `${cur.is_playing ? 'Playing' : 'Paused on'} "${it.name}"${by}${it.album ? `, from the album "${it.album.name}"` : ''}.`;
    } catch (e) {
      if (e.status !== 403) return explain(e);
    }
  }
  const t = await windowTitle();
  if (t === null) return 'I can only check what is playing on Windows, or after Spotify is connected in Settings.';
  if (!t) return 'Spotify is not open.';
  if (/^spotify( free| premium)?$/i.test(t)) return 'Spotify is open but nothing is playing.';
  const [artist, ...rest] = t.split(' - ');
  return rest.length ? `Playing "${rest.join(' - ')}" by ${artist}.` : `Spotify shows: ${t}.`;
}

async function control({ action, volume_percent } = {}, mediaKey) {
  const keyFor = { pause: 'play_pause', resume: 'play_pause', next: 'next', previous: 'previous' };
  if (connected()) {
    try {
      if (action === 'pause') await api('PUT', '/me/player/pause');
      else if (action === 'resume') await api('PUT', '/me/player/play');
      else if (action === 'next') await api('POST', '/me/player/next');
      else if (action === 'previous') await api('POST', '/me/player/previous');
      else if (action === 'shuffle_on' || action === 'shuffle_off') await api('PUT', `/me/player/shuffle?state=${action === 'shuffle_on'}`);
      else if (action === 'volume') {
        const v = Math.max(0, Math.min(100, Math.round(Number(volume_percent))));
        if (!Number.isFinite(v)) return 'Tell me a volume from 0 to 100.';
        await api('PUT', `/me/player/volume?volume_percent=${v}`);
        return `Spotify volume set to ${v}%.`;
      } else return 'Unknown Spotify action.';
      return { pause: 'Paused Spotify.', resume: 'Resumed Spotify.', next: 'Skipped to the next song.', previous: 'Went back a song.',
        shuffle_on: 'Shuffle is on.', shuffle_off: 'Shuffle is off.' }[action] || 'Done.';
    } catch (e) {
      if (!keyFor[action]) return explain(e);
    }
  }
  if (keyFor[action]) return mediaKey({ action: keyFor[action] });
  return 'Shuffle and exact volume need Spotify connected in Settings (Spotify Premium).';
}

async function queue({ query } = {}) {
  query = String(query || '').trim();
  if (!connected()) return 'Adding to the queue needs Spotify connected in Settings (Spotify Premium).';
  try {
    const res = await api('GET', `/search?${new URLSearchParams({ q: query, type: 'track', limit: '5' })}`);
    const item = ((res && res.tracks) || {}).items && res.tracks.items.find(Boolean);
    if (!item) return `Spotify found nothing for "${query}".`;
    await api('POST', `/me/player/queue?uri=${encodeURIComponent(item.uri)}`);
    return `Added "${item.name}" by ${item.artists.map((a) => a.name).join(', ')} to the queue.`;
  } catch (e) {
    return explain(e);
  }
}

module.exports = { init, connect, disconnect, connected, play, nowPlaying, control, queue, REDIRECT_URI };
