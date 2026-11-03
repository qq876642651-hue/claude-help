const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, clipboard, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./core/paths');
const { readUsage, addAccount, removeUsage, restoreUsage } = require('./core/usage');
const mailSites = require('./core/mailSites');
const sessions = require('./core/sessions');
const settings = require('./settings');
const I18n = require('./i18n');

const ICON = path.join(__dirname, 'assets', 'icon.png');

let win = null;
let tray = null;
let quitting = false; // 退出过程中不再拦截关闭
let asking = false; // 关闭弹窗正在显示
let trayHinted = false; // 本次运行是否已提示过“仍在后台运行”

// 界面语言：按设置（跟随系统 / 中文 / English）算出 zh 或 en
function t(key, vars) {
  return I18n.create(I18n.resolve(settings.get().language, app.getLocale()))(key, vars);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function trayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.open'), click: showWindow },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => app.quit() },
  ]));
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(ICON);
  tray.setToolTip('Claude Help');
  trayMenu();
  tray.on('click', showWindow);
}

function hideToTray() {
  ensureTray();
  win.hide();
  if (!trayHinted) {
    trayHinted = true;
    tray.displayBalloon({ iconType: 'info', title: t('tray.hintTitle'), content: t('tray.hintText') });
  }
}

const ACTIONS = ['tray', 'quit', 'cancel'];
let closeRequestId = 0;

// 返回 { action: 'tray' | 'quit' | 'cancel', remember }
// 先用页面里的对话框问：页面显示后先回 { id, shown: true }，选完再回 { id, action, remember }
// 页面 5 秒内没确认显示（没加载完或卡住）就改用原生弹窗；显示之后等多久都行
// CLAUDE_HELP_CLOSE_ANSWER 只用于测试：tray、quit、cancel，加 -remember 表示勾选“以后不再询问”
async function askCloseAction() {
  const preset = process.env.CLAUDE_HELP_CLOSE_ANSWER;
  if (preset) {
    const [action, remember] = preset.split('-');
    return { action, remember: remember === 'remember' };
  }
  if (win.isMinimized()) win.restore();
  const id = ++closeRequestId;
  const answer = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener('app:closeAnswer', onAnswer);
      resolve(null);
    }, 5000);
    function onAnswer(_e, a) {
      if (!a || a.id !== id) return;
      clearTimeout(timer);
      if (a.shown) return;
      ipcMain.removeListener('app:closeAnswer', onAnswer);
      resolve(a);
    }
    ipcMain.on('app:closeAnswer', onAnswer);
    send('app:closeRequest', { id });
  });
  if (!answer) return nativeAsk();
  return { action: ACTIONS.includes(answer.action) ? answer.action : 'cancel', remember: Boolean(answer.remember) };
}

async function nativeAsk() {
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: 'question',
    title: t('close.title'),
    message: t('close.message'),
    detail: t('close.sub'),
    buttons: [t('close.tray'), t('close.quit'), t('common.cancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    checkboxLabel: t('close.remember'),
  });
  return { action: ACTIONS[response], remember: checkboxChecked };
}

async function onClose() {
  let action = settings.get().closeAction;
  if (action === 'ask') {
    if (asking) return;
    asking = true;
    try {
      const answer = await askCloseAction();
      action = answer.action;
      if (answer.remember && action !== 'cancel') send('settings:changed', settings.set('closeAction', action));
    } finally {
      asking = false;
    }
  }
  if (action === 'tray') hideToTray();
  else if (action === 'quit') app.quit();
}

// 会话按账号分组，能对上 usage.json 里 accountId 的组带上邮箱
function sessionGroups() {
  const accounts = readUsage().accounts;
  return sessions.listSessions().map((g) => {
    const acc = accounts.find((a) => a.accountId === g.accountId);
    return { ...g, email: acc ? acc.email : null };
  });
}

// 只认完整的会话 ID，路径由这里自己找，不用渲染进程传来的
function exactSession(id) {
  const hit = sessions.findSession(id);
  if (!hit || hit.data.sessionId !== id) throw new Error(t('error.sessionNotFound'));
  return hit;
}

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
  ipcMain.handle('usage:add', (_e, email) => addAccount(email));
  ipcMain.handle('usage:remove', (_e, email) => removeUsage(email));
  ipcMain.handle('usage:restore', (_e, record) => restoreUsage(record));
  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));

  ipcMain.handle('sessions:get', () => sessionGroups());
  ipcMain.handle('sessions:copyResume', (_e, id) => {
    const s = sessions.toSession(exactSession(id).data);
    if (!s.transcript) throw new Error(t('error.noTranscript'));
    clipboard.writeText(sessions.resumePrompt(s));
    return { cwd: s.cwd };
  });
  // 移到回收站，不做永久删除
  ipcMain.handle('sessions:trash', async (_e, id) => {
    exactSession(id);
    const { session, files } = sessions.sessionFiles(id);
    for (const f of files) await shell.trashItem(f);
    return { title: session.title, count: files.length };
  });
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('mail:open', async (_e, email) => {
    clipboard.writeText(String(email));
    const url = mailSites.mailUrlFor(email);
    if (!url) return { opened: false, domain: String(email).split('@')[1] || '' };
    await shell.openExternal(url);
    return { opened: true, url };
  });
  ipcMain.handle('mail:openSite', (_e, url) => {
    if (!mailSites.isWebUrl(url)) throw new Error(t('error.webUrlOnly'));
    return shell.openExternal(url);
  });
  ipcMain.handle('mailSites:get', () => mailSites.readMailSites());
  ipcMain.handle('mailSites:add', (_e, domain, url) => mailSites.addSite(domain, url));
  ipcMain.handle('mailSites:update', (_e, oldDomain, domain, url) => mailSites.updateSite(oldDomain, domain, url));
  ipcMain.handle('mailSites:remove', (_e, domain) => mailSites.removeSite(domain));
  ipcMain.handle('mailSites:reset', () => mailSites.resetSites());

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, key, value) => {
    const next = settings.set(key, value);
    // 换语言后更新托盘菜单并重新加载页面；页面里的 location.reload() 会被 will-navigate 拦下，所以由这里来做
    if (key === 'language') {
      trayMenu();
      setImmediate(() => { if (win && !win.isDestroyed()) win.webContents.reload(); });
    }
    return next;
  });
  ipcMain.on('app:lang', (e) => {
    e.returnValue = I18n.resolve(settings.get().language, app.getLocale());
  });

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
  // 静默安装（不弹安装向导、沿用原安装位置），装完自动重启；安装期间关闭窗口不再询问
  ipcMain.handle('update:install', () => {
    if (!app.isPackaged) throw new Error(t('error.devInstall'));
    quitting = true;
    autoUpdater.quitAndInstall(true, true);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: 'Claude Help',
    icon: ICON,
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
  // 点 × 时按设置询问、回到后台或退出；退出过程中（托盘「退出」、自动更新安装）照常关闭
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    onClose().catch(() => {});
  });
  win.on('closed', () => {
    win = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });
  app.whenReady().then(() => {
    registerIpc();
    setupUpdater();
    watchUsage();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
