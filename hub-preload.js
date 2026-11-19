// The bridge for Capri Hub (renderer/hub.html): only what the Hub window needs.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, data) => fn(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('hub', {
  init: call('hub-init'),
  dashboard: call('hub-dashboard'),
  icons: call('hub-icons'),
  launch: call('hub-launch'),
  apps: call('hub-apps'),
  myApps: call('hub-myapps'),
  saveMyApps: call('hub-myapps-save'),
  pickApps: call('hub-myapps-pick'),
  pickIcon: call('hub-icon-pick'),
  fileApp: call('hub-file-app'),
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  history: call('hub-history'),
  chat: call('hub-chat'),
  clearChat: call('hub-clear-chat'),
  notesGet: call('notes-get'),
  notesSave: call('notes-save'),
  nowPlaying: call('hub-now-playing'),
  status: call('hub-status'),
  statusAction: call('hub-status-action'),
  webApp: call('hub-web-app'),
  music: call('hub-music'),
  screenTime: call('hub-screentime'),
  setScreenTime: call('hub-screentime-set'),
  stats: call('hub-stats'),
  cleanupInfo: call('hub-cleanup-info'),
  endTask: call('hub-end-task'),
  cleanTemp: call('hub-clean-temp'),
  emptyBin: call('hub-empty-bin'),
  openSettings: call('hub-open-settings'),
  windowCtl: (what) => ipcRenderer.send('hub-window', what),
  pageShown: (p) => ipcRenderer.send('hub-page-shown', p),
  placeTerminal: (rect, visible) => ipcRenderer.send('hub-term-place', { rect, visible }),
  onPage: on('hub-page'),
  onIcons: on('hub-icons-ready'),
  onNotes: on('notes-updated'),
  onHistory: on('hub-history-changed'),
  onConfig: on('config'),
});
