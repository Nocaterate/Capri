// Capri Terminal (design A): real PowerShell / CMD tabs (xterm.js on a ConPTY from src/terminal.js) in her TV colours.
// Typing "/" at the start of an empty line opens her panel at the bottom; "/capri ..." there asks her about what's
// on the screen (anything else you typed after "/" goes straight to the shell, so paths like /? still work).
// She answers in the panel with commands as steps: Run (Enter), Edit (Ctrl+E: put it in the shell for you to change)
// or Skip (Esc). With "Always allow" in Settings they run straight away, except risky ones (main decides that).
// Her text never goes into the shell's screen itself, so the shell's own display stays exactly right.
import META from '../assets/capri/sheet.js';

const T = window.capriTerm;
const $ = (id) => document.getElementById(id);
const el = { terms: $('terms'), tabs: $('tabs'), capri: $('capri'), log: $('log'), steps: $('steps'), form: $('ask-form'), ask: $('ask'),
  face: $('face'), feed: $('feed'), sheet: $('sheet'), add: $('add'), addMenu: $('add-menu') };
const THEME = {
  background: '#04080c', foreground: '#ffe0ec', cursor: '#ff70a2', cursorAccent: '#04080c', selectionBackground: 'rgba(255, 46, 120, 0.35)',
  black: '#0b0710', red: '#ff4d6d', green: '#2eff8c', yellow: '#f8e81c', blue: '#5ec8ff', magenta: '#ff70a2', cyan: '#20e8f0', white: '#ffe0ec',
  brightBlack: '#7d6a86', brightRed: '#ff7a93', brightGreen: '#7dffb5', brightYellow: '#fff27a', brightBlue: '#9adcff', brightMagenta: '#ffb3d1',
  brightCyan: '#8ff4f8', brightWhite: '#ffffff',
};
const SHELL_LABEL = { powershell: 'POWERSHELL', cmd: 'CMD' };
let NAME = 'Capri';

// ---------------------------------------------------------------- tabs
const tabs = [];
let active = null;
const byId = new Map();

const MAX_TABS = 12;                             // each tab is a whole shell: keep the PC (and the bar) sane
async function newTab(shell = 'powershell') {
  if (tabs.length >= MAX_TABS) { flashLimit(); return null; }
  const div = document.createElement('div');
  div.className = 'term';
  el.terms.appendChild(div);
  const term = new window.Terminal({
    fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace", fontSize: 14, lineHeight: 1.1, cursorBlink: true,
    scrollback: 5000, theme: THEME, allowTransparency: false,
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(div);
  const btn = document.createElement('div');
  btn.className = 'tab';
  btn.innerHTML = `<span class="name"></span><span class="x" title="Close tab">×</span>`;
  el.tabs.appendChild(btn);
  const tab = { id: 0, shell, term, fit, div, btn, typed: 0, lastData: 0, ended: false, history: [], plan: null };
  tabs.push(tab);
  btn.addEventListener('click', (e) => { if (e.target.classList.contains('x')) closeTab(tab); else activate(tab); });
  btn.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab); } });   // middle-click closes
  labelTabs();
  activate(tab);
  term.onData((d) => onInput(tab, d));
  term.onResize(({ cols, rows }) => { if (tab.id) T.resize(tab.id, cols, rows); });
  // copy / paste like Windows Terminal: Ctrl+C copies when something is selected, Ctrl+V pastes, right-click pastes
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); term.clearSelection(); return false; }
    if (e.ctrlKey && e.key.toLowerCase() === 'v') { navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => {}); return false; }
    return true;
  });
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); term.clearSelection(); }
    else navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => {});
  });
  fit.fit();
  const r = await T.spawn(shell, term.cols, term.rows);
  if (!r || r.error) {
    term.write(`\x1b[31mCouldn't start ${SHELL_LABEL[shell] || shell}: ${(r && r.error) || 'unknown error'}\x1b[0m\r\n`);
    tab.ended = true;
    return tab;
  }
  tab.id = r.id;
  byId.set(r.id, tab);
  return tab;
}
function activate(tab) {
  active = tab;
  for (const t of tabs) { t.div.hidden = t !== tab; t.btn.classList.toggle('on', t === tab); }
  requestAnimationFrame(() => showTab(tab));
  requestAnimationFrame(() => { refit(); if (el.capri.hidden) tab.term.focus(); });
  renderSteps();
}
function closeTab(tab) {
  if (tab.id) T.kill(tab.id);
  byId.delete(tab.id);
  tab.term.dispose(); tab.div.remove(); tab.btn.remove();
  tabs.splice(tabs.indexOf(tab), 1);
  if (!tabs.length) { T.windowCtl('close'); return; }
  labelTabs();
  if (active === tab) activate(tabs[tabs.length - 1]);
}
function refit() {
  if (!active || active.div.hidden) return;
  try { active.fit.fit(); } catch { /* not laid out yet */ }
}
new ResizeObserver(() => refit()).observe(el.terms);

