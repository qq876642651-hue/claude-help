const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, clipboard, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./core/paths');
const { readUsage, recordUsage, addAccount, removeUsage, restoreUsage, setAccountId, findByAccountId } = require('./core/usage');
const { syncDesktopUsage, historyFiles } = require('./core/desktopUsage');
const mailSites = require('./core/mailSites');
const sessions = require('./core/sessions');
const memory = require('./core/memory');
const desktopLogin = require('./desktopLogin');
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

const sameEmail = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// 桌面端当前登录的是不是这个账号：accountId 对得上才算 same。
// 卡片还没有 accountId、桌面端当前的号也没记在别的卡片上时，可能就是这个号，返回 ask 让用户确认；
// 不问的话只能切换，而重新登录同一个号时 lastKnownAccountUuid 不变，以后还是认不出来
function loginMode(email) {
  const current = desktopLogin.currentAccountId();
  const accounts = readUsage().accounts;
  const acc = accounts.find((a) => sameEmail(a.email, email));
  if (current && acc && acc.accountId === current) return 'same';
  if (current && acc && !acc.accountId && !accounts.some((a) => a.accountId === current)) return 'ask';
  return 'switch';
}

// 把脚本读到的用量页解析成 plan，记到这个邮箱上；返回 { ok, email?, step?, detail? }
function recordDesktopUsage(email, raw, accountId) {
  const r = desktopLogin.toPlan(raw);
  if (!r.ok) return { ok: false, step: r.step, detail: r.detail };
  try {
    recordUsage(email, r.plan, accountId);
    return { ok: true, email };
  } catch (e) {
    return { ok: false, step: 'parse', detail: e.message };
  }
}

// 为某个邮箱填好登录页后，10 分钟内桌面端换了账号 ID 就算登录完成：
// 换成没记录过的 ID 就补进这个邮箱的记录；ID 属于这个邮箱时，再从桌面端读一次额度
let idWatch = null;
function watchNewAccountId(email) {
  if (idWatch) clearInterval(idWatch.timer);
  const before = desktopLogin.currentAccountId();
  const until = Date.now() + 10 * 60000;
  const stop = () => { clearInterval(timer); idWatch = null; };
  const timer = setInterval(async () => {
    if (Date.now() > until) return stop();
    const id = desktopLogin.currentAccountId();
    if (!id || id === before) return;
    stop();
    const accounts = readUsage().accounts;
    const acc = accounts.find((a) => sameEmail(a.email, email));
    if (!acc) return;
    if (!acc.accountId && !accounts.some((a) => a.accountId === id)) {
      try {
        setAccountId(email, id);
      } catch {}
    }
    if ((findByAccountId(id) || {}).email !== acc.email || mailBusy) return;
    // 刚登录完页面还在加载，脚本会等账号按钮出现；这期间不让别的收信同时操作桌面端
    mailBusy = true;
    try {
      const r = await desktopLogin.readUsage();
      if (r.ok) recordUsage(acc.email, r.plan, id);
    } catch {} finally {
      mailBusy = false;
    }
  }, 5000);
  idWatch = { timer };
}

let mailBusy = false;
let importBundle = null; // 「记忆」页正在导入的文件

// 「收信」：桌面端是这个号就只读额度；不是这个号（或没登录）就先读旧账号的额度，再退出登录、填邮箱、点继续，然后在浏览器打开收信页
// answer 是用户对“桌面端当前登录的是这个号吗”的回答（same | switch）；需要问又没有回答时返回 { ask: true }
// 测试时用 CLAUDE_HELP_SAME_ANSWER（same | switch）代替回答
async function openMail(email, answer) {
  email = String(email);
  let mode = loginMode(email);
  if (mode === 'ask') {
    mode = answer || process.env.CLAUDE_HELP_SAME_ANSWER;
    if (mode !== 'same' && mode !== 'switch') return { ask: true };
    if (mode === 'same') setAccountId(email, desktopLogin.currentAccountId());
  }
  // 要退出的号对得上某张卡才读额度：页面上只有显示名，对不上就不知道该记到哪个邮箱
  const current = desktopLogin.currentAccountId();
  const leaving = mode === 'switch' ? findByAccountId(current) : null;
  clipboard.writeText(email);
  const { usage: rawUsage, ...login } = await desktopLogin.run(email, mode, Boolean(leaving));
  if (login.ok && login.action === 'filled') watchNewAccountId(email);
  const owner = login.ok && login.action === 'none' ? email : leaving && leaving.email;
  const usage = rawUsage && owner ? recordDesktopUsage(owner, rawUsage, current) : null;
  // 桌面端被切到了前面；登录出错时把软件叫回来，好让用户看到提示
  if (!login.ok) showWindow();
  // 同号不用登录，也就不用收信：记完额度回到软件
  if (login.ok && login.action === 'none') {
    showWindow();
    return { opened: false, login, usage };
  }
  const url = mailSites.mailUrlFor(email);
  if (!url) {
    showWindow();
    return { opened: false, domain: email.split('@')[1] || '', login, usage };
  }
  await shell.openExternal(url);
  return { opened: true, url, login, usage };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// usage.json 是整体重写的，监视目录比监视文件可靠
function watchUsage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let timer = null;
  fs.watch(DATA_DIR, (_event, name) => {
    if (name && name !== 'usage.json') return;
    clearTimeout(timer);
    timer = setTimeout(() => send('usage:changed', readUsage()), 300);
  });
}

