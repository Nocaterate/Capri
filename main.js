// Capri — desktop companion, main process.
// Transparent always-on-top overlay + tray + hotkeys + AI/voice backend.
const {
  app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, shell, session, Notification, powerMonitor, net, dialog, desktopCapturer, WebContentsView,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const brain = require('./src/brain');
const tts = require('./src/tts');
const crypto = require('crypto');
const os = require('os');
const hermes = require('./src/hermes');
const mcpServer = require('./src/mcp-server');
const spotify = require('./src/spotify');
const apps = require('./src/apps');
const discord = require('./src/discord');
const browserLink = require('./src/browser');
const pcHands = require('./src/pc');
const { createActivity } = require('./src/activity');
const { createCare } = require('./src/care');
const commands = require('./src/commands');
const { createWalker } = require('./src/walker');
const { createTerminal } = require('./src/terminal');
const { createUsage } = require('./src/usage');
const { createHub } = require('./src/hub');
const { createScreenTime } = require('./src/screentime');
const { createStats } = require('./src/stats');
const { createIcons } = require('./src/icons');

const IS_TEST = process.env.COMPANION_TEST === '1';
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---------- config ----------
const USER_DIR = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DIR, 'config.json');
const HISTORY_PATH = path.join(USER_DIR, 'history.json');
const LOG_PATH = path.join(USER_DIR, 'capri.log');
const NOTES_PATH = path.join(USER_DIR, 'notes.json');
// notable things for the Hub's Status page (taken from the log as it's written)
const recentEvents = [];
const NOTABLE = /^(hermes (is not answering|gateway is answering|gateway up|gateway not answering|restarted)|discord state (online|off|error)|browser link (connected|disconnected)|restarting|pc helper exited|care: offline|hub: emptied|new version available|visualizer capture failed)/i;
function log(...parts) {
  try {
    fs.mkdirSync(USER_DIR, { recursive: true });
    const msg = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    if (NOTABLE.test(msg)) { recentEvents.push({ at: Date.now(), text: msg.slice(0, 140) }); if (recentEvents.length > 30) recentEvents.shift(); }
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { if (fs.statSync(LOG_PATH).size > 512 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.old'); } catch { /* no log yet */ }
    fs.appendFileSync(LOG_PATH, line);
  } catch { /* logging must never break her */ }
}
const ASSET_DIR = path.join(__dirname, 'assets');

const DEFAULT_PERSONALITY = [
  'You are bubbly, quick-witted and a little mischievous, with a big heart under all that static.',
  'You love electricity and glitches, and you sometimes slip in a light electric pun (charged, sparks, buzzing, short circuit, voltage),',
  'but at most one per reply so it stays fun. You hype the user up, tease them gently, and genuinely care how they are doing.',
].join(' ');

const DEFAULT_CONFIG = {
  characterName: 'Capri',
  personality: DEFAULT_PERSONALITY,
  userName: '',
  apiBaseUrl: 'https://api.groq.com/openai/v1',
  apiKey: '',
  chatModel: 'openai/gpt-oss-120b',
  sttBaseUrl: '',
  sttApiKey: '',
  sttModel: 'whisper-large-v3-turbo',
  sttLanguage: 'en',
  voiceEnabled: true,
  voiceFx: false,
  ttsProvider: 'fish', // 'fish' = her cloned voice (Fish Audio), 'edge' = Microsoft Edge voices
  fishApiKey: '',
  fishVoiceId: '',
  fishModel: 's2.1-pro-free',
  fishSpeed: '1',
  ttsVoice: 'en-US-AnaNeural',
  ttsPitch: '+15%',
  ttsRate: '+6%',
  sfxEnabled: true,
  sfxVolume: 0.6,
  scale: 6,
  posX: null,
  posY: 0,
  autonomy: true,
  // "Make her more alive": she notices what's in front on your main screen and talks about it now and then
  tvMode: false, // TV mode: she lives inside a little terminal TV (the overlay saves this and tvPos)
  tvPos: null, // { x, y } as fractions of the screen
  // Care & PC alerts (src/care.js): eye breaks, water, bedtime, CPU/disk/internet, low battery (overlay)
  careEyes: true,
  careWater: true,
  careBedtime: true,
  careBedtimeAt: '00:00',
  carePc: true,
  // Usage meter (src/usage.js): prices per brain in US$ per million tokens, optional daily token limit
  usagePrices: {},
  usageLimitOn: false,
  usageLimit: 50000,
  activityAware: false,
  activityMinutes: 18, // at most one remark every this many minutes (1-60)
  windowWalker: false, // she peeks over the top edge of the window you're using (renderer/walker.js)
  activityAi: true, // her AI writes the line (it gets the app and title); off = built-in lines only
  hotkeyTalk: 'Control+Alt+Space',
  hotkeyType: 'Control+Alt+T',
  hotkeyHide: 'Control+Alt+H',
  hotkeyHub: 'Control+Alt+W',
  // Capri Hub (src/hub.js): window place, the apps you pinned, screen time on/off
  hubBounds: null,
  myApps: [], // [{ id, name, kind: 'appsfolder'|'file'|'url', target, icon }]
  screenTime: true, // count which app is in front, per day (only app names; Hub → Screen time)
  openAtLogin: false,
  hubAtLogin: false, // also open Capri Hub when she starts with Windows (not on her own restarts)
  spotifyClientId: '',
  spotifyRefreshToken: '',
  spotifyAccessToken: '',
  spotifyExpires: 0,
  // Hermes Agent
  hermesBridge: false, // run Capri's tool server so Hermes can use her desktop powers
  hermesMcpPort: 43823,
  hermesMcpToken: '',
  hermesApiKey: '',
  hermesAutostart: false, // start the Hermes gateway (in WSL) together with Capri
  hermesBrain: false, // Capri talks through Hermes
  hermesPrevBrain: null,
  hermesSetBrain: true, // give Hermes an AI model when connecting
  hermesGeminiKey: '', // optional: free Gemini key just for Hermes
  // Discord bot
  discordEnabled: false,
  discordToken: '',
  discordOwnerId: '', // owners: Discord usernames and/or user IDs, comma-separated; empty = whoever owns the bot app
  discordOwnerLocks: {}, // username -> the user ID first seen with it
  discordDesktop: true, // desktop Capri shows what happens on Discord
  discordVoice: true, // speak replies in a voice channel after /join
  discordAvatarSet: false,
  dOut: false, // D (her companion) is out next to her
  // browsers (the Capri Browser Link extension)
  browserLink: true, // listen for the extension on 127.0.0.1:43824
  defaultBrowser: '', // the browser Capri opens pages in and uses first ('' = Windows' default; chrome, edge, brave, opera, vivaldi, firefox)
  browserLinks: [], // extension IDs you allowed once
  // what Capri may do without asking first (Settings → Permissions, or "Always allow" on her question)
  autoApprove: { apps: false, files: false, browser: false, commands: false, terminal: false },
  termBounds: null, // Capri Terminal window size/position (src/terminal.js)
  updateNotified: '', // newest version she already told the user about
};
const SECRET_KEYS = ['spotifyRefreshToken', 'spotifyAccessToken', 'spotifyExpires', 'hermesMcpToken', 'hermesApiKey', 'hermesPrevBrain', 'hermesBrain', 'discordAvatarSet', 'discordOwnerLocks', 'browserLinks', 'autoApprove'];

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function saveJSON(p, data) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  } catch (e) { console.error('save failed', p, e); }
}
let config = { ...DEFAULT_CONFIG, ...loadJSON(CONFIG_PATH, {}) };
if (IS_TEST && process.env.COMPANION_TEST_CONFIG) config = { ...config, ...JSON.parse(process.env.COMPANION_TEST_CONFIG) };
let history = loadJSON(HISTORY_PATH, []);

// ---------- windows ----------
let overlay = null;
let appQuitting = false;
const alive = () => !!overlay && !overlay.isDestroyed(); // her window can be gone while Capri quits
let settingsWin = null;
let tray = null;
let hidden = false;

function createOverlay() {
  const wa = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    show: false,
    // A tool window: Chromium browsers don't count tool windows when they check whether their window is covered.
    // Without this, whenever Capri is clickable (mouse over her) her full-screen overlay "covers" the browser,
    // which then thinks it's hidden and freezes/pauses the YouTube video playing in it.
    ...(process.platform === 'win32' && config.overlayToolWindow !== false ? { type: 'toolbar' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  ignoringMouse = true;
  overlay.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlay.once('ready-to-show', () => { if (alive()) overlay.showInactive(); });
  // Alt+F4 / a stray close: hide her instead of destroying her window
  overlay.on('close', (e) => { if (!appQuitting) { e.preventDefault(); toggleHidden(true); } });
  // if her page crashes, bring her back
  // her page's errors go to the activity log (otherwise a broken feature fails silently)
  overlay.webContents.on('console-message', (e, lvl, msg, line, src) => {
    const level = typeof lvl === 'number' ? lvl : (e && e.level);
    const text = typeof msg === 'string' ? msg : (e && e.message);
    if (level === 3 || level === 'error') log('overlay error:', String(text).slice(0, 400), src ? `(${String(src).split('/').pop()}:${line})` : '');
  });
  // her page reloaded (an update): a party that was running is gone, so let Esc and the menu go back to normal
  overlay.webContents.on('did-start-loading', () => {
    if (!partyOn) return;
    partyOn = false;
    try { if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape'); } catch { /* fine */ }
    if (tray) buildTray();
  });
  overlay.webContents.on('preload-error', (_e, p, err) => log('preload error', err && err.message));
  overlay.webContents.on('render-process-gone', (_e, d) => {
    log('overlay renderer gone', d && d.reason);
    if (!appQuitting && d && d.reason !== 'clean-exit') setTimeout(() => { if (alive()) overlay.reload(); }, 1000);
  });
}

function createSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 800, height: 800, minWidth: 560, minHeight: 500, title: `${config.characterName} Settings`,
    autoHideMenuBar: true,
    backgroundColor: '#140A16',
    icon: path.join(ASSET_DIR, 'icon256.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
}

function toggleHidden(force) {
  const next = typeof force === 'boolean' ? force : !hidden;
  if (next === hidden || !alive()) return;
  hidden = next;
  if (hidden) {
    send('dismiss'); // play the teleport-out first
    setIgnoreMouse(true);
    setTimeout(() => { if (hidden && alive()) overlay.hide(); }, 900);
  } else {
    overlay.showInactive();
    bringToFront();
    send('summon');
  }
  buildTray();
}

// Windows forgets a window is "always on top" after it was hidden, so a summoned Capri can end up behind other
// windows. Flip the flag off and on and move her to the top of the stack (also a little later, after the
// window is really shown, because the first try can land before Windows has finished showing it).
function bringToFront() {
  const go = () => {
    if (!alive() || hidden) return;
    try { overlay.setAlwaysOnTop(false); overlay.setAlwaysOnTop(true, 'screen-saver'); overlay.moveTop(); } catch { /* closing */ }
  };
  go();
  setTimeout(go, 150);
  setTimeout(go, 600);
}

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(ASSET_DIR, 'icon32.png')));
    tray.on('click', () => { if (hub) hub.open(); });
  }
  tray.setToolTip(`${config.characterName} — desktop companion`);
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function menuTemplate() {
  // trimmed on purpose: Notes & To-do, Terminal, apps, stats and more live in the Hub (tray icon, Ctrl+Alt+W, /hub)
  return [
    {
      label: 'Actions',
      // with D out she gets duo moves; on her own, her solo ones
      submenu: [
        { label: partyOn && partyKind === 'party' ? 'Stop High Forever' : 'High Forever ♪', enabled: !(partyOn && partyKind === 'ride'),
          click: () => { toggleHidden(false); send('action', partyOn ? 'high_forever_stop' : 'high_forever'); } },
        // a duo action: D is called if he isn't out, and stays until the ride ends
        { label: partyOn && partyKind === 'ride' ? 'Stop In Love With Myself' : 'In Love With Myself ♪ (with D)', enabled: !(partyOn && partyKind === 'party'),
          click: () => { toggleHidden(false); send('action', partyOn ? 'in_love_stop' : 'in_love'); } },
        // TV mode: she lives in a little terminal TV (renderer/tv.js); the overlay saves tvMode itself
        { label: 'TV mode', type: 'checkbox', checked: !!config.tvMode, enabled: !partyOn,
          click: () => { toggleHidden(false); send('action', 'tv_toggle'); } },
        { type: 'separator' },
        ...(config.dOut ? [
        ['Power up together', 'duo_charge'], ['Loom behind D', 'loom'], ['Back to back', 'b2b'], ['Perch on D', 'perch'],
        ['Electric coil around D', 'coil'], ['Chill together', 'chill'], { type: 'separator' },
        ['Dash together', 'dash'], ['Teleport together', 'teleport'], ['Back to the corner', 'recenter'],
      ] : [
        ['Power up!', 'charge'], ['Teleport', 'teleport'], ['Dash', 'dash'], ['Chill (lounge)', 'chill'], ['Back to the corner', 'recenter'],
      ]).map((it) => (Array.isArray(it) ? { label: it[0], click: () => send('action', it[1]) } : it))],
    },
    partyOn && partyKind === 'ride'
      ? { label: 'Uncall D (not mid-ride)', enabled: false }
      : { label: config.dOut ? 'Uncall D' : 'Call D', click: () => setConfig({ dOut: !config.dOut }) },
    { type: 'separator' },
    { label: 'Settings…', click: createSettings },
    { label: 'Open activity log', click: () => { if (!fs.existsSync(LOG_PATH)) log('log started'); shell.openPath(LOG_PATH); } },
    { label: 'Clear chat memory', click: () => { clearHistory(); send('toast', 'Chat memory wiped. Fresh start!'); } },
    { type: 'separator' },
    { label: hidden ? `Summon ${config.characterName}` : 'Hide', click: () => toggleHidden() },
    { label: 'Restart', click: () => restartCapri('from the menu', { openHub: !!config.hubAtLogin }) },
    { label: 'Quit', click: () => app.quit() },
  ];
}

