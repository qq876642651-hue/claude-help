const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { desktopDataDirs } = require('./core/paths');

// 操作 Claude 桌面端时认控件用的名称（不分大小写的正则）。桌面端改了文字只改这里
const NAMES = {
  logout: ['^(退出登录|登出|注销|Log ?out|Sign ?out)$'],
  continue: ['^(使用(电子)?邮(箱|件)(地址)?继续|继续|Continue with email|Continue)$'],
  start: ['^(开始使用|Get started|Start)$'],
  email: ['邮箱', '邮件', 'e-?mail'],
  settings: ['设置', 'Settings'],
  // 账号菜单里的「用量」，点了打开设置的用量页
  usageItem: ['^(用量|Usage)$'],
  // 用量页上的进度条：当前会话就是 5 小时额度
  sessionLimit: ['^(当前会话|Current session)$'],
  weeklyLimit: ['^(本周|每周|This week|Current week|Weekly)$'],
  // 这些标题以下是按产品分的用量和额外用量，不算额度
  usageEnd: ['^本周各产品的用量$', '^用量额度$', 'by product', '^Extra usage$'],
  usageHeading: ['^(您的用量|你的用量|Your usage)$'],
  extraUsage: ['^(用量额度|Extra usage)$'],
};

const SCRIPT = path.join(__dirname, 'desktop-login.ps1');
const TIMEOUT_MS = 90000;

// 桌面端当前账号：config.json 里的 lastKnownAccountUuid。可能有多份数据目录，取最近改过的那份
function configFiles() {
  if (process.env.CLAUDE_HELP_DESKTOP_CONFIG) return [process.env.CLAUDE_HELP_DESKTOP_CONFIG];
  return desktopDataDirs().map((dir) => path.join(dir, 'config.json'));
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

// mode：same（已登录就不动，顺便读额度）| switch（已登录就先退出）。返回 { ok, action: none | filled, usage?, step, detail }
// usage 是脚本交出的原始结果，用 toPlan 转成 plan
// 测试时用 CLAUDE_HELP_LOGIN_RESULT 跳过桌面端：none | filled | fail:<步骤> | auto（same 返回 none，switch 返回 filled）；
// same 时的 usage 用 CLAUDE_HELP_DESKTOP_USAGE（原始结果的 JSON 或文件路径）
function run(email, mode) {
  const fake = process.env.CLAUDE_HELP_LOGIN_RESULT;
  if (fake) {
    const m = /^fail:(.+)$/.exec(fake);
    const action = fake === 'auto' ? (mode === 'same' ? 'none' : 'filled') : fake;
    const result = m ? { ok: false, step: m[1] } : { ok: true, action };
    if (result.action === 'none') result.usage = fakeUsage() || { ok: false, step: 'script', detail: 'no CLAUDE_HELP_DESKTOP_USAGE' };
    return new Promise((resolve) => setTimeout(() => resolve(result), 800));
  }
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, step: 'window', detail: 'Windows only' });
  return runScript({ CLAUDE_HELP_LOGIN_EMAIL: email, CLAUDE_HELP_LOGIN_MODE: mode });
}

// 只列出桌面端窗口里的控件，不点击；桌面端改版后用来查名称
function probe() {
  return runScript({ CLAUDE_HELP_LOGIN_MODE: 'probe' });
}

const WEEKDAYS = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const matches = (name, patterns) => patterns.some((p) => new RegExp(p, 'i').test(name));

