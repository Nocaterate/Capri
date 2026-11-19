// Screen time for the Hub: every few seconds, which app is in front (the pc helper's cheap `foreground`), added up
// per app per day in <userData>/screentime.json (62 days kept). Only app names and exe paths are stored, never
// window titles. Time while you're away (no input for 3 minutes) doesn't count, unless the app is full screen
// (a movie or a game you watch without touching anything).
const fs = require('fs');
const path = require('path');

const POLL_MS = 5000;
const AWAY_MS = 3 * 60e3;
const KEEP_DAYS = 62;

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// what to call an app: its file description ("Google Chrome"), else a tidied process name ("StarRail" -> "Star Rail")
function appName(fg) {
  const desc = String(fg.desc || '').trim();
  if (desc && desc.length <= 40 && !/^(microsoft® windows® operating system|application frame host)$/i.test(desc)) return desc;
  const p = String(fg.process || '').replace(/\.exe$/i, '');
  return p.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim() || 'Unknown';
}
function appKey(fg) {
  if (/^applicationframehost$/i.test(fg.process || '')) {
    // Store apps all run inside ApplicationFrameHost: the window title's last part names the app
    const t = String(fg.title || '').split(/\s[-–—]\s/).pop().trim();
    return t ? { key: `uwp:${t.toLowerCase()}`, name: t, path: '' } : null;
  }
  const p = String(fg.path || '').trim();
  const key = (p || String(fg.process || '')).toLowerCase();
  if (!key) return null;
  return { key, name: appName(fg), path: p };
}

function createScreenTime({ pc, file, log = () => {}, getConfig, selfName = 'Capri' }) {
  let data = { days: {}, apps: {} };
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d && d.days) data = { days: d.days || {}, apps: d.apps || {} }; } catch { /* first run */ }
  let timer = null, lastAt = 0, dirty = false, saveTimer = null, failures = 0, failUntil = 0;

  function save() {
    if (!dirty) return;
    dirty = false;
    try {
      const keep = Object.keys(data.days).sort().slice(-KEEP_DAYS);
      data.days = Object.fromEntries(keep.map((k) => [k, data.days[k]]));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    } catch (e) { log('screen time save failed', e.message); }
  }
  function add(app, secs) {
    if (!app || !(secs > 0)) return;
    const d = dayKey();
    const day = data.days[d] || (data.days[d] = {});
    day[app.key] = Math.round(((day[app.key] || 0) + secs) * 10) / 10;
    const meta = data.apps[app.key] || (data.apps[app.key] = {});
    meta.name = app.name; if (app.path) meta.path = app.path; meta.last = Date.now();
    dirty = true;
  }
  async function poll() {
    const now = Date.now();
    const elapsed = lastAt ? Math.min(POLL_MS * 2, now - lastAt) / 1000 : 0;
    lastAt = now;
    if (now < failUntil) return;
    let fg;
    try { fg = await pc.call('foreground', {}, 6000); failures = 0; } catch {
      failures++; failUntil = now + Math.min(10 * 60e3, 30e3 * failures);
      return;
    }
    if (!fg || fg.none) return;
    if ((fg.idle || 0) > AWAY_MS && !fg.fullscreen) return;
    if (fg.self) { add({ key: 'capri', name: selfName, path: '' }, elapsed); return; }
    add(appKey(fg), elapsed);
  }

  function start() {
    if (timer || process.platform !== 'win32') return;
    lastAt = 0;
    timer = setInterval(() => { poll().catch((e) => log('screen time poll', e.message)); }, POLL_MS);
    saveTimer = setInterval(save, 60e3);
    log('screen time on');
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer); clearInterval(saveTimer); timer = null; saveTimer = null;
    save();
    log('screen time off');
  }
  function sync() { if (getConfig().screenTime !== false) start(); else stop(); }

  // the Hub's numbers: today per app, the last 7 days' totals, and the apps you use most (for "Jump back in")
  function summary() {
    const today = dayKey();
    const todayMap = data.days[today] || {};
    const apps = Object.entries(todayMap).map(([key, s]) => ({ key, secs: Math.round(s), name: (data.apps[key] || {}).name || key, path: (data.apps[key] || {}).path || '' }))
      .sort((a, b) => b.secs - a.secs);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = dayKey(d);
      week.push({ day: k, secs: Math.round(Object.values(data.days[k] || {}).reduce((a, b) => a + b, 0)) });
    }
    return { on: !!timer || (getConfig().screenTime !== false && process.platform === 'win32'), today, total: apps.reduce((a, b) => a + b.secs, 0), apps, week };
  }
  // most used apps over the last 14 days that can be opened again (they have an exe path)
  function topApps(n = 8) {
    const tally = {};
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      for (const [k, s] of Object.entries(data.days[dayKey(d)] || {})) tally[k] = (tally[k] || 0) + s;
    }
    return Object.entries(tally)
      .map(([key, secs]) => ({ key, secs, ...(data.apps[key] || {}) }))
      .filter((a) => a.path && /\.exe$/i.test(a.path) && !/\\(explorer|capri|electron|searchhost|shellexperiencehost|startmenuexperiencehost|lockapp|applicationframehost)\.exe$/i.test(a.path))
      .sort((a, b) => b.secs - a.secs)
      .slice(0, n)
      .map((a) => ({ key: a.key, name: a.name || path.basename(a.path, '.exe'), path: a.path, secs: Math.round(a.secs) }));
  }

  return { start, stop, sync, summary, topApps, save, _poll: poll, _data: () => data };
}

module.exports = { createScreenTime, appKey, appName, dayKey };