function send(channel, payload) {
  if (alive() && !overlay.webContents.isDestroyed()) overlay.webContents.send(channel, payload);
}

function focusTyping() {
  toggleHidden(false);
  if (!alive()) return;
  if (partyOn) { send('type-open'); return; }   // the overlay says why typing is off mid-party
  setIgnoreMouse(false);
  overlay.focus();
  send('type-open');
}

function setConfig(patch) {
  const discordChanged = ['discordEnabled', 'discordToken'].some((k) => k in patch && patch[k] !== config[k]);
  if ('discordOwnerId' in patch && patch.discordOwnerId !== config.discordOwnerId) patch = { ...patch, discordOwnerLocks: {} }; // new owner list: forget old locks
  config = { ...config, ...patch };
  saveJSON(CONFIG_PATH, config);
  send('config', publicConfig());
  // an open Settings window hears about changes made elsewhere (e.g. resizing her with the mouse wheel)
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('config', publicConfig());
  if ('openAtLogin' in patch && !IS_TEST) setLoginItem();
  if (['hotkeyTalk', 'hotkeyType', 'hotkeyHide', 'hotkeyHub'].some((k) => k in patch)) registerHotkeys();
  if ('hermesBridge' in patch || 'hermesMcpPort' in patch) syncToolServer();
  if ('activityAware' in patch) activity.sync();
  if ('windowWalker' in patch) walker.sync();
  if (discordChanged) restartDiscord();
  if ('dOut' in patch) { toggleHidden(false); send('duo', !!config.dOut); }
  if (tray) buildTray();
}

// ---------- notes & to-do list ----------
// Saved in <userData>/notes.json. To-dos with "Remind me" on and a time get a reminder at the next time
// that clock time comes round; when it fires Capri says it (and Windows shows a notification), then the
// bell turns itself off so its light always shows whether a reminder is still pending.
let notesOpen = false;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
function loadNotes() {
  const d = loadJSON(NOTES_PATH, {});
  return { notes: Array.isArray(d.notes) ? d.notes : [], todos: Array.isArray(d.todos) ? d.todos : [] };
}
// "2026-11-20" + "09:30" -> that moment in local time
function atDate(date, hhmm) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0).getTime();
}
function nextOccurrence(hhmm, from = Date.now()) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = new Date(from);
  t.setHours(h, m, 0, 0);
  if (t.getTime() <= from + 1000) t.setDate(t.getDate() + 1);
  return t.getTime();
}
function cleanNotes(doc, prev) {
  const old = new Map((prev ? prev.todos : []).map((t) => [t.id, t]));
  // the overlay saves notes and to-dos separately; whatever it didn't send stays as it was
  const notes = !Array.isArray(doc.notes) ? (prev ? prev.notes : []) : doc.notes.slice(0, 500).map((n) => ({
    id: clip(n.id, 40) || crypto.randomUUID(), title: clip(n.title, 120), body: clip(n.body, 20000), updated: Number(n.updated) || Date.now(),
  }));
  if (!Array.isArray(doc.todos)) return { notes, todos: prev ? prev.todos : [] };
  const todos = doc.todos.slice(0, 500).map((t) => {
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time || '') ? t.time : '';
    // an optional day (the Hub's calendar); without one, a time means "the next time the clock says it"
    const date = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(t.date || '') ? t.date : '';
    const out = { id: clip(t.id, 40) || crypto.randomUUID(), text: clip(t.text, 50), time, remind: !!(t.remind && time), created: Number(t.created) || Date.now() };
    if (date) out.date = date;
    if (out.remind) {
      const was = old.get(out.id);
      // keep the planned time unless the reminder was just switched on or its day/time changed
      if (was && was.remind && was.time === time && (was.date || '') === date && was.remindAt) out.remindAt = was.remindAt;
      else if (date) { out.remindAt = atDate(date, time); if (out.remindAt < Date.now() - 60000) { out.remind = false; delete out.remindAt; } }
      else out.remindAt = nextOccurrence(time);
    }
    return out;
  });
  return { notes, todos };
}
// "20:00", "8:30 pm", "8pm", "0815" → "HH:MM" ('' when there is no time, null when it can't be read)
// ---------- browsers ----------
// Clicks and submits that could send, buy, post or delete something come back as needsConfirm: Capri asks you
// on the desktop (a bubble with Allow / No), and only does it if you say yes there.
const confirmWaits = new Map();
let confirmSeq = 0;
// category: 'apps' (clicking/typing in programs), 'files' (changing files), 'browser' (risky clicks/submits),
// 'commands' (PowerShell). Allowed categories (Settings → Permissions, or "Always allow" on the question) skip it.
const CATEGORY_LABEL = { apps: 'clicking and typing in apps', files: 'changing files', browser: 'browser sends and submits', commands: 'running commands', terminal: 'running commands in Capri Terminal' };
function askUser(text, seconds = 60, category = null) {
  if (category && config.autoApprove && config.autoApprove[category]) { log('auto-allowed (' + category + '):', text); return Promise.resolve(true); }
  return new Promise((resolve) => {
    if (!alive()) return resolve(false);
    const id = ++confirmSeq;
    const timer = setTimeout(() => { confirmWaits.delete(id); send('confirm-cancel', id); resolve(false); }, seconds * 1000);
    confirmWaits.set(id, (ok, always) => {
      clearTimeout(timer); confirmWaits.delete(id);
      if (ok && always && category) {
        config.autoApprove = { ...(config.autoApprove || {}), [category]: true };
        saveJSON(CONFIG_PATH, config);
        log('always allow:', category);
        if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('permissions', config.autoApprove);
      }
      resolve(!!ok);
    });
    toggleHidden(false);
    send('confirm-ask', { id, text, seconds, category, categoryLabel: category ? CATEGORY_LABEL[category] : '' });
  });
}
ipcMain.on('confirm-answer', (_e, { id, ok, always } = {}) => { const f = confirmWaits.get(id); if (f) f(ok, always); });
// Settings → Permissions (only the Settings window may change these)
ipcMain.handle('get-permissions', () => ({ ...DEFAULT_CONFIG.autoApprove, ...(config.autoApprove || {}) }));
ipcMain.handle('set-permissions', (e, perms) => {
  if (!settingsWin || settingsWin.isDestroyed() || e.sender !== settingsWin.webContents) return false;
  const p = {};
  for (const k of Object.keys(DEFAULT_CONFIG.autoApprove)) p[k] = !!(perms && perms[k]);
  config.autoApprove = p;
  saveJSON(CONFIG_PATH, config);
  log('permissions:', JSON.stringify(p));
  return p;
});

// her hands on the PC
const pc = pcHands.createPc({ log: (...a) => log(...a), userDir: USER_DIR });

// ---------- activity sense ("Make her more alive" in Settings) ----------
// Every 8 s (only while it's on) she checks the window in front on the main screen; src/activity.js decides
// what it is and when a remark fits. The line goes to the overlay; once she has said it, it joins her chat
// memory (with a note of what she noticed) so she understands your answer.
let activityPending = null;
// Capri Terminal: your PowerShell / CMD in her style, with /capri (src/terminal.js + renderer/terminal.html)
const terminal = createTerminal({
  BrowserWindow, ipcMain, getConfig: () => config, setConfig, log: (...a) => log(...a), brain,
  rootDir: __dirname, iconPath: path.join(ASSET_DIR, 'icon256.png'), WebContentsView,
});

// Capri Hub: dashboard, chat, tasks, apps, stats, screen time (src/hub.js + renderer/hub.html)
const screenTime = createScreenTime({ pc, file: path.join(USER_DIR, 'screentime.json'), log: (...a) => log(...a), getConfig: () => config, selfName: config.characterName || 'Capri' });
const stats = createStats({ pc, log: (...a) => log(...a) });
let hub = null;
const icons = createIcons({
  dir: path.join(USER_DIR, 'icons'), log: (...a) => log(...a),
  getFileIcon: (p, o) => app.getFileIcon(p, o),
  onReady: (done) => { if (hub) hub.send('hub-icons-ready', done); },
});
hub = createHub({
  BrowserWindow, ipcMain, dialog, shell, getConfig: () => config, setConfig, log: (...a) => log(...a),
  rootDir: __dirname, iconPath: path.join(ASSET_DIR, 'icon256.png'),
  icons, screenTime, stats, pc, apps,
  chat: (text) => chatTurn(text, {}),
  getHistory: () => chatLines(),
  clearHistory: () => clearHistory(),
  openSettings: () => createSettings(),
  getRelease: () => newRelease,
  appVersion: app.getVersion(),
  getStatus: () => hubStatus(),
  terminal,
  openPage: (u) => openPage(u),
  statusAction: (id) => hubStatusAction(id),
  music: {
    track: () => spotify.track(),
    forget: () => spotify.forgetTrack(),
    control: (action) => spotify.control({ action }, (a) => actions.media_control(a)),
  },
});