// “17:10 重置”“星期三02:00 重置”“11月12日 02:00 重置”“Resets 5:10 PM”“Resets Wed 2:00 AM”：按本地时间取下一次出现的时刻
function parseReset(text, now) {
  const s = String(text).replace(/重置|\bresets?\b|\bat\b|\bon\b|,/gi, ' ').replace(/\s+/g, ' ').trim();
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(s);
  if (!m) return '';
  let hour = Number(m[1]);
  if (m[3]) hour = hour % 12 + (/pm/i.test(m[3]) ? 12 : 0);
  const d = new Date(now);
  d.setHours(hour, Number(m[2]), 0, 0);
  const before = s.slice(0, m.index).trim().toLowerCase();
  const date = /(\d{1,2})月(\d{1,2})日/.exec(before) || /([a-z]{3})[a-z]*\.? (\d{1,2})$/.exec(before);
  const wd = /(?:星期|周)([日天一二三四五六])/.exec(before) || /\b(sun|mon|tue|wed|thu|fri|sat)/.exec(before);
  if (date) {
    const month = /^\d+$/.test(date[1]) ? Number(date[1]) - 1 : MONTHS.indexOf(date[1]);
    if (month < 0) return '';
    d.setMonth(month, Number(date[2]));
    if (d.getTime() <= now) d.setFullYear(d.getFullYear() + 1);
  } else if (wd) {
    d.setDate(d.getDate() + (WEEKDAYS[wd[1]] - d.getDay() + 7) % 7);
    if (d.getTime() <= now) d.setDate(d.getDate() + 7);
  } else if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

// 把用量页的原始文字转成 get_usage 那样的 plan；认不出 5 小时额度就报错，免得记成错的数据
function parseUsage(raw, now = Date.now()) {
  const items = (raw && Array.isArray(raw.items) ? raw.items : []).filter((e) => e && e.name).sort((a, b) => a.top - b.top);
  const end = items.find((e) => e.type === 'Text' && matches(e.name, NAMES.usageEnd));
  const cutoff = end ? end.top : Infinity;
  const bars = items.filter((e) => e.type === 'ProgressBar' && e.top < cutoff && Number.isFinite(Number(e.value)));
  const resets = items.filter((e) => e.type === 'Text' && e.top < cutoff && /重置|reset/i.test(e.name) && /\d:\d\d/.test(e.name));
  const windows = bars.map((b) => {
    const label = matches(b.name, NAMES.sessionLimit) ? '5-hour limit' : matches(b.name, NAMES.weeklyLimit) ? 'Weekly · all models' : 'Weekly · ' + b.name;
    // 重置时间写在进度条上方那一行，取纵坐标最近的
    const near = resets.filter((r) => Math.abs(r.top - b.top) < 40).sort((x, y) => Math.abs(x.top - b.top) - Math.abs(y.top - b.top))[0];
    return { label, percentUsed: Math.round(Number(b.value)), resetsAt: near ? parseReset(near.name, now) : '' };
  });
  if (!windows.some((w) => w.label === '5-hour limit')) {
    throw new Error('用量页上没认出 5 小时额度：' + JSON.stringify(items.slice(0, 40).map((e) => e.name)));
  }
  const heading = items.find((e) => e.type === 'Text' && matches(e.name, NAMES.usageHeading));
  const planText = heading && items.find((e) => e !== heading && e.type === 'Text' && Math.abs(e.top - heading.top) < 8 && /\w/.test(e.name));
  const fromAccount = /\b(Free|Pro|Max(?: \d+x)?|Team|Enterprise)\s*$/i.exec(String(raw.account || ''));
  const extra = items.find((e) => e.type === 'Button' && matches(e.name, NAMES.extraUsage));
  return {
    status: 'ok',
    plan: planText ? planText.name : fromAccount ? fromAccount[1] : '',
    windows,
    extraUsage: { enabled: Boolean(extra && /^on$/i.test(extra.toggle)) },
  };
}

function fakeUsage() {
  const raw = process.env.CLAUDE_HELP_DESKTOP_USAGE;
  if (!raw) return null;
  try {
    return JSON.parse(fs.existsSync(raw) ? fs.readFileSync(raw, 'utf8') : raw);
  } catch {
    return { ok: false, step: 'script', detail: 'CLAUDE_HELP_DESKTOP_USAGE 不是 JSON' };
  }
}

// 只读额度（切换账号、登录完成后用）：返回 { ok, plan } 或 { ok: false, step, detail }
async function readUsage() {
  const fake = fakeUsage();
  const raw = fake || (process.platform === 'win32' ? await runScript({ CLAUDE_HELP_LOGIN_MODE: 'usage' }) : { ok: false, step: 'window', detail: 'Windows only' });
  return toPlan(raw);
}

// 脚本交出的原始结果 → { ok, plan }；同号收信时 run() 结果里的 usage 也走这里
function toPlan(raw) {
  if (!raw || !raw.ok) return { ok: false, step: (raw && raw.step) || 'script', detail: raw && raw.detail };
  try {
    return { ok: true, plan: parseUsage(raw) };
  } catch (e) {
    return { ok: false, step: 'parse', detail: e.message };
  }
}

module.exports = { NAMES, currentAccountId, run, probe, readUsage, toPlan, parseUsage, parseReset };
