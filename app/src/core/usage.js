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
function recordUsage(email, plan) {
  email = String(email || '').trim();
  if (!email.includes('@')) throw new Error('需要账号邮箱');
  if (!plan || plan.status !== 'ok') throw new Error(`plan.status 是 ${plan && plan.status}，没有记录`);

  const record = {
    email,
    plan: String(plan.plan || ''),
    windows: (plan.windows || []).map((w) => ({
      label: String(w.label),
      percentUsed: Number(w.percentUsed) || 0,
      resetsAt: String(w.resetsAt || ''),
    })),
    extraUsageEnabled: Boolean(plan.extraUsage && plan.extraUsage.enabled),
    recordedAt: new Date().toISOString(),
  };

  const key = email.toLowerCase();
  const accounts = readUsage().accounts.filter((a) => String(a.email).toLowerCase() !== key);
  accounts.push(record);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify({ accounts }, null, 2));
  return { record, count: accounts.length };
}

module.exports = { readUsage, recordUsage };
