// Command protocols, the typing side: while you type "/..." in her typing box (or the TV command line) a list of
// matching commands shows above it. Up/Down pick, Tab completes, Enter sends. With no list open, Up/Down walk
// through what you typed before. The commands themselves run in main (src/commands.js), no AI involved.
const api = window.companion;
let LIST = [];
const ready = (async () => { try { LIST = (await api.commandsList()) || []; } catch { LIST = []; } })();
const HIST_KEY = 'capriTyped';
let history = [];
try { history = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { history = []; }

export function remember(text) {
  const t = String(text || '').trim();
  if (!t) return;
  history = [t, ...history.filter((h) => h !== t)].slice(0, 40);
  try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch { /* no storage */ }
}
export const isCommand = (text) => /^\/\S/.test(String(text || '').trim());

// attach the list to one input. place: 'above' (typebox) or 'above' of the TV command line too
export function attachCommands(input, form, { onEnterPick } = {}) {
  const box = document.createElement('div');
  box.className = 'cmd-suggest interactive';
  box.hidden = true;
  document.body.appendChild(box);
  const badge = document.createElement('span');
  badge.className = 'cmd-badge';
  badge.textContent = '⚡ INSTANT';
  badge.hidden = true;
  form.appendChild(badge);
  let items = [], sel = 0, hi = -1, draft = '';

  function matches(v) {
    const m = v.match(/^\/(\S*)(\s?)/);
    if (!m) return [];
    const w = m[1].toLowerCase();
    if (m[2]) return LIST.filter((c) => c.name === w);          // the command is typed: show its hint only
    const starts = LIST.filter((c) => c.name.startsWith(w));
    const inside = w ? LIST.filter((c) => !c.name.startsWith(w) && (c.name.includes(w) || c.desc.toLowerCase().includes(w))) : [];
    return [...starts, ...inside].slice(0, 7);
  }
  function place() {
    const r = form.getBoundingClientRect();
    box.style.width = Math.max(260, r.width) + 'px';
    box.style.left = Math.min(Math.max(8, r.left), innerWidth - Math.max(260, r.width) - 8) + 'px';
    const h = box.offsetHeight;
    box.style.top = (r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6) + 'px';
  }
  function render() {
    const v = input.value;
    badge.hidden = !isCommand(v) && v.trim() !== '/';
    items = matches(v);
    if (!items.length) { box.hidden = true; return; }
    sel = Math.min(sel, items.length - 1);
    box.innerHTML = '';
    items.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'cmd-row' + (i === sel ? ' on' : '');
      const n = document.createElement('b'); n.textContent = '/' + c.name;
      const a = document.createElement('i'); a.textContent = c.args;
      const d = document.createElement('span'); d.textContent = c.desc;
      row.append(n, a, d);
      row.addEventListener('pointerdown', (e) => { e.preventDefault(); sel = i; complete(); input.focus(); });
      box.appendChild(row);
    });
    box.hidden = false;
    place();
  }
  function complete() {
    const c = items[sel];
    if (!c) return;
    const rest = input.value.replace(/^\/\S*\s?/, '');
    input.value = `/${c.name} ${rest}`;
    render();
  }
  input.addEventListener('input', () => { sel = 0; hi = -1; ready.then(render); });
  input.addEventListener('blur', () => { box.hidden = true; });
  input.addEventListener('focus', () => ready.then(render));
  input.addEventListener('keydown', (e) => {
    const open = !box.hidden && items.length;
    if (e.key === 'Tab') { e.preventDefault(); if (open) complete(); else if (input.value === '') { input.value = '/'; render(); } return; }
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !/\s/.test(input.value)) {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render();
      return;
    }
    // Enter on a half-typed command name ("/ti") picks the highlighted one first
    if (e.key === 'Enter' && open && /^\/\S*$/.test(input.value) && !LIST.some((c) => '/' + c.name === input.value.toLowerCase()) && items[sel] && !items[sel].args) {
      input.value = '/' + items[sel].name;
      if (onEnterPick) onEnterPick();
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && history.length) {
      e.preventDefault();
      if (hi === -1) draft = input.value;
      hi = Math.max(-1, Math.min(history.length - 1, hi + (e.key === 'ArrowUp' ? 1 : -1)));
      input.value = hi === -1 ? draft : history[hi];
      sel = 0;
      render();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    if (e.key === 'Escape') box.hidden = true;
  });
  return { hide() { box.hidden = true; badge.hidden = true; hi = -1; }, refresh: () => ready.then(render) };
}

// what she shows after a command: a short line, or the help list
export function resultLine(r) {
  if (!r) return 'Hmm, nothing happened.';
  return String(r.text || '').slice(0, 600);
}