// lots of tabs: they number themselves (POWERSHELL 2, CMD 3), get shorter (PS 4), and the bar scrolls
// (mouse wheel over it, the ‹ › buttons, or Ctrl+Tab)
function labelTabs() {
  const count = {};
  const many = tabs.length > 4;
  el.tabs.classList.toggle('many', many);
  for (const t of tabs) {
    count[t.shell] = (count[t.shell] || 0) + 1;
    const base = many ? (t.shell === 'cmd' ? 'CMD' : 'PS') : (SHELL_LABEL[t.shell] || 'SHELL');
    const n = tabs.filter((x) => x.shell === t.shell).length > 1 ? ` ${count[t.shell]}` : '';
    t.btn.querySelector('.name').textContent = base + n;
  }
  requestAnimationFrame(updateScroll);
}
const scrollL = $('tabs-left'), scrollR = $('tabs-right');
// scroll the bar just enough that this tab is fully in view
function showTab(tab) {
  const t = el.tabs, b = tab.btn;
  if (b.offsetLeft < t.scrollLeft) t.scrollTo({ left: b.offsetLeft - 4, behavior: 'instant' });
  else if (b.offsetLeft + b.offsetWidth > t.scrollLeft + t.clientWidth) t.scrollTo({ left: b.offsetLeft + b.offsetWidth - t.clientWidth + 4, behavior: 'instant' });
  updateScroll();
}
function updateScroll() {
  const over = el.tabs.scrollWidth > el.tabs.clientWidth + 1;
  scrollL.hidden = scrollR.hidden = !over;
  scrollL.disabled = el.tabs.scrollLeft <= 0;
  scrollR.disabled = el.tabs.scrollLeft + el.tabs.clientWidth >= el.tabs.scrollWidth - 1;
}
el.tabs.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); el.tabs.scrollLeft += e.deltaY; } }, { passive: false });
el.tabs.addEventListener('scroll', updateScroll);
scrollL.addEventListener('click', () => { el.tabs.scrollLeft -= el.tabs.clientWidth * 0.7; });
scrollR.addEventListener('click', () => { el.tabs.scrollLeft += el.tabs.clientWidth * 0.7; });
new ResizeObserver(() => { if (active) showTab(active); else updateScroll(); }).observe(el.tabs);
let limitTimer = null;
function flashLimit() {
  const b = el.add;
  b.textContent = `MAX ${MAX_TABS}`;
  b.style.color = '#ff4d6d'; b.style.borderColor = '#ff4d6d';
  clearTimeout(limitTimer);
  limitTimer = setTimeout(() => { b.textContent = '+'; b.style.color = ''; b.style.borderColor = ''; }, 1800);
}

T.onData(({ id, data }) => { const t = byId.get(id); if (!t) return; t.term.write(data); t.lastData = performance.now(); });
T.onExit(({ id }) => {
  const t = byId.get(id);
  if (!t) return;
  t.ended = true;
  t.term.write('\r\n\x1b[90m[the shell closed — close this tab or open a new one with +]\x1b[0m\r\n');
  t.btn.style.opacity = '0.5';
});
T.onNewTab((shell) => newTab(shell));

// what you type: tracked just enough to know when the line is empty (so "/" can open her panel)
function onInput(tab, d) {
  if (tab.ended || !tab.id) return;
  if (tab.typed === 0 && d === '/') { openCapri({ slash: true }); return; }
  if (d.startsWith('\x1b')) tab.typed = d === '\x1b' ? 0 : -1;            // Esc clears the line; arrows/history: unknown
  else {
    for (const c of d) {
      if (c === '\r' || c === '\x03') tab.typed = 0;
      else if (c === '\x7f' || c === '\b') { if (tab.typed > 0) tab.typed--; }
      else if (c === '\t') tab.typed = -1;
      else if (c >= ' ' && tab.typed >= 0) tab.typed++;
    }
  }
  T.write(tab.id, d);
}

