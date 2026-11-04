const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeHelp', {
  // 界面语言（zh | en），脚本一加载就要用，所以同步取；切换语言后页面重新加载
  lang: ipcRenderer.sendSync('app:lang'),
  getUsage: () => ipcRenderer.invoke('usage:get'),
  onUsage: (cb) => ipcRenderer.on('usage:changed', (_e, data) => cb(data)),
  addAccount: (email) => ipcRenderer.invoke('usage:add', email),
  removeUsage: (email) => ipcRenderer.invoke('usage:remove', email),
  restoreUsage: (record) => ipcRenderer.invoke('usage:restore', record),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),

  getSessions: () => ipcRenderer.invoke('sessions:get'),
  copyResume: (id) => ipcRenderer.invoke('sessions:copyResume', id),
  trashSession: (id) => ipcRenderer.invoke('sessions:trash', id),
  version: () => ipcRenderer.invoke('app:version'),

  getMemory: () => ipcRenderer.invoke('memory:list'),
  readMemory: (key, file) => ipcRenderer.invoke('memory:read', key, file),
  writeMemory: (key, file, text, mtime) => ipcRenderer.invoke('memory:write', key, file, text, mtime),
  revealMemory: (key, file) => ipcRenderer.invoke('memory:reveal', key, file),
  trashMemory: (key, file) => ipcRenderer.invoke('memory:trash', key, file),
  exportMemory: (keys) => ipcRenderer.invoke('memory:export', keys),
  pickMemoryImport: () => ipcRenderer.invoke('memory:importPick'),
  planMemoryImport: (targets) => ipcRenderer.invoke('memory:importPlan', targets),
  applyMemoryImport: (targets, overwrite) => ipcRenderer.invoke('memory:importApply', targets, overwrite),

  openMail: (email, answer) => ipcRenderer.invoke('mail:open', email, answer),
  openSite: (url) => ipcRenderer.invoke('mail:openSite', url),
  getMailSites: () => ipcRenderer.invoke('mailSites:get'),
  addMailSite: (domain, url) => ipcRenderer.invoke('mailSites:add', domain, url),
  updateMailSite: (oldDomain, domain, url) => ipcRenderer.invoke('mailSites:update', oldDomain, domain, url),
  removeMailSite: (domain) => ipcRenderer.invoke('mailSites:remove', domain),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  onSettings: (cb) => ipcRenderer.on('settings:changed', (_e, data) => cb(data)),
  onCloseRequest: (cb) => ipcRenderer.on('app:closeRequest', (_e, req) => cb(req)),
  answerClose: (answer) => ipcRenderer.send('app:closeAnswer', answer),

  dataDir: () => ipcRenderer.invoke('dataDir:get'),
  openDataDir: () => ipcRenderer.invoke('dataDir:open'),

  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, info) => cb(info)),
});
