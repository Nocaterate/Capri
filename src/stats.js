// PC statistics for the Hub (a small Task Manager): CPU, memory, GPU (nvidia-smi when there is one), network speed,
// the busiest processes and every fixed disk. Sampled only while the Hub's Stats page asks for it.
// CPU per process and network speed come from the difference between two samples.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const HISTORY = 40;

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { for (const v of Object.values(c.times)) total += v; idle += c.times.idle; }
  return { idle, total };
}

function nvidiaSmi() {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 4000 }, (err, out) => {
        if (err) return resolve(null);
        const [name, util, used, total, temp] = String(out).split('\n')[0].split(',').map((s) => s.trim());
        if (!name) return resolve(null);
        resolve({ name, util: Number(util) || 0, memUsed: Number(used) * 1048576 || 0, memTotal: Number(total) * 1048576 || 0, temp: Number(temp) || null });
      });
  });
}

// how big a folder is, stopping after a time limit (the temp folder can be huge)
function folderSize(dir, ms = 4000) {
  const until = Date.now() + ms;
  let bytes = 0, files = 0, partial = false;
  const walk = (d, depth) => {
    if (depth > 12) return;
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (Date.now() > until) { partial = true; return; }
      const full = path.join(d, it.name);
      if (it.isDirectory()) walk(full, depth + 1);
      else if (it.isFile()) { try { bytes += fs.statSync(full).size; files++; } catch { /* locked */ } }
    }
  };
  walk(dir, 0);
  return { bytes, files, partial };
}

