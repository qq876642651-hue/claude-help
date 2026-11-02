const { app, BrowserWindow, WebContentsView, ipcMain, clipboard, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAIL_URL = 'https://onet.yulishomes.com/';
// ch-usage 技能把记录写到这里；应用只读不写
const DATA_DIR = path.join(os.homedir(), '.claude', 'claude-help');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

let win = null;
let mailView = null;
let mailShown = false;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function readUsage() {
  try {
    const text = fs.readFileSync(USAGE_FILE, 'utf8').replace(/^﻿/, '');
    const data = JSON.parse(text);
    return { accounts: Array.isArray(data.accounts) ? data.accounts : [] };
  } catch {
    return { accounts: [] };
  }
}

// 记录脚本是整体重写文件，监视目录比监视文件可靠
function watchUsage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let timer = null;
  fs.watch(DATA_DIR, (_event, name) => {
    if (name && name !== 'usage.json') return;
    clearTimeout(timer);
    timer = setTimeout(() => send('usage:changed', readUsage()), 300);
  });
}

function toBounds(b) {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  };
}

// 收信网站禁止 iframe 内嵌，所以用独立的 WebContentsView 叠在右侧分栏上
function ensureMailView() {
  if (mailView) return mailView;
  mailView = new WebContentsView({
    webPreferences: { partition: 'persist:mail', sandbox: true, contextIsolation: true },
  });
  mailView.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mailView.webContents.loadURL(MAIL_URL);
  return mailView;
}

function registerIpc() {
  ipcMain.handle('usage:get', () => readUsage());
  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('mail:show', (_e, bounds) => {
    const view = ensureMailView();
    if (!mailShown) {
      win.contentView.addChildView(view);
      mailShown = true;
    }
    view.setBounds(toBounds(bounds));
  });
  ipcMain.on('mail:bounds', (_e, bounds) => {
    if (mailView && mailShown) mailView.setBounds(toBounds(bounds));
  });
  ipcMain.handle('mail:hide', () => {
    if (mailView && mailShown) {
      win.contentView.removeChildView(mailView);
      mailShown = false;
    }
  });
  ipcMain.handle('mail:reload', () => mailView && mailView.webContents.reload());
  ipcMain.handle('mail:external', () => shell.openExternal(MAIL_URL));
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
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
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
    mailView = null;
    mailShown = false;
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
