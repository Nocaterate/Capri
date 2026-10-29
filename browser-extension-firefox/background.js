// Capri Browser Link: a small bridge between Capri (on this PC) and this browser (Chrome, Edge, Brave, Opera,
// Vivaldi; the Firefox copy in browser-extension-firefox/ uses this same file).
// It connects to Capri at ws://127.0.0.1:43824 and does what she asks: list/open/switch/close tabs, read the
// page, click, type, scroll, play/pause media. It never types into password or card fields, and it tells Capri
// when a click or a submit looks like it would send, buy, post or delete something, so she asks you first.
const URL_CAPRI = 'ws://127.0.0.1:43824/capri';
let ws = null, keep = null, connecting = false;

function connect() {
  if (connecting || (ws && ws.readyState <= 1)) return;
  connecting = true;
  try { ws = new WebSocket(URL_CAPRI); } catch { connecting = false; return; }
  ws.onopen = () => {
    connecting = false;
    ws.send(JSON.stringify({ type: 'hello', version: chrome.runtime.getManifest().version, ua: navigator.userAgent, brave: !!(navigator.brave) }));
    clearInterval(keep);
    keep = setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"type":"ping"}'); }, 20000);   // keeps the worker awake
  };
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg || !msg.id) return;
    let result;
    try { result = await handle(msg.cmd, msg.args || {}); } catch (e) { result = { error: String((e && e.message) || e) }; }
    try { ws.send(JSON.stringify({ id: msg.id, result })); } catch { /* Capri went away */ }
  };
  ws.onclose = () => { connecting = false; clearInterval(keep); ws = null; setTimeout(connect, 3000); };
  ws.onerror = () => { connecting = false; };
}
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('capri', { periodInMinutes: 0.5 }); connect(); });
chrome.alarms.onAlarm.addListener(connect);
chrome.action.onClicked.addListener(connect);
connect();

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (t) return t;
  const [any] = await chrome.tabs.query({ active: true });
  return any;
}
async function tabOf(args) {
  const t = args.tabId ? await chrome.tabs.get(Number(args.tabId)) : await activeTab();
  if (!t) throw new Error('No browser tab is open.');
  return t;
}
async function settle(tabId, ms = 10000) {
  const until = Date.now() + ms;
  await sleep(300);
  while (Date.now() < until) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t || t.status === 'complete') return t;
    await sleep(250);
  }
  return chrome.tabs.get(tabId).catch(() => null);
}
const brief = (t) => t && { tabId: t.id, title: t.title || '', url: t.url || '', active: !!t.active, audible: !!t.audible };
function okUrl(u) {
  let s = String(u || '').trim();
  if (!s) throw new Error('No address given.');
  if (!/^[a-z]+:\/\//i.test(s)) {
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) s = 'https://' + s;
    else s = 'https://www.google.com/search?q=' + encodeURIComponent(s);
  }
  const url = new URL(s);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Capri only opens normal web pages (http/https).');
  return url.href;
}
async function inPage(tab, func, args = []) {
  if (!/^https?:/i.test(tab.url || '')) throw new Error("This tab is a browser page Capri isn't allowed to touch (only normal websites).");
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return r && r.result;
}

// ---------------------------------------------------------------- commands
async function handle(cmd, a) {
  switch (cmd) {
    case 'tabs': {
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.slice(0, 40).map(brief) };
    }
    case 'open': {
      const url = okUrl(a.url);
      let t;
      if (a.newTab === false) { const cur = await activeTab(); t = cur ? await chrome.tabs.update(cur.id, { url, active: true }) : await chrome.tabs.create({ url }); }
      else t = await chrome.tabs.create({ url, active: true });
      if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
      return { tab: brief(await settle(t.id)) };
    }
    case 'tab': {
      const t = await tabOf(a);
      if (a.action === 'close') { await chrome.tabs.remove(t.id); return { closed: brief(t) }; }
      if (a.action === 'back') { await chrome.tabs.goBack(t.id).catch(() => {}); return { tab: brief(await settle(t.id)) }; }
      if (a.action === 'forward') { await chrome.tabs.goForward(t.id).catch(() => {}); return { tab: brief(await settle(t.id)) }; }
      if (a.action === 'reload') { await chrome.tabs.reload(t.id); return { tab: brief(await settle(t.id)) }; }
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
      return { tab: brief(await chrome.tabs.get(t.id)) };
    }
    case 'read': {
      const t = await tabOf(a);
      const page = await inPage(t, pageRead, [Number(a.max) || 6000]);
      return { tab: brief(t), page };
    }
    case 'click': {
      const t = await tabOf(a);
      const r = await inPage(t, pageClick, [Number(a.element), !!a.force]);
      if (r && r.clicked) r.tab = brief(await settle(t.id, 6000));
      return r;
    }
    case 'type': {
      const t = await tabOf(a);
      const r = await inPage(t, pageType, [Number(a.element), String(a.text ?? ''), !!a.submit, !!a.force]);
      if (r && r.submitted) r.tab = brief(await settle(t.id, 8000));
      return r;
    }
    case 'scroll': {
      const t = await tabOf(a);
      return inPage(t, pageScroll, [String(a.direction || 'down')]);
    }
    case 'media': {
      const t = await tabOf(a);
      return inPage(t, pageMedia, [String(a.action || 'toggle')]);
    }
    default:
      return { error: `Unknown command ${cmd}` };
  }
}

// ---------------------------------------------------------------- functions that run inside the page
// (each must be self-contained: Chrome copies the function's source into the tab)