function createStats({ pc, log = () => {}, ownPid = process.pid }) {
  let prev = null;          // { at, cpu, procs: Map(pid -> cpu seconds), rx, tx }
  let last = null, lastAt = 0, busy = null;
  let gpuMissing = false;
  const hist = { cpu: [], mem: [], gpu: [], net: [] };
  const push = (k, v) => { hist[k].push(Math.round(v * 10) / 10); if (hist[k].length > HISTORY) hist[k].shift(); };

  async function sample() {
    if (busy) return busy;
    if (last && Date.now() - lastAt < 900) return last;
    busy = (async () => {
      const now = Date.now();
      const cpu = cpuTimes();
      const cores = os.cpus().length || 1;
      let win = null;
      if (process.platform === 'win32') {
        try { win = await pc.call('stats', {}, 10000); } catch (e) { log('stats failed', e.message); }
      }
      const gpu = gpuMissing ? null : await nvidiaSmi();
      if (!gpu && !gpuMissing) { gpuMissing = true; }

      const secs = prev ? Math.max(0.2, (now - prev.at) / 1000) : 0;
      const cpuPct = prev ? Math.max(0, Math.min(100, 100 * (1 - (cpu.idle - prev.cpu.idle) / Math.max(1, cpu.total - prev.cpu.total)))) : 0;
      const memTotal = os.totalmem(), memUsed = memTotal - os.freemem();

      // processes, grouped by name like Task Manager's "apps" view
      const procTimes = new Map();
      const groups = new Map();
      for (const p of (win && win.procs) || []) {
        if (!p || !p.n) continue;
        procTimes.set(p.id, p.c || 0);
        const before = prev && prev.procs.get(p.id);
        const pct = prev && before != null ? Math.max(0, ((p.c || 0) - before) / secs / cores * 100) : 0;
        const g = groups.get(p.n) || { name: p.n, cpu: 0, mem: 0, count: 0, pids: [] };
        g.cpu += pct; g.mem += p.m || 0; g.count++; g.pids.push(p.id);
        groups.set(p.n, g);
      }
      const procs = [...groups.values()]
        .filter((g) => !/^(idle|system idle process)$/i.test(g.name))
        .sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)
        .slice(0, 14)
        .map((g) => ({ ...g, cpu: Math.round(g.cpu * 10) / 10, self: g.pids.includes(ownPid) }));

      const rx = win ? Number(win.rx) || 0 : 0, tx = win ? Number(win.tx) || 0 : 0;
      const down = prev && rx >= prev.rx ? (rx - prev.rx) / secs : 0;
      const up = prev && tx >= prev.tx ? (tx - prev.tx) / secs : 0;

      if (prev) {
        push('cpu', cpuPct); push('mem', (memUsed / memTotal) * 100);
        push('gpu', gpu ? gpu.util : 0); push('net', down + up);
      }
      prev = { at: now, cpu, procs: procTimes, rx, tx };
      const c0 = os.cpus()[0] || {};
      last = {
        at: now,
        cpu: { pct: Math.round(cpuPct), cores, model: String(c0.model || '').replace(/\s+/g, ' ').trim(), mhz: c0.speed || 0 },
        mem: { used: memUsed, total: memTotal },
        gpu,
        net: { down, up },
        procs,
        procCount: win && win.procs ? win.procs.length : 0,
        disks: ((win && win.disks) || []).map((d) => ({ name: d.name, label: d.label || '', total: Number(d.total) || 0, free: Number(d.free) || 0 })),
        uptime: os.uptime(),
        history: { cpu: [...hist.cpu], mem: [...hist.mem], gpu: [...hist.gpu], net: [...hist.net] },
        ready: !!prev && hist.cpu.length > 0,
      };
      lastAt = now;
      return last;
    })();
    try { return await busy; } finally { busy = null; }
  }

  // Recycle Bin and temp folder sizes (only when the Stats page opens). The bin is read straight from each fixed
  // drive's $Recycle.Bin (your own folder there; other users' are locked), never through the pc helper: walking it
  // with the Shell can take long and would block everything else the helper does.
  async function cleanup() {
    const temp = folderSize(os.tmpdir(), 3000);
    let bin = null;
    if (process.platform === 'win32') {
      bin = { bytes: 0, count: 0, partial: false };
      const drives = (last && last.disks && last.disks.length ? last.disks.map((d) => d.name) : ['C:\\']);
      for (const d of drives) {
        const root = path.join(d, '$Recycle.Bin');
        let sids = [];
        try { sids = fs.readdirSync(root, { withFileTypes: true }).filter((x) => x.isDirectory()); } catch { continue; }
        for (const sid of sids) {
          const dir = path.join(root, sid.name);
          let items = [];
          try { items = fs.readdirSync(dir); } catch { continue; }
          bin.count += items.filter((f) => /^\$I/i.test(f)).length;
          const r = folderSize(dir, 2000);
          bin.bytes += r.bytes; if (r.partial) bin.partial = true;
        }
      }
    }
    return { temp: { ...temp, dir: os.tmpdir() }, bin };
  }
  // empty the Recycle Bin in its own PowerShell (it can take a while with many files)
  function emptyBin() {
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue'],
        { windowsHide: true, timeout: 180000 }, (err) => resolve(err && err.killed ? { ok: false, error: 'it took too long' } : { ok: true }));
    });
  }

  // delete temp files that haven't changed for a day (skips anything in use)
  function cleanTemp() {
    const root = os.tmpdir();
    const cutoff = Date.now() - 24 * 3600e3;
    let bytes = 0, files = 0, skipped = 0;
    const walk = (d, depth) => {
      if (depth > 12) return;
      let items = [];
      try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const it of items) {
        const full = path.join(d, it.name);
        if (/^capri-pc-helper\.ps1$|^capri-icons/i.test(it.name)) continue;
        if (it.isDirectory()) {
          walk(full, depth + 1);
          try { if (!fs.readdirSync(full).length) fs.rmdirSync(full); } catch { /* in use */ }
        } else {
          try {
            const s = fs.statSync(full);
            if (s.mtimeMs > cutoff) { skipped++; continue; }
            fs.unlinkSync(full); bytes += s.size; files++;
          } catch { skipped++; }
        }
      }
    };
    walk(root, 0);
    return { bytes, files, skipped };
  }

  return { sample, cleanup, cleanTemp, emptyBin };
}

module.exports = { createStats, folderSize };
