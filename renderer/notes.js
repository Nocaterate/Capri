// Notes & To-do list: a hologram panel Capri projects next to herself.
// Opening: she charges, zaps (red form) to the side of the screen with more room, casts, and the panel
// scans in beside her. Closing (✕, Esc, or the menu item again): it folds into a line and zips back into her hand.
// Data lives in <userData>/notes.json via main.js, which also fires the to-do reminders.

const BELL_ON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 1.5a4 4 0 0 0-4 4v2.6L2.6 11h10.8L12 8.1V5.5a4 4 0 0 0-4-4zM6.4 12.5a1.7 1.7 0 0 0 3.2 0z" fill="currentColor"/></svg>';
const BELL_OFF = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 1.5a4 4 0 0 0-4 4v2.6L2.6 11h10.8L12 8.1V5.5a4 4 0 0 0-4-4zM6.4 12.5a1.7 1.7 0 0 0 3.2 0z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 2l12 12" stroke="currentColor" stroke-width="1.4"/></svg>';
const TRASH = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4h10M6 4V2.5h4V4M4.5 4l.6 9.5h5.8l.6-9.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const MAX_TODO = 50;

export function initNotes(env) {
  const { api, st, fx, sfx } = env;
  const $ = (id) => document.getElementById(id);
  const wrap = $('holo'), panel = wrap.querySelector('.holo');
  const el = {
    tabs: wrap.querySelectorAll('.holo-tab'), x: $('holo-x'),
    notesPane: $('holo-notes'), todoPane: $('holo-todo'),
    list: $('h-notelist'), newNote: $('h-new'), editor: $('h-editor'), empty: $('h-empty'),
    title: $('h-title'), text: $('h-text'), saved: $('h-saved'), delNote: $('h-delnote'),
    add: $('h-add'), todo: $('h-todo'), count: $('h-count'), time: $('h-time'), bell: $('h-bell'),
    rows: $('h-rows'), none: $('h-none'), hint: $('h-hint'),
  };
  const HINT = el.hint.textContent;

  let doc = { notes: [], todos: [] };
  let open = false, busy = false, tab = 'notes', current = null;
  let confirm = null;            // { kind: 'todo' | 'note', id } waiting for "Delete?"
  let addRemind = false, saveTimer = null, hintTimer = null, side = 1;
  st.notesOpen = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- saving
  async function load() {
    try { const d = await api.notesGet(); if (d) doc = { notes: d.notes || [], todos: d.todos || [] }; } catch { /* keep what we have */ }
    if (!current || !doc.notes.find((n) => n.id === current)) current = sortedNotes()[0]?.id || null;
  }
  function saveNotesSoon() {
    el.saved.textContent = 'Saving…'; el.saved.classList.remove('ok');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushNotes, 400);
  }
  async function flushNotes() {
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = null;
    try {
      await api.notesSave({ notes: doc.notes });
      el.saved.textContent = '● Saved'; el.saved.classList.add('ok');
    } catch { el.saved.textContent = 'Could not save'; }
  }
  async function saveTodos() {
    try {
      const d = await api.notesSave({ todos: doc.todos });
      if (d && d.todos) doc.todos = d.todos;   // main adds when each reminder will fire
    } catch { hint('Could not save. Try again?', true); }
    renderTodos();
  }

  // ---------------------------------------------------------------- notes tab
  const sortedNotes = () => doc.notes.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  function when(t) {
    const d = new Date(t), now = new Date();
    const hm = d.toTimeString().slice(0, 5);
    if (d.toDateString() === now.toDateString()) return `Today ${hm}`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function renderNoteList() {
    const notes = sortedNotes();
    el.list.innerHTML = notes.map((n) => {
      const first = (n.body || '').split('\n').find((l) => l.trim()) || 'Empty note';
      return `<button class="h-note${n.id === current ? ' on' : ''}" data-id="${esc(n.id)}"><b>${esc(n.title || 'Untitled')}</b><small>${esc(first)}</small><i>${when(n.updated)}</i></button>`;
    }).join('');
    const has = notes.length > 0;
    el.editor.hidden = !has || !current;
    el.empty.hidden = has && !!current;
  }
  function renderEditor() {
    const n = doc.notes.find((x) => x.id === current);
    if (!n) { renderNoteList(); return; }
    el.title.value = n.title || '';
    el.text.value = n.body || '';
    renderDelNote();
  }
  function renderDelNote() {
    const asking = confirm && confirm.kind === 'note' && confirm.id === current;
    el.delNote.innerHTML = asking
      ? '<span class="h-confirm"><span>Delete this note?</span><button type="button" class="h-danger" data-act="yes">Delete</button><button type="button" class="h-secondary" data-act="no">Keep</button></span>'
      : `<button type="button" class="h-trash wide" data-act="ask">${TRASH} Delete note</button>`;
  }
  function renderNotes() { renderNoteList(); if (current) renderEditor(); }

  el.newNote.addEventListener('click', () => {
    flushNotes();
    const n = { id: uid(), title: '', body: '', updated: Date.now() };
    doc.notes.push(n);
    current = n.id; confirm = null;
    renderNotes();
    saveNotesSoon();
    el.title.focus();
  });
  el.list.addEventListener('click', (e) => {
    const b = e.target.closest('.h-note');
    if (!b) return;
    flushNotes();
    current = b.dataset.id; confirm = null;
    renderNotes();
  });
  const edited = () => {
    const n = doc.notes.find((x) => x.id === current);
    if (!n) return;
    n.title = el.title.value; n.body = el.text.value; n.updated = Date.now();
    renderNoteList();
    saveNotesSoon();
  };
  el.title.addEventListener('input', edited);
  el.text.addEventListener('input', edited);
  el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.text.focus(); } });
  el.delNote.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'ask') { confirm = { kind: 'note', id: current }; renderDelNote(); renderTodos(); }
    else if (act === 'no') { confirm = null; renderDelNote(); }
    else if (act === 'yes') {
      doc.notes = doc.notes.filter((n) => n.id !== current);
      confirm = null; current = sortedNotes()[0]?.id || null;
      saveNotesSoon(); flushNotes();
      renderNotes();
      sfx.crackle(0.25, 20);
    }
  });

  // ---------------------------------------------------------------- to-do tab
  function bellHtml(on) { return `${on ? BELL_ON : BELL_OFF}<span>${on ? 'ON' : 'OFF'}</span>`; }
  function bellTitle(t) {
    if (!t.remind || !t.remindAt) return t.time ? 'Remind me: off (click to turn on)' : 'Pick a time, then turn this on';
    const d = new Date(t.remindAt), today = new Date();
    const day = d.toDateString() === today.toDateString() ? 'today' : 'tomorrow';
    return `${env.name()} will remind you ${day} at ${t.time}`;
  }
  function renderTodos() {
    el.rows.innerHTML = doc.todos.map((t) => {
      const asking = confirm && confirm.kind === 'todo' && confirm.id === t.id;
      const del = asking
        ? '<div class="h-confirm"><span>Delete?</span><button type="button" class="h-danger" data-act="yes">Delete</button><button type="button" class="h-secondary" data-act="no">Keep</button></div>'
        : `<button type="button" class="h-trash" data-act="ask" title="Delete">${TRASH}</button>`;
      return `<tr data-id="${esc(t.id)}" class="${asking ? 'ask' : ''}">
        <td class="task">${esc(t.text)}</td>
        <td class="tm"><input type="time" class="h-rowtime" value="${esc(t.time || '')}" aria-label="Time"></td>
        <td><button type="button" class="h-bell${t.remind ? ' on' : ''}" data-act="bell" title="${esc(bellTitle(t))}">${bellHtml(t.remind)}</button></td>
        <td>${del}</td></tr>`;
    }).join('');
    el.none.hidden = doc.todos.length > 0;
  }
  function renderAddBell() {
    el.bell.classList.toggle('on', addRemind);
    el.bell.innerHTML = bellHtml(addRemind);
    el.bell.title = addRemind ? `${env.name()} will remind you at this time` : 'Remind me: off';
  }
  function hint(msg, bad = false) {
    clearTimeout(hintTimer);
    el.hint.textContent = msg;
    el.hint.classList.toggle('bad', bad);
    hintTimer = setTimeout(() => { el.hint.textContent = HINT; el.hint.classList.remove('bad'); }, 4000);
  }
  const counter = () => {
    el.count.textContent = `${el.todo.value.length}/${MAX_TODO}`;
    el.count.classList.toggle('full', el.todo.value.length >= MAX_TODO);
  };
  el.todo.addEventListener('input', counter);
  el.time.addEventListener('change', () => { if (el.time.value && !addRemind) { addRemind = true; renderAddBell(); } if (!el.time.value && addRemind) { addRemind = false; renderAddBell(); } });
  el.bell.addEventListener('click', () => {
    if (!addRemind && !el.time.value) { hint('Pick a time first, then turn the reminder on.', true); el.time.focus(); flash(el.time); return; }
    addRemind = !addRemind; renderAddBell(); sfx.blip(addRemind);
  });
  el.add.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.todo.value.trim().slice(0, MAX_TODO);
    if (!text) { el.todo.focus(); flash(el.todo); return; }
    const time = el.time.value || '';
    doc.todos.push({ id: uid(), text, time, remind: addRemind && !!time, created: Date.now() });
    el.todo.value = ''; el.time.value = ''; addRemind = false;
    counter(); renderAddBell();
    sfx.blip(true);
    saveTodos().then(() => {
      const t = doc.todos[doc.todos.length - 1];
      if (t && t.remind) hint(`Got it. ${bellTitle(t)}.`);
    });
    el.todo.focus();
  });
  el.rows.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('tr');
    if (!btn || !row) return;
    const t = doc.todos.find((x) => x.id === row.dataset.id);
    if (!t) return;
    const act = btn.dataset.act;
    if (act === 'bell') {
      if (!t.remind && !t.time) { hint('Set a time for this to-do first.', true); const ti = row.querySelector('.h-rowtime'); ti.focus(); flash(ti); return; }
      t.remind = !t.remind;
      sfx.blip(t.remind);
      saveTodos().then(() => { const n = doc.todos.find((x) => x.id === t.id); if (n && n.remind) hint(`${bellTitle(n)}.`); });
    } else if (act === 'ask') { confirm = { kind: 'todo', id: t.id }; renderTodos(); renderDelNote(); }
    else if (act === 'no') { confirm = null; renderTodos(); }
    else if (act === 'yes') {
      doc.todos = doc.todos.filter((x) => x.id !== t.id);
      confirm = null;
      sfx.crackle(0.25, 20);
      saveTodos();
    }
  });
  el.rows.addEventListener('change', (e) => {
    if (!e.target.classList.contains('h-rowtime')) return;
    const t = doc.todos.find((x) => x.id === e.target.closest('tr').dataset.id);
    if (!t) return;
    t.time = e.target.value || '';
    if (!t.time) t.remind = false;
    saveTodos();
  });
  function flash(node) { node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash'); }

  // ---------------------------------------------------------------- tabs, closing, keys
  function setTab(name) {
    tab = name;
    el.tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    el.notesPane.hidden = name !== 'notes';
    el.todoPane.hidden = name !== 'todo';
    confirm = null;
    if (name === 'notes') renderNotes(); else { renderTodos(); renderAddBell(); counter(); }
    sfx.blip(true);
  }
  el.tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  el.x.addEventListener('click', () => closeNotes());
  // a click anywhere else in the panel cancels a pending "Delete?"
  panel.addEventListener('mousedown', (e) => {
    api.focusOverlay();
    if (confirm && !e.target.closest('.h-confirm')) { confirm = null; renderTodos(); renderDelNote(); }
  });
  window.addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Escape' || e.target.id === 'typeinput') return;
    e.preventDefault();
    if (confirm) { confirm = null; renderTodos(); renderDelNote(); return; }
    closeNotes();
  });

  // ---------------------------------------------------------------- placing it beside her
  function reach() {                       // how far her (and D's) pixels reach from where she stands
    const S = env.S();
    return env.duoX() != null ? 60 * S : 34 * S;
  }
  function place() {
    const W = env.W(), H = env.H();
    const pw = Math.min(600, W - 16), ph = Math.min(panel.offsetHeight || 480, H - 16);
    wrap.style.width = pw + 'px';
    const cx = env.duoX() != null ? env.duoX() : st.pos.x;
    const r = reach();
    const roomR = W - (cx + r), roomL = cx - r;
    side = roomR >= roomL ? 1 : -1;
    const left = side > 0 ? cx + r + 14 : cx - r - 14 - pw;
    wrap.style.left = Math.round(Math.max(8, Math.min(W - pw - 8, left))) + 'px';
    const core = env.coreScreen();
    wrap.style.top = Math.round(Math.max(8, Math.min(H - ph - 8, core.y - ph * 0.62))) + 'px';
    wrap.style.setProperty('--origin', side > 0 ? 'left' : 'right');
  }
  window.addEventListener('resize', () => { if (open) place(); });
  function edgePoint() {                   // the panel edge nearest to her, for the bolt
    const b = wrap.getBoundingClientRect();
    return { x: side > 0 ? b.left + 4 : b.right - 4, y: b.top + Math.min(b.height * 0.4, 160) };
  }

  async function waitFor(cond, ms) {
    const until = performance.now() + ms;
    while (!cond() && performance.now() < until) await sleep(50);
  }

  async function openNotes() {
    if (open || busy) return;
    busy = true;
    try {
      await env.ensureVisible();
      if (st.chill) env.endChill();
      const loading = load();
      st.notesOpen = true;               // keeps her from wandering off while the panel is up
      st.lastInteraction = performance.now();
      // 1. a quick charge
      if (['idle', 'speaking'].includes(st.mode) && !st.action) { env.play('charge', 0.45); sfx.powerUp(0.4); await sleep(430); }
      // 2. zap toward the side of the screen with more room (red electric form)
      const W = env.W(), r = reach();
      const goLeft = st.pos.x > W / 2;
      const target = goLeft ? r + 16 : W - r - 16;
      if (st.mode === 'idle') {
        env.startWalk(target, true, 2.6);   // a fast zap, not a stroll
        await waitFor(() => st.mode !== 'walking', 5000);
        await sleep(env.duoX() != null ? 650 : 120);   // with D: let her burst back out of him first
      }
      await loading;
      // 3. cast, and the hologram scans in beside her
      place();
      st.flip = side;
      env.play('cast', 1.1);
      await sleep(170);
      setTab(tab);
      wrap.hidden = false;
      place();
      wrap.classList.remove('closing'); void wrap.offsetWidth; wrap.classList.add('opening');
      const o = env.orbScreen(), p = edgePoint();
      fx.bolt(o.x, o.y, p.x, p.y, { life: 0.3, width: 1.5, branches: 3 });
      fx.burst(p.x, p.y, 14, { speed: 220, life: 0.4, gravity: 0 });
      fx.doFlash(0.15);
      sfx.zap(0.9);
      open = true;
      api.notesState(true);
      api.focusOverlay();
      setTimeout(() => { if (open) { st.winkUntil = performance.now() + 1000; env.setEmotion('happy', 2, false); } }, 650);
      setTimeout(() => {
        wrap.classList.remove('opening');
        if (!open) return;
        if (tab === 'notes' && current) el.text.focus(); else if (tab === 'todo') el.todo.focus();
      }, 560);
    } finally { busy = false; }
  }

  async function closeNotes(instant = false) {
    if (!open) return;
    open = false;
    confirm = null;
    flushNotes();
    api.notesState(false);
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    if (instant) { wrap.hidden = true; st.notesOpen = false; env.setInteractive(false); return; }
    if (st.visible && ['idle', 'speaking'].includes(st.mode)) { st.flip = side; env.play('cast', 0.7); }
    wrap.classList.remove('opening'); void wrap.offsetWidth; wrap.classList.add('closing');
    sfx.zap(0.45);
    await sleep(330);
    const p = edgePoint(), o = env.orbScreen();
    if (st.visible) {
      fx.bolt(p.x, p.y, o.x, o.y, { life: 0.22, width: 1.2, branches: 1 });
      for (let i = 0; i < 10; i++) fx.spark(o.x + (Math.random() - 0.5) * 20, o.y + (Math.random() - 0.5) * 20);
    }
    await sleep(120);
    if (!open) { wrap.hidden = true; wrap.classList.remove('closing'); }
    st.notesOpen = false;
    env.setInteractive(false);
  }

  api.onNotesToggle((arg) => { if (arg === 'open') openNotes(); else if (open) closeNotes(); else openNotes(); });
  // main changed the list: a reminder fired (its bell switches off), or Capri added / removed something herself
  api.onNotesUpdated((d) => {
    if (!d) return;
    doc.todos = d.todos || doc.todos;
    if (d.notes && !saveTimer) {          // don't clobber a note you're typing in right now
      doc.notes = d.notes;
      if (!current || !doc.notes.find((n) => n.id === current)) current = sortedNotes()[0]?.id || null;
    }
    if (d.by === 'capri' && d.focus && d.tab === 'notes' && !saveTimer) current = d.focus;
    if (!open) return;
    if (d.by === 'capri' && d.tab && d.tab !== tab) setTab(d.tab);
    else if (tab === 'todo') renderTodos(); else renderNotes();
    if (d.by === 'capri' && d.focus && d.tab === 'todo') {
      const row = el.rows.querySelector(`tr[data-id="${CSS.escape(d.focus)}"]`);
      if (row) { row.classList.add('new'); row.scrollIntoView({ block: 'nearest' }); }
    }
    if (d.by === 'capri') { const p = edgePoint(), o = env.orbScreen(); fx.bolt(o.x, o.y, p.x, p.y, { life: 0.2, width: 1.2, branches: 1 }); sfx.zap(0.4); }
  });

  renderAddBell();
  return { open: openNotes, close: closeNotes, isOpen: () => open, _doc: () => doc, setTab };
}
