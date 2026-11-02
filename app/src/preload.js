const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeHelp', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  onUsage: (cb) => ipcRenderer.on('usage:changed', (_e, data) => cb(data)),
  removeUsage: (email) => ipcRenderer.invoke('usage:remove', email),
  restoreUsage: (record) => ipcRenderer.invoke('usage:restore', record),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),

  getSessions: () => ipcRenderer.invoke('sessions:get'),
  copyResume: (id) => ipcRenderer.invoke('sessions:copyResume', id),
  trashSession: (id) => ipcRenderer.invoke('sessions:trash', id),
  version: () => ipcRenderer.invoke('app:version'),

  openMail: (email) => ipcRenderer.invoke('mail:open', email),
  openSite: (url) => ipcRenderer.invoke('mail:openSite', url),
  getMailSites: () => ipcRenderer.invoke('mailSites:get'),
  addMailSite: (domain, url) => ipcRenderer.invoke('mailSites:add', domain, url),
  updateMailSite: (oldDomain, domain, url) => ipcRenderer.invoke('mailSites:update', oldDomain, domain, url),
  removeMailSite: (domain) => ipcRenderer.invoke('mailSites:remove', domain),
  resetMailSites: () => ipcRenderer.invoke('mailSites:reset'),

  dataDir: () => ipcRenderer.invoke('dataDir:get'),
  openDataDir: () => ipcRenderer.invoke('dataDir:open'),

  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, info) => cb(info)),
});
