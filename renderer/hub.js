// Capri Hub window (see src/hub.js). Plain DOM, no framework. window.hub is the bridge from hub-preload.js.
(() => {
  const api = window.hub;
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const fmtDur = (s) => { s = Math.round(s || 0); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60); return hh ? `${hh}h ${pad(mm)}m` : mm ? `${mm}m` : `${s}s`; };
  const fmtBytes = (b) => { b = Number(b) || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return `${b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)} ${u[i]}`; };

  let toastT = null;
  function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }

  // ------------------------------------------------------------------ icons
  const iconCache = new Map();     // icon target -> data URL
  const iconTarget = (a) => (!a ? '' : a.kind === 'appsfolder' ? `shell:AppsFolder\\${a.target}` : a.kind === 'file' ? a.target : a.kind === 'url' ? `fav:${a.target}` : '');
  const COLORS = ['#ff2e78', '#4c8dff', '#7a5cff', '#1ed760', '#3aa0ff', '#e0457b', '#76b900', '#f2b632', '#14b8a6', '#c2410c'];
  const initials = (n) => { const w = String(n || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '').slice(1, 2))).toUpperCase(); };
  const colorOf = (n) => { let x = 0; for (const c of String(n)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return COLORS[x % COLORS.length]; };
  function iconEl(a, custom) {
    const el = h('span', { class: 'ico', style: `background:${colorOf(a.name)}` });
    const t = iconTarget(a);
    el.dataset.iconTarget = t;
    const url = (custom && custom[a.id || a.target]) || iconCache.get(t);
    if (url) setIcon(el, url); else el.textContent = initials(a.name);
    return el;
  }
  function setIcon(el, url) {
    el.textContent = '';
    el.classList.add('has-img');
    el.append(h('img', { src: url, alt: '', draggable: 'false' }));
  }
  function takeIcons(map) { for (const [k, v] of Object.entries(map || {})) if (v) iconCache.set(k, v); }
  api.onIcons((done) => {
    takeIcons(done);
    for (const el of document.querySelectorAll('.ico[data-icon-target]')) {
      const url = done[el.dataset.iconTarget];
      if (url && !el.classList.contains('has-img')) setIcon(el, url);
    }
  });

  // ------------------------------------------------------------------ pages
  const TITLES = { dash: '// dashboard', chat: '// chat', task: '// task', apps: '// applications', stats: '// statistics', time: '// screen time', mine: '// favorites', status: '// status', term: '// terminal' };
  let page = null;
  const loaders = {};
  function show(p) {
    if (!TITLES[p]) p = 'dash';
    const prev = page;
    page = p;
    for (const b of document.querySelectorAll('.nav[data-page]')) b.classList.toggle('on', b.dataset.page === p);
    for (const s of document.querySelectorAll('.page')) s.hidden = s.id !== `p-${p}`;
    $('#title').textContent = TITLES[p];
    if (api.pageShown) api.pageShown(p);
    if (prev === 'stats' && p !== 'stats') stopStats();
    if (prev === 'dash' && p !== 'dash') stopMusic();
    placeTerm();
    if (loaders[p]) loaders[p]();
  }
  for (const b of document.querySelectorAll('.nav[data-page]')) b.addEventListener('click', () => show(b.dataset.page));
  $('#go-settings').addEventListener('click', () => api.openSettings());
  for (const b of document.querySelectorAll('[data-win]')) b.addEventListener('click', () => api.windowCtl(b.dataset.win));
  api.onPage((p) => show(p));

  // ------------------------------------------------------------------ notes data (shared by Dashboard and Task)
  let doc = { notes: [], todos: [] };
  async function loadNotes() { doc = await api.notesGet(); }
  async function saveTodos() { const r = await api.notesSave({ todos: doc.todos }); doc.todos = r.todos; }
  async function saveNotes() { const r = await api.notesSave({ notes: doc.notes }); doc.notes = r.notes; }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  api.onNotes((d) => {
    if (!d) return;
    doc.todos = d.todos || doc.todos;
    if (!noteDirty) doc.notes = d.notes || doc.notes;
    if (page === 'dash') { renderCal(); renderDay(); }
    if (page === 'task') { renderTodos(); if (!noteDirty) renderNoteList(); }
  });
  function todoRow(t, { showDate = false } = {}) {
    const late = t.date && t.date < dayKey(new Date());
    const when = [showDate && t.date ? shortDay(t.date) : '', t.time].filter(Boolean).join(' · ');
    const row = h('div', { class: 'td' },
      h('button', { class: 'chk', title: 'Done', 'aria-label': `Done: ${t.text}`, onclick: () => doneTodo(t, row) }),
      h('span', { class: 'tx', text: t.text, title: t.text }),
      when ? h('span', { class: `when${late ? ' late' : ''}`, text: when }) : null,
      h('button', { class: `bell${t.remind ? ' on' : ''}`, text: '◆', title: t.remind ? 'Reminder on' : t.time ? 'Remind me' : 'Give it a time first', 'aria-label': 'Reminder', onclick: () => toggleBell(t) }));
    return row;
  }
  async function doneTodo(t, row) {
    row.classList.add('gone');
    await new Promise((r) => setTimeout(r, 220));
    doc.todos = doc.todos.filter((x) => x.id !== t.id);
    await saveTodos();
    if (page === 'dash') { renderCal(); renderDay(); } else renderTodos();
  }
  async function toggleBell(t) {
    if (!t.time) { toast('Give it a time first, then the bell works.'); return; }
    const x = doc.todos.find((y) => y.id === t.id);
    if (!x) return;
    x.remind = !x.remind;
    await saveTodos();
    const n = doc.todos.find((y) => y.id === t.id);
    if (x.remind && n && !n.remind) toast('That time has already passed.');
    else if (n && n.remind) toast(`I'll remind you ${n.date ? shortDay(n.date) : n.remindAt && new Date(n.remindAt).getDate() !== new Date().getDate() ? 'tomorrow' : 'today'} at ${n.time}.`);
    if (page === 'dash') renderDay(); else renderTodos();
  }
  function shortDay(k) {
    const d = parseDay(k), today = new Date(), tm = new Date(); tm.setDate(today.getDate() + 1);
    if (k === dayKey(today)) return 'today';
    if (k === dayKey(tm)) return 'tomorrow';
    return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  }

  // ------------------------------------------------------------------ DASHBOARD
  let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let selDay = dayKey(new Date());
  function tickClock() {
    const d = new Date();
    const s = d.getSeconds(), m = d.getMinutes(), hr = d.getHours();
    $('#h-hand').style.transform = `rotate(${(hr % 12 + m / 60) * 30}deg)`;
    $('#m-hand').style.transform = `rotate(${(m + s / 60) * 6}deg)`;
    $('#s-hand').style.transform = `rotate(${s * 6}deg)`;
    $('#c-hm').textContent = `${pad(hr)}:${pad(m)}`;
    $('#c-s').textContent = `:${pad(s)}`;
    $('#c-date').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    const start = new Date(d.getFullYear(), 0, 1);
    const doy = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 864e5) + 1;
    const leap = new Date(d.getFullYear(), 1, 29).getDate() === 29;
    $('#c-day').textContent = `DAY ${doy}/${leap ? 366 : 365}`;
    // ISO week
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dn = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dn);
    const wk = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
    $('#c-week').textContent = `WEEK ${wk}`;
    $('#c-prog').style.width = `${((hr * 3600 + m * 60 + s) / 864).toFixed(1)}%`;
    if (selDayIsToday && selDay !== dayKey(d)) { selDay = dayKey(d); if (page === 'dash') { renderCal(); renderDay(); } }
  }
  let selDayIsToday = true;
  setInterval(tickClock, 1000);
  tickClock();

  // Favorites: only the ones registered on the Favorites page; APPS and WEB tabs
  let favTab = (() => { try { return localStorage.getItem('hubFavTab') === 'web' ? 'web' : 'apps'; } catch { return 'apps'; } })();
  let favData = { top: [], web: [] };
  async function loadJump() {
    favData = await api.dashboard();
    takeIcons(favData.icons);
    renderFav();
  }
  function renderFav() {
    const r = favData;
    $('#tab-apps').textContent = `APPS ${(r.top || []).length}`;
    $('#tab-web').textContent = `WEB ${(r.web || []).length}`;
    $('#tab-apps').classList.toggle('on', favTab === 'apps');
    $('#tab-web').classList.toggle('on', favTab === 'web');
    const grid = $('#jump');
    grid.textContent = '';
    const list = (favTab === 'web' ? r.web : r.top) || [];
    for (const a of list) {
      grid.append(h('button', { class: 'tile', title: a.kind === 'url' ? `${a.name} · ${a.target}` : a.name, onclick: () => api.launch(a).then((x) => toast(x && x.ok ? `Opening ${a.name}~` : `Couldn't open ${a.name}.`)) },
        iconEl(a, r.custom), h('span', { class: 'nm', text: a.name })));
    }
    for (let i = list.length; i < 8; i++) {
      if (i === list.length) {
        grid.append(h('button', { class: 'tile add', title: favTab === 'web' ? 'Add a website' : 'Add favorite apps', onclick: () => { show('mine'); if (favTab === 'web') setTimeout(() => $('#web-name').focus(), 60); } },
          h('span', { class: 'ico', style: 'background:transparent;border:1px dashed var(--pink);color:var(--pink2)', text: '+' }), h('span', { class: 'nm', text: favTab === 'web' ? 'Add website' : 'Add favorite' })));
      } else grid.append(h('div', { class: 'tile empty-slot', 'aria-hidden': 'true' }, h('span', { class: 'ico', style: 'background:transparent' }), h('span', { class: 'nm', text: ' ' })));
    }
  }
  for (const b of [$('#tab-apps'), $('#tab-web')]) b.addEventListener('click', () => { favTab = b.dataset.tab; try { localStorage.setItem('hubFavTab', favTab); } catch { /* fine */ } renderFav(); });
  $('#fav-manage').addEventListener('click', () => show('mine'));

  // ---------------- now playing (Spotify) with a visualizer
  const fmtMs = (ms) => { const t = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(t / 60)}:${pad(t % 60)}`; };
  const BARS = 28;
  const vizEl = $('#viz');
  for (let i = 0; i < BARS; i++) vizEl.append(h('i'));
  const bars = [...vizEl.children];
  let np = { playing: false }, npAt = 0, musicT = null, rafId = 0;
  const level = new Array(BARS).fill(0);
  const viz = { an: null, ctx: null, stream: null, data: null, tried: false };
  async function startViz() {
    if (viz.an || viz.tried) return;
    viz.tried = true;
    try {
      // the PC's sound (loopback) only for the bars: nothing is recorded or sent anywhere
      const st = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      st.getVideoTracks().forEach((t) => t.stop());
      if (!st.getAudioTracks().length) throw new Error('no audio track');
      viz.ctx = new AudioContext();
      const src = viz.ctx.createMediaStreamSource(st);
      viz.an = viz.ctx.createAnalyser(); viz.an.fftSize = 512; viz.an.smoothingTimeConstant = 0.75;
      src.connect(viz.an);
      viz.data = new Uint8Array(viz.an.frequencyBinCount);
      viz.stream = st;
    } catch (e) { console.error('visualizer: no PC sound, using a beat-free animation', e && e.message); }
  }
  function stopViz() {
    if (viz.stream) viz.stream.getTracks().forEach((t) => t.stop());
    if (viz.ctx) viz.ctx.close().catch(() => {});
    viz.an = viz.ctx = viz.stream = viz.data = null; viz.tried = false;
  }
  function frame(t) {
    rafId = requestAnimationFrame(frame);
    const on = np.playing && page === 'dash' && !document.hidden;
    if (viz.an && on) {
      viz.an.getByteFrequencyData(viz.data);
      const n = viz.data.length;
      for (let i = 0; i < BARS; i++) {
        const a = Math.floor(Math.pow(i / BARS, 1.7) * n * 0.7), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / BARS, 1.7) * n * 0.7));
        let m = 0; for (let k = a; k < b; k++) m = Math.max(m, viz.data[k]);
        level[i] = level[i] * 0.4 + (m / 255) * 0.6;
      }
    } else {
      for (let i = 0; i < BARS; i++) {
        const target = on ? 0.25 + 0.6 * Math.abs(Math.sin(t / 260 + i * 0.9) * Math.sin(t / 410 + i * 0.37)) : 0;
        level[i] = level[i] * 0.85 + target * 0.15;
      }
    }
    for (let i = 0; i < BARS; i++) bars[i].style.height = `${Math.max(3, level[i] * 100)}%`;
    if (np.playing && np.durationMs) {
      const pos = Math.min(np.durationMs, np.progressMs + (Date.now() - npAt));
      $('#np-pos').textContent = fmtMs(pos);
      $('#np-prog').style.width = `${(pos / np.durationMs) * 100}%`;
    }
  }
  function renderNp() {
    const box = $('#np'), on = !!(np.playing && np.name);
    box.classList.toggle('on', on);
    const art = $('#np-art');
    art.textContent = '';
    if (np.name && np.art) art.append(h('img', { src: np.art, alt: '' })); else art.append(h('span', { text: '♪' }));
    const paused = np.name && !np.playing;
    $('#np-name').textContent = np.name || '∿ dead air ∿';
    $('#np-artist').textContent = np.name ? np.artists || '' : '';
    $('#np-src').textContent = on ? '● SPOTIFY' : paused ? '❚❚ PAUSED' : '○ SPOTIFY IDLE';
    $('#np-play').hidden = !np.name;
    $('#np-idle').hidden = !!np.name;
    $('#np-idle-text').textContent = np.error ? np.error : np.open ? 'Spotify is open but silent. Want me to put something on?' : "Nothing's playing. Want me to put something on?";
    $('#np-dur').textContent = np.durationMs ? fmtMs(np.durationMs) : '';
    if (!np.durationMs) { $('#np-pos').textContent = np.source === 'window' ? 'live' : ''; $('#np-prog').style.width = '0'; }
    else { $('#np-pos').textContent = fmtMs(np.progressMs); $('#np-prog').style.width = `${(np.progressMs / np.durationMs) * 100}%`; }
    $('#np-toggle').textContent = np.playing ? '⏸' : '▶';
    if (on) startViz(); else if (viz.an && !np.name) stopViz();
  }
  async function pollMusic() {
    clearTimeout(musicT);
    if (page !== 'dash') return;
    if (!document.hidden) {
      try { np = await api.nowPlaying() || { playing: false }; npAt = Date.now(); renderNp(); } catch (e) { console.error(e); }
    }
    musicT = setTimeout(pollMusic, document.hidden ? 15000 : 4000);
    if (!rafId) rafId = requestAnimationFrame(frame);
  }
  function stopMusic() { clearTimeout(musicT); musicT = null; cancelAnimationFrame(rafId); rafId = 0; stopViz(); }
  async function music(action) {
    const r = await api.music(action);
    if (r && r.text && !r.ok) toast(r.text);
    setTimeout(pollMusic, 700);
  }
  $('#np-toggle').addEventListener('click', () => music(np.playing ? 'pause' : 'resume'));
  $('#np-next').addEventListener('click', () => music('next'));
  $('#np-prev').addEventListener('click', () => music('previous'));
  $('#np-ask').addEventListener('click', () => { $('#ask-input').value = 'Put on some music for me~'; $('#ask-form').requestSubmit(); });

  function renderCal() {
    const g = $('#cal-grid');
    g.textContent = '';
    $('#cal-month').textContent = `${MONTHS[calMonth.getMonth()].slice(0, 3).toUpperCase()} ${calMonth.getFullYear()}`;
    for (const d of DOW) g.append(h('div', { class: 'dow', text: d }));
    const first = new Date(calMonth);
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(1 - lead);
    const dated = new Set(doc.todos.filter((t) => t.date).map((t) => t.date));
    const today = dayKey(new Date());
    const cells = lead + new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate() > 35 ? 42 : 35;
    for (let i = 0; i < cells; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = dayKey(d);
      const cls = ['day', d.getMonth() !== calMonth.getMonth() ? 'out' : '', k === today ? 'today' : '', k === selDay ? 'sel' : '', dated.has(k) || (k === today && doc.todos.some((t) => !t.date)) ? 'has' : ''].filter(Boolean).join(' ');
      g.append(h('button', { class: cls, 'aria-label': d.toDateString(), onclick: () => { selDay = k; selDayIsToday = k === today; if (d.getMonth() !== calMonth.getMonth()) calMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCal(); renderDay(); } },
        h('span', { text: d.getDate() }), h('i')));
    }
  }
  function renderDay() {
    const today = dayKey(new Date());
    const d = parseDay(selDay);
    $('#day-title').textContent = `${selDay === today ? 'Today · ' : ''}${d.toLocaleDateString('en-GB', { weekday: selDay === today ? undefined : 'short', day: 'numeric', month: 'short' })}`;
    const list = $('#day-list');
    list.textContent = '';
    const onDay = doc.todos.filter((t) => t.date === selDay).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    for (const t of onDay) list.append(todoRow(t));
    const anytime = selDay === today ? doc.todos.filter((t) => !t.date) : [];
    if (anytime.length) {
      list.append(h('div', { class: 'sub', text: 'ANYTIME' }));
      for (const t of anytime) list.append(todoRow(t));
    }
    if (!onDay.length && !anytime.length) list.append(h('div', { class: 'empty', text: selDay < today ? 'Nothing was planned.' : 'Nothing planned. Free day~' }));
  }
  $('#cal-prev').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCal(); });
  $('#cal-next').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCal(); });
  $('#day-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#day-text').value.trim();
    if (!text) return;
    const time = $('#day-time').value;
    doc.todos.push({ id: uid(), text, time, date: selDay, remind: !!time, created: Date.now() });
    $('#day-text').value = ''; $('#day-time').value = '';
    await saveTodos();
    const n = doc.todos[doc.todos.length - 1];
    if (time && n && !n.remind) toast('Added. That time has already passed, so no reminder.');
    else if (time) toast(`Added. I'll remind you at ${time}.`);
    renderCal(); renderDay();
  });

  // the little chat on the dashboard
  async function lastLine() {
    const lines = await api.history();
    const last = [...lines].reverse().find((l) => l.role === 'assistant');
    $('#ask-say').textContent = last ? last.text : `Hey! Need anything? Ask me here~`;
  }
  let asking = false;
  $('#ask-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#ask-input').value.trim();
    if (!text || asking) return;
    asking = true;
    $('#ask-input').value = '';
    const say = $('#ask-say');
    say.textContent = ''; say.append(h('span', { class: 'dots', text: 'thinking' }));
    const r = await api.chat(text);
    asking = false;
    say.textContent = r.text || '…';
  });
  $('#ask-open').addEventListener('click', () => show('chat'));

  loaders.dash = async () => {
    await loadNotes();
    renderCal(); renderDay();
    loadJump().catch((e) => console.error(e));
    if (!asking) lastLine().catch(() => {});
    pollMusic();
  };

  // ------------------------------------------------------------------ CHAT
  let sending = false;
  async function renderChat() {
    const lines = await api.history();
    const log = $('#chat-log');
    log.textContent = '';
    if (!lines.length) log.append(h('div', { class: 'empty', text: 'No messages yet. Say hi~' }));
    for (const l of lines) addMsg(l.role, l.text);
    log.scrollTop = log.scrollHeight;
  }
  function addMsg(role, text) {
    const log = $('#chat-log');
    const empty = log.querySelector('.empty'); if (empty) empty.remove();
    const el = role === 'user'
      ? h('div', { class: 'msg user', text })
      : h('div', { class: 'msg-c' }, h('img', { src: '../assets/icon256.png', alt: '' }), h('div', { class: 'msg capri', text }));
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  async function sendChat() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = '';
    addMsg('user', text);
    const wait = addMsg('assistant', '');
    wait.querySelector('.msg').append(h('span', { class: 'dots', text: 'thinking' }));
    const r = await api.chat(text);
    wait.querySelector('.msg').textContent = r.text || '…';
    sending = false;
    $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
  }
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
  $('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  $('#chat-clear').addEventListener('click', async () => { if (await api.clearChat()) { renderChat(); toast('Memory wiped. Fresh start!'); } });
  api.onHistory(() => {
    if (sending || asking) return;
    if (page === 'chat') renderChat();
    if (page === 'dash') lastLine().catch(() => {});
  });
  loaders.chat = () => { renderChat(); setTimeout(() => $('#chat-input').focus(), 50); };

  // ------------------------------------------------------------------ TASK
  let addBell = false;
  function renderTodos() {
    const list = $('#todo-list');
    list.textContent = '';
    const today = dayKey(new Date());
    const dated = doc.todos.filter((t) => t.date).sort((a, b) => `${a.date} ${a.time || '99'}`.localeCompare(`${b.date} ${b.time || '99'}`));
    const groups = [
      ['EARLIER', dated.filter((t) => t.date < today)],
      ['TODAY', dated.filter((t) => t.date === today)],
      ['COMING UP', dated.filter((t) => t.date > today)],
      ['ANYTIME', doc.todos.filter((t) => !t.date)],
    ];
    for (const [name, items] of groups) {
      if (!items.length) continue;
      list.append(h('div', { class: 'sub', text: name }));
      for (const t of items) list.append(todoRow(t, { showDate: name !== 'TODAY' }));
    }
    if (!doc.todos.length) list.append(h('div', { class: 'empty', text: 'Nothing to do. Nice~' }));
  }
  $('#todo-bell').addEventListener('click', () => { addBell = !addBell; $('#todo-bell').classList.toggle('on', addBell); });
  $('#todo-time').addEventListener('change', () => { if ($('#todo-time').value && !addBell) { addBell = true; $('#todo-bell').classList.add('on'); } });
  $('#todo-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#todo-text').value.trim();
    if (!text) return;
    const time = $('#todo-time').value, date = $('#todo-date').value;
    const id = uid();
    doc.todos.push({ id, text, time, ...(date ? { date } : {}), remind: !!time && addBell, created: Date.now() });
    await saveTodos();
    const n = doc.todos.find((t) => t.id === id);
    if (time && addBell && n && !n.remind) toast('Added. That time has already passed, so no reminder.');
    else if (n && n.remind) toast(`Added. I'll remind you ${n.date ? shortDay(n.date) : ''} at ${n.time}.`.replace('  ', ' '));
    $('#todo-text').value = ''; $('#todo-time').value = ''; $('#todo-date').value = '';
    addBell = false; $('#todo-bell').classList.remove('on');
    renderTodos();
  });

  let curNote = null, noteDirty = false, noteT = null;
  function renderNoteList() {
    const list = $('#note-list');
    list.textContent = '';
    const notes = [...doc.notes].sort((a, b) => (b.updated || 0) - (a.updated || 0));
    for (const n of notes) {
      list.append(h('button', { class: `note${curNote === n.id ? ' on' : ''}`, onclick: () => openNote(n.id) },
        h('b', { text: n.title || 'Untitled' }), h('small', { text: (n.body || '').split('\n')[0] || ' ' })));
    }
    if (!notes.length) list.append(h('div', { class: 'empty', text: 'No notes yet.' }));
    if (!doc.notes.find((n) => n.id === curNote)) { curNote = notes[0] ? notes[0].id : null; if (curNote) openNote(curNote, true); else fillNote(null); }
  }
  function fillNote(n) {
    $('#note-title').value = n ? n.title || '' : '';
    $('#note-body').value = n ? n.body || '' : '';
    $('#note-title').disabled = $('#note-body').disabled = !n;
    $('#note-del').hidden = !n;
    $('#note-saved').textContent = '';
  }
  function openNote(id, quiet) {
    flushNote();
    curNote = id;
    fillNote(doc.notes.find((n) => n.id === id));
    if (!quiet) renderNoteList();
  }
  function noteChanged() {
    const n = doc.notes.find((x) => x.id === curNote);
    if (!n) return;
    n.title = $('#note-title').value; n.body = $('#note-body').value; n.updated = Date.now();
    noteDirty = true;
    $('#note-saved').textContent = 'typing…';
    clearTimeout(noteT);
    noteT = setTimeout(flushNote, 700);
  }
  async function flushNote() {
    clearTimeout(noteT);
    if (!noteDirty) return;
    noteDirty = false;
    await saveNotes();
    $('#note-saved').textContent = 'saved';
    const cur = $('#note-list .note.on');
    const n = doc.notes.find((x) => x.id === curNote);
    if (cur && n) { cur.querySelector('b').textContent = n.title || 'Untitled'; cur.querySelector('small').textContent = (n.body || '').split('\n')[0] || ' '; }
  }
  $('#note-title').addEventListener('input', noteChanged);
  $('#note-body').addEventListener('input', noteChanged);
  $('#note-new').addEventListener('click', async () => {
    await flushNote();
    const n = { id: uid(), title: '', body: '', updated: Date.now() };
    doc.notes.push(n);
    await saveNotes();
    curNote = n.id;
    renderNoteList(); fillNote(doc.notes.find((x) => x.id === n.id));
    $('#note-title').focus();
  });
  $('#note-del').addEventListener('click', async () => {
    const n = doc.notes.find((x) => x.id === curNote);
    if (!n || !confirm(`Delete "${n.title || 'Untitled'}"?`)) return;
    noteDirty = false; clearTimeout(noteT);
    doc.notes = doc.notes.filter((x) => x.id !== curNote);
    curNote = null;
    await saveNotes();
    renderNoteList();
  });
  loaders.task = async () => { await loadNotes(); renderTodos(); renderNoteList(); };
  window.addEventListener('beforeunload', () => { if (noteDirty) flushNote(); });

  // ------------------------------------------------------------------ APPS
  let allApps = null, myIds = new Set();
  const appKey = (a) => `${a.kind}|${String(a.target).toLowerCase()}`;
  async function loadApps() {
    const [r, mine] = await Promise.all([allApps ? null : api.apps(), api.myApps()]);
    if (r) { allApps = r.apps || []; takeIcons(r.icons); if (r.error) toast(r.error); }
    myIds = new Set((mine.apps || []).map(appKey));
    renderApps();
  }
  function renderApps() {
    const q = $('#apps-search').value.trim().toLowerCase();
    const grid = $('#apps-grid');
    grid.textContent = '';
    const list = (allApps || []).filter((a) => !q || a.name.toLowerCase().includes(q));
    for (const a of list.slice(0, 400)) {
      const pinned = myIds.has(appKey(a));
      grid.append(h('div', { class: 'app', role: 'button', tabindex: '0', title: a.name, onclick: () => api.launch(a).then((x) => toast(x && x.ok ? `Opening ${a.name}~` : `Couldn't open ${a.name}.`)) },
        h('button', { class: `star${pinned ? ' on' : ''}`, text: pinned ? '★' : '☆', title: pinned ? 'Remove from Favorites' : 'Add to Favorites', 'aria-label': 'Pin', onclick: (e) => { e.stopPropagation(); togglePin(a); } }),
        iconEl(a), h('span', { class: 'nm', text: a.name })));
    }
    if (!allApps) grid.append(h('div', { class: 'empty', text: 'Reading your Start menu…' }));
    else if (!list.length) grid.append(h('div', { class: 'empty', text: 'No app matches that.' }));
  }
  async function togglePin(a) {
    const mine = (await api.myApps()).apps || [];
    const k = appKey(a);
    const next = myIds.has(k) ? mine.filter((x) => appKey(x) !== k) : [...mine, { id: uid(), name: a.name, kind: a.kind, target: a.target }];
    const r = await api.saveMyApps(next);
    myIds = new Set((r.apps || []).map(appKey));
    toast(myIds.has(k) ? `${a.name} added to Favorites~` : `${a.name} removed from Favorites.`);
    renderApps();
  }
  $('#apps-search').addEventListener('input', renderApps);
  loaders.apps = () => { renderApps(); loadApps().catch((e) => console.error(e)); setTimeout(() => $('#apps-search').focus(), 50); };

  // ------------------------------------------------------------------ STATS
  let statsT = null;
  function stopStats() { clearTimeout(statsT); statsT = null; }
  function spark(values, max, color) {
    const el = h('div', { class: 'spark' });
    const vals = values.slice(-24);
    while (vals.length < 24) vals.unshift(0);
    for (const v of vals) el.append(h('i', { style: `height:${Math.max(2, Math.min(100, (v / (max || 1)) * 100))}%;background:${color}` }));
    return el;
  }
  function meter(k, sub, v, color, note, hist, max) {
    return h('div', { class: 'card meter' },
      h('div', { class: 'row' }, h('span', { class: 'lbl', text: k }), h('span', { class: 'grow' }), h('span', { class: 'tiny soft', text: sub })),
      h('div', { class: 'v', style: `color:${color}`, text: v }), spark(hist, max, color), h('div', { class: 'note-l', text: note, title: note }));
  }
  const DISK_SVG = '<rect x="3" y="6" width="18" height="12"></rect><path d="M7 14h4"></path><circle cx="17" cy="14" r="1"></circle>';
  async function pollStats() {
    if (page !== 'stats') return;
    let s = null;
    try { s = await api.stats(); } catch (e) { console.error(e); }
    if (page !== 'stats') return;
    if (s) renderStats(s);
    statsT = setTimeout(pollStats, document.hidden ? 6000 : 2000);
  }
  function renderStats(s) {
    const m = $('#meters');
    m.textContent = '';
    const memPct = s.mem.total ? (s.mem.used / s.mem.total) * 100 : 0;
    const netMax = Math.max(1, ...s.history.net);
    m.append(
      meter('CPU', `${s.cpu.cores} threads${s.cpu.mhz ? ` · ${(s.cpu.mhz / 1000).toFixed(1)} GHz` : ''}`, s.ready ? `${s.cpu.pct}%` : '…', '#ff2e78', s.cpu.model || 'Processor', s.history.cpu, 100),
      meter('MEMORY', fmtBytes(s.mem.total), fmtBytes(s.mem.used), '#ff70a2', `${Math.round(memPct)}% in use`, s.history.mem, 100),
      s.gpu
        ? meter('GPU', 'NVIDIA', `${s.gpu.util}%`, '#2eff8c', `${s.gpu.name.replace(/^NVIDIA\s+/i, '')} · VRAM ${fmtBytes(s.gpu.memUsed)} / ${fmtBytes(s.gpu.memTotal)}${s.gpu.temp ? ` · ${s.gpu.temp}°C` : ''}`, s.history.gpu, 100)
        : meter('GPU', '', '—', '#2eff8c', 'No NVIDIA GPU info on this PC', [], 100),
      meter('NETWORK', '', s.ready ? `${fmtBytes(s.net.down + s.net.up)}/s` : '…', '#ffb3d1', `↓ ${fmtBytes(s.net.down)}/s · ↑ ${fmtBytes(s.net.up)}/s`, s.history.net, netMax),
    );
    $('#proc-count').textContent = s.procCount ? `sorted by CPU · ${s.procCount} running` : '';
    const pl = $('#proc-list');
    pl.textContent = '';
    for (const p of s.procs) {
      const hot = p.cpu >= 10 ? '#ff2e78' : p.cpu >= 3 ? '#ff70a2' : 'var(--ink)';
      pl.append(h('div', { class: 'proc' },
        h('span', { class: 'nm', text: `${p.name}${p.count > 1 ? ` (${p.count})` : ''}`, title: p.name }),
        h('span', { style: `color:${hot}`, text: s.ready ? `${p.cpu.toFixed(1)}%` : '…' }),
        h('span', { class: 'soft', text: fmtBytes(p.mem) }),
        h('button', { class: 'end', text: 'END', disabled: p.self || p.keep, title: p.keep ? 'Part of Windows (or Capri): not ended from here' : `End ${p.name}`, onclick: async () => { const r = await api.endTask(p.name, p.pids); if (r && r.text) toast(r.text); } })));
    }
    if (!s.procs.length) pl.append(h('div', { class: 'empty', text: 'Process list needs Windows.' }));
    const up = s.uptime; $('#uptime').textContent = `uptime ${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h`;
    const dl = $('#disk-list');
    dl.textContent = '';
    for (const d of s.disks) {
      const used = d.total - d.free, pct = d.total ? (used / d.total) * 100 : 0;
      const col = pct >= 90 ? '#ff2e78' : pct >= 80 ? '#ff70a2' : '#2eff8c';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.style.stroke = col; svg.innerHTML = DISK_SVG;
      dl.append(h('div', { class: 'disk' }, svg, h('div', { class: 'info' },
        h('div', { class: 'row' }, h('b', { text: `${d.label || 'Local Disk'} (${d.name.replace(/\\$/, '')})` }), h('span', { class: 'grow' }), h('span', { class: 'soft', text: `${fmtBytes(d.free)} free of ${fmtBytes(d.total)}` })),
        h('div', { class: 'dbar' }, h('div', { style: `width:${pct.toFixed(1)}%;background:${col};box-shadow:0 0 8px ${col}` })),
        h('div', { class: 'tiny', style: `color:${pct >= 90 ? 'var(--bad)' : pct >= 80 ? 'var(--hot)' : 'var(--ok)'}`, text: pct >= 90 ? 'Almost full.' : pct >= 80 ? 'Getting full.' : 'Healthy' }))));
    }
    if (!s.disks.length) dl.append(h('div', { class: 'empty', text: 'Disk info needs Windows.' }));
  }
  async function loadCleanup() {
    $('#bin-btn').textContent = 'RECYCLE BIN · …'; $('#temp-btn').textContent = 'TEMP FILES · …';
    const c = await api.cleanupInfo();
    if (!c) return;
    $('#bin-btn').textContent = c.bin ? `EMPTY RECYCLE BIN · ${fmtBytes(c.bin.bytes)}` : 'EMPTY RECYCLE BIN';
    $('#temp-btn').textContent = `CLEAN TEMP FILES · ${c.temp.partial ? '≥ ' : ''}${fmtBytes(c.temp.bytes)}`;
  }
  $('#bin-btn').addEventListener('click', async () => { const r = await api.emptyBin(); if (r) { toast(r.ok ? 'Recycle Bin emptied.' : `Couldn't empty it: ${r.error}`); loadCleanup(); } });
  $('#temp-btn').addEventListener('click', async () => { const r = await api.cleanTemp(); if (r) { toast(`Cleaned ${fmtBytes(r.bytes)} (${r.files} files${r.skipped ? `, ${r.skipped} in use or new were kept` : ''}).`); loadCleanup(); } });
  loaders.stats = () => { stopStats(); pollStats(); loadCleanup().catch(() => {}); };

  // ------------------------------------------------------------------ SCREEN TIME
  async function loadTime(r) {
    r = r || await api.screenTime();
    $('#time-on').checked = !!r.on;
    $('#time-total').textContent = fmtDur(r.total);
    const list = $('#time-list');
    list.textContent = '';
    const top = (r.apps || []).slice(0, 14);
    const max = top.length ? top[0].secs : 1;
    const need = [];
    for (const a of top) {
      const item = { name: a.name, kind: a.path ? 'file' : 'none', target: a.path || a.key };
      if (a.path && !iconCache.has(a.path)) need.push(a.path);
      const ic = iconEl(item);
      if (a.key === 'capri') setIcon(ic, '../assets/icon256.png');
      list.append(h('div', { class: 'ta' }, ic, h('div', { class: 'info' },
        h('div', { class: 'top' }, h('span', { text: a.name }), h('span', { text: fmtDur(a.secs) })),
        h('div', { class: 'tbar' }, h('div', { style: `width:${Math.max(1, (a.secs / max) * 100)}%` })))));
    }
    if (!top.length) list.append(h('div', { class: 'empty', text: r.on ? 'Nothing counted yet today. Check back in a bit~' : 'Counting is off.' }));
    if (need.length) {
      const got = await api.icons(need);
      takeIcons(got);
      for (const el of list.querySelectorAll('.ico[data-icon-target]')) { const u = got[el.dataset.iconTarget]; if (u) setIcon(el, u); }
    }
    const bars = $('#week-bars'), labels = $('#week-labels');
    bars.textContent = ''; labels.textContent = '';
    const wmax = Math.max(1, ...(r.week || []).map((w) => w.secs));
    for (const w of r.week || []) {
      const d = parseDay(w.day);
      bars.append(h('div', { class: `wb${w.day === r.today ? ' today' : ''}` }, h('span', { text: w.secs ? fmtDur(w.secs) : '' }), h('i', { style: `height:${(w.secs / wmax) * 100}%` })));
      labels.append(h('span', { text: DOW[(d.getDay() + 6) % 7] }));
    }
  }
  $('#time-on').addEventListener('change', async () => { const r = await api.setScreenTime($('#time-on').checked); loadTime(r); });
  loaders.time = () => loadTime().catch((e) => console.error(e));

  // ------------------------------------------------------------------ MY APPS
  let mine = [];
  async function loadMine(r) {
    r = r || await api.myApps();
    mine = r.apps || [];
    takeIcons(r.icons);
    const row = (a) => {
      const i = mine.indexOf(a);
      const group = mine.filter((x) => (x.kind === 'url') === (a.kind === 'url'));
      const gi = group.indexOf(a);
      const ico = iconEl(a, r.custom);
      const icoBtn = h('button', { class: 'ico', style: ico.style.cssText, title: 'Change icon', 'aria-label': `Change icon of ${a.name}`, onclick: () => changeIcon(a) });
      icoBtn.dataset.iconTarget = ico.dataset.iconTarget;
      icoBtn.append(...ico.childNodes); if (ico.classList.contains('has-img')) icoBtn.classList.add('has-img');
      return h('div', { class: 'ma' },
        h('button', { class: 'mv', text: '▲', 'aria-label': 'Move up', disabled: gi === 0, onclick: () => move(a, -1) }),
        h('button', { class: 'mv', text: '▼', 'aria-label': 'Move down', disabled: gi === group.length - 1, onclick: () => move(a, 1) }),
        icoBtn,
        h('input', { class: 'name', value: a.name, maxlength: '60', 'aria-label': 'Name', onchange: (e) => { a.name = e.target.value.trim() || a.name; saveMine(); } }),
        h('span', { class: 'tgt', text: a.kind === 'appsfolder' ? `Start menu · ${a.target}` : a.target, title: a.target }),
        h('button', { class: 'btn ghost', text: 'OPEN', onclick: () => api.launch(a) }),
        h('button', { class: 'link bad', text: 'remove', onclick: () => { mine.splice(i, 1); saveMine(); } }));
    };
    const apps = mine.filter((a) => a.kind !== 'url'), webs = mine.filter((a) => a.kind === 'url');
    const list = $('#mine-list'), wl = $('#web-list');
    list.textContent = ''; wl.textContent = '';
    apps.forEach((a) => list.append(row(a)));
    webs.forEach((a) => wl.append(row(a)));
    if (!apps.length) list.append(h('div', { class: 'empty', text: 'No favorite apps yet.' }));
    if (!webs.length) wl.append(h('div', { class: 'empty', text: 'No websites yet. Add one with a name and its link.' }));
  }
  function move(a, d) {
    const web = a.kind === 'url';
    const idx = mine.map((x, k) => ((x.kind === 'url') === web ? k : -1)).filter((k) => k >= 0);
    const at = idx.indexOf(mine.indexOf(a)), to = idx[at + d];
    if (to == null) return;
    const i = mine.indexOf(a);
    [mine[i], mine[to]] = [mine[to], mine[i]];
    saveMine();
  }
  $('#web-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = await api.webApp($('#web-name').value, $('#web-url').value);
    if (!a) { toast('That link doesn\'t look like a website.'); return; }
    mine.push(a); await saveMine();
    $('#web-name').value = ''; $('#web-url').value = '';
    toast(`${a.name} added~`);
  });
  async function saveMine() { loadMine(await api.saveMyApps(mine)); }
  async function changeIcon(a) { const f = await api.pickIcon(); if (f) { a.icon = f; saveMine(); } }
  $('#mine-add').addEventListener('click', async () => { const add = await api.pickApps(); if (add && add.length) { mine.push(...add); saveMine(); toast(`Added ${add.map((x) => x.name).join(', ')}~`); } });
  const mineEl = $('.mine');
  mineEl.addEventListener('dragover', (e) => { e.preventDefault(); mineEl.classList.add('drop'); });
  mineEl.addEventListener('dragleave', () => mineEl.classList.remove('drop'));
  mineEl.addEventListener('drop', async (e) => {
    e.preventDefault(); mineEl.classList.remove('drop');
    const added = [];
    for (const f of e.dataTransfer.files) { const a = await api.fileApp(api.pathOf(f)); if (a) added.push(a); }
    if (added.length) { mine.push(...added); saveMine(); toast(`Added ${added.map((x) => x.name).join(', ')}~`); }
  });
  loaders.mine = () => loadMine().catch((e) => console.error(e));

  // ------------------------------------------------------------------ STATUS (title-bar lights + page)
  let status = null, statusT = null;
  const LIGHT_IDS = ['hermes', 'discord', 'spotify', 'browser', 'internet'];
  const fmtAgo = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
  async function pollStatus() {
    clearTimeout(statusT);
    if (!document.hidden) {
      try { status = await api.status(); } catch (e) { console.error(e); }
      if (status) { renderLights(); if (page === 'status') renderStatus(); }
    }
    statusT = setTimeout(pollStatus, page === 'status' ? 5000 : 15000);
  }
  function renderLights() {
    const box = $('#lights');
    box.textContent = '';
    for (const id of LIGHT_IDS) {
      const s = status.services.find((x) => x.id === id);
      if (!s) continue;
      box.append(h('button', { class: 'light', title: `${s.name}: ${s.state}`, onclick: (e) => openPop(s, e.currentTarget) }, h('i', { class: `l-${s.light}` }), s.short || s.name));
    }
    const worst = status.services.some((s) => s.light === 'bad') ? 'bad' : status.services.some((s) => s.light === 'warn') ? 'warn' : '';
    const dot = $('#status-dot');
    dot.hidden = !worst; dot.className = `nav-dot l-${worst}`;
  }
  function actionBtn(a) {
    return h('button', { class: 'btn ghost', text: a.label, onclick: async (e) => {
      const b = e.currentTarget; const was = b.textContent;
      b.disabled = true; b.textContent = '…';
      const r = await api.statusAction(a.id);
      b.disabled = false; b.textContent = was;
      if (r && r.text) toast(r.text);
      pollStatus();
    } });
  }
  function openPop(s, anchor) {
    const pop = $('#pop');
    pop.textContent = '';
    pop.append(
      h('div', { class: 'row' }, h('i', { class: `l-${s.light}`, style: 'width:8px;height:8px' }), h('b', { text: s.name }), h('span', { class: 'grow' }), h('span', { class: 'soft', text: s.state })),
      ...s.lines.map((l) => h('div', { class: 'soft', text: l })),
      h('div', { class: 'row' }, ...s.actions.map(actionBtn), h('span', { class: 'grow' }), h('button', { class: 'link', text: 'status page ›', onclick: () => { pop.hidden = true; show('status'); } })));
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 340, r.left + r.width / 2 - 165))}px`;
    pop.hidden = false;
  }
  document.addEventListener('mousedown', (e) => { const pop = $('#pop'); if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.light')) pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#pop').hidden = true; });
  function renderStatus() {
    if (!status) return;
    const g = $('#svc');
    g.textContent = '';
    for (const s of status.services) {
      g.append(h('div', { class: 'card svc' },
        h('div', { class: 'head' }, h('i', { class: `dot l-${s.light}` }), h('span', { class: 'lbl', style: `color:${s.light === 'ok' ? 'var(--green)' : s.light === 'warn' ? '#f2b632' : s.light === 'bad' ? 'var(--pink)' : 'var(--dim)'}`, text: s.name })),
        h('div', { class: 'st', text: s.state }),
        ...s.lines.map((l) => h('div', { class: 'ln', text: l })),
        s.actions.length ? h('div', { class: 'acts' }, ...s.actions.map(actionBtn)) : null));
    }
    const rl = $('#recent');
    rl.textContent = '';
    for (const ev of status.recent) rl.append(h('div', {}, h('span', { text: `${fmtAgo(ev.at)} · ` }), ev.text));
    if (!status.recent.length) rl.append(h('div', { text: 'Nothing happened since Capri started. All quiet~' }));
    $('#status-at').textContent = `checked ${new Date(status.at).toLocaleTimeString('en-GB')}`;
  }
  loaders.status = () => { renderStatus(); pollStatus(); };

  // ------------------------------------------------------------------ TERMINAL
  // the main process lays her terminal page over #term-host; it stays alive (tabs keep running) on other pages
  let termShown = false;
  function placeTerm() {
    if (!api.placeTerminal) return;
    const show = page === 'term' && !document.hidden && $('#pop').hidden;
    if (!show) { if (termShown) { termShown = false; api.placeTerminal(null, false); } return; }
    const r = $('#term-host').getBoundingClientRect();
    if (!r.width || !r.height) { requestAnimationFrame(placeTerm); return; }
    termShown = true;
    api.placeTerminal({ x: r.left + 1, y: r.top + 1, width: r.width - 2, height: r.height - 2 }, true);
  }
  new ResizeObserver(() => { if (page === 'term') placeTerm(); }).observe($('#term-host'));
  window.addEventListener('resize', () => { if (page === 'term') placeTerm(); });
  new MutationObserver(() => placeTerm()).observe($('#pop'), { attributes: true, attributeFilter: ['hidden'] });
  loaders.term = () => requestAnimationFrame(placeTerm);

  // ------------------------------------------------------------------ start
  document.addEventListener('visibilitychange', () => { placeTerm(); if (document.hidden) return; if (page === 'dash') loaders.dash(); pollStatus(); });
  (async () => {
    const info = await api.init();
    document.title = `${info.name || 'Capri'} Hub`;
    $('#brand').textContent = `${String(info.name || 'Capri').toUpperCase()} HUB`;
    $('#chat-brain').textContent = `Brain: ${info.brain}`;
    if (info.release) {
      const u = $('#update');
      u.hidden = false; u.textContent = `⚡ v${info.release.version} is out`;
      u.title = 'Open the download page';
      u.addEventListener('click', () => window.open(info.release.url));
    }
    const p = new URLSearchParams(location.search).get('page');
    show(p || 'dash');
    pollStatus();
  })();
  window.__hubTest = { show, doc: () => doc, iconCache };
})();
