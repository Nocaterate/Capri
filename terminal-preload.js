// The bridge for Capri Terminal (renderer/terminal.html): only what the terminal window needs.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, data) => fn(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('capriTerm', {
  spawn: (shell, cols, rows) => ipcRenderer.invoke('term-spawn', { shell, cols, rows }),
  write: (id, data) => ipcRenderer.send('term-write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('term-resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('term-kill', { id }),
  info: () => ipcRenderer.invoke('term-info'),
  check: (cmd) => ipcRenderer.invoke('term-check', cmd),
  ask: (payload) => ipcRenderer.invoke('term-ask', payload),
  windowCtl: (what) => ipcRenderer.send('term-window', what),
  onData: on('term-data'),
  onExit: on('term-exit'),
  onNewTab: on('term-new-tab'),
});
