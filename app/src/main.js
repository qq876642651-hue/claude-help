const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ch-usage 技能把记录写到这里；应用只读不写
const DATA_DIR = path.join(os.homedir(), '.claude', 'claude-help');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const MAIL_SITES_FILE = path.join(DATA_DIR, 'mail-sites.json');
const SKILLS_TARGET = path.join(os.homedir(), '.claude', 'skills');
const SKILLS_MANIFEST = path.join(DATA_DIR, 'skills-installed.json');

// 预置：onet.yulishomes.com 支持的波兰邮箱后缀（取自该站 app.js 的 providerDomains）
const DEFAULT_MAIL_URL = 'https://onet.yulishomes.com/';
const DEFAULT_MAIL_DOMAINS = [
  'onet.pl', 'op.pl', 'onet.eu', 'poczta.onet.eu', 'vp.pl', 'autograf.pl', 'buziaczek.pl', 'amorki.pl',
  'wp.pl', 'o2.pl', 'tlen.pl', 'go2.pl',
  'interia.pl', 'interia.eu', 'poczta.fm', 'int.pl', '2gb.pl',
];

let win = null;

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

// ---- 收信地址：邮箱后缀 → 网址，用系统默认浏览器打开 ----

function isWebUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeSites(list) {
  if (!Array.isArray(list)) return null;
  return list
    .map((s) => ({ domain: String(s.domain || '').trim().toLowerCase().replace(/^@/, ''), url: String(s.url || '').trim() }))
    .filter((s) => s.domain && isWebUrl(s.url));
}

function readMailSites() {
  try {
    const sites = normalizeSites(JSON.parse(fs.readFileSync(MAIL_SITES_FILE, 'utf8')).sites);
    if (sites) return sites;
  } catch {}
  return DEFAULT_MAIL_DOMAINS.map((domain) => ({ domain, url: DEFAULT_MAIL_URL }));
}

function writeMailSites(list) {
  const sites = normalizeSites(list);
  if (!sites || sites.length !== list.length) throw new Error('每一行都要填后缀，网址要以 http:// 或 https:// 开头');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MAIL_SITES_FILE, JSON.stringify({ sites }, null, 2));
  return sites;
}

function mailUrlFor(email) {
  const domain = String(email).split('@')[1];
  if (!domain) return null;
  const site = readMailSites().find((s) => s.domain === domain.toLowerCase());
  return site ? site.url : null;
}

// ---- 技能安装：软件自带 skills/，复制到用户级 ~/.claude/skills/ ----

function skillsSource() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'skills')
    : path.join(__dirname, '..', '..', 'skills');
}

function bundledSkills() {
  try {
    return fs.readdirSync(skillsSource(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsSource(), d.name, 'SKILL.md')))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function skillsStatus() {
  let installed = null;
  try {
    installed = JSON.parse(fs.readFileSync(SKILLS_MANIFEST, 'utf8'));
  } catch {}
  return {
    bundledVersion: app.getVersion(),
    installedVersion: installed && installed.version,
    skills: bundledSkills(),
    target: SKILLS_TARGET,
  };
}

// 只替换本软件自带的那几个技能文件夹，不碰用户的其他技能
function installSkills() {
  const names = bundledSkills();
  if (!names.length) throw new Error('软件里没有找到技能文件');
  fs.mkdirSync(SKILLS_TARGET, { recursive: true });
  for (const name of names) {
    const dest = path.join(SKILLS_TARGET, name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(path.join(skillsSource(), name), dest, { recursive: true });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SKILLS_MANIFEST, JSON.stringify({
    version: app.getVersion(),
    skills: names,
    installedAt: new Date().toISOString(),
  }, null, 2));
  return skillsStatus();
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

  ipcMain.handle('skills:status', () => skillsStatus());
  ipcMain.handle('skills:install', () => installSkills());
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
