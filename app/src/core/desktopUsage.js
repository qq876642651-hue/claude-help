const fs = require('fs');
const path = require('path');
const { desktopDataDirs } = require('./paths');
const { sessionRoots, safeReaddir } = require('./sessions');
const { readUsage, writeAccounts } = require('./usage');

// 桌面端每 15 分钟给当前账号记一条样本：plan-usage-history.json 的 { version, samples: [{ t, org, u: { fh, sd } }] }
// fh 是 5 小时额度用掉的百分比，sd 是每周（全部模型）的；u 为空表示那次没读到。内部格式没有公开，读不到就当没有
const HISTORY = 'plan-usage-history.json';
const FIVE_HOURS = 5 * 3600000;
const WEEK = 7 * 86400000;
const FIVE_HOUR_LABEL = '5-hour limit';
const WEEKLY_LABEL = 'Weekly · all models';

function historyFiles() {
  if (process.env.CLAUDE_HELP_USAGE_HISTORY) return [process.env.CLAUDE_HELP_USAGE_HISTORY];
  return desktopDataDirs().map((dir) => path.join(dir, HISTORY));
}

function readSamples() {
  const samples = [];
  for (const file of historyFiles()) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
      for (const s of Array.isArray(data.samples) ? data.samples : []) {
        if (s && s.org && Number.isFinite(s.t) && s.u && Number.isFinite(s.u.fh)) samples.push(s);
      }
    } catch {}
  }
  return samples.sort((a, b) => a.t - b.t);
}

// 会话目录是 <账号ID>\<组织ID>\，由此知道样本里的组织属于哪个账号
function orgAccounts() {
  const map = new Map();
  for (const root of sessionRoots()) {
    for (const accountId of safeReaddir(root)) {
      for (const org of safeReaddir(path.join(root, accountId))) map.set(org, accountId);
    }
  }
  return map;
}

const time = (iso) => (iso ? new Date(iso).getTime() : NaN);

// 每周额度按固定时刻重置：已经过去的就整周往后推
function nextWeekly(old, at) {
  let t = time(old && old.resetsAt);
  if (!Number.isFinite(t)) return '';
  while (t <= at) t += WEEK;
  return new Date(t).toISOString();
}

// 5 小时额度从重置后的第一次使用开始计时：旧的重置时间还没到就沿用；
// 过了就在之后的样本里找最近一轮的开始（用量从 0 变大、比上一条小、或距上一轮开始满 5 小时），
// 按那时开始推算（样本 15 分钟一条，所以是估计值）
function nextFiveHour(old, samples, latest) {
  const oldReset = time(old && old.resetsAt);
  if (Number.isFinite(oldReset) && oldReset > latest.t) return { resetsAt: old.resetsAt, estimated: Boolean(old.resetsAtEstimated) };
  if (!latest.u.fh) return { resetsAt: '', estimated: false };
  const since = Number.isFinite(oldReset) ? oldReset : -Infinity;
  let start = null;
  let prev = null;
  for (const s of samples) {
    if (s.t <= since) continue;
    if (s.u.fh > 0 && (start === null || !prev || prev.u.fh === 0 || s.u.fh < prev.u.fh || s.t >= start + FIVE_HOURS)) start = s.t;
    prev = s;
  }
  const reset = start === null ? NaN : start + FIVE_HOURS;
  if (!(reset > latest.t)) return { resetsAt: '', estimated: false };
  return { resetsAt: new Date(reset).toISOString(), estimated: true };
}

function updated(acc, samples, latest) {
  const windows = acc.windows.length ? acc.windows.map((w) => ({ ...w })) : [
    { label: FIVE_HOUR_LABEL, percentUsed: 0, resetsAt: '' },
    { label: WEEKLY_LABEL, percentUsed: 0, resetsAt: '' },
  ];
  for (const w of windows) {
    if (/5-hour/i.test(w.label)) {
      const r = nextFiveHour(w, samples, latest);
      w.percentUsed = latest.u.fh;
      w.resetsAt = r.resetsAt;
      if (r.estimated) w.resetsAtEstimated = true;
      else delete w.resetsAtEstimated;
    } else if (/^Weekly.*all models/i.test(w.label) && Number.isFinite(latest.u.sd)) {
      w.percentUsed = latest.u.sd;
      w.resetsAt = nextWeekly(w, latest.t);
    }
  }
  return { ...acc, windows, recordedAt: new Date(latest.t).toISOString(), source: 'desktop' };
}

// 用桌面端的样本更新各账号的百分比：只在样本比现有记录新时更新，免得盖掉从界面读到的完整额度
// 返回更新了几个账号；没有变化时不写文件
function syncDesktopUsage() {
  const samples = readSamples();
  if (!samples.length) return 0;
  const orgs = orgAccounts();
  const byAccount = new Map();
  for (const s of samples) {
    const id = orgs.get(s.org);
    if (!id) continue;
    if (!byAccount.has(id)) byAccount.set(id, []);
    byAccount.get(id).push(s);
  }
  let changed = 0;
  const accounts = readUsage().accounts.map((acc) => {
    const own = acc.accountId && byAccount.get(acc.accountId);
    if (!own) return acc;
    const latest = own[own.length - 1];
    if (latest.t <= (time(acc.recordedAt) || 0)) return acc;
    changed++;
    return updated(acc, own, latest);
  });
  if (changed) writeAccounts(accounts);
  return changed;
}

module.exports = { HISTORY, historyFiles, syncDesktopUsage };
