const fs = require('fs');
const { DATA_DIR, USAGE_FILE } = require('./paths');

function readUsage() {
  try {
    const data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8').replace(/^﻿/, ''));
    return { accounts: Array.isArray(data.accounts) ? data.accounts : [] };
  } catch {
    return { accounts: [] };
  }
}

// plan 是桌面端 get_usage 返回的 plan 对象；每个账号只保留最新一条
// accountId 是桌面端的账号 ID（用来把会话对应到邮箱），没传时沿用旧记录里的
function recordUsage(email, plan, accountId) {
  email = String(email || '').trim();
  if (!email.includes('@')) throw new Error('需要账号邮箱');
  if (!plan || plan.status !== 'ok') throw new Error(`plan.status 是 ${plan && plan.status}，没有记录`);

  const old = readUsage().accounts.find((a) => String(a.email).toLowerCase() === email.toLowerCase());
  const record = {
    email,
    accountId: accountId || (old && old.accountId) || undefined,
    plan: String(plan.plan || ''),
    windows: (plan.windows || []).map((w) => ({
      label: String(w.label),
      percentUsed: Number(w.percentUsed) || 0,
      resetsAt: String(w.resetsAt || ''),
    })),
    extraUsageEnabled: Boolean(plan.extraUsage && plan.extraUsage.enabled),
    recordedAt: new Date().toISOString(),
  };

  const accounts = putRecord(record);
  return { record, count: accounts.length };
}

function writeAccounts(accounts) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify({ accounts }, null, 2));
  return accounts;
}

// 同一邮箱（不分大小写）只留一条
function putRecord(record) {
  const key = String(record.email).toLowerCase();
  const accounts = readUsage().accounts.filter((a) => String(a.email).toLowerCase() !== key);
  accounts.push(record);
  return writeAccounts(accounts);
}

// 只删这个账号的额度记录，返回被删的那条，供撤销时原样放回
function removeUsage(email) {
  const key = String(email || '').trim().toLowerCase();
  const accounts = readUsage().accounts;
  const removed = accounts.find((a) => String(a.email).toLowerCase() === key);
  if (!removed) throw new Error(`没有 ${email} 的记录`);
  const kept = writeAccounts(accounts.filter((a) => a !== removed));
  return { removed, count: kept.length };
}

// 手动添加账号：额度先空着（recordedAt 为 null），以后记录额度时整条覆盖
function addAccount(email) {
  email = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱格式不对');
  const key = email.toLowerCase();
  if (readUsage().accounts.some((a) => String(a.email).toLowerCase() === key)) throw new Error(`已有 ${email}`);
  const record = {
    email,
    plan: '',
    windows: [],
    extraUsageEnabled: false,
    recordedAt: null,
    addedAt: new Date().toISOString(),
  };
  return { record, count: putRecord(record).length };
}

// 给记录补上桌面端账号 ID（手动添加的账号没有），原地改，不动顺序和其他字段
function setAccountId(email, accountId) {
  const key = String(email || '').trim().toLowerCase();
  const accounts = readUsage().accounts;
  const record = accounts.find((a) => String(a.email).toLowerCase() === key);
  if (!record) throw new Error(`没有 ${email} 的记录`);
  record.accountId = String(accountId);
  writeAccounts(accounts);
  return { record };
}

function restoreUsage(record) {
  if (!record || !String(record.email || '').includes('@') || !Array.isArray(record.windows)) throw new Error('记录格式不对');
  return { count: putRecord(record).length };
}

module.exports = { readUsage, recordUsage, addAccount, removeUsage, restoreUsage, setAccountId };
