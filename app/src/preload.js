const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeHelp', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  onUsage: (cb) => ipcRenderer.on('usage:changed', (_e, data) => cb(data)),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  version: () => ipcRenderer.invoke('app:version'),

  showMail: (bounds) => ipcRenderer.invoke('mail:show', bounds),
  setMailBounds: (bounds) => ipcRenderer.send('mail:bounds', bounds),
  hideMail: () => ipcRenderer.invoke('mail:hide'),
  reloadMail: () => ipcRenderer.invoke('mail:reload'),
  openMailExternal: () => ipcRenderer.invoke('mail:external'),

  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, info) => cb(info)),
});
