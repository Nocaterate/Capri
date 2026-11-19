// Capri Hub: one window with an icon menu on the left (renderer/hub.html): Dashboard (clock, Jump back in, calendar
// with to-dos, a small chat), Chat, Task (to-dos + notes), Apps (everything in the Start menu), Stats (a small Task
// Manager + disks), Screen time and My Apps (apps you pin; she can open them by name too). Settings opens the
// normal Settings window. Opened with the tray icon, the Hub hotkey (Ctrl+Alt+W) or /hub.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PAGES = ['dash', 'chat', 'task', 'apps', 'stats', 'time', 'mine', 'status', 'term'];
// processes the Hub never ends (Windows itself and Capri)
const KEEP_ALIVE = /^(system|idle|registry|smss|csrss|wininit|winlogon|services|lsass|svchost|dwm|explorer|fontdrvhost|memcompression|secure system|sihost|ctfmon|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|textinputhost|lockapp|taskhostw|spoolsv|audiodg|conhost|wudfhost|msmpeng|nissrv|securityhealthservice|vmmem|vmmemwsl|wslservice|capri|electron)$/i;

function cleanApp(a) {
  const kind = ['appsfolder', 'file', 'url'].includes(a && a.kind) ? a.kind : null;
  const target = String((a && a.target) || '').slice(0, 1000);
  if (!kind || !target) return null;
  if (kind === 'url' && !/^https?:\/\//i.test(target)) return null;
  return {
    id: String(a.id || '').slice(0, 40) || crypto.randomUUID(),
    name: String(a.name || '').trim().slice(0, 60) || 'App',
    kind, target,
    icon: a.icon ? String(a.icon).slice(0, 1000) : '',
  };
}
const iconTarget = (a) => (!a ? '' : a.kind === 'appsfolder' ? `shell:AppsFolder\\${a.target}` : a.kind === 'file' ? a.target : a.kind === 'url' ? `fav:${a.target}` : '');
const tidyName = (file) => path.basename(file).replace(/\.(exe|lnk|url)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();

function createHub(deps) {
  const {
    BrowserWindow, ipcMain, dialog, shell, getConfig, setConfig, log, rootDir, iconPath,
    icons, screenTime, stats, pc, apps, chat, getHistory, clearHistory, openSettings, getRelease, appVersion, music, getStatus, statusAction,
  } = deps;
  let win = null;

  function open(page) {
    page = PAGES.includes(page) ? page : 'dash';
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      win.webContents.send('hub-page', page);
      return;
    }
    const b = getConfig().hubBounds || {};
    win = new BrowserWindow({
      width: b.width || 1120, height: b.height || 760, x: b.x, y: b.y, minWidth: 900, minHeight: 620,
      frame: false, backgroundColor: '#0a050c', title: `${getConfig().characterName || 'Capri'} Hub`, icon: iconPath, show: false,
      webPreferences: { preload: path.join(rootDir, 'hub-preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.loadFile(path.join(rootDir, 'renderer', 'hub.html'), { query: { page } });
    win.once('ready-to-show', () => { if (win && !win.isDestroyed()) win.show(); });
    const saveBounds = () => { if (win && !win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) setConfig({ hubBounds: win.getBounds() }); };
    let bt = null;
    win.on('resize', () => { clearTimeout(bt); bt = setTimeout(saveBounds, 600); });
    win.on('move', () => { clearTimeout(bt); bt = setTimeout(saveBounds, 600); });
    win.on('closed', () => { win = null; });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('console-message', (e, lvl, msg, line, src) => {
      const level = typeof lvl === 'number' ? lvl : (e && e.level);
      const text = typeof msg === 'string' ? msg : (e && e.message);
      if (level === 3 || level === 'error') log('hub error:', String(text).slice(0, 400), src ? `(${String(src).split('/').pop()}:${line})` : '');
    });
    log('hub: opened', page);
  }
  const isOpen = () => !!(win && !win.isDestroyed());
  const sendHub = (ch, data) => { if (isOpen()) win.webContents.send(ch, data); };
  const fromHub = (e) => isOpen() && e.sender === win.webContents;
  const handle = (ch, fn, fallback = null) => ipcMain.handle(ch, (e, ...a) => (fromHub(e) ? fn(...a) : fallback));
  const confirm = async (message, detail, yes = 'Yes') => {
    if (!isOpen()) return false;
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: [yes, 'Cancel'], defaultId: 1, cancelId: 1, message, detail, noLink: true });
    return r.response === 0;
  };

  // ---------------- apps: launching, the Start menu list, My Apps
  function myApps() { return (getConfig().myApps || []).map(cleanApp).filter(Boolean); }
  function launch(a) {
    if (!a) return { ok: false };
    try {
      if (a.kind === 'appsfolder') {
        spawn('explorer.exe', [`shell:AppsFolder\\${a.target}`], { detached: true, stdio: 'ignore', windowsHide: false }).on('error', () => {}).unref();
      } else if (a.kind === 'url') {
        if (!/^https?:\/\//i.test(a.target)) return { ok: false };
        (deps.openPage || shell.openExternal)(a.target);
      } else {
        shell.openPath(a.target).then((err) => { if (err) log('hub: open failed', err); });
      }
      log('hub: opened app', a.name || '');
      return { ok: true };
    } catch (e) { log('hub: launch failed', e.message); return { ok: false, error: e.message }; }
  }
  // My Apps first by name: so "open <name>" finds apps you pinned (used by main's open_app)
  function findMyApp(name) {
    const q = String(name || '').toLowerCase().trim();
    if (!q) return null;
    const list = myApps();
    return list.find((a) => a.name.toLowerCase() === q) || list.find((a) => a.name.toLowerCase().startsWith(q)) || null;
  }
  function iconFor(list) {
    const want = [];
    const custom = {};
    for (const a of list) {
      if (a.icon) {
        try { const ext = path.extname(a.icon).slice(1).toLowerCase(); custom[a.id || a.target] = `data:image/${ext === 'jpg' ? 'jpeg' : ext === 'ico' ? 'x-icon' : ext === 'svg' ? 'svg+xml' : ext};base64,${fs.readFileSync(a.icon).toString('base64')}`; continue; } catch { /* file gone: use the app's own */ }
      }
      const t = iconTarget(a);
      if (t) want.push(t);
    }
    return { custom, icons: icons.get(want) };
  }

  handle('hub-init', () => {
    const cfg = getConfig();
    return {
      name: cfg.characterName || 'Capri', version: appVersion, release: getRelease(),
      brain: cfg.hermesBrain ? 'Hermes' : String(cfg.chatModel || 'AI'),
      screenTime: cfg.screenTime !== false, platform: process.platform,
    };
  }, {});
  // Favorites: only the ones you registered (Favorites page), in your order; apps and websites are separate tabs
  handle('hub-dashboard', () => {
    const all = myApps();
    const top = all.filter((a) => a.kind !== 'url').slice(0, 8);
    const web = all.filter((a) => a.kind === 'url').slice(0, 8);
    return { top, web, ...iconFor([...top, ...web]) };
  }, { top: [], web: [] });
  // Status page + title-bar lights
  handle('hub-status', () => getStatus(), null);
  handle('hub-status-action', (id) => statusAction(String(id || '')), { ok: false });
  // a website for Favorites: name + https link
  handle('hub-web-app', (name, link) => {
    let u = String(link || '').trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    let host = '';
    try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return null; host = x.hostname.replace(/^www\./, ''); } catch { return null; }
    const n = String(name || '').trim() || host.split('.')[0].replace(/^./, (c) => c.toUpperCase());
    return { id: crypto.randomUUID(), name: n.slice(0, 60), kind: 'url', target: u };
  }, null);
  // Now Playing (Spotify) and its buttons
  handle('hub-now-playing', async () => { try { return await music.track(); } catch (e) { return { source: 'none', playing: false, error: e.message }; } }, { source: 'none' });
  handle('hub-music', async (action) => {
    if (!['pause', 'resume', 'next', 'previous'].includes(action)) return { ok: false };
    try { const text = await music.control(action); music.forget(); return { ok: true, text }; } catch (e) { return { ok: false, text: e.message }; }
  }, { ok: false });
  handle('hub-icons', (targets) => icons.get(Array.isArray(targets) ? targets.slice(0, 400) : []), {});
  handle('hub-launch', (a) => launch(cleanApp(a)), { ok: false });
  handle('hub-apps', async () => {
    try {
      const list = (await apps.getStartApps()).filter((a) => a && a.Name && a.AppID)
        .map((a) => ({ name: String(a.Name), target: String(a.AppID), kind: 'appsfolder' }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { apps: list, icons: icons.get(list.map(iconTarget)) };
    } catch (e) { return { apps: [], error: e.message }; }
  }, { apps: [] });
  handle('hub-myapps', () => { const l = myApps(); return { apps: l, ...iconFor(l) }; }, { apps: [] });
  handle('hub-myapps-save', (list) => {
    const clean = (Array.isArray(list) ? list : []).slice(0, 60).map(cleanApp).filter(Boolean);
    setConfig({ myApps: clean });
    return { apps: clean, ...iconFor(clean) };
  }, { apps: [] });
  // "+ Add app": pick an exe or shortcut
  handle('hub-myapps-pick', async () => {
    if (!isOpen()) return null;
    const r = await dialog.showOpenDialog(win, { title: 'Add an app', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Apps and shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }] });
    if (r.canceled) return null;
    return r.filePaths.map((f) => ({ id: crypto.randomUUID(), name: tidyName(f), kind: 'file', target: f }));
  });
  handle('hub-icon-pick', async () => {
    if (!isOpen()) return null;
    const r = await dialog.showOpenDialog(win, { title: 'Choose an icon', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'ico', 'svg', 'webp', 'gif'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('hub-file-app', (file) => {
    const f = String(file || '');
    if (!/^[a-z]:\\/i.test(f) || !fs.existsSync(f)) return null;
    return { id: crypto.randomUUID(), name: tidyName(f), kind: 'file', target: f };
  });

  // ---------------- chat (the same memory as talking to her on the desktop)
  handle('hub-history', () => getHistory(), []);
  handle('hub-chat', async (text) => {
    const t = String(text || '').trim().slice(0, 4000);
    if (!t) return { text: '' };
    try { return await chat(t); } catch (e) { return { text: `I couldn't answer just now: ${e.message}`, emotion: 'sad', error: true }; }
  }, { text: '' });
  handle('hub-clear-chat', async () => {
    if (!(await confirm('Wipe her chat memory?', 'She forgets this conversation (here and on the desktop). Notes and to-dos stay.', 'Wipe'))) return false;
    clearHistory();
    return true;
  }, false);

  // ---------------- screen time
  handle('hub-screentime', () => screenTime.summary(), {});
  handle('hub-screentime-set', (on) => { setConfig({ screenTime: !!on }); screenTime.sync(); return screenTime.summary(); }, {});

  // ---------------- stats
  handle('hub-stats', async () => {
    const s = await stats.sample();
    return s && { ...s, procs: s.procs.map((p) => ({ ...p, keep: KEEP_ALIVE.test(p.name) })) };
  }, null);
  handle('hub-cleanup-info', () => stats.cleanup(), null);
  handle('hub-end-task', async (name, pids) => {
    const n = String(name || '');
    const ids = (Array.isArray(pids) ? pids : []).map(Number).filter((p) => Number.isInteger(p) && p > 4 && p !== process.pid);
    if (!n || !ids.length || KEEP_ALIVE.test(n)) return { ok: false, text: `${n} is part of Windows (or me), so I won't end it.` };
    if (!(await confirm(`End ${n}?`, `${ids.length > 1 ? `All ${ids.length} of its processes stop` : 'It stops'} right away, like End task in Task Manager. Anything unsaved in it is lost.`, 'End task'))) return { ok: false, cancelled: true };
    let ended = 0;
    for (const id of ids) { try { process.kill(id); ended++; } catch { /* already gone or not allowed */ } }
    log('hub: ended task', n, `(${ended}/${ids.length})`);
    return { ok: ended > 0, text: ended ? `Ended ${n}.` : `Windows didn't let me end ${n}.` };
  }, { ok: false });
  handle('hub-clean-temp', async () => {
    if (!(await confirm('Clean temp files?', 'Deletes files in your temp folder that haven\'t changed for a day. Files in use are skipped.', 'Clean'))) return null;
    const r = stats.cleanTemp();
    log('hub: cleaned temp', r.files, 'files');
    return r;
  });
  handle('hub-empty-bin', async () => {
    if (!(await confirm('Empty the Recycle Bin?', 'Everything in it is deleted for good.', 'Empty'))) return null;
    const r = await stats.emptyBin();
    log('hub: emptied the recycle bin', r.ok ? '' : r.error);
    return r;
  });

  handle('hub-open-settings', () => { openSettings(); return true; }, false);
  // the Terminal page: her terminal page sits in the Hub window over the page's box (rect in the Hub's pixels)
  ipcMain.on('hub-term-place', (e, { rect, visible } = {}) => {
    if (!fromHub(e) || !deps.terminal) return;
    if (visible) deps.terminal.embedIn(win);
    deps.terminal.placeEmbed(rect, visible);
  });
  ipcMain.on('hub-window', (e, what) => {
    if (!fromHub(e)) return;
    if (what === 'close') win.close();
    else if (what === 'min') win.minimize();
    else if (what === 'max') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  });

  const reload = () => { if (isOpen()) win.webContents.reloadIgnoringCache(); };
  let curPage = 'dash';
  ipcMain.on('hub-page-shown', (e, p) => { if (fromHub(e) && PAGES.includes(p)) curPage = p; });
  const currentPage = () => curPage;
  const owns = (wc) => isOpen() && !!wc && wc === win.webContents;
  const ownsFrame = (f) => { try { return isOpen() && !!f && f.processId === win.webContents.mainFrame.processId && f.routingId === win.webContents.mainFrame.routingId; } catch { return false; } };
  return { open, isOpen, reload, currentPage, owns, ownsFrame, send: sendHub, findMyApp, launch, PAGES };
}

module.exports = { createHub, cleanApp, iconTarget, tidyName, KEEP_ALIVE };
