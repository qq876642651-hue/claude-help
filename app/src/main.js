const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./core/paths');
const { readUsage } = require('./core/usage');
const mailSites = require('./core/mailSites');

let win = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// CLI 是整体重写 usage.json，监视目录比监视文件可靠
function watchUsage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let timer = null;
  fs.watch(DATA_DIR, (_event, name) => {
    if (name && name !== 'usage.json') return;
    clearTimeout(timer);
    timer = setTimeout(() => send('usage:changed', readUsage()), 300);
  });
}

function registerIpc() {
  ipcMain.handle('usage:get', () => readUsage());
  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('mail:open', async (_e, email) => {
    clipboard.writeText(String(email));
    const url = mailSites.mailUrlFor(email);
    if (!url) return { opened: false, domain: String(email).split('@')[1] || '' };
    await shell.openExternal(url);
    return { opened: true, url };
  });
  ipcMain.handle('mail:openSite', (_e, url) => {
    if (!mailSites.isWebUrl(url)) throw new Error('只能打开 http(s) 网址');
    return shell.openExternal(url);
  });
  ipcMain.handle('mailSites:get', () => mailSites.readMailSites());
  ipcMain.handle('mailSites:add', (_e, domain, url) => mailSites.addSite(domain, url));
  ipcMain.handle('mailSites:update', (_e, oldDomain, domain, url) => mailSites.updateSite(oldDomain, domain, url));
  ipcMain.handle('mailSites:remove', (_e, domain) => mailSites.removeSite(domain));
  ipcMain.handle('mailSites:reset', () => mailSites.resetSites());

  ipcMain.handle('dataDir:get', () => DATA_DIR);
  ipcMain.handle('dataDir:open', async () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const err = await shell.openPath(DATA_DIR);
    if (err) throw new Error(err);
  });
}

function setupUpdater() {
  autoUpdater.on('checking-for-update', () => send('update:status', { status: 'checking' }));
  autoUpdater.on('update-available', (i) => send('update:status', { status: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => send('update:status', { status: 'latest' }));
  autoUpdater.on('download-progress', (p) => send('update:status', { status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('update:status', { status: 'downloaded', version: i.version }));
  autoUpdater.on('error', (e) => send('update:status', { status: 'error', message: String((e && e.message) || e) }));

  ipcMain.handle('update:check', () => {
    if (!app.isPackaged) return send('update:status', { status: 'dev' });
    return autoUpdater.checkForUpdates().then(() => {}, () => {});
  });
  // 静默安装（不弹安装向导、沿用原安装位置），装完自动重启
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(true, true));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: 'Claude Help',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
  });
  win.on('closed', () => {
    win = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    registerIpc();
    setupUpdater();
    watchUsage();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