// ---------------------------------------------------------------- her panel
let viaSlash = false, busy = false;
function openCapri({ slash = false, text = '' } = {}) {
  viaSlash = slash;
  el.capri.hidden = false;
  el.ask.value = slash ? '/' : text;
  refit();
  el.ask.focus();
  if (!el.log.childElementCount) logLine('sys', `${NAME.toUpperCase()} is linked to this terminal. Ask me anything about it~`);
}
function closeCapri() {
  if (busy) return;
  el.capri.hidden = true;
  viaSlash = false;
  refit();
  if (active) active.term.focus();
}
function logLine(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  el.log.appendChild(d);
  while (el.log.childElementCount > 60) el.log.firstChild.remove();
  el.log.scrollTop = el.log.scrollHeight;
  return d;
}
el.ask.addEventListener('input', () => {
  if (!viaSlash) return;
  const v = el.ask.value;
  // still on the way to "/capri", or already past it: stay; anything else was meant for the shell
  if ('/capri'.startsWith(v.toLowerCase()) || /^\/capri(\s|$)/i.test(v)) return;
  const tab = active;
  el.capri.hidden = true; viaSlash = false; refit();
  if (tab && !tab.ended && tab.id) { T.write(tab.id, v); tab.typed = v.length; tab.term.focus(); }
});
el.ask.addEventListener('keydown', (e) => {
  const tab = active, step = tab && tab.plan && tab.plan.steps.find((s) => s.state === 'now');
  if (e.key === 'Escape') { e.preventDefault(); if (step) skipStep(tab, step); else closeCapri(); return; }
  if (e.key === 'Backspace' && viaSlash && el.ask.value === '/') { e.preventDefault(); closeCapri(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'e' && step) { e.preventDefault(); editStep(tab, step); return; }
  if (e.key === 'Enter' && !el.ask.value.trim() && step) { e.preventDefault(); runStep(tab, step); }
});
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = el.ask.value.trim();
  if (!raw || busy) return;
  const q = raw.replace(/^\/capri\b\s*/i, '').trim();
  el.ask.value = '';
  viaSlash = false;
  if (!q) { logLine('q', '> /capri'); logLine('who', `${NAME.toUpperCase()} >`); logLine('say', 'What should I do? Tell me and I\'ll look at your terminal~'); face.talk(); return; }
  askCapri(q);
});
$('ask-btn').addEventListener('click', () => (el.capri.hidden ? openCapri() : closeCapri()));

function screenText(tab) {
  const b = tab.term.buffer.active, out = [];
  for (let i = Math.max(0, b.length - 80); i < b.length; i++) { const l = b.getLine(i); out.push(l ? l.translateToString(true) : ''); }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

async function askCapri(q, { quiet = false } = {}) {
  const tab = active;
  if (!tab || busy) return;
  busy = true;
  if (!quiet) logLine('q', `> ${q}`);
  const thinking = logLine('sys think', `${NAME} is reading your terminal`);
  face.set('think');
  let res;
  try { res = await T.ask({ question: q, screen: screenText(tab), shell: tab.shell, history: tab.history }); }
  catch (err) { res = { say: `Something went wrong: ${err.message}`, commands: [], error: true }; }
  thinking.remove();
  busy = false;
  logLine('who', `${NAME.toUpperCase()} >`);
  logLine('say', res.say || '…');
  face.talk(res.error ? 'sad' : 'happy');
  tab.history.push({ q, a: JSON.stringify({ say: res.say, commands: res.commands || [] }) });
  if (tab.history.length > 8) tab.history.shift();
  tab.plan = (res.commands && res.commands.length) ? { steps: res.commands.map((cmd) => ({ cmd, state: 'wait' })), ran: 0 } : null;
  renderSteps();
  nextStep(tab);
}

async function nextStep(tab) {
  if (!tab.plan) return;
  const step = tab.plan.steps.find((s) => s.state === 'wait');
  if (!step) { renderSteps(true); return; }
  step.state = 'now';
  const chk = await T.check(step.cmd).catch(() => ({ ask: true }));
  step.danger = !!chk.danger;
  renderSteps();
  if (!chk.ask) runStep(tab, step);
  else { if (step.danger) face.set('surprised'); el.ask.focus(); }
}
function clearLine(tab) { if (tab.typed !== 0) { T.write(tab.id, '\x1b'); tab.typed = 0; } }
async function runStep(tab, step) {
  if (step.state !== 'now' || tab.ended) return;
  step.state = 'running';
  renderSteps();
  clearLine(tab);
  logLine('sys', `⚡ ${NAME.toLowerCase()} ran: ${step.cmd}`);
  face.zap();
  const started = performance.now();
  tab.lastData = started;
  T.write(tab.id, step.cmd + '\r');
  tab.plan.ran++;
  // wait for the command to go quiet (no new output for 1.2 s), or up to 10 minutes
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      const now = performance.now();
      if (step.state !== 'running' || tab.ended || (now - started > 600 && now - tab.lastData > 1200) || now - started > 600e3) { clearInterval(iv); resolve(); }
    }, 200);
  });
  if (step.state === 'running') step.state = 'done';
  nextStep(tab);
}
function skipStep(tab, step) { step.state = 'skip'; logLine('sys', `skipped: ${step.cmd}`); nextStep(tab); }
function editStep(tab, step) {
  clearLine(tab);
  T.write(tab.id, step.cmd);
  tab.typed = step.cmd.length;
  step.state = 'edit';
  for (const s of tab.plan.steps) if (s.state === 'wait') s.state = 'skip';
  logLine('sys', 'It\'s in your terminal now: change it and press Enter yourself.');
  renderSteps();
  closeCapri();
}
function stopStep(tab) { T.write(tab.id, '\x03'); }

