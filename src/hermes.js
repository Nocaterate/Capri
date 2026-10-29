// Windows side of the Capri <-> Hermes Agent connection.
// Hermes runs inside WSL2. This file checks WSL, turns on WSL mirrored networking, runs the
// setup script inside WSL, and starts / stops the Hermes gateway together with Capri.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const HERMES_URL = 'http://127.0.0.1:8642';
const isWin = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // single-quote for bash

function wsl(args, timeout = 60000) {
  return new Promise((resolve) => {
    if (!isWin) return resolve({ code: -1, out: 'WSL is only on Windows.' });
    execFile('wsl.exe', args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      // wsl.exe's own messages are UTF-16; strip the NULs so they read normally
      const out = `${stdout || ''}${stderr || ''}`.replace(/\u0000/g, '').trim();
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out });
    });
  });
}
const bash = (cmd, timeout) => wsl(['-e', 'bash', '-lc', `export PATH="$HOME/.local/bin:$PATH"; ${cmd}`], timeout);

async function health(url = `${HERMES_URL}/health`) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
}

// Is it *our* Hermes answering, with the key Capri gave it? ('ok' | 'wrong-key' | 'down')
async function verify(key) {
  try {
    const r = await fetch(`${HERMES_URL}/v1/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000) });
    if (r.ok) return 'ok';
    if (r.status === 401 || r.status === 403) return 'wrong-key';
    return 'down';
  } catch { return 'down'; }
}

async function status() {
  if (!isWin) return { wsl: false, hermes: false, gateway: await health() };
  const w = await wsl(['-e', 'true'], 20000);
  if (w.code !== 0) return { wsl: false, hermes: false, gateway: false };
  // installed = its folder exists; the setup script repairs a missing `hermes` command
  const h = await bash('test -d "$HOME/.hermes/hermes-agent" -o -d "$HOME/.hermes" && echo yes', 20000);
  return { wsl: true, hermes: /yes/.test(h.out), gateway: await health() };
}

// WSL mirrored networking (Windows 11 22H2+): localhost works both ways between Windows and WSL.
function ensureMirrored() {
  const build = Number(String(os.release()).split('.')[2] || 0);
  if (build < 22621) return { supported: false, changed: false };
  const file = path.join(os.homedir(), '.wslconfig');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* no file yet */ }
  const lines = text.split(/\r?\n/);
  let sec = null, wsl2 = -1, setAt = -1;
  lines.forEach((l, i) => {
    const m = l.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) { sec = m[1].trim().toLowerCase(); if (sec === 'wsl2') wsl2 = i; return; }
    if (sec === 'wsl2' && /^\s*networkingMode\s*=/i.test(l)) setAt = i;
  });
  if (setAt >= 0 && /=\s*mirrored\s*$/i.test(lines[setAt])) return { supported: true, changed: false };
  if (setAt >= 0) lines[setAt] = 'networkingMode=mirrored';
  else if (wsl2 >= 0) lines.splice(wsl2 + 1, 0, 'networkingMode=mirrored');
  else { if (text.trim()) lines.push(''); lines.push('[wsl2]', 'networkingMode=mirrored'); }
  if (text) fs.copyFileSync(file, file + '.bak-capri');
  fs.writeFileSync(file, lines.join('\r\n').replace(/(\r\n)*$/, '\r\n'));
  return { supported: true, changed: true };
}

// Copy the setup script somewhere WSL can read it (Unix line endings) and run it inside WSL.
async function runSetup({ userDir, scriptSource, apiKey, mcpToken, mcpPort, brain }) {
  const dir = path.join(userDir, 'hermes');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'setup-capri.sh');
  fs.writeFileSync(file, fs.readFileSync(scriptSource, 'utf8').replace(/\r\n/g, '\n'));
  let cmd = `bash "$(wslpath -u ${q(file)})" --api-key ${q(apiKey)} --mcp-token ${q(mcpToken)} --mcp-port ${q(mcpPort)}`;
  if (brain) cmd += ` --brain ${q(brain.kind)} --brain-model ${q(brain.model)} --brain-url ${q(brain.url || '')} --brain-key ${q(brain.key)}`;
  const res = await bash(cmd, 90000);
  return { ...res, file, command: cmd };
}

let child = null;
let starting = null;
// name of Hermes's systemd user service, if the installer made one (prefer one with "gateway" in its name)
const FIND_UNIT = "systemctl --user list-unit-files --no-legend 2>/dev/null | awk 'tolower($1) ~ /hermes/ {print $1}' | awk '{a[NR]=$0} /gateway/ {print; f=1; exit} END {if (!f && NR) print a[1]}'";
// Run `hermes gateway run` in WSL and keep it attached: stdin stays open (some CLIs quit on an empty stdin),
// and its output goes to Capri's activity log so we can see why it stops.
function startGateway(log) {
  if (starting) return starting;
  starting = (async () => {
    if (await health()) return true;
    if (!isWin) return false;
    if (child) { try { child.kill(); } catch { /* gone */ } child = null; }
    log('starting hermes gateway in WSL');
    // The installer may have set Hermes up as a systemd service: then restart that service (starting a second
    // gateway is refused), and keep this WSL session open so WSL doesn't shut the service down, showing its log.
    const cmd = [
      'export PATH="$HOME/.local/bin:$PATH" PYTHONUNBUFFERED=1',
      `UNIT="$(${FIND_UNIT})"`,
      'if [ -n "$UNIT" ]; then',
      '  echo "[capri] Hermes runs as the service $UNIT; restarting it"',
      '  hermes gateway restart --yes 2>&1 || systemctl --user restart "$UNIT" 2>&1',
      '  journalctl --user -u "$UNIT" -f -n 15 --no-pager -o cat 2>&1',
      '  exec sleep infinity',
      'fi',
      'hermes gateway run 2>&1; code=$?; echo "[capri] hermes gateway run exited with code $code"; exit $code',
    ].join('\n');
    const me = spawn('wsl.exe', ['-e', 'bash', '-lc', cmd], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = me;
    let lines = 0;
    const onData = (d) => {
      for (const raw of String(d).replace(/\u0000/g, '').split(/\r?\n/)) {
        const l = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!l) continue;
        lines++;
        // everything at first, later only the important lines
        if (lines <= 120 || /error|warn|exception|traceback|fail|listening|exit|stopp|denied|refused|address/i.test(l)) log('hermes:', l.slice(0, 400));
      }
    };
    me.stdout.on('data', onData);
    me.stderr.on('data', onData);
    me.on('exit', (c) => { log('hermes gateway exited', c); if (child === me) child = null; });
    me.on('error', (e) => log('hermes gateway failed to start', e.message));
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      if (await health()) { log('hermes gateway is answering on port 8642'); return true; }
      if (child !== me) break; // it quit
    }
    log('hermes gateway did not answer on port 8642');
    return false;
  })().finally(() => { starting = null; });
  return starting;
}
// leaveService: when Capri quits, a systemd service keeps running (it's yours, e.g. for Telegram)
async function stopGateway({ leaveService = false } = {}) {
  const c = child;
  child = null;
  if (c) { try { c.stdin.end(); c.kill(); } catch { /* gone */ } }
  if (leaveService && isWin) { await bash(`[ -n "$(${FIND_UNIT})" ] || pkill -f "hermes gateway" || true`, 15000); return; }
  // a systemd service gets stopped properly (killing it would just make systemd restart it)
  if (isWin) await bash(`if [ -n "$(${FIND_UNIT})" ]; then hermes gateway stop --yes >/dev/null 2>&1 || true; else pkill -f "hermes gateway" || true; fi`, 15000);
}
const gatewayAlive = () => !!child;

module.exports = { status, health, verify, ensureMirrored, runSetup, startGateway, stopGateway, gatewayAlive, wsl, HERMES_URL };