// 桌面端每 15 分钟往 plan-usage-history.json 记一条样本：变化时同步一次，另外每 5 分钟兜底一次（目录可能后来才出现）
function watchDesktopUsage() {
  const sync = () => {
    try {
      syncDesktopUsage();
    } catch {}
  };
  sync();
  let timer = null;
  for (const file of historyFiles()) {
    try {
      fs.watch(path.dirname(file), (_event, name) => {
        if (name && name !== path.basename(file)) return;
        clearTimeout(timer);
        timer = setTimeout(sync, 1000);
      });
    } catch {}
  }
  setInterval(sync, 5 * 60000);
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

  // 记忆：路径都由 core/memory 按 key + 文件名算，不用渲染进程传来的路径
  ipcMain.handle('memory:list', () => memory.listMemory());
  ipcMain.handle('memory:read', (_e, key, file) => memory.readEntry(key, file));
  ipcMain.handle('memory:write', (_e, key, file, text, mtime) => memory.writeEntry(key, file, text, mtime));
  ipcMain.handle('memory:reveal', async (_e, key, file) => {
    const p = memory.entryPath(key, file);
    if (fs.existsSync(p)) return shell.showItemInFolder(p);
    const err = await shell.openPath(path.dirname(p));
    if (err) throw new Error(err);
  });
  // 移到回收站，再去掉索引里对应的行；索引本身不让删
  ipcMain.handle('memory:trash', async (_e, key, file) => {
    if (file === memory.INDEX) throw new Error(t('error.memoryIndex'));
    const p = memory.entryPath(key, file);
    if (!fs.existsSync(p)) throw new Error(t('error.memoryGone'));
    await shell.trashItem(p);
    memory.removeFromIndex(key, file);
  });
  // CLAUDE_HELP_DIALOG_FILE 只用于测试：导出、导入直接用这个路径，不弹系统文件框
  ipcMain.handle('memory:export', async (_e, keys) => {
    const bundle = memory.exportMemory(keys);
    if (!bundle.groups.length) throw new Error(t('error.memoryEmpty'));
    const { canceled, filePath } = process.env.CLAUDE_HELP_DIALOG_FILE
      ? { filePath: process.env.CLAUDE_HELP_DIALOG_FILE }
      : await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('documents'), `claude-memory-${new Date().toISOString().slice(0, 10)}.json`),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
    return { path: filePath, groups: bundle.groups.length };
  });
  // 选好的导入文件留在主进程，页面只拿预览，确认时再按这份写入
  ipcMain.handle('memory:importPick', async () => {
    const { canceled, filePaths } = process.env.CLAUDE_HELP_DIALOG_FILE
      ? { filePaths: [process.env.CLAUDE_HELP_DIALOG_FILE] }
      : await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
    if (canceled || !filePaths.length) return null;
    importBundle = memory.parseBundle(fs.readFileSync(filePaths[0], 'utf8'));
    return {
      file: path.basename(filePaths[0]),
      exportedAt: importBundle.exportedAt || null,
      projects: memory.localProjects(),
      plan: memory.planImport(importBundle),
    };
  });
  ipcMain.handle('memory:importPlan', (_e, targets) => {
    if (!importBundle) throw new Error(t('error.memoryNoImport'));
    return memory.planImport(importBundle, targets || []);
  });
  ipcMain.handle('memory:importApply', (_e, targets, overwrite) => {
    if (!importBundle) throw new Error(t('error.memoryNoImport'));
    const r = memory.applyImport(importBundle, targets || [], { overwrite: Boolean(overwrite) });
    importBundle = null;
    return r;
  });

  ipcMain.handle('mail:open', async (_e, email, answer) => {
    if (mailBusy) throw new Error(t('error.mailBusy'));
    mailBusy = true;
    try {
      return await openMail(email, answer);
    } finally {
      mailBusy = false;
    }
  });
  ipcMain.handle('mail:openSite', (_e, url) => {
    if (!mailSites.isWebUrl(url)) throw new Error(t('error.webUrlOnly'));
    return shell.openExternal(url);
  });
  ipcMain.handle('mailSites:get', () => mailSites.readMailSites());
  ipcMain.handle('mailSites:add', (_e, domain, url) => mailSites.addSite(domain, url));
  ipcMain.handle('mailSites:update', (_e, oldDomain, domain, url) => mailSites.updateSite(oldDomain, domain, url));
  ipcMain.handle('mailSites:remove', (_e, domain) => mailSites.removeSite(domain));

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
    watchDesktopUsage();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