function renderSteps(finished = false) {
  el.steps.innerHTML = '';
  const tab = active;
  if (!tab || !tab.plan) return;
  const n = tab.plan.steps.length;
  tab.plan.steps.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = `step ${s.state === 'now' || s.state === 'running' ? 'now' : s.state === 'done' ? 'done' : s.state === 'skip' || s.state === 'edit' ? 'skip' : ''}${s.danger && s.state === 'now' ? ' danger' : ''}`;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = { wait: '·', now: '▸', running: '⚡', done: '✓', skip: '–', edit: '✎' }[s.state];
    const code = document.createElement('code');
    code.textContent = (n > 1 ? `${i + 1}/${n}  ` : '') + s.cmd;
    row.append(mark, code);
    if (s.state === 'now') {
      const b = document.createElement('span'); b.className = 'btns';
      if (s.danger) { const w = document.createElement('span'); w.style.color = '#ff4d6d'; w.textContent = 'risky — check it'; b.appendChild(w); }
      for (const [cls, label, fn] of [['run', '↵ RUN', () => runStep(tab, s)], ['edit', '^E EDIT', () => editStep(tab, s)], ['skip-b', 'ESC SKIP', () => skipStep(tab, s)]]) {
        const x = document.createElement('button'); x.type = 'button'; x.className = cls; x.textContent = label; x.addEventListener('click', fn); b.appendChild(x);
      }
      row.appendChild(b);
    }
    if (s.state === 'running') {
      const b = document.createElement('span'); b.className = 'btns';
      const x = document.createElement('button'); x.type = 'button'; x.className = 'skip-b'; x.textContent = '^C STOP';
      x.addEventListener('click', () => stopStep(tab)); b.appendChild(x); row.appendChild(b);
    }
    el.steps.appendChild(row);
  });
  if (finished && tab.plan.ran) {
    const row = document.createElement('div'); row.className = 'step';
    const code = document.createElement('code'); code.textContent = 'Done~ want me to check how it went?';
    const b = document.createElement('span'); b.className = 'btns';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'run'; x.textContent = '⚡ CHECK RESULT';
    x.addEventListener('click', () => { tab.plan = null; renderSteps(); askCapri('I ran those commands. Look at the output: did it work, and what should I do next?', { quiet: true }); });
    b.appendChild(x); row.append(code, b); el.steps.appendChild(row);
  }
  el.log.scrollTop = el.log.scrollHeight;
}