// "Sit on my window": where the window in front is, for the overlay (src/walker.js + renderer/walker.js)
const walker = createWalker({
  pc, getConfig: () => config, log: (...a) => log(...a), send,
  getDisplay: () => screen.getPrimaryDisplay(),
  isVisible: () => !hidden && alive(),
});
const activity = createActivity({
  pc, log: (...a) => log(...a), getConfig: () => config,
  isBusy: () => hidden || partyOn || !alive(),
  makeLine: async ({ what, minutes }) => {
    if (usage.overLimit()) return null;             // over today's token limit: her built-in lines instead
    const prev = config.hermesPrevBrain;
    const cfg = config.hermesBrain && prev && prev.apiKey ? { ...config, ...prev } : config;   // her quick brain, not a whole Hermes turn
    const r = await brain.quickLine(cfg, `(Not the user talking: this is your own sense of what they're doing on their PC.) `
      + `They have been ${what} for about ${minutes} minute${minutes === 1 ? '' : 's'}. Say ONE short, natural line to them about it, `
      + 'like a friend glancing over: a casual question or reaction, under 18 words. Do not say you can see their screen or windows, '
      + "don't repeat long titles word for word, and don't offer to do anything. Start with the emotion tag.");
    if (!r.text || r.text.length > 170) return null;
    return r;
  },
  onSay: (line) => { activityPending = line; send('activity-say', { text: line.text, emotion: line.emotion, category: line.category }); },
  onMood: (m) => send('activity-mood', m),
});
// ---------- usage meter: every AI reply's token count, per brain per day ----------
const usage = createUsage({
  file: path.join(USER_DIR, 'usage.json'), getConfig: () => config, log: (...a) => log(...a),
  onLimit: (n) => send('care-say', { kind: 'limit', emotion: 'surprised',
    text: `We've used today's token limit (${Math.round(n / 1000)}k). I'll use my own lines for remarks until tomorrow; chatting still works.` }),
});
brain.setUsageHook((url, model, u) => usage.add(url, model, u));
ipcMain.handle('usage-get', () => usage.summary());

// is the internet there? Several test addresses at once, through Chromium's network (system proxy) and Node's own;
// any answer means online (one blocked address or a LAN adapter Windows misjudges must not count as offline). Also
// online if the Discord bot is connected. Cached 30 s so the Hub and Care can both ask.
const ONLINE_PROBES = ['https://www.msftconnecttest.com/connecttest.txt', 'https://www.gstatic.com/generate_204', 'https://www.cloudflare.com/cdn-cgi/trace', 'https://api.github.com/zen'];
let onlineCache = { at: 0, ok: null }, lastOfflineWhy = '';
async function checkOnline(fresh) {
  if (!fresh && onlineCache.ok != null && Date.now() - onlineCache.at < 30000) return onlineCache.ok;
  const errs = [];
  const probe = (u, viaNet) => (viaNet ? net.fetch : fetch)(u, { signal: AbortSignal.timeout(7000), cache: 'no-store' })
    .then((r) => { if (r.status >= 500) throw new Error(`HTTP ${r.status}`); return true; })
    .catch((e) => { errs.push(`${viaNet ? 'net' : 'node'} ${new URL(u).host}: ${(e && (e.cause && e.cause.code)) || (e && e.message) || e}`); throw e; });
  let ok = false;
  try { ok = await Promise.any(ONLINE_PROBES.flatMap((u) => [probe(u, true), probe(u, false)])); } catch { ok = false; }
  if (!ok) { try { ok = discordBot.status().state === 'online'; } catch { /* not ready */ } }
  if (!ok) {
    const why = errs.slice(0, 4).join(' | ');
    if (why !== lastOfflineWhy) { lastOfflineWhy = why; log('internet check failed:', why); }
  } else lastOfflineWhy = '';
  onlineCache = { at: Date.now(), ok };
  return ok;
}

// ---------- the Hub's Status page and title-bar lights ----------
// light: 'ok' | 'warn' | 'bad' | 'off' (turned off in Settings)
async function hubStatus() {
  const hermesOn = !!(config.hermesBrain || config.hermesBridge);
  const [hermesUp, online, helperOk, track] = await Promise.all([
    hermesOn ? hermes.health() : Promise.resolve(false),
    checkOnline(),
    process.platform === 'win32' ? pc.call('ping', {}, 4000).then(() => true).catch(() => false) : Promise.resolve(null),
    spotify.connected() ? spotify.track().catch(() => null) : Promise.resolve(null),
  ]);
  const ds = discordBot.status() || {};
  const bs = browsers.status();
  const prev = config.hermesPrevBrain;
  const brainName = config.hermesBrain ? 'Hermes' : String(config.chatModel || 'AI');
  const services = [
    { id: 'hermes', name: 'BRAIN · ' + (config.hermesBrain ? 'HERMES' : 'AI'), short: 'HERMES',
      light: config.hermesBrain || hermesOn ? (hermesUp ? 'ok' : connecting ? 'warn' : 'bad') : (config.apiKey || /localhost|127\.0\.0\.1/.test(config.apiBaseUrl) ? 'ok' : 'warn'),
      state: config.hermesBrain || hermesOn ? (hermesUp ? 'Online' : connecting ? 'Starting…' : 'Not answering') : `Using ${brainName}`,
      lines: [config.hermesBrain ? 'Capri talks through Hermes (WSL, port 8642)' : `Model: ${config.chatModel}`, hermesOn && !hermesUp ? 'She answers with the fallback brain until it is back' : ''],
      actions: hermesOn ? [{ id: 'hermes-restart', label: 'RESTART HERMES' }] : [{ id: 'settings', label: 'SETTINGS' }] },
    { id: 'fallback', name: 'FALLBACK BRAIN', light: config.hermesBrain ? (prev && prev.apiKey ? 'ok' : 'warn') : 'off',
      state: config.hermesBrain ? (prev && prev.apiKey ? 'Ready' : 'None set') : 'Not needed', lines: [prev && prev.chatModel ? `${prev.chatModel}` : ''], actions: [] },
    { id: 'discord', name: 'DISCORD BOT', short: 'DISCORD',
      light: !config.discordEnabled ? 'off' : ds.state === 'online' ? 'ok' : ds.state === 'connecting' ? 'warn' : 'bad',
      state: !config.discordEnabled ? 'Off' : ds.text || ds.state || 'Unknown', lines: [ds.owner ? `owner ${ds.owner}` : ''],
      actions: config.discordEnabled ? [{ id: 'discord-restart', label: 'RESTART BOT' }] : [{ id: 'settings', label: 'SETTINGS' }] },
    { id: 'spotify', name: 'SPOTIFY', short: 'SPOTIFY', light: spotify.connected() ? 'ok' : 'off',
      state: spotify.connected() ? 'Connected' : 'Not connected',
      lines: [track && track.name ? `${track.playing ? 'playing' : 'paused on'} ${track.name}` : spotify.connected() ? 'nothing playing' : 'Connect it in Settings → Apps'],
      actions: spotify.connected() ? [] : [{ id: 'settings', label: 'CONNECT' }] },
    { id: 'browser', name: 'BROWSER LINK', short: 'BROWSER',
      light: config.browserLink === false ? 'off' : bs.browsers.length ? 'ok' : bs.listening ? 'warn' : 'bad',
      state: config.browserLink === false ? 'Off' : bs.browsers.length ? `${bs.browsers.map((b) => b.name).join(' + ')} linked` : bs.waiting.length ? `${bs.waiting.join(', ')} waits for your OK` : 'No browser linked',
      lines: [
        bs.browsers.length ? '' : bs.waiting.length ? 'Answer Allow on Capri\'s question on the desktop' : bs.listening ? 'Open the browser with the Capri Browser Link extension loaded (Developer mode → Load unpacked)' : 'Not listening',
        bs.defaultBrowser ? `main browser: ${bs.defaultBrowser}${bs.chosen ? '' : ' (Windows default)'}` : '',
      ],
      actions: [{ id: 'browser-folder', label: 'EXTENSION FOLDER' }, { id: 'settings', label: 'SETTINGS' }] },
    { id: 'internet', name: 'INTERNET', short: 'INTERNET', light: online ? 'ok' : 'bad', state: online ? 'Online' : 'Offline', lines: [online ? '' : "Windows' internet test didn't answer"], actions: [] },
    { id: 'helper', name: 'PC HELPER · TOOLS', light: helperOk === false ? 'bad' : 'ok',
      state: helperOk === false ? 'Not answering' : helperOk ? 'Running' : 'Windows only',
      lines: [`tool server ${toolServer ? `:${config.hermesMcpPort}` : 'off'} · screen time ${config.screenTime !== false ? 'on' : 'off'}`], actions: [{ id: 'helper-restart', label: 'RESTART HELPER' }] },
  ].map((x) => ({ ...x, lines: x.lines.filter(Boolean) }));
  return { services, recent: recentEvents.slice(-10).reverse(), at: Date.now() };
}
async function hubStatusAction(id) {
  log('hub: status action', id);
  if (id === 'hermes-restart') { connecting = true; const ok = await hermes.restartGateway(log).catch(() => false); connecting = false; return { ok, text: ok ? 'Hermes is back.' : "Hermes didn't come back yet. Try again in a minute." }; }
  if (id === 'discord-restart') { clearTimeout(discordTimer); const st = await discordBot.start(); broadcastDiscord(); return { ok: st && st.state === 'online', text: (st && st.text) || 'Restarted.' }; }
  if (id === 'browser-folder') { const dir = path.join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked'), 'browser-extension'); await shell.openPath(dir); return { ok: true, text: 'Opened the extension folder.' }; }
  if (id === 'helper-restart') { pc.stop(); await new Promise((r) => setTimeout(r, 1200)); await pc.call('ping', {}, 20000).catch(() => {}); return { ok: true, text: 'The PC helper restarted.' }; }
  if (id === 'settings') { createSettings(); return { ok: true }; }
  return { ok: false };
}

// ---------- care & PC alerts ----------
const care = createCare({
  getConfig: () => config, log: (...a) => log(...a),
  getIdleSeconds: () => { try { return powerMonitor.getSystemIdleTime(); } catch { return 0; } },
  isOnline: () => checkOnline(true),   // several addresses at once (see checkOnline)
  isBusy: () => hidden || partyOn || !alive(),
  onSay: (l) => send('care-say', l),
});

ipcMain.on('activity-spoken', (_e, text) => {
  const l = activityPending;
  if (!l || l.text !== text) return;
  activityPending = null;
  history.push({ role: 'user', content: `(Capri noticed the user is ${l.note}.)` }, { role: 'assistant', content: `[${l.emotion || 'happy'}] ${l.text}` });
  history = history.slice(-24);
  while (history.length && history[0].role !== 'user') history.shift();   // never start with half a tool exchange
  saveJSON(HISTORY_PATH, history);
});
// answering her Yes/No puts the keyboard on Capri: give it back to the app she was working in before typing
async function backToApp() {
  const w = pc.last() && pc.last().window;
  if (w && w.hwnd) await pc.call('front', { hwnd: w.hwnd }).catch(() => {});
}
// show her zapping at the spot she's about to click, and keep her overlay from catching that click
async function pcAct(x, y) {
  forceClickThrough = Date.now() + 1500;
  setIgnoreMouse(true);
  try {
    const p = process.platform === 'win32' ? screen.screenToDipPoint({ x, y }) : { x, y };
    const b = alive() ? overlay.getBounds() : { x: 0, y: 0 };
    send('pc-act', { kind: 'click', x: p.x - b.x, y: p.y - b.y });
  } catch { /* just no animation */ }
  await new Promise((r) => setTimeout(r, 260));
}

const browsers = browserLink.createBrowserLink({
  port: 43824,
  log: (...a) => log(...a),
  isAllowed: (id) => (config.browserLinks || []).includes(id),
  allow: (id) => { config.browserLinks = [...new Set([...(config.browserLinks || []), id])]; saveJSON(CONFIG_PATH, config); },
  ask: (text) => askUser(text, 120),
  onState: (s) => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('browser-state', s); },
  getPreferred: () => config.defaultBrowser || '',
});
// open a web page in Capri's browser (Settings → Browser), else Windows' default
async function openPage(url) {
  const key = browsers.browserKey(config.defaultBrowser || '');
  if (key && process.platform === 'win32' && await browsers.launch(key, url)) return;
  shell.openExternal(url);
}
function notLinked(r, browser) {
  if (r.error !== 'NOT_CONNECTED') return `That didn't work: ${r.error}`;
  const st = browsers.status();
  if (browser && st.browsers.length) return `${browser} isn't linked to me (linked: ${st.browsers.map((b) => b.name).join(', ')}). Add the Capri Browser Link extension there first (Settings → Browser).`;
  return "I'm not linked to a browser yet. Add the Capri Browser Link extension to your browser first (Settings → Browser), then I can read pages, click and type.";
}
async function confirmable(cmd, args, browser) {
  let r = await browsers.call(cmd, args, { browser });
  if (r.error) return notLinked(r, browser);
  if (r.needsConfirm) {
    const tabs = await browsers.call('tabs', {}, { browser });
    const cur = (tabs.tabs || []).find((t) => (args.tabId ? t.tabId === Number(args.tabId) : t.active));
    const where = cur ? browserLink.host(cur.url) : r.browser;
    const ok = await askUser(`Can I ${r.what} on ${where}?`, 60, 'browser');
    log('browser confirm:', r.what, where, ok ? 'allowed' : 'declined');
    if (!ok) return `I didn't ${r.what}: the user said no (or didn't answer on the PC). Don't try it again unless they ask.`;
    r = await browsers.call(cmd, { ...args, force: true }, { browser });
    if (r.error) return notLinked(r, browser);
  }
  if (cmd === 'click') return `Clicked "${r.what}".${r.tab ? ` Now on "${r.tab.title}".` : ''} Read the page again before clicking anything else.`;
  return `Typed it${r.submitted ? ' and pressed Enter' : ''}.${r.tab ? ` Now on "${r.tab.title}".` : ''}`;
}
ipcMain.handle('browser-status', () => browsers.status());
ipcMain.handle('open-extension-folder', async (_e, which) => {
  const dir = path.join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked'), which === 'firefox' ? 'browser-extension-firefox' : 'browser-extension');
  await shell.openPath(dir);
  return dir;
});

