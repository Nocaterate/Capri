// Capri Terminal: your real PowerShell / CMD in a window dressed like her TV (renderer/terminal.html). Each tab is
// a real shell on a pseudo-console (@lydell/node-pty: prebuilt ConPTY binding, nothing to compile). Typing
// "/capri ..." at an empty prompt never reaches the shell: the window asks her (askTerminal below) with what's
// on screen, and she answers inside the terminal with commands you Run / Edit / Skip (or that run straight away
// when Settings → Computer control → "Run commands she suggests in Capri Terminal" is allowed).
// Nothing typed in the terminal is logged; only "terminal: opened powershell" style lines.
const os = require('os');
const path = require('path');

const SHELLS = {
  powershell: { file: 'powershell.exe', args: ['-NoLogo'], label: 'PowerShell' },
  cmd: { file: 'cmd.exe', args: [], label: 'CMD' },
};

// commands that always ask, even with "Always allow" on: deleting or overwriting, system and security changes, and
// anything that runs downloaded, hidden or nested code (she reads the screen, which is untrusted, so a planted line
// could try that). Any redirect (>) asks too. A false alarm only means one extra question.
const DANGER = new RegExp([
  String.raw`\b(rm|rmdir|rd|del|erase|ri|format|diskpart|shutdown|restart-computer|stop-computer|clear-disk|clear-content|clear-recyclebin)\b`,
  String.raw`\b(remove-item|move-item|mv|move|ren|rename-item|set-content|add-content|out-file|copy-item|cp|copy|xcopy|robocopy|new-item)\b`,
  String.raw`\b(invoke-expression|iex|invoke-command|icm|invoke-webrequest|iwr|invoke-restmethod|irm|curl|wget|bitsadmin|certutil|start-bitstransfer)\b`,
  String.raw`\b(start-process|saps|start|stop-process|kill|taskkill|schtasks|register-scheduledtask|wmic|vssadmin|wevtutil|netsh|bcdedit|takeown|icacls|cipher)\b`,
  String.raw`\b(set-executionpolicy|set-itemproperty|new-itemproperty|remove-itemproperty|set-mppreference|add-mppreference|reg|regedit|msiexec|mshta|rundll32|regsvr32|cscript|wscript|choco|winget|uninstall-\w+|disable-\w+|enable-\w+)\b`,
  String.raw`\bsc(\.exe)?\s+(delete|config|create|stop)\b|\bnet\s+(user|localgroup|share|stop)\b`,
  String.raw`\b(powershell|pwsh)(\.exe)?\b|\bcmd(\.exe)?\s+\/[ck]\b|-enc(odedcommand)?\b|-recurse\b|\/s\b.*\/q\b|\bmkfs\b|>`,
  String.raw`\bgit\s+(push\b.*(-f\b|--force)|reset\s+--hard|clean\s+-\w*f)`,
].join('|'), 'i');