function pageRead(max) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const clean = (s, n = 70) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  document.querySelectorAll('[data-capri-id]').forEach((e) => e.removeAttribute('data-capri-id'));
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=textbox], [role=searchbox], [role=combobox], [role=checkbox], [role=switch], [role=tab], [role=menuitem], [role=option], [contenteditable=""], [contenteditable="true"]';
  const all = [...document.querySelectorAll(sel)].filter(visible);
  const vh = innerHeight;
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; };
  const order = [...all.filter(inView), ...all.filter((e) => !inView(e))].slice(0, 140);
  const els = [];
  order.forEach((el, i) => {
    const id = i + 1;
    el.setAttribute('data-capri-id', String(id));
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'textarea' ? 'text box' : tag === 'select' ? 'dropdown'
      : tag === 'input' ? (type === 'search' ? 'search box' : ['checkbox', 'radio'].includes(type) ? type : ['submit', 'button', 'reset', 'image'].includes(type) ? 'button' : 'text box')
      : el.isContentEditable ? 'text box' : 'button');
    const label = clean(el.getAttribute('aria-label') || (tag === 'input' || tag === 'textarea' ? '' : el.innerText) || el.getAttribute('placeholder')
      || el.getAttribute('title') || el.getAttribute('alt') || (tag === 'input' ? el.value : '') || el.getAttribute('name') || (tag === 'a' ? el.getAttribute('href') : ''));
    const blocked = type === 'password' || /cc-|card|cvv|cvc/i.test((el.getAttribute('autocomplete') || '') + ' ' + (el.getAttribute('name') || ''));
    const e = { id, role, label };
    if (blocked) e.note = 'password/card field: Capri does not type here';
    if ((tag === 'input' || tag === 'textarea') && el.value && !blocked && type !== 'submit') e.value = clean(el.value, 40);
    if (type === 'checkbox' || type === 'radio') e.checked = !!el.checked;
    if (!inView(el)) e.offscreen = true;
    els.push(e);
  });
  const root = document.querySelector('main, [role=main], article') || document.body;
  let text = clean((root && root.innerText) || '', max || 6000);
  if (root !== document.body && text.length < 400) text = clean(document.body.innerText, max || 6000);
  return { title: document.title, url: location.href, text, elements: els, scroll: Math.round((scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)) * 100) };
}

function pageClick(id, force) {
  const el = document.querySelector(`[data-capri-id="${id}"]`);
  if (!el) return { error: `Element [${id}] isn't on the page any more. Read the page again.` };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const label = clean(el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('href'));
  const RISKY = /\b(send|submit|buy|pay|purchase|order|checkout|check ?out|delete|remove|erase|post|publish|tweet|reply|comment|confirm|transfer|withdraw|donate|subscribe|unsubscribe|sign ?in|log ?in|sign ?up|register|install|accept|agree|save|apply|share|upload|block|report|kirim|beli|bayar|hapus)\b/i;
  const form = el.closest('form');
  const isSubmit = (el.tagName === 'BUTTON' && (el.getAttribute('type') || 'submit') === 'submit' && form) || (el.tagName === 'INPUT' && ['submit', 'image'].includes((el.type || '').toLowerCase()));
  const search = form && (form.getAttribute('role') === 'search' || /search/i.test(form.getAttribute('action') || '') || form.querySelector('input[type=search], input[name=q], input[name=search_query]'));
  if (!force && (RISKY.test(label) || (isSubmit && !search))) return { needsConfirm: true, what: `click "${label || 'this button'}"` };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus({ preventScroll: true });
  el.click();
  return { clicked: true, what: label };
}

function pageType(id, text, submit, force) {
  const el = document.querySelector(`[data-capri-id="${id}"]`);
  if (!el) return { error: `Element [${id}] isn't on the page any more. Read the page again.` };
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'password' || /cc-|card|cvv|cvc/i.test((el.getAttribute('autocomplete') || '') + ' ' + (el.getAttribute('name') || ''))) {
    return { error: 'That is a password or card field. Capri never types there: the user types it themselves.' };
  }
  if (['file', 'hidden', 'checkbox', 'radio', 'submit', 'button'].includes(type)) return { error: 'That element is not a text field. Click it instead.' };
  const form = el.closest('form');
  const search = type === 'search' || el.getAttribute('role') === 'searchbox' || /^(q|query|search|search_query|s|keyword)$/i.test(el.getAttribute('name') || '')
    || /search|cari/i.test(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '') || (form && (form.getAttribute('role') === 'search' || /search/i.test(form.getAttribute('action') || '')));
  if (submit && !force && !search) return { needsConfirm: true, what: `type "${text.slice(0, 60)}" and press Enter (that sends the form)` };
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (el.isContentEditable) {
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (!submit) return { typed: true };
  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  const down = el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
  if (down && form) { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
  return { typed: true, submitted: true };
}

function pageScroll(direction) {
  const h = innerHeight * 0.8;
  if (direction === 'top') scrollTo({ top: 0, behavior: 'smooth' });
  else if (direction === 'bottom') scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  else scrollBy({ top: direction === 'up' ? -h : h, behavior: 'smooth' });
  return { scrolled: direction };
}

function pageMedia(action) {
  const media = [...document.querySelectorAll('video, audio')].sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
  const m = media.find((x) => !x.paused) || media[0];
  if (!m) return { error: 'There is no video or audio on this page.' };
  if (action === 'play' || (action === 'toggle' && m.paused)) { m.play().catch(() => {}); return { media: 'playing' }; }
  if (action === 'pause' || action === 'toggle') { m.pause(); return { media: 'paused' }; }
  if (action === 'mute') { m.muted = true; return { media: 'muted' }; }
  if (action === 'unmute') { m.muted = false; return { media: 'unmuted' }; }
  return { error: `Unknown media action ${action}` };
}