function parseClock(v) {
  if (v == null || String(v).trim() === '') return '';
  const m = String(v).trim().toLowerCase().match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3]) { if (h < 1 || h > 12) return null; if (m[3][0] === 'p' && h < 12) h += 12; if (m[3][0] === 'a' && h === 12) h = 0; }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
// save a whole notes document from main (Capri's own tools) and tell the panel
function saveNotesDoc(doc, tab, focus) {
  const clean = cleanNotes(doc, loadNotes());
  saveJSON(NOTES_PATH, clean);
  scheduleTodoReminders(clean);
  send('notes-updated', { ...clean, by: 'capri', tab, focus });
  if (hub) hub.send('notes-updated', { ...clean, by: 'capri' });
  return clean;
}
const todoTimers = new Map();
function scheduleTodoReminders(doc) {
  for (const t of todoTimers.values()) clearTimeout(t);
  todoTimers.clear();
  for (const t of doc.todos) {
    if (!t.remind || !t.remindAt) continue;
    const wait = Math.max(1500, t.remindAt - Date.now());   // missed while Capri was closed: remind right away
    todoTimers.set(t.id, setTimeout(() => fireTodoReminder(t.id), Math.min(wait, 2 ** 31 - 1)));
  }
}
function fireTodoReminder(id) {
  todoTimers.delete(id);
  const doc = loadNotes();
  const t = doc.todos.find((x) => x.id === id);
  if (!t || !t.remind) return;
  if (t.remindAt - Date.now() > 60000) { scheduleTodoReminders(doc); return; }   // a long wait was capped: not yet
  const late = Date.now() - t.remindAt > 5 * 60000;
  t.remind = false; delete t.remindAt;
  saveJSON(NOTES_PATH, doc);
  log('to-do reminder:', t.text, late ? '(missed earlier)' : '');
  toggleHidden(false);
  send('reminder', late ? `${t.text} (that was at ${t.time})` : t.text);
  send('notes-updated', doc);
  if (hub) hub.send('notes-updated', doc);
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title: `${config.characterName} reminder`, body: `${t.text}${t.time ? `  ·  ${t.time}` : ''}`, icon: path.join(ASSET_DIR, 'icon256.png') });
      n.on('click', () => { if (hub) hub.open('task'); });
      n.show();
    }
  } catch (e) { log('notification failed', e.message); }
}
ipcMain.handle('notes-get', () => loadNotes());
ipcMain.handle('notes-save', (e, doc) => {
  const clean = cleanNotes(doc || {}, loadNotes());
  saveJSON(NOTES_PATH, clean);
  scheduleTodoReminders(clean);
  // the other side (her hologram panel or the Hub) hears about it; the one that saved already has it
  if (hub && hub.isOpen() && alive() && e.sender === overlay.webContents) hub.send('notes-updated', clean);
  else send('notes-updated', clean);
  return clean;
});
ipcMain.on('notes-state', (_e, open) => { notesOpen = !!open; if (tray) buildTray(); });

