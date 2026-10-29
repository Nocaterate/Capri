// Open, close and list desktop apps (Windows).
// Open: any app in the Start menu (desktop and Store apps), found by name.
// Close: asks the app's windows to close, like clicking X, so apps can still ask you to save.
const { spawn, execFile } = require('child_process');

// Windows itself, and Capri: never close these
const PROTECTED = new Set([
  'explorer', 'capri', 'electron', 'csrss', 'winlogon', 'wininit', 'services', 'lsass', 'svchost', 'dwm', 'system',
  'searchhost', 'searchapp', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost', 'lockapp',
  'taskmgr', 'systemsettings', 'sihost', 'ctfmon', 'runtimebroker', 'securityhealthsystray',
]);

// spoken names → what the Start menu calls them
const ALIASES = {
  'vs code': 'visual studio code', vscode: 'visual studio code', code: 'visual studio code',
  word: 'word', excel: 'excel', powerpoint: 'powerpoint', calc: 'calculator', 'file explorer': 'file explorer',
  files: 'file explorer', settings: 'settings', 'control panel': 'control panel', cmd: 'command prompt',
  terminal: 'terminal', 'task manager': 'task manager', browser: 'microsoft edge', edge: 'microsoft edge',
  chrome: 'google chrome', wa: 'whatsapp', ig: 'instagram',
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function powershell(script, env = {}) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Opening and closing apps only works on Windows for now.'));
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script],
      { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...env } },
      (err, out) => (err ? reject(err) : resolve(String(out || '').trim())));
  });
}
const parseList = (out) => { if (!out) return []; const j = JSON.parse(out); return Array.isArray(j) ? j : [j]; };

// best match by name: exact > starts with > word starts with > contains > all words present
function score(name, q) {
  const n = norm(name);
  if (!n || !q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q + ' ') || n.startsWith(q)) return 85;
  if ((' ' + n).includes(' ' + q)) return 70;
  if (n.includes(q)) return 55;
  const words = q.split(' ');
  if (words.length > 1 && words.every((w) => n.includes(w))) return 45;
  return 0;
}
function best(list, q, keyFns) {
  let top = null;
  for (const item of list) {
    const s = Math.max(...keyFns.map((f) => score(f(item), q)));
    if (s > 0 && (!top || s > top.s || (s === top.s && String(keyFns[0](item)).length < String(keyFns[0](top.item)).length))) top = { item, s };
  }
  return top && top.item;
}

let startApps = null, startAppsAt = 0;
async function getStartApps() {
  if (startApps && Date.now() - startAppsAt < 5 * 60 * 1000) return startApps;
  startApps = parseList(await powershell('Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress'));
  startAppsAt = Date.now();
  return startApps;
}

async function openApp({ name } = {}) {
  const raw = norm(name);
  if (!raw) return 'Tell me which app to open.';
  const q = ALIASES[raw] || raw;
  let apps;
  try { apps = await getStartApps(); } catch (e) { return e.message; }
  const app = best(apps, q, [(a) => a.Name]);
  if (!app) return `I couldn't find an app called "${name}" in the Start menu.`;
  const child = spawn('explorer.exe', [`shell:AppsFolder\\${app.AppID}`], { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
  return `Opening ${app.Name}.`;
}

async function openWindows() {
  const out = await powershell(
    "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | " +
    "Select-Object Id, ProcessName, MainWindowTitle, @{n='Desc';e={$_.Description}} | ConvertTo-Json -Compress");
  return parseList(out).filter((p) => !PROTECTED.has(String(p.ProcessName).toLowerCase()));
}

async function listOpenApps() {
  let wins;
  try { wins = await openWindows(); } catch (e) { return e.message; }
  if (!wins.length) return 'No app windows are open.';
  const names = [...new Set(wins.map((w) => (w.Desc && w.ProcessName !== 'ApplicationFrameHost' ? w.Desc : w.MainWindowTitle)))];
  return `Open apps: ${names.slice(0, 25).join(', ')}.`;
}

async function closeApp({ name } = {}) {
  const raw = norm(name);
  if (!raw) return 'Tell me which app to close.';
  const q = ALIASES[raw] || raw;
  let wins;
  try { wins = await openWindows(); } catch (e) { return e.message; }
  const hit = best(wins, q, [(w) => w.Desc, (w) => w.ProcessName, (w) => w.MainWindowTitle]);
  if (!hit) return `I don't see an open app called "${name}".`;
  // Store apps all live in ApplicationFrameHost, so close only that window; otherwise close every window of the app
  const targets = hit.ProcessName === 'ApplicationFrameHost' ? [hit] : wins.filter((w) => w.ProcessName === hit.ProcessName);
  const label = hit.ProcessName === 'ApplicationFrameHost' ? hit.MainWindowTitle : hit.Desc || hit.ProcessName;
  try {
    await powershell("foreach ($i in ($env:CAPRI_IDS -split ',')) { $p = Get-Process -Id $i -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() } }",
      { CAPRI_IDS: targets.map((t) => t.Id).join(',') });
    await new Promise((r) => setTimeout(r, 2500));
    const still = (await openWindows()).filter((w) => targets.some((t) => t.Id === w.Id));
    if (still.length) return `I asked ${label} to close, but it's still open. It may be waiting for you to save something.`;
    return `Closed ${label}.`;
  } catch (e) {
    return `Couldn't close ${label}: ${e.message}`;
  }
}

module.exports = { openApp, closeApp, listOpenApps, _test: { score, best, norm, ALIASES } };
