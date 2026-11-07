// Care & PC alerts: Capri looks after you and your PC. Once a minute (main process) she checks:
//   you   - an eye break every 20 minutes of use, a water reminder every hour of use, bedtime after a set time
//   PC    - CPU busy over 90% for 2 minutes, the system disk over 90% full, the internet dropping / coming back
// (low battery is watched in the overlay, through the browser's battery API).
// Each alert is said once (with a cooldown) through onSay; nothing is stored. Settings switch each group off.
const fs = require('fs');
const os = require('os');

const LINES = {
  eyes: [['relaxed', 'Eye break! Look at something far away for 20 seconds~'], ['relaxed', "20 minutes on the screen. Rest your eyes for a moment, I'll wait."], ['happy', 'Blink blink! Look out the window for 20 seconds?']],
  water: [['happy', 'Water check! Take a sip for me?'], ['happy', "It's been an hour. Drink some water, okay?"], ['relaxed', 'Hydration time~ I run on electricity, you run on water.']],
  bedtime: [['sad', "It's {time}... go to sleep, okay? I'll guard your to-dos."], ['angry', "{time}?! Bed. Now. Everything will still be here tomorrow."], ['relaxed', "It's {time}. Five more minutes, then sleep. Promise?"]],
  cpu: [['surprised', "Your PC is working super hard (CPU {n}%). I'm overheating! Close something heavy?"], ['surprised', 'CPU at {n}%... something is eating your PC. Want me to look?']],
  disk: [['surprised', 'Your {drive} drive is {n}% full. Maybe clean up Downloads?'], ['sad', "Disk {drive} is {n}% full... we're running out of room."]],
  offline: [['sad', "Uh oh, we're offline. Check the Wi-Fi?"], ['surprised', 'The internet just dropped! I lost my connection.']],
  online: [['happy', "Back online! I can think again~"], ['happy', 'Internet is back!']],
};
const pickLine = (kind, vars = {}) => {
  const [emotion, t] = LINES[kind][Math.floor(Math.random() * LINES[kind].length)];
  return { emotion, text: t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) };
};

function parseClock(s, fallback) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? (Number(m[1]) % 24) * 60 + Number(m[2]) : fallback;
}

function createCare({ getConfig, getIdleSeconds, isOnline, log = () => {}, isBusy = () => false, onSay }) {
  let timer = null;
  let activeMin = 0, waterMin = 0, lastBed = 0;
  let cpuPrev = null, cpuHigh = 0, lastCpu = 0;
  let lastDisk = 0, lastDiskCheck = 0;
  let netFails = 0, offline = false;
  const pending = [];                              // alerts waiting for her to be free

  function cpuPercent() {
    const now = os.cpus().reduce((a, c) => { for (const k in c.times) a[k === 'idle' ? 'idle' : 'busy'] += c.times[k]; return a; }, { idle: 0, busy: 0 });
    const prev = cpuPrev; cpuPrev = now;
    if (!prev) return 0;
    const busy = now.busy - prev.busy, idle = now.idle - prev.idle;
    return busy + idle > 0 ? Math.round((busy / (busy + idle)) * 100) : 0;
  }
  function say(kind, vars) {
    const l = pickLine(kind, vars);
    pending.push({ ...l, kind });
    while (pending.length > 3) pending.shift();
  }

  async function tick() {
    const cfg = getConfig();
    const now = Date.now();
    const idle = Number(getIdleSeconds()) || 0;
    // ---- you
    if (idle < 120) { activeMin++; waterMin++; } else if (idle >= 300) activeMin = 0;   // 5 min away = your eyes had a break
    if (idle >= 1800) waterMin = 0;
    if (cfg.careEyes !== false && activeMin >= 20) { activeMin = 0; say('eyes'); }
    if (cfg.careWater !== false && waterMin >= 60) { waterMin = 0; say('water'); }
    if (cfg.careBedtime !== false && idle < 120) {
      const d = new Date(), m = d.getHours() * 60 + d.getMinutes();
      const bed = parseClock(cfg.careBedtimeAt, 0), wake = 5 * 60;
      const late = bed <= wake ? m >= bed && m < wake : m >= bed || m < wake;
      if (late && now - lastBed > 45 * 60e3) { lastBed = now; say('bedtime', { time: d.toTimeString().slice(0, 5) }); }
    }
    // ---- the PC
    if (cfg.carePc !== false) {
      const cpu = cpuPercent();
      cpuHigh = cpu >= 90 ? cpuHigh + 1 : 0;
      if (cpuHigh >= 2 && now - lastCpu > 30 * 60e3) { lastCpu = now; say('cpu', { n: cpu }); }
      if (now - lastDiskCheck > 30 * 60e3) {
        lastDiskCheck = now;
        try {
          const drive = process.platform === 'win32' ? `${process.env.SystemDrive || 'C:'}\\` : '/';
          const s = fs.statfsSync(drive);
          const used = Math.round((1 - s.bavail / s.blocks) * 100);
          if (used >= 90 && now - lastDisk > 24 * 3600e3) { lastDisk = now; say('disk', { n: used, drive: drive.replace(/\\$/, '') }); }
        } catch (e) { log('care disk check failed:', e.message); }
      }
      let ok = true;
      try { ok = await isOnline(); } catch { ok = false; }
      if (!ok) { netFails++; if (netFails === 2 && !offline) { offline = true; say('offline'); } }
      else { if (offline) say('online'); offline = false; netFails = 0; }
    } else cpuPercent();
    // ---- say what's waiting, one at a time, when she's free
    if (pending.length && !isBusy()) {
      const l = pending.shift();
      log('care:', l.kind);
      onSay(l);
    }
  }

  function start() {
    if (timer) return;
    cpuPercent();
    timer = setInterval(() => { tick().catch((e) => log('care tick', e.message)); }, 60e3);
    log('care alerts on');
  }
  function stop() { clearInterval(timer); timer = null; }
  return { start, stop, tick, _state: () => ({ activeMin, waterMin, cpuHigh, offline, pending: pending.length }) };
}

module.exports = { createCare, pickLine, parseClock, LINES };