// ---------- High Forever (party mode) and In Love With Myself (the car ride with D) ----------
// Their songs live in <userData>/music (never shipped): any mp3/wav/ogg/m4a. High Forever plays the one with
// "high forever" in its name (else any song that isn't the ride's); the ride plays "in love with myself".
// While either runs, Esc anywhere stops it (the stop box on screen does too). partyKind: 'party' | 'ride'.
let partyOn = false, partyKind = 'party';
const MUSIC_DIR = path.join(USER_DIR, 'music');
const BUNDLED_MUSIC = path.join(ASSET_DIR, 'music');   // the songs that come with Capri
const RIDE_SONG = /in.?love.?with.?myself/i;
// a song you put in <userData>/music wins; otherwise she plays the one that came with her
function partySongPath(kind) {
  for (const dir of [MUSIC_DIR, BUNDLED_MUSIC]) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => SOUND_EXT.test(f)).sort(); } catch { continue; }
    const pick = kind === 'in_love'
      ? files.find((f) => RIDE_SONG.test(f))
      : files.find((f) => /high.?forever/i.test(f)) || files.find((f) => !RIDE_SONG.test(f));
    if (pick) return path.join(dir, pick);
  }
  return null;
}
ipcMain.handle('party-song', (_e, kind) => {
  const p = partySongPath(kind);
  if (!p) return null;
  try {
    if (fs.statSync(p).size > 40 * 1024 * 1024) return null;
    const buf = fs.readFileSync(p);
    return { name: path.basename(p), bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
  } catch (e) { log('party song unreadable', e.message); return null; }
});
ipcMain.handle('open-music-folder', async () => {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  await shell.openPath(MUSIC_DIR);
  return MUSIC_DIR;
});
ipcMain.on('party-state', (_e, on, kind) => {
  partyOn = !!on;
  if (on) partyKind = kind === 'ride' ? 'ride' : 'party';
  log(partyKind === 'ride' ? 'in love with myself' : 'high forever', partyOn ? 'on' : 'off');
  try {
    if (partyOn && !globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', () => send('action', partyKind === 'ride' ? 'in_love_stop' : 'high_forever_stop'));
    if (!partyOn && globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape');
  } catch (e) { log('esc shortcut', e.message); }
  if (tray) buildTray();
});
ipcMain.on('focus-overlay', () => { if (alive()) { setIgnoreMouse(false); overlay.focus(); } });

// ---------- new version check ----------
// Asks GitHub for the latest release at start and every 12 h. When it's newer than this copy the menu gets
// "Update to vX…" (opens the release page), and Windows shows a notification once per new version.
const RELEASES_API = 'https://api.github.com/repos/Nocaterate/Capri/releases/latest';
let newRelease = null; // { version, url }
const verParts = (v) => String(v).replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) {
  const x = verParts(a), y = verParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
async function checkForUpdate() {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Capri' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) { log('update check: GitHub said', res.status); return; }
    const r = await res.json();
    if (!r.tag_name || r.draft || r.prerelease || !isNewer(r.tag_name, app.getVersion())) return;
    const version = String(r.tag_name).replace(/^v/i, '');
    const url = /^https://github.com//.test(r.html_url || '') ? r.html_url : 'https://github.com/Nocaterate/Capri/releases/latest';
    newRelease = { version, url };
    if (tray) buildTray();
    log('new version available:', version, '(this is', app.getVersion() + ')');
    if (config.updateNotified === version) return;
    setConfig({ updateNotified: version });
    if (Notification.isSupported()) {
      const n = new Notification({ title: `${config.characterName} v${version} is out ⚡`, body: 'Click to open the download page, or right-click her → Update.', icon: path.join(ASSET_DIR, 'icon256.png') });
      n.on('click', () => shell.openExternal(url));
      n.show();
    }
  } catch (e) { log('update check failed', e.message); }
}

// ---------- live updates ----------
// When Capri runs from a plain folder (resources/app, not app.asar), editing her files updates her by herself:
// look-only files (renderer/, assets/) reload her window, anything else restarts the app.
function restartCapri(why, { openHub = false } = {}) {
  log('restarting', why);
  send('toast', 'Updating myself… back in a sec! ⚡');
  // without --at-login (a restart is not a Windows start); with --hub=<page> when the Hub was open (it comes back on
  // the same page) or when "Restart" was picked with "open Capri Hub too" on
  const args = process.argv.slice(1).filter((a) => a !== AT_LOGIN_ARG && !a.startsWith('--hub='));
  const page = hub && hub.isOpen() ? hub.currentPage() : openHub ? 'dash' : '';
  if (page) args.push(`--hub=${page}`);
  setTimeout(() => { app.relaunch({ args }); app.quit(); }, 700);
}
// Windows start: the login item passes --at-login (Windows can't tell otherwise). Also counts as a Windows start when
// Windows itself has only been up for a few minutes (the first boot after this update, before the flag is set).
const AT_LOGIN_ARG = '--at-login';
const startedAtLogin = process.argv.includes(AT_LOGIN_ARG) || (config.openAtLogin && os.uptime() < 240);
function setLoginItem() {
  app.setLoginItemSettings({ openAtLogin: !!config.openAtLogin, args: config.openAtLogin ? [AT_LOGIN_ARG] : [] });
}
function watchOwnFiles() {
  if (IS_TEST || __dirname.includes('app.asar')) return;
  let timer = null;
  let needRestart = false;
  const changed = new Set();
  // Windows also reports a file when it is only *read* (its last-access time changes), so only count
  // files whose contents really changed: newer than when we started watching / last saw them.
  const since = Date.now() - 2000;
  const seen = new Map();
  try {
    fs.watch(__dirname, { recursive: true }, (_ev, file) => {
      if (!file) return;
      const f = String(file).replace(/\\/g, '/');
      if (/^(node_modules|\.git)(\/|$)/.test(f) || /(^|\/)(\.|~)|\.(log|tmp|swp|crx|pem)$/i.test(f)) return;
      try {
        const s = fs.statSync(path.join(__dirname, f));
        if (s.isDirectory()) return;
        if (s.mtimeMs <= (seen.get(f) || since)) return;
        seen.set(f, s.mtimeMs);
      } catch { /* deleted or renamed: that counts as a change */ }
      changed.add(f);
      if (!/^(renderer|assets)\//.test(f)) needRestart = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const list = [...changed]; changed.clear();
        if (needRestart) { needRestart = false; restartCapri(`files changed: ${list.join(', ')}`); return; }
        log('reloading her window, files changed:', list.join(', '));
        if (alive()) overlay.webContents.reloadIgnoringCache();
        if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.reloadIgnoringCache();
        if (hub) hub.reload();
      }, 1500);
    });
    log('watching her own files for updates:', __dirname);
  } catch (e) { log('could not watch her files', e.message); }
}

// ---------- Hermes Agent ----------
const newSecret = () => crypto.randomBytes(24).toString('hex');
let toolServer = null;
function syncToolServer() {
  if (toolServer) { toolServer.close(); toolServer = null; }
  if (!config.hermesBridge) return;
  if (!config.hermesMcpToken) { config.hermesMcpToken = newSecret(); saveJSON(CONFIG_PATH, config); }
  toolServer = mcpServer.start({
    port: Number(config.hermesMcpPort) || 43823,
    token: config.hermesMcpToken,
    tools: brain.TOOLS,
    actions,
    onSay: (text, emotion) => { toggleHidden(false); send('say', { text, emotion }); },
    onReact: (name) => { toggleHidden(false); send('action', name); },
    onToolUsed: (name) => send('remote-tool', name),
    log,
  });
}

// Capri's brain <-> Hermes (keeps the old brain settings so they can be restored)
function useHermesBrain(on) {
  if (on && !config.hermesBrain) {
    if (!config.hermesApiKey) config.hermesApiKey = newSecret();
    const prev = { apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey, chatModel: config.chatModel, sttBaseUrl: config.sttBaseUrl, sttApiKey: config.sttApiKey };
    const patch = { hermesBrain: true, hermesPrevBrain: prev, apiBaseUrl: `${hermes.HERMES_URL}/v1`, apiKey: config.hermesApiKey, chatModel: 'hermes-agent' };
    // her ears still need a speech-to-text service: keep using the old one
    if (!config.sttBaseUrl) { patch.sttBaseUrl = config.apiBaseUrl; patch.sttApiKey = config.sttApiKey || config.apiKey; }
    setConfig(patch);
  } else if (!on && config.hermesBrain) {
    const prev = { ...(config.hermesPrevBrain || {}) };
    // keep her ears working: if speech-to-text used the old brain's service, name it explicitly
    if (prev.apiBaseUrl && !prev.sttBaseUrl) { prev.sttBaseUrl = config.sttBaseUrl || prev.apiBaseUrl; prev.sttApiKey = config.sttApiKey || prev.apiKey; }
    setConfig({ hermesBrain: false, ...prev, hermesPrevBrain: null });
  }
}

// Which AI model Hermes should use: a Gemini key for Hermes, or else Capri's own (pre-Hermes) brain.
function brainForHermes() {
  if (!config.hermesSetBrain) return null;
  if (config.hermesGeminiKey) return { kind: 'gemini', model: 'gemini-3.8-flash', key: config.hermesGeminiKey, label: 'Gemini (gemini-3.8-flash)' };
  const src = config.hermesBrain && config.hermesPrevBrain ? config.hermesPrevBrain : config;
  if (!src.apiKey || !src.apiBaseUrl || /:8642/.test(src.apiBaseUrl)) return null;
  if (/generativelanguage\.googleapis\.com/.test(src.apiBaseUrl)) {
    return { kind: 'gemini', model: src.chatModel || 'gemini-3.8-flash', key: src.apiKey, label: `Gemini (${src.chatModel})` };
  }
  return { kind: 'custom', model: src.chatModel, url: src.apiBaseUrl, key: src.apiKey, label: `${src.chatModel} (Capri's brain)` };
}

// Keep Hermes running while Capri uses it (restart if it stops; at most 6 tries an hour)
let hermesRestarts = [];
async function ensureHermes(why) {
  if (IS_TEST || process.platform !== 'win32' || connecting) return;
  if (!(config.hermesAutostart && (config.hermesBrain || config.hermesBridge))) return;
  if (await hermes.health()) return;
  hermesRestarts = hermesRestarts.filter((t) => Date.now() - t < 3600e3);
  if (hermesRestarts.length >= 6) return;
  hermesRestarts.push(Date.now());
  log('hermes is not answering', `(${why}), starting it again`);
  hermes.startGateway(log);
}

let connecting = false;
async function connectHermes() {
  if (connecting) return { ok: false, message: 'Already connecting…' };
  connecting = true;
  const steps = [];
  const step = (t) => { steps.push(t); log('hermes connect:', t); };
  try {
    if (process.platform !== 'win32') return { ok: false, message: 'Connecting to Hermes in WSL only works on Windows.' };
    if (!config.hermesApiKey) config.hermesApiKey = newSecret();
    setConfig({ hermesBridge: true }); // starts the tool server (and makes its token)
    step(`Capri's tool server is on (port ${config.hermesMcpPort}).`);

    let st = await hermes.status();
    if (!st.wsl) return { ok: false, need: 'wsl', steps, message: 'WSL isn\'t installed yet. Follow step 1 of the Hermes setup in the README, then click Connect again.' };
    if (!st.hermes) return { ok: false, need: 'hermes', steps, message: 'Hermes isn\'t installed in WSL yet. Follow steps 2–3 of the Hermes setup in the README, then click Connect again.' };
    step('Found WSL and Hermes.');

    const net = hermes.ensureMirrored();
    if (net.changed) {
      step('Turned on WSL mirrored networking. Restarting WSL…');
      await hermes.stopGateway();
      await hermes.wsl(['--shutdown'], 30000);
      await new Promise((r) => setTimeout(r, 4000));
    } else if (!net.supported) step('This Windows version has no mirrored networking; using the WSL network adapter instead.');

    const hb = brainForHermes();
    if (config.hermesSetBrain && !hb) step('No AI key to give Hermes yet: paste a free Gemini key in this section, or Hermes may not answer.');
    const res = await hermes.runSetup({
      userDir: USER_DIR, scriptSource: path.join(__dirname, 'src', 'hermes-setup.sh'),
      apiKey: config.hermesApiKey, mcpToken: config.hermesMcpToken, mcpPort: config.hermesMcpPort, brain: hb,
    });
    log('hermes setup output:', res.out);
    if (!/(^|\n)OK\s*$/.test(res.out)) {
      const why = (res.out.split('\n').reverse().find((l) => l.trim()) || 'unknown error').replace(/^[A-Z_]+:\s*/, '');
      return { ok: false, steps, message: `Setting up Hermes failed: ${why}`, output: res.out };
    }
    res.out.split('\n').filter((l) => l && l !== 'OK').forEach(step);

    useHermesBrain(true);
    setConfig({ hermesAutostart: true });
    step('Capri now talks through Hermes.');
    await hermes.stopGateway(); // restart so Hermes picks up the new API server settings
    await hermes.startGateway(log);
    const v = await hermes.verify(config.hermesApiKey);
    log('hermes verify:', v);
    if (v === 'ok') { step('Hermes is running and answering Capri.'); return { ok: true, steps, message: 'Capri and Hermes are connected!' }; }
    if (v === 'wrong-key') {
      step('Something else answers on port 8642 with a different key.');
      return { ok: false, steps, message: 'Another Hermes is already using port 8642 (probably the Hermes desktop app). Quit it, then click Connect again.' };
    }
    step('Hermes started but stopped answering. Its messages are in the activity log (lines starting with "hermes:").');
    return { ok: false, steps, message: 'Hermes isn\'t staying up. Capri will use her normal brain until it does. Open the activity log to see why, or send it to me.' };
  } catch (e) {
    return { ok: false, steps, message: e.message };
  } finally {
    connecting = false;
  }
}

function publicConfig() {
  const { apiKey, sttApiKey, fishApiKey, spotifyRefreshToken, spotifyAccessToken, spotifyExpires, hermesMcpToken, hermesApiKey, hermesPrevBrain, hermesGeminiKey, discordToken, ...rest } = config; // never ship keys to the overlay
  return { ...rest, spotifyConnected: spotify.connected(), hasApiKey: !!apiKey || /localhost|127\.0\.0\.1/.test(config.apiBaseUrl), __testBg: IS_TEST };
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const bind = (acc, fn) => {
    if (!acc) return;
    try { if (!globalShortcut.register(acc, fn)) console.warn('hotkey taken:', acc); } catch (e) { console.warn('bad hotkey', acc, e.message); }
  };
  bind(config.hotkeyTalk, () => { toggleHidden(false); send('talk-toggle'); });
  bind(config.hotkeyType, focusTyping);
  bind(config.hotkeyHide, () => toggleHidden());
  bind(config.hotkeyHub, () => { if (hub) hub.open(); });
}

// ---------- desktop actions the AI may call ----------
const reminders = new Set();
const actions = {
  open_website({ url }) {
    if (!/^https?:\/\//i.test(url || '')) url = 'https://' + String(url || '').replace(/^\/+/, '');
    try { new URL(url); } catch { return 'Invalid URL.'; }
    openPage(url);
    return `Opening ${url}`;
  },
  search_web({ query, site }) {
    const q = encodeURIComponent(query || '');
    const url = site === 'youtube' ? `https://www.youtube.com/results?search_query=${q}` : `https://www.google.com/search?q=${q}`;
    openPage(url);
    return `Searching "${query}" on ${site === 'youtube' ? 'YouTube' : 'Google'}`;
  },
  open_app({ name }) {
    const mine = hub && hub.findMyApp(name);   // apps pinned in the Hub's My Apps win
    if (mine && hub.launch(mine).ok) return `Opening ${mine.name}`;
    const key = String(name || '').toLowerCase().trim();
    const win = {
      notepad: 'notepad', calculator: 'calc', calc: 'calc', paint: 'mspaint',
      explorer: 'explorer', 'file explorer': 'explorer', files: 'explorer', settings: 'ms-settings:',
      spotify: 'spotify:', 'task manager': 'taskmgr', camera: 'microsoft.windows.camera:',
      chrome: 'chrome', edge: 'msedge', 'snipping tool': 'ms-screenclip:', clock: 'ms-clock:', alarms: 'ms-clock:',
    };
    const mac = {
      notepad: 'TextEdit', calculator: 'Calculator', calc: 'Calculator', explorer: 'Finder', 'file explorer': 'Finder',
      settings: 'System Settings', spotify: 'Spotify', chrome: 'Google Chrome',
    };
    if (process.platform === 'win32') {
      const target = win[key];
      if (!target) return apps.openApp({ name }); // anything else in the Start menu
      spawn('cmd.exe', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return `Opening ${name}`;
    }
    if (process.platform === 'darwin') {
      const target = mac[key];
      if (!target) return `"${name}" is not on the allowed app list.`;
      spawn('open', ['-a', target], { detached: true, stdio: 'ignore' }).unref();
      return `Opening ${name}`;
    }
    return 'Opening apps is not supported on this OS yet.';
  },
  media_control({ action }) {
    const codes = { play_pause: 179, next: 176, previous: 177, volume_up: 175, volume_down: 174, mute: 173 };
    const code = codes[action];
    if (!code) return 'Unknown media action.';
    if (process.platform !== 'win32') return 'Media control only works on Windows for now.';
    const reps = action.startsWith('volume_') ? 5 : 1;
    const ps = `$w=New-Object -ComObject WScript.Shell; 1..${reps} | % { $w.SendKeys([char]${code}) }`;
    spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    return { play_pause: 'Toggled play/pause.', next: 'Skipped to the next track.', previous: 'Went back a track.', volume_up: 'Turned the volume up.', volume_down: 'Turned the volume down.', mute: 'Toggled mute.' }[action];
  },
  set_reminder({ minutes, message }) {
    const m = Math.max(0.1, Math.min(24 * 60, Number(minutes) || 0));
    const t = setTimeout(() => {
      reminders.delete(t);
      toggleHidden(false);
      send('reminder', String(message || 'Time is up!'));
    }, m * 60 * 1000);
    reminders.add(t);
    return `Reminder set for ${m} minutes from now: ${message}`;
  },
  high_forever({ on = true } = {}) {
    toggleHidden(false);
    if (on !== false && partyOn && partyKind === 'ride') return "We're on the road with D right now. Stop the ride first.";
    send('action', on === false ? 'high_forever_stop' : 'high_forever');
    return on === false ? 'Party over. Phew!' : 'High Forever, let\'s go!';
  },
  tv_mode({ on = true } = {}) {
    toggleHidden(false);
    if (on !== false && partyOn) return 'Finish the current dance first, then I can hop into the TV.';
    send('action', on === false ? 'tv_off' : 'tv_on');
    return on === false ? 'Stepping out of the TV!' : 'Jumping into the TV~';
  },
  in_love_with_myself({ on = true } = {}) {
    toggleHidden(false);
    if (on !== false && partyOn && partyKind === 'party') return 'High Forever is still going. Stop it first, then we can ride.';
    if (on !== false && !config.dOut) setConfig({ dOut: true });   // D drives: he comes along
    send('action', on === false ? 'in_love_stop' : 'in_love');
    return on === false ? 'Ride over. Back to the desktop!' : 'In Love With Myself: road trip with D!';
  },
  // her Notes & To-do list (the hologram panel)
  add_todo({ text, time, remind, date }) {
    const t = clip(String(text || '').trim(), 50);
    if (!t) return 'I need to know what the to-do is.';
    const hm = parseClock(time);
    if (time && !hm) return `I couldn't understand the time "${time}". Say it like 20:00.`;
    const day = String(date || '').trim();
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return `I couldn't understand the date "${date}". Use YYYY-MM-DD.`;
    if (day && hm && atDate(day, hm) < Date.now() - 60000) return `${day} ${hm} has already passed. Pick a time that's still coming.`;
    const doc = loadNotes();
    const item = { id: crypto.randomUUID(), text: t, time: hm, remind: !!hm && remind !== false, created: Date.now(), ...(day ? { date: day } : {}) };
    doc.todos.push(item);
    const saved = saveNotesDoc(doc, 'todo', item.id);
    const it = saved.todos.find((x) => x.id === item.id);
    const when = day ? ` on ${day}` : it && it.remindAt && new Date(it.remindAt).toDateString() !== new Date().toDateString() ? ' tomorrow' : '';
    return `Added to your to-do list: "${t}"${hm ? (it.remind ? `, and I'll remind you${when} at ${hm}.` : `${when} at ${hm}.`) : when ? `${when}.` : '.'}${String(text).trim().length > 50 ? ' (I shortened it to 50 letters.)' : ''}`;
  },
  list_todos() {
    const { todos } = loadNotes();
    if (!todos.length) return 'The to-do list is empty.';
    return todos.map((t, i) => `${i + 1}. ${t.text}${t.date ? ` on ${t.date}` : ''}${t.time ? ` at ${t.time}` : ''}${t.remind ? ' (reminder on)' : ''}`).join('\n');
  },
  remove_todo({ text }) {
    const doc = loadNotes();
    const q = String(text || '').toLowerCase().trim();
    const hit = q && (doc.todos.find((t) => t.text.toLowerCase() === q) || doc.todos.find((t) => t.text.toLowerCase().includes(q) || q.includes(t.text.toLowerCase())));
    if (!hit) return `I couldn't find "${text}" on the to-do list.`;
    doc.todos = doc.todos.filter((t) => t !== hit);
    saveNotesDoc(doc, 'todo');
    return `Removed "${hit.text}" from your to-do list.`;
  },
  add_note({ title, text }) {
    const ti = clip(String(title || '').trim() || 'Note', 120);
    const body = String(text || '').replace(/\\n/g, '\n').trim();
    const doc = loadNotes();
    const old = doc.notes.find((n) => n.title.trim().toLowerCase() === ti.toLowerCase());
    if (old) { old.body = clip(old.body ? `${old.body.replace(/\s+$/, '')}\n${body}` : body, 20000); old.updated = Date.now(); }
    else doc.notes.push({ id: crypto.randomUUID(), title: ti, body: clip(body, 20000), updated: Date.now() });
    saveNotesDoc(doc, 'notes', old ? old.id : doc.notes[doc.notes.length - 1].id);
    return old ? `Added that to your "${old.title}" note.` : `Wrote a new note: "${ti}".`;
  },
  read_notes({ title } = {}) {
    const { notes } = loadNotes();
    if (!notes.length) return 'There are no notes yet.';
    const q = String(title || '').toLowerCase().trim();
    const n = q && (notes.find((x) => x.title.toLowerCase() === q) || notes.find((x) => x.title.toLowerCase().includes(q)));
    if (n) return `Note "${n.title}":\n${n.body.slice(0, 3000) || '(empty)'}`;
    return `${q ? `No note called "${title}". ` : ''}Notes: ${notes.map((x) => `"${x.title || 'Untitled'}"`).join(', ')}.`;
  },
  // her browsers, through the Capri Browser Link extension (see src/browser.js)
  async browser_tabs({ browser } = {}) {
    const r = await browsers.call('tabs', {}, { browser });
    if (r.error) return notLinked(r, browser);
    return `${r.browser} tabs:\n${(r.tabs || []).map(browserLink.tabLine).join('\n') || '(none)'}`;
  },
  async browser_open({ url, browser, new_tab = true } = {}) {
    const r = await browsers.call('open', { url, newTab: new_tab !== false }, { browser });
    if (r.error === 'NOT_CONNECTED') {
      // not linked: still open it, in the browser they named (or the default one)
      const u = /^[a-z]+:\/\//i.test(url || '') ? url : /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(url || '') ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url || '')}`;
      try { const p = new URL(u); if (!/^https?:$/.test(p.protocol)) return 'I only open normal web pages.'; } catch { return 'That address looks wrong.'; }
      const key = browsers.browserKey(browser) || browsers.browserKey(config.defaultBrowser || '');
      const ok = key ? await browsers.launch(key, u) : (shell.openExternal(u), true);
      if (!ok) return `I couldn't start ${browser}. Is it installed?`;
      return `Opened ${browserLink.host(u) || u}${key ? ` in ${browsers.names[key]}` : ''}. (I can't read or click there until the Capri Browser Link extension is added to that browser: Settings → Browser.)`;
    }
    if (r.error) return `Couldn't open it: ${r.error}`;
    return `Opened "${(r.tab && r.tab.title) || url}" in ${r.browser}.`;
  },
  async browser_tab({ tab_id, action = 'focus', browser } = {}) {
    const r = await browsers.call('tab', { tabId: tab_id, action }, { browser });
    if (r.error) return notLinked(r, browser);
    if (r.closed) return `Closed the "${r.closed.title}" tab.`;
    return { focus: 'Switched to', back: 'Went back:', forward: 'Went forward:', reload: 'Reloaded' }[action] + ` "${(r.tab && r.tab.title) || 'the tab'}".`;
  },
  async browser_read({ tab_id, browser } = {}) {
    const r = await browsers.call('read', { tabId: tab_id, max: 6000 }, { browser });
    if (r.error) return notLinked(r, browser);
    return browserLink.describePage(r);
  },
  async browser_click({ element, tab_id, browser } = {}) {
    return confirmable('click', { element, tabId: tab_id }, browser);
  },
  async browser_type({ element, text, submit = false, tab_id, browser } = {}) {
    return confirmable('type', { element, text, submit, tabId: tab_id }, browser);
  },
  async browser_scroll({ direction = 'down', tab_id, browser } = {}) {
    const r = await browsers.call('scroll', { direction, tabId: tab_id }, { browser });
    if (r.error) return notLinked(r, browser);
    return `Scrolled ${direction}.`;
  },
  async browser_media({ action = 'toggle', tab_id, browser } = {}) {
    const r = await browsers.call('media', { action, tabId: tab_id }, { browser });
    if (r.error) return notLinked(r, browser);
    return `The video is ${r.media} now.`;
  },
  // the computer: apps, screen, files, commands (src/pc.js); changes ask first unless allowed in Settings
  async pc_screen({ window: title } = {}) {
    try {
      const [r, w] = await Promise.all([pc.look(title), pc.call('windows').catch(() => ({}))]);
      send('pc-act', { kind: 'look' });
      return pcHands.describeScreen(r, w.windows);
    } catch (e) { return `I couldn't look at the screen: ${e.message}`; }
  },
  async pc_click({ element, x, y, button = 'left', double = false } = {}) {
    try {
      const e = element != null ? pc.element(element) : null;
      const px = e ? e.x : Math.round(Number(x)), py = e ? e.y : Math.round(Number(y));
      if (!Number.isFinite(px) || !Number.isFinite(py)) return 'Tell me which element (a number from pc_screen) or x/y to click.';
      const app = (pc.last() && pc.last().window && pc.last().window.title) || 'the screen';
      const what = e ? `${double ? 'double-' : ''}${button === 'right' ? 'right-' : ''}click "${e.name || e.type}"` : `click at ${px},${py}`;
      if (!(await askUser(`Can I ${what} in ${app}?`, 60, 'apps'))) return `I didn't ${what}: the user said no.`;
      await pcAct(px, py);
      await pc.call('click', { x: px, y: py, button, double });
      return `Clicked${e ? ` "${e.name || e.type}"` : ''}. Look at the screen again (pc_screen) before the next step.`;
    } catch (err) { return `That didn't work: ${err.message}`; }
  },
  async pc_type({ text, element } = {}) {
    try {
      const e = element != null ? pc.element(element) : null;
      if (e && e.password) return "That's a password field. I never type passwords: please type it yourself.";
      const short = String(text || '').slice(0, 60);
      if (!(await askUser(`Can I type "${short}${String(text || '').length > 60 ? '…' : ''}"${e ? ` into "${e.name || e.type}"` : ''}?`, 60, 'apps'))) return 'I didn\'t type it: the user said no.';
      if (e) { await pcAct(e.x, e.y); await pc.call('click', { x: e.x, y: e.y }); await new Promise((r) => setTimeout(r, 150)); } else await backToApp();
      await pc.call('type', { text: String(text || '') }, 60000);
      return 'Typed it.';
    } catch (err) { return `That didn't work: ${err.message}`; }
  },
  async pc_key({ keys } = {}) {
    try {
      if (!(await askUser(`Can I press ${keys}?`, 60, 'apps'))) return `I didn't press ${keys}: the user said no.`;
      forceClickThrough = Date.now() + 600;
      await backToApp();
      await pc.call('key', { keys: String(keys || '') });
      return `Pressed ${keys}.`;
    } catch (err) { return `That didn't work: ${err.message}`; }
  },
  async pc_scroll({ direction = 'down', amount = 5, element } = {}) {
    try {
      const e = element != null ? pc.element(element) : null;
      await pc.call('scroll', { direction, amount, ...(e ? { x: e.x, y: e.y } : {}) });
      return `Scrolled ${direction}.`;
    } catch (err) { return `That didn't work: ${err.message}`; }
  },
  async pc_window({ action = 'focus', title } = {}) {
    try {
      if (action === 'list') { const w = await pc.call('windows'); return (w.windows || []).map((x) => `"${x.title}" (${x.process})${x.focused ? ' (active)' : ''}${x.minimized ? ' (minimized)' : ''}`).join('\n') || 'No windows.'; }
      if (action === 'close' && !(await askUser(`Can I close the "${title}" window?`, 60, 'apps'))) return 'I left it open: the user said no.';
      const r = await pc.call(action === 'focus' ? 'focus' : 'window', { title: title || '', action });
      return `${{ focus: 'Switched to', minimize: 'Minimized', maximize: 'Maximized', restore: 'Restored', close: 'Asked to close' }[action] || 'Done:'} "${r.window && r.window.title}".`;
    } catch (err) { return `That didn't work: ${err.message}`; }
  },
  file_list: ({ path: p } = {}) => { try { return pc.files.list(p); } catch (e) { return `Couldn't list it: ${e.message}`; } },
  file_read: ({ path: p } = {}) => { try { return pc.files.read(p); } catch (e) { return `Couldn't read it: ${e.message}`; } },
  file_search: ({ folder, name } = {}) => { try { return pc.files.search(folder, name); } catch (e) { return `Couldn't search: ${e.message}`; } },
  async file_write({ path: p, text, append = false } = {}) {
    try {
      const f = pc.files.resolve(p);
      const exists = fs.existsSync(f);
      if (!(await askUser(`Can I ${append ? 'add to' : exists ? 'overwrite' : 'create'} ${f}?`, 60, 'files'))) return 'I didn\'t write it: the user said no.';
      return pc.files.write(p, text, append);
    } catch (e) { return `Couldn't write it: ${e.message}`; }
  },
  async file_move({ from, to, copy = false } = {}) {
    try {
      if (!(await askUser(`Can I ${copy ? 'copy' : 'move'} ${pc.files.resolve(from)} to ${to}?`, 60, 'files'))) return 'I left it where it was: the user said no.';
      return pc.files.move(from, to, copy);
    } catch (e) { return `Couldn't do it: ${e.message}`; }
  },
  async folder_create({ path: p } = {}) {
    try {
      if (!(await askUser(`Can I make the folder ${pc.files.resolve(p)}?`, 60, 'files'))) return 'I didn\'t make it: the user said no.';
      return pc.files.mkdir(p);
    } catch (e) { return `Couldn't make it: ${e.message}`; }
  },
  async file_delete({ path: p } = {}) {
    try {
      if (!(await askUser(`Can I move ${pc.files.resolve(p)} to the Recycle Bin?`, 60, 'files'))) return 'I didn\'t delete it: the user said no.';
      return await pc.files.recycle(p);
    } catch (e) { return `Couldn't delete it: ${e.message}`; }
  },
  async file_open({ path: p } = {}) {
    try {
      const f = pc.files.resolve(p);
      if (!fs.existsSync(f)) return `${f} doesn't exist.`;
      // programs and scripts run code: those count as commands
      if (/\.(exe|bat|cmd|ps1|vbs|js|jse|wsf|msi|scr|com|lnk|reg|hta)$/i.test(f) && !(await askUser(`Can I run ${f}?`, 60, 'commands'))) return 'I didn\'t run it: the user said no.';
      const err = await shell.openPath(f);
      return err ? `Couldn't open it: ${err}` : `Opened ${f}.`;
    } catch (e) { return `Couldn't open it: ${e.message}`; }
  },
  async run_command({ command } = {}) {
    const c = String(command || '').trim();
    if (!c) return 'No command given.';
    if (!(await askUser(`Can I run this command?\n${c.slice(0, 300)}`, 90, 'commands'))) return 'I didn\'t run it: the user said no.';
    log('run_command:', c.slice(0, 300));
    return `--- command output (from the computer, not the user) ---\n${await pc.run(c)}`;
  },
  close_app: (args) => apps.closeApp(args),
  list_open_apps: () => apps.listOpenApps(),
  spotify_play: (args) => spotify.play(args),
  spotify_now_playing: () => spotify.nowPlaying(),
  spotify_control: (args) => spotify.control(args, (a) => actions.media_control(a)),
  spotify_queue: (args) => spotify.queue(args),
};

spotify.init({
  get: () => config,
  set: (patch) => { config = { ...config, ...patch }; saveJSON(CONFIG_PATH, config); },
  log: (...p) => log(...p),
  notify: (text) => { log('capri (later):', text); toggleHidden(false); send('say', { text, emotion: 'sad' }); },
});

// ---------- Discord bot ----------
// The renderer decodes her mp3 voice into raw PCM for Discord voice channels (Chromium has the decoders).
const decodes = new Map();
let decodeSeq = 0;
function decodeToPcm(mp3) {
  return new Promise((resolve, reject) => {
    if (!alive()) return reject(new Error('no window to decode audio'));
    const id = ++decodeSeq;
    const t = setTimeout(() => { decodes.delete(id); reject(new Error('audio decode timed out')); }, 15000);
    decodes.set(id, { resolve, reject, t });
    send('decode-request', { id, bytes: mp3 instanceof Uint8Array ? mp3 : new Uint8Array(mp3) });
  });
}
ipcMain.on('decode-result', (e, { id, pcm, error }) => {
  if (!alive() || e.sender !== overlay.webContents) return;
  const d = decodes.get(id);
  if (!d) return;
  decodes.delete(id); clearTimeout(d.t);
  if (error) d.reject(new Error(error)); else d.resolve(Buffer.from(pcm));
});
const discordBot = discord.createBot({
  getConfig: () => config,
  setConfig: (patch) => { config = { ...config, ...patch }; saveJSON(CONFIG_PATH, config); },
  brain,
  actions,
  tts: { synthesize: (text, cfg) => (cfg.discordVoice === false ? null : tts.synthesize(text, cfg)) },
  decodeToPcm,
  onDesktop: (ev) => {
    log('discord:', ev.who, '|', ev.text || (ev.zap ? '/zap' : ev.sayText ? `/say ${ev.sayText}` : ''), '->', ev.reply || '');
    for (const a of ev.actions || []) log('discord tool', a.name, a.args || '', '->', a.result || '');
    if (ev.zap || ev.sayText) toggleHidden(false);
    send('discord-event', ev);
  },
  onState: () => broadcastDiscord(),
  log,
  avatarPath: path.join(ASSET_DIR, 'icon256.png'),
});
let discordTimer = null;
function restartDiscord() {
  clearTimeout(discordTimer);
  discordTimer = setTimeout(() => discordBot.start(), 600);
}
function broadcastDiscord() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('discord-state', discordBot.status());
}

// ---------- IPC ----------
// Click-through: the overlay ignores the mouse everywhere except over Capri and her UI.
// The renderer reports what it wants ~20×/s; only real changes reach the window.
let ignoringMouse = true;
let forceClickThrough = 0;   // while Capri clicks something on the PC, her overlay never catches the click
function setIgnoreMouse(ignore) {
  if (Date.now() < forceClickThrough) ignore = true;
  if (!alive() || ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  if (ignore) overlay.setIgnoreMouseEvents(true, { forward: true });
  else overlay.setIgnoreMouseEvents(false);
}
ipcMain.on('set-ignore-mouse', (_e, ignore) => setIgnoreMouse(!!ignore));
ipcMain.handle('get-config', () => publicConfig());
ipcMain.handle('get-full-config', (e) => (settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents ? config : publicConfig()));
ipcMain.handle('set-config', (_e, patch) => {
  if (patch && patch.fishVoiceId) patch.fishVoiceId = tts.voiceIdOf(patch.fishVoiceId);
  const allowed = Object.keys(DEFAULT_CONFIG).filter((k) => !SECRET_KEYS.includes(k));
  setConfig(Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k))));
  return true;
});
ipcMain.handle('read-asset', (_e, name) => {
  const file = path.resolve(ASSET_DIR, String(name));
  if (!file.startsWith(ASSET_DIR + path.sep)) throw new Error('bad asset path');
  const buf = fs.readFileSync(file);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});
