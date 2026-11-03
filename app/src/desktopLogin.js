const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// 操作 Claude 桌面端登录页时认按钮用的名称（不分大小写的正则，整串匹配）。桌面端改了文字只改这里
const NAMES = {
  logout: ['^(退出登录|登出|注销|Log ?out|Sign ?out)$'],
  continue: ['^(使用(电子)?邮(箱|件)(地址)?继续|继续|Continue with email|Continue)$'],
  email: ['邮箱', '邮件', 'e-?mail'],
  settings: ['设置', 'Settings'],
};

const SCRIPT = path.join(__dirname, 'desktop-login.ps1');
const TIMEOUT_MS = 60000;

// 桌面端当前账号：config.json 里的 lastKnownAccountUuid。可能有多份数据目录，取最近改过的那份
function configFiles() {
  if (process.env.CLAUDE_HELP_DESKTOP_CONFIG) return [process.env.CLAUDE_HELP_DESKTOP_CONFIG];
  const files = [];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const dataDir = path.join(local, 'Claude-Data');
    let names = [];
    try { names = fs.readdirSync(dataDir); } catch {}
    for (const name of names) files.push(path.join(dataDir, name, 'config.json'));
  }
  if (process.env.APPDATA) files.push(path.join(process.env.APPDATA, 'Claude', 'config.json'));
  return files;
}

function currentAccountId() {
  let best = null;
  for (const file of configFiles()) {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (best && best.mtime >= mtime) continue;
      const id = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).lastKnownAccountUuid;
      if (id) best = { mtime, id: String(id) };
    } catch {}
  }
  return best ? best.id : null;
}

// 脚本走 -EncodedCommand，不落盘；注释行去掉，免得命令行太长
function runScript(env) {
  const source = fs.readFileSync(SCRIPT, 'utf8').split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  const encoded = Buffer.from(source, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...process.env, ...env, CLAUDE_HELP_LOGIN_NAMES: JSON.stringify(NAMES) },
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const line = String(stdout).trim().split(/\r?\n/).pop();
      try {
        return resolve(JSON.parse(line));
      } catch {}
      if (err && err.killed) return resolve({ ok: false, step: 'timeout' });
      resolve({ ok: false, step: 'script', detail: String(stderr || (err && err.message) || stdout).trim().slice(0, 500) });
    });
  });
}

// mode：same（已登录就不动）| switch（已登录就先退出）。返回 { ok, action: none | filled, step, detail }
// 测试时用 CLAUDE_HELP_LOGIN_RESULT 跳过桌面端：none | filled | fail:<步骤> | auto（same 返回 none，switch 返回 filled）
function run(email, mode) {
  const fake = process.env.CLAUDE_HELP_LOGIN_RESULT;
  if (fake) {
    const m = /^fail:(.+)$/.exec(fake);
    const action = fake === 'auto' ? (mode === 'same' ? 'none' : 'filled') : fake;
    const result = m ? { ok: false, step: m[1] } : { ok: true, action };
    return new Promise((resolve) => setTimeout(() => resolve(result), 800));
  }
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, step: 'window', detail: 'Windows only' });
  return runScript({ CLAUDE_HELP_LOGIN_EMAIL: email, CLAUDE_HELP_LOGIN_MODE: mode });
}

// 只列出桌面端窗口里的控件，不点击；桌面端改版后用来查名称
function probe() {
  return runScript({ CLAUDE_HELP_LOGIN_MODE: 'probe' });
}

module.exports = { NAMES, currentAccountId, run, probe };
