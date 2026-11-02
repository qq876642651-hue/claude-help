const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeHelp', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  onUsage: (cb) => ipcRenderer.on('usage:changed', (_e, data) => cb(data)),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  version: () => ipcRenderer.invoke('app:version'),

  openMail: (email) => ipcRenderer.invoke('mail:open', email),
  getMailSites: () => ipcRenderer.invoke('mailSites:get'),
  setMailSites: (list) => ipcRenderer.invoke('mailSites:set', list),

  skillsStatus: () => ipcRenderer.invoke('skills:status'),
  installSkills: () => ipcRenderer.invoke('skills:install'),

  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, info) => cb(info)),
});
