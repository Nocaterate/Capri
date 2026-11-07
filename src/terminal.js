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

function createTerminal({ BrowserWindow, ipcMain, getConfig, setConfig, log, brain, rootDir, iconPath }) {
  let win = null, pty = null, ptyError = '';
  const tabs = new Map();                        // id -> { proc, shell }
  let seq = 0;

  function loadPty() {
    if (pty || ptyError) return pty;
    try { pty = require('@lydell/node-pty'); } catch (e) { ptyError = e.message; log('terminal: pty unavailable:', e.message); }
    return pty;
  }

  function open(shell = 'powershell') {
    shell = SHELLS[shell] ? shell : 'powershell';
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      win.webContents.send('term-new-tab', shell);
      return;
    }
    const b = getConfig().termBounds || {};
    win = new BrowserWindow({
      width: b.width || 940, height: b.height || 600, x: b.x, y: b.y, minWidth: 560, minHeight: 360,
      frame: false, backgroundColor: '#04080c', title: 'Capri Terminal', icon: iconPath, show: false,
      webPreferences: { preload: path.join(rootDir, 'terminal-preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.loadFile(path.join(rootDir, 'renderer', 'terminal.html'), { query: { shell } });
    win.once('ready-to-show', () => win.show());
    const saveBounds = () => { if (win && !win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) setConfig({ termBounds: win.getBounds() }); };
    let bt = null;
    win.on('resize', () => { clearTimeout(bt); bt = setTimeout(saveBounds, 600); });
    win.on('move', () => { clearTimeout(bt); bt = setTimeout(saveBounds, 600); });
    win.on('closed', () => { for (const id of [...tabs.keys()]) kill(id); win = null; });
    log('terminal: opened', shell);
  }

  const fromTerm = (e) => win && !win.isDestroyed() && e.sender === win.webContents;

  function spawn(shell, cols, rows) {
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
    tabs.set(id, { proc, shell });
    proc.onData((d) => { if (win && !win.isDestroyed()) win.webContents.send('term-data', { id, data: d }); });
    proc.onExit(({ exitCode }) => { tabs.delete(id); if (win && !win.isDestroyed()) win.webContents.send('term-exit', { id, code: exitCode }); });
    log('terminal: started', shell);
    return { id, label: s.label };
  }
  function kill(id) { const t = tabs.get(id); if (!t) return; tabs.delete(id); try { t.proc.kill(); } catch { /* gone */ } }

  ipcMain.handle('term-spawn', (e, { shell, cols, rows } = {}) => (fromTerm(e) ? spawn(shell, cols, rows) : { error: 'no' }));
  ipcMain.on('term-write', (e, { id, data } = {}) => { if (!fromTerm(e)) return; const t = tabs.get(id); if (t && typeof data === 'string') t.proc.write(data); });
  ipcMain.on('term-resize', (e, { id, cols, rows } = {}) => { if (!fromTerm(e)) return; const t = tabs.get(id); if (t) try { t.proc.resize(Math.max(20, cols | 0), Math.max(5, rows | 0)); } catch { /* exited */ } });
  ipcMain.on('term-kill', (e, { id } = {}) => { if (fromTerm(e)) kill(id); });
  ipcMain.on('term-window', (e, what) => {
    if (!fromTerm(e)) return;
    if (what === 'close') win.close();
    else if (what === 'min') win.minimize();
    else if (what === 'max') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  });
  ipcMain.handle('term-info', (e) => {
    if (!fromTerm(e)) return {};
    const cfg = getConfig();
    return { name: cfg.characterName || 'Capri', autoRun: !!(cfg.autoApprove && cfg.autoApprove.terminal) };
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

  return { open, isOpen: () => !!(win && !win.isDestroyed()), SHELLS };
}

module.exports = { createTerminal, SHELLS, DANGER };