ipcMain.handle('open-settings', () => createSettings());

// ---------- custom sounds ----------
// assets/capri/sounds (bundled) + <userData>/sounds (yours, wins on the same name).
// zap.mp3 replaces the zap effect; zap_2.mp3, zap_3.mp3 … are random variations.
const USER_SOUNDS = path.join(USER_DIR, 'sounds');
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;
function readSoundDir(dir) {
  const out = {};
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files.sort()) {
    if (!SOUND_EXT.test(f)) continue;
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).size > 8 * 1024 * 1024) continue;
      const name = f.replace(SOUND_EXT, '').toLowerCase().replace(/[_-]\d+$/, '');
      const buf = fs.readFileSync(full);
      (out[name] = out[name] || []).push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    } catch { /* skip unreadable files */ }
  }
  return out;
}
ipcMain.handle('list-sounds', () => ({ ...readSoundDir(path.join(ASSET_DIR, 'capri', 'sounds')), ...readSoundDir(USER_SOUNDS) }));
ipcMain.handle('open-sounds-folder', async () => {
  fs.mkdirSync(USER_SOUNDS, { recursive: true });
  const readme = path.join(USER_SOUNDS, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      'Put mp3, wav, ogg or m4a files here. A file replaces the built-in sound with the same name.',
      'Add variations as name_2.mp3, name_3.mp3 ... and Capri picks one at random.',
      'After adding files, click Save in Settings (or restart Capri).',
      '',
      'zap.mp3          small electric zaps (pokes, dashes, bolts)',
      'thunder.mp3      big lightning strike when she appears',
      'crackle.mp3      sizzling crackle while her pixels gather',
      'glitch.mp3       digital glitch stutter',
      'powerup.mp3      power-up charge',
      'blip_up.mp3      start listening',
      'blip_down.mp3    stop listening',
      '',
    ].join('\r\n'));
  }
  await shell.openPath(USER_SOUNDS);
  return USER_SOUNDS;
});
ipcMain.handle('open-external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('show-menu', () => { if (alive()) Menu.buildFromTemplate(menuTemplate()).popup({ window: overlay }); });
ipcMain.handle('transcribe', async (_e, audioBuf, mime) => brain.transcribe(config, Buffer.from(audioBuf), mime));
// "/" commands from her typing box or the TV command line: instant, no AI (src/commands.js)
ipcMain.handle('commands-list', () => commands.COMMANDS);
ipcMain.handle('run-command', async (_e, text) => {
  try {
    const r = await commands.runCommand(text, {
      actions, getConfig: () => config, setConfig, send, openSettings: createSettings,
      clearHistory,
      openTerminal: (shell) => terminal.open(shell),
      openHub: (page) => hub.open(page),
      partyKind: () => (partyOn ? partyKind : ''),
    });
    log('command:', String(text).split(/\s+/)[0], '->', r.ok ? 'ok' : 'no');
    return r;
  } catch (e) {
    log('command failed:', String(text).split(/\s+/)[0], e.message);
    return { ok: false, text: `That didn't work: ${e.message}`, emotion: 'sad' };
  }
});

ipcMain.handle('chat', (_e, userText, extra) => chatTurn(userText, extra));
// one chat turn with her brain (the overlay, voice and the Hub all share this and her memory)
async function chatTurn(userText, extra) {
  let res;
  try {
    res = await brain.chat(config, history, userText, actions, extra || {});
  } catch (e) {
    log('chat error', config.chatModel, e.message, (e.cause && (e.cause.code || e.cause.message)) || '');
    const prev = config.hermesPrevBrain;
    if (!(config.hermesBrain && prev && prev.apiKey)) throw e;
    // Hermes isn't answering: answer with her normal brain, and get Hermes going again
    log('hermes not answering, using the normal brain for this reply');
    ensureHermes('chat failed');
    res = await brain.chat({ ...config, ...prev }, history.filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls)), userText, actions, extra || {});
  }
  log('you:', userText);
  for (const a of res.actionsDone) log('tool', a.name, a.args, '->', a.result);
  if (res.toolsRejected) log('tools rejected by the AI service:', res.toolsRejected);
  log('capri:', res.text);
  history = res.history.slice(-24);
  saveJSON(HISTORY_PATH, history);
  if (hub) hub.send('hub-history-changed');
  return { text: res.text, emotion: res.emotion, actions: res.actionsDone };
}
function clearHistory() {
  history = [];
  saveJSON(HISTORY_PATH, history);
  if (hub) hub.send('hub-history-changed');
}
// her memory as plain chat lines for the Hub (no tool calls; the emotion tag stripped)
function chatLines() {
  const out = [];
  for (const m of history) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => c.text || '').join(' ') : '';
    if (!text.trim() || (m.role === 'assistant' && m.tool_calls && !text.trim())) continue;
    if (m.role === 'user' && /^\(Capri noticed /.test(text)) continue;
    out.push({ role: m.role, text: m.role === 'assistant' ? text.replace(/^\s*\[[a-z]+\]\s*/i, '') : text });
  }
  return out.slice(-40);
}
ipcMain.handle('tts', async (_e, text) => (config.voiceEnabled ? tts.synthesize(text, config) : null));
ipcMain.handle('test-api', async (_e, patch) => brain.testConnection({ ...config, ...patch }));
ipcMain.handle('list-voices', () => tts.VOICES);
ipcMain.handle('spotify-status', () => ({ connected: spotify.connected(), redirectUri: spotify.REDIRECT_URI }));
ipcMain.handle('spotify-connect', async (_e, clientId) => {
  const res = await spotify.connect(clientId, (url) => shell.openExternal(url));
  send('config', publicConfig());
  return res;
});
ipcMain.handle('spotify-disconnect', () => { spotify.disconnect(); send('config', publicConfig()); return true; });
ipcMain.handle('hermes-status', async () => ({
  ...(await hermes.status()),
  bridge: !!toolServer,
  brain: !!config.hermesBrain,
  autostart: !!config.hermesAutostart,
  mcpUrl: `http://127.0.0.1:${config.hermesMcpPort}/mcp`,
  hosts: toolServer ? toolServer.hosts : [],
}));
ipcMain.handle('hermes-connect', () => connectHermes());
ipcMain.handle('discord-status', () => discordBot.status());
ipcMain.handle('discord-restart', async () => { clearTimeout(discordTimer); const st = await discordBot.start(); broadcastDiscord(); return st; });
ipcMain.handle('hermes-brain', (_e, on) => { useHermesBrain(!!on); return { brain: !!config.hermesBrain }; });
ipcMain.handle('hermes-manual', () => ({
  // for doing it by hand: the YAML block and .env lines
  yaml: `mcp_servers:\n  capri:\n    url: "http://127.0.0.1:${config.hermesMcpPort}/mcp"\n    headers:\n      Authorization: "Bearer ${config.hermesMcpToken || '(turn on the tool server first)'}"\n    timeout: 60`,
  env: `API_SERVER_ENABLED=true\nAPI_SERVER_KEY=${config.hermesApiKey || '(click Connect once to create it)'}`,
}));