function createTerminal({ BrowserWindow, ipcMain, getConfig, setConfig, log, brain, rootDir, iconPath, WebContentsView }) {
  let win = null, pty = null, ptyError = '';
  // the terminal page lives in its own window and/or inside the Hub (a view in the Hub window): each tab belongs to one
  const tabs = new Map();                        // id -> { proc, shell, wc, buf }
  let seq = 0;
  let embed = null, embedHost = null;            // WebContentsView inside the Hub, and the Hub window
  let adopt = [];                                // tab ids waiting for the window (Pop out from the Hub)

  function loadPty() {
    if (pty || ptyError) return pty;
    try { pty = require('@lydell/node-pty'); } catch (e) { ptyError = e.message; log('terminal: pty unavailable:', e.message); }
    return pty;
  }

  function open(shell = 'powershell', { adoptIds = null } = {}) {
    shell = SHELLS[shell] ? shell : 'powershell';
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      if (adoptIds) { adopt = adoptIds; win.webContents.send('term-adopt'); } else win.webContents.send('term-new-tab', shell);
      return;
    }
    adopt = adoptIds || [];
    const b = getConfig().termBounds || {};
    win = new BrowserWindow({
      width: b.width || 940, height: b.height || 600, x: b.x, y: b.y, minWidth: 560, minHeight: 360,
      frame: false, backgroundColor: '#04080c', title: 'Capri Terminal', icon: iconPath, show: false,
      webPreferences: { preload: path.join(rootDir, 'terminal-preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.loadFile(path.join(rootDir, 'renderer', 'terminal.html'), { query: adoptIds ? { shell, adopt: '1' } : { shell } });
    win.once('ready-to-show', () => win.show());
    const saveBounds = () => { if (win && !win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) setConfig({ termBounds: win.getBounds() }); };
    let bt = null;
    win.on('resize', () => { clearTimeout(bt); bt = setTimeout(saveBounds, 600); });
    win.on('move', () => { clearTimeout(bt); bt = setTimeout(saveBounds, 600); });
    const wc = win.webContents;
    win.on('closed', () => { killOf(wc); win = null; });
    log('terminal: opened', shell);
  }

  // inside the Hub: one view, kept while the Hub is open (tabs keep running when you switch Hub pages)
  function embedIn(host, { shell = 'powershell' } = {}) {
    if (embed && embedHost === host && !embed.webContents.isDestroyed()) return embed;
    if (!WebContentsView) return null;
    embedHost = host;
    embed = new WebContentsView({ webPreferences: { preload: path.join(rootDir, 'terminal-preload.js'), contextIsolation: true, nodeIntegration: false } });
    embed.setBackgroundColor('#04080c');
    host.contentView.addChildView(embed);
    embed.setVisible(false);
    embed.webContents.loadFile(path.join(rootDir, 'renderer', 'terminal.html'), { query: { shell, embed: '1' } });
    const wc = embed.webContents;
    host.on('closed', () => { killOf(wc); try { wc.close(); } catch { /* gone */ } if (embedHost === host) { embed = null; embedHost = null; } });
    log('terminal: opened in the Hub');
    return embed;
  }
  function placeEmbed(rect, visible) {
    if (!embed || embed.webContents.isDestroyed()) return;
    if (rect) embed.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
    embed.setVisible(!!visible);
    if (visible) embed.webContents.focus();
  }

  const senders = () => [win && !win.isDestroyed() ? win.webContents : null, embed && !embed.webContents.isDestroyed() ? embed.webContents : null].filter(Boolean);
  const fromTerm = (e) => senders().includes(e.sender);
  const sendTo = (wc, ch, data) => { if (wc && !wc.isDestroyed()) wc.send(ch, data); };
  function killOf(wc) { for (const [id, t] of [...tabs]) if (t.wc === wc) kill(id); }

  function spawn(wc, shell, cols, rows) {
    const P = loadPty();
    if (!P) return { error: `The terminal helper didn't load (${ptyError}).` };
    const s = SHELLS[shell] || SHELLS.powershell;
    const id = ++seq;
    let proc;
    try {
      proc = P.spawn(s.file, s.args, {
        name: 'xterm-256color', cols: Math.max(20, cols | 0 || 100), rows: Math.max(5, rows | 0 || 30),
        cwd: os.homedir(), env: { ...process.env, CAPRI_TERMINAL: '1' }, useConpty: true,
      });
    } catch (e) { log('terminal: spawn failed', e.message); return { error: e.message }; }
    const tab = { proc, shell, wc, buf: '' };
    tabs.set(id, tab);
    // the last part of the screen is kept so a tab can move between the Hub and the window (Pop out)
    proc.onData((d) => { tab.buf = (tab.buf + d).slice(-120000); sendTo(tab.wc, 'term-data', { id, data: d }); });
    proc.onExit(({ exitCode }) => { tabs.delete(id); sendTo(tab.wc, 'term-exit', { id, code: exitCode }); });
    log('terminal: started', shell);
    return { id, label: s.label };
  }
  function kill(id) { const t = tabs.get(id); if (!t) return; tabs.delete(id); try { t.proc.kill(); } catch { /* gone */ } }

  // a page may only touch its own tabs
  const own = (e, id) => { const t = tabs.get(id); return t && t.wc === e.sender ? t : null; };
  ipcMain.handle('term-spawn', (e, { shell, cols, rows } = {}) => (fromTerm(e) ? spawn(e.sender, shell, cols, rows) : { error: 'no' }));
  ipcMain.on('term-write', (e, { id, data } = {}) => { const t = own(e, id); if (t && typeof data === 'string') t.proc.write(data); });
  ipcMain.on('term-resize', (e, { id, cols, rows } = {}) => { const t = own(e, id); if (t) try { t.proc.resize(Math.max(20, cols | 0), Math.max(5, rows | 0)); } catch { /* exited */ } });
  ipcMain.on('term-kill', (e, { id } = {}) => { if (own(e, id)) kill(id); });
  ipcMain.on('term-window', (e, what) => {
    if (!fromTerm(e)) return;
    const isEmbed = embed && e.sender === embed.webContents;
    if (isEmbed) {
      if (what === 'popout') {
        // its running tabs move to the terminal window (the screen so far comes along)
        const ids = [...tabs].filter(([, t]) => t.wc === e.sender).map(([id]) => id);
        if (!ids.length) { open('powershell'); return; }
        e.sender.send('term-released', ids);
        open('powershell', { adoptIds: ids });
        log('terminal: popped out of the Hub', ids.length, 'tab(s)');
      }
      return;
    }
    if (what === 'close') win.close();
    else if (what === 'min') win.minimize();
    else if (what === 'max') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  });
  // the window takes over tabs from the Hub: they now send to it, and it gets each one's screen so far
  ipcMain.handle('term-adopt', (e) => {
    if (!(win && !win.isDestroyed() && e.sender === win.webContents)) return [];
    const out = [];
    for (const id of adopt) { const t = tabs.get(id); if (t) { t.wc = e.sender; out.push({ id, shell: t.shell, buf: t.buf }); } }
    adopt = [];
    return out;
  });
  ipcMain.handle('term-info', (e) => {
    if (!fromTerm(e)) return {};
    const cfg = getConfig();
    return { name: cfg.characterName || 'Capri', autoRun: !!(cfg.autoApprove && cfg.autoApprove.terminal), embedded: !!(embed && e.sender === embed.webContents) };
  });
  // the danger check lives here so the window can't be talked out of it
  ipcMain.handle('term-check', (e, cmd) => {
    if (!fromTerm(e)) return { ask: true };
    const cfg = getConfig();
    const danger = DANGER.test(String(cmd || ''));
    return { ask: danger || !(cfg.autoApprove && cfg.autoApprove.terminal), danger };
  });
  ipcMain.handle('term-ask', async (e, { question, screen, shell, history } = {}) => {
    if (!fromTerm(e)) return { say: 'No.', commands: [] };
    log('terminal: asked Capri');
    try { return await brain.terminalHelp(getConfig(), { question, screen, shell, history }); }
    catch (err) { log('terminal: ask failed', err.message); return { say: `I couldn't think just now: ${err.message}`, commands: [], error: true }; }
  });

  return { open, embedIn, placeEmbed, isOpen: () => !!(win && !win.isDestroyed()), SHELLS };
}

module.exports = { createTerminal, SHELLS, DANGER };
