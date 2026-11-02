const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./core/paths');
const { readUsage } = require('./core/usage');
const { readMailSites, writeMailSites, mailUrlFor } = require('./core/mailSites');

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
    const url = mailUrlFor(email);
    if (!url) return { opened: false };
    await shell.openExternal(url);
    return { opened: true, url };
  });
  ipcMain.handle('mailSites:get', () => readMailSites());
  ipcMain.handle('mailSites:set', (_e, list) => writeMailSites(list));
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
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 720,
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
