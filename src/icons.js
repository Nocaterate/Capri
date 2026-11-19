// App icons for the Hub, as data: URLs. The real Windows icon of an exe, a shortcut or a Start-menu app
// (shell:AppsFolder\<AppID>, Store apps included) is made by src/icons.ps1 and kept in <userData>/icons/<hash>.png,
// so each icon is only made once. If the shell can't give one, Electron's own file icon is the fallback.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const keyOf = (target) => crypto.createHash('sha1').update(String(target).toLowerCase()).digest('hex').slice(0, 20);

function createIcons({ dir, log = () => {}, getFileIcon, onReady = () => {} }) {
  const mem = new Map();            // key -> data URL ('' = no icon)
  const queue = new Map();          // key -> target
  let running = false;

  function fromDisk(key) {
    try {
      const f = path.join(dir, `${key}.png`);
      if (!fs.existsSync(f)) return null;
      return `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
    } catch { return null; }
  }
  // ---------------- website icons ("fav:https://site/..."): the site's own icon, fetched once and kept
  const favBusy = new Set();
  async function fetchIcon(u) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(7000), redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 Capri' } });
      if (!r.ok) return null;
      const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > 600 * 1024) return null;
      const t = /^image\//.test(type) ? type : /\.ico(\?|$)/i.test(u) ? 'image/x-icon' : /\.svg(\?|$)/i.test(u) ? 'image/svg+xml' : /\.png(\?|$)/i.test(u) ? 'image/png' : '';
      if (!t) return null;
      return `data:${t};base64,${buf.toString('base64')}`;
    } catch { return null; }
  }
  async function favicon(target) {
    const key = keyOf(target);
    if (favBusy.has(key)) return;
    favBusy.add(key);
    let url = null;
    try {
      const page = new URL(target.slice(4));
      if (!/^https?:$/.test(page.protocol)) throw new Error('not a web page');
      const cands = [];
      try {
        const r = await fetch(page.href, { signal: AbortSignal.timeout(8000), redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 Capri' } });
        const html = (await r.text()).slice(0, 300000);
        const base = r.url || page.href;
        for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
          const tag = m[0];
          const rel = (tag.match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1] || '';
          const href = (tag.match(/\bhref\s*=\s*["']?([^"' >]+)/i) || [])[1];
          if (!href || !/icon/i.test(rel) || /mask-icon/i.test(rel)) continue;
          const size = Number(((tag.match(/\bsizes\s*=\s*["']?(\d+)/i) || [])[1]) || (/apple-touch/i.test(rel) ? 180 : 32));
          try { cands.push({ u: new URL(href, base).href, size }); } catch { /* bad href */ }
        }
      } catch { /* the page didn't load: try /favicon.ico */ }
      cands.sort((a, b) => (Math.abs(a.size - 96) - Math.abs(b.size - 96)));
      cands.push({ u: `${page.origin}/favicon.ico` });
      for (const c of cands.slice(0, 5)) { url = await fetchIcon(c.u); if (url) break; }
    } catch { url = null; }
    mem.set(key, url || '');
    if (url) { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${key}.txt`), url); } catch { /* fine */ } }
    favBusy.delete(key);
    onReady({ [target]: url || null });
  }

  // targets: strings. Returns what is known now; the rest arrive later through onReady({ target: url })
  function get(targets) {
    const out = {};
    for (const t of new Set((targets || []).filter(Boolean).map(String))) {
      const key = keyOf(t);
      if (t.startsWith('fav:')) {
        if (mem.has(key)) { out[t] = mem.get(key) || null; continue; }
        try { const u = fs.readFileSync(path.join(dir, `${key}.txt`), 'utf8'); if (u) { mem.set(key, u); out[t] = u; continue; } } catch { /* not yet */ }
        favicon(t);
        continue;
      }
      if (mem.has(key)) { out[t] = mem.get(key) || null; continue; }
      const url = fromDisk(key);
      if (url) { mem.set(key, url); out[t] = url; continue; }
      queue.set(key, t);
    }
    if (queue.size) setTimeout(run, 30);
    return out;
  }

  async function fallback(key, target) {
    if (!getFileIcon || !/^[a-z]:\\/i.test(target)) return '';
    try {
      const img = await getFileIcon(target, { size: 'large' });
      if (!img || img.isEmpty()) return '';
      const png = img.toPNG();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${key}.png`), png);
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch { return ''; }
  }

  async function run() {
    if (running || !queue.size) return;
    running = true;
    const batch = [...queue.entries()].slice(0, 80);
    for (const [k] of batch) queue.delete(k);
    const done = {};
    try {
      if (process.platform !== 'win32') throw new Error('icons need Windows');
      fs.mkdirSync(dir, { recursive: true });
      const script = path.join(os.tmpdir(), 'capri-icons.ps1');
      fs.writeFileSync(script, '﻿' + fs.readFileSync(path.join(__dirname, 'icons.ps1'), 'utf8'));
      const listFile = path.join(os.tmpdir(), `capri-icons-${process.pid}.txt`);
      fs.writeFileSync(listFile, batch.map(([k, t]) => `${k}\t${t}`).join('\n'), 'utf8');
      const out = await new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script, listFile, dir],
          { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1048576 }, (err, stdout, stderr) => {
            if (err && !stdout) log('icons:', (stderr || err.message || '').toString().trim().slice(0, 300));
            resolve(String(stdout || ''));
          });
      });
      try { fs.unlinkSync(listFile); } catch { /* fine */ }
      const ok = new Set();
      for (const line of out.split('\n')) { try { const j = JSON.parse(line.trim()); if (j.ok) ok.add(j.key); } catch { /* not json */ } }
      for (const [k, t] of batch) {
        let url = ok.has(k) ? fromDisk(k) : null;
        if (!url) url = await fallback(k, t);
        mem.set(k, url || '');
        done[t] = url || null;
      }
      const made = Object.values(done).filter(Boolean).length;
      if (batch.length) log(`icons: ${made} of ${batch.length} made`);
    } catch (e) {
      for (const [k, t] of batch) { const url = await fallback(k, t); mem.set(k, url); done[t] = url || null; }
    }
    running = false;
    onReady(done);
    if (queue.size) setTimeout(run, 30);
  }

  return { get, keyOf };
}

module.exports = { createIcons, keyOf };