// ---------------------------------------------------------------- her face (title bar) and feed (panel)
const face = (() => {
  const CW = META.size[0], CH = META.size[1];
  const off = document.createElement('canvas'); off.width = CW; off.height = CH;
  const og = off.getContext('2d');
  let mood = 'neutral', talkUntil = 0, zapUntil = 0, blinkAt = performance.now() + 2500, state = 'idle';
  const put = (n) => { const r = META.rects[n]; if (r) og.drawImage(el.sheet, r[0], r[1], CW, CH, 0, 0, CW, CH); };
  function compose(t) {
    og.clearRect(0, 0, CW, CH);
    put(Math.floor(t / 600) % 2 ? 'idle1' : 'idle0');
    const blink = t > blinkAt && t < blinkAt + 140;
    if (t > blinkAt + 140) blinkAt = t + 2500 + Math.random() * 3000;
    const eyes = blink ? 'blink' : state === 'think' ? 'relaxed' : state === 'surprised' ? 'surprised' : mood;
    put('eyes_' + (META.rects['eyes_' + eyes] ? eyes : 'neutral'));
    const talking = t < talkUntil;
    put(talking ? `mouth_talk${1 + (Math.floor(t / 110) % 3)}` : 'mouth_' + (state === 'surprised' ? 'surprised' : mood === 'sad' ? 'sad' : mood === 'happy' ? 'happy' : 'neutral'));
    if (t < zapUntil) { og.globalCompositeOperation = 'source-atop'; og.fillStyle = 'rgba(255, 26, 60, 0.55)'; og.fillRect(0, 0, CW, CH); og.globalCompositeOperation = 'source-over'; }
  }
  function draw(cv, sx, sy, sw, sh, t) {
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const bob = Math.round(Math.sin(t / 500) * 1);
    g.drawImage(off, sx, sy + bob, sw, sh, 0, 0, cv.width, cv.height);
    if (state === 'think') {
      g.fillStyle = '#ffd6e6';
      for (let i = 0; i < 3; i++) { const a = t / 250 + i * 2.09; g.fillRect(Math.round(cv.width / 2 + Math.cos(a) * cv.width * 0.3), Math.round(cv.height * 0.12 + Math.sin(a) * 3), 3, 3); }
    }
  }
  el.face.width = 80; el.face.height = 80;
  el.feed.width = 192; el.feed.height = 192;
  function frame(t) {
    if (el.sheet.complete && el.sheet.naturalWidth) {
      compose(t);
      draw(el.face, 28, 26, 40, 40, t);                                     // her head and mask
      if (!el.capri.hidden) draw(el.feed, 6, 4, 84, 84, t);                 // waist-up
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return {
    set(s) { state = s; },
    talk(m = 'happy') { state = 'idle'; mood = m; talkUntil = performance.now() + 1600; setTimeout(() => { if (mood === m) mood = 'neutral'; }, 6000); },
    zap() { zapUntil = performance.now() + 500; state = 'idle'; },
  };
})();

// ---------------------------------------------------------------- window
$('min').addEventListener('click', () => T.windowCtl('min'));
$('max').addEventListener('click', () => T.windowCtl('max'));
$('close').addEventListener('click', () => T.windowCtl('close'));
el.add.addEventListener('click', () => { el.addMenu.hidden = !el.addMenu.hidden; });
el.addMenu.addEventListener('click', (e) => { const s = e.target.dataset && e.target.dataset.shell; if (s) { el.addMenu.hidden = true; newTab(s); } });
document.addEventListener('pointerdown', (e) => { if (!el.addMenu.hidden && !e.target.closest('#add-wrap')) el.addMenu.hidden = true; });
// Ctrl+Shift+T new tab of the same shell, Ctrl+Tab next tab, Ctrl+Shift+Space opens her panel
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); newTab(active ? active.shell : 'powershell'); }
  else if (e.ctrlKey && e.key === 'Tab' && tabs.length > 1) { e.preventDefault(); activate(tabs[(tabs.indexOf(active) + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]); }
  else if (e.ctrlKey && e.shiftKey && e.code === 'Space') { e.preventDefault(); if (el.capri.hidden) openCapri(); else closeCapri(); }
}, true);

(async () => {
  try { const info = await T.info(); if (info && info.name) NAME = info.name; } catch { /* default */ }
  $('brand').textContent = `${NAME.toUpperCase()}.SH`;
  document.title = `${NAME} Terminal`;
  const shell = new URLSearchParams(location.search).get('shell') || 'powershell';
  await newTab(shell);
})();

window.__term = { tabs, openCapri, closeCapri, askCapri, screenText, get active() { return active; } };