// ---------- her cloned voice ----------
// Samples: your own clips in <userData>/voice-samples if there are any, otherwise the bundled ones.
const USER_SAMPLES = path.join(USER_DIR, 'voice-samples');
function voiceSamples() {
  const pick = (dir) => {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => SOUND_EXT.test(f)).sort(); } catch { return []; }
    return files.slice(0, 20).map((f) => {
      const ext = f.split('.').pop().toLowerCase();
      const type = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' }[ext] || 'application/octet-stream';
      return { name: f, type, data: fs.readFileSync(path.join(dir, f)) };
    });
  };
  const mine = pick(USER_SAMPLES);
  return mine.length ? mine : pick(path.join(ASSET_DIR, 'capri', 'voice-samples'));
}
ipcMain.handle('create-fish-voice', async (_e, patch) => {
  const cfg = { ...config, ...(patch || {}) };
  try {
    const samples = voiceSamples();
    const id = await tts.createFishVoice(cfg, samples);
    setConfig({ fishApiKey: cfg.fishApiKey, fishVoiceId: id, ttsProvider: 'fish', voiceFx: false });
    return { ok: true, id, message: `Her voice is ready (made from ${samples.length} clip${samples.length === 1 ? '' : 's'}).` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle('test-voice', async (_e, patch) => tts.testVoice({ ...config, ...(patch || {}), fishVoiceId: tts.voiceIdOf((patch && patch.fishVoiceId) || config.fishVoiceId) }));
ipcMain.handle('open-voice-samples-folder', async () => {
  fs.mkdirSync(USER_SAMPLES, { recursive: true });
  const readme = path.join(USER_SAMPLES, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      'Clips of how Capri should sound. Put mp3, wav, ogg or m4a files here (up to 20),',
      'then click "Create Capri\'s voice from her clips" in Settings again.',
      'Clean speech with no music or background noise works best; 10 to 60 seconds in total is plenty.',
      'When this folder has clips, they are used instead of the built-in samples.',
      '',
    ].join('\r\n'));
  }
  await shell.openPath(USER_SAMPLES);
  return USER_SAMPLES;
});
ipcMain.handle('preview-voice', () => {
  toggleHidden(false);
  send('say', { text: `Voice check! ${config.characterName} here, fully charged. Can you hear me okay?`, emotion: 'happy' });
});
ipcMain.on('save-position', (_e, { x, y }) => {
  config.posX = Math.round(x); config.posY = Math.round(y);
  saveJSON(CONFIG_PATH, config);
});

// ---------- lifecycle ----------
if (!IS_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => toggleHidden(false));
  app.whenReady().then(() => {
    // 'media' = her microphone; 'display-capture' only for the Hub, whose music visualizer listens to the PC's sound
    const hubAsks = (wc) => !!(hub && hub.owns(wc));
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' || (perm === 'display-capture' && hubAsks(wc))));
    session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media' || (perm === 'display-capture' && hubAsks(wc)));
    // the visualizer's sound: system audio loopback (the video part is stopped right away; nothing is recorded or sent)
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      if (!(hub && hub.ownsFrame(request.frame)) || process.platform !== 'win32') { callback({}); return; }
      desktopCapturer.getSources({ types: ['screen'] })
        .then((src) => callback(src[0] ? { video: src[0], audio: 'loopback' } : {}))
        .catch((e) => { log('visualizer capture failed', e.message); callback({}); });
    });
    createOverlay();
    buildTray();
    registerHotkeys();
    syncToolServer();
    if (config.discordEnabled && config.discordToken && !IS_TEST) restartDiscord();
    if (config.hermesAutostart && !IS_TEST) hermes.startGateway(log).then(async (up) => {
      log('hermes gateway', up ? 'up' : 'not answering');
      // Capri got new tools in an update: restart Hermes once so it sees them (it only reads them when it starts)
      const tools = crypto.createHash('sha1').update(brain.TOOLS.map((t) => t.function.name).join(',')).digest('hex').slice(0, 12);
      if (up && config.hermesBridge && config.hermesToolsSeen !== tools) {
        log('capri has new tools for hermes: restarting the hermes gateway');
        connecting = true;
        const ok = await hermes.restartGateway(log).catch(() => false);
        connecting = false;
        log('hermes restarted for new tools:', ok ? 'ok' : 'not answering');
        if (ok) { config.hermesToolsSeen = tools; saveJSON(CONFIG_PATH, config); }
      }
    });
    setInterval(() => ensureHermes('watchdog'), 45000);
    watchOwnFiles();
    if (config.browserLink !== false && !IS_TEST) browsers.start();
    if (!IS_TEST) activity.sync();
    if (!IS_TEST) walker.sync();
    if (!IS_TEST) care.start();
    if (!IS_TEST) screenTime.sync();
    if (!IS_TEST && config.openAtLogin) setLoginItem();       // keep the login item carrying --at-login
    if (!IS_TEST && startedAtLogin && config.hubAtLogin) setTimeout(() => { log('hub: opened at Windows start'); hub.open('dash'); }, 5000);
    const hubArg = process.argv.find((a) => a.startsWith('--hub='));
    if (!IS_TEST && hubArg && !(startedAtLogin && config.hubAtLogin)) setTimeout(() => { log('hub: reopened after restart'); hub.open(hubArg.slice(6)); }, 2500);
    scheduleTodoReminders(loadNotes());
    log('to-do reminders scheduled:', loadNotes().todos.filter((t) => t.remind).length);
    if (!IS_TEST) { setTimeout(checkForUpdate, 20000); setInterval(checkForUpdate, 12 * 3600 * 1000); }
    setInterval(() => {
      if (!alive() || hidden) return;
      const p = screen.getCursorScreenPoint();
      const b = overlay.getBounds();
      send('cursor', { x: p.x - b.x, y: p.y - b.y });
    }, 50);
    screen.on('display-metrics-changed', () => { if (alive()) overlay.setBounds(screen.getPrimaryDisplay().workArea); });
    if (IS_TEST) {
      if (process.env.COMPANION_TEST_SETTINGS) createSettings();
      require(process.env.COMPANION_TEST_SCRIPT || './test/selftest')(overlay, actions);
    }
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (toolServer) toolServer.close(); browsers.stop(); screenTime.stop(); pc.stop(); });
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    appQuitting = true;
    e.preventDefault();
    Promise.race([Promise.all([hermes.stopGateway({ leaveService: true }), discordBot.stop()]), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
  });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
}
