#!/usr/bin/env node
// claude-help 命令行：安装后由 claude-help.cmd 以 ELECTRON_RUN_AS_NODE 方式运行，开发时可直接 node src/cli.js
const fs = require('fs');
const { spawnSync } = require('child_process');
const { readUsage, recordUsage } = require('./core/usage');
const { readMailSites, addSite, removeSite, resetSites, mailUrlFor } = require('./core/mailSites');
const { readConfig, saveConfig, diffConfig } = require('./core/config');
const { USAGE_FILE, MAIL_SITES_FILE, CONFIG_FILE } = require('./core/paths');
const fmt = require('./core/format');
const { version } = require('../package.json');

const HELP = `claude-help ${version} — Claude 账号额度与配置工具（与 Claude Help 桌面软件共用数据）

用法：
  claude-help [usage] [--sort weekly|5h|recorded] [--json]   显示各账号额度（默认按每周剩余排序）
  claude-help usage record --email <邮箱> [--file <文件>]     记录一个账号的额度（plan JSON 从 stdin 或文件读）
  claude-help mail <邮箱> [--print]                          复制账号，并用默认浏览器打开对应的收信网址
  claude-help sites                                          列出“邮箱后缀 → 收信网址”
  claude-help sites add <后缀> <网址> | remove <后缀> | reset
  claude-help config save                                    保存配置模板（get_settings 结果从 stdin 读）
  claude-help config diff                                    对比模板与当前设置（get_settings 结果从 stdin 读）
  claude-help config show                                    显示已保存的配置模板
  claude-help --version | --help

给 Claude 的说明（额度和桌面端设置只有你在 Claude 桌面端会话里能读写，本工具只负责存数据和比对）：
  记录额度：调用 mcp__ccd_session_mgmt__get_usage；plan.status 为 ok 时，把 plan 对象的 JSON
    通过 stdin 交给 claude-help usage record --email <会话上下文里的用户邮箱>。不要读 ~/.claude.json 里的邮箱。
  保存配置：调用 mcp__ccd_settings__get_settings，把完整返回值的 JSON 通过 stdin 交给 claude-help config save；
    覆盖已有模板前先问用户。
  应用配置：调用 get_settings，把返回值交给 claude-help config diff；对输出 toSet 里的每一项调用一次
    mcp__ccd_settings__set_setting（用户逐项批准），readOnlyDiffs 里的项请用户自己到 Settings → Claude Code 修改。

数据文件：
  ${USAGE_FILE}
  ${MAIL_SITES_FILE}
  ${CONFIG_FILE}
`;

class UsageError extends Error {}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && ['sort', 'email', 'file'].includes(name)) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function readInput(file) {
  const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  if (!text.trim()) throw new UsageError(file ? `${file} 是空的` : '没有从 stdin 读到 JSON');
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new UsageError('JSON 格式不对：' + e.message);
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

// ---- usage ----

// 终端里中文占两列，按显示宽度补空格
function padDisplay(text, width) {
  let w = 0;
  for (const ch of text) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return text + ' '.repeat(Math.max(0, width - w));
}

function bar(used, width) {
  const n = Math.round(Math.min(100, used) / 100 * width);
  return '█'.repeat(n) + '░'.repeat(width - n);
}

function showUsage(flags) {
  const now = Date.now();
  const kind = { weekly: 'weekly', '5h': 'fiveHour', recorded: 'recorded' }[flags.sort || 'weekly'];
  if (!kind) throw new UsageError('--sort 只能是 weekly、5h 或 recorded');
  const accounts = fmt.sortAccounts(readUsage().accounts, kind, now);

  if (flags.json) return printJson(accounts);
  if (!accounts.length) {
    console.log('还没有记录。在 Claude 桌面端里说“记录额度”，Claude 会读额度并交给 claude-help usage record。');
    return;
  }
  for (const acc of accounts) {
    console.log(`${acc.email}  ${acc.plan || '未知套餐'}  记录于 ${fmt.ago(acc.recordedAt, now)}`);
    for (const w of acc.windows) {
      const used = fmt.usedNow(w, now);
      const reset = fmt.isRestored(w, now) ? '已恢复' : fmt.duration(new Date(w.resetsAt).getTime() - now) + '后重置';
      console.log(`  ${padDisplay(fmt.labelText(w.label), 16)} ${bar(used, 20)} ${String(used).padStart(3)}%  ${reset}`);
    }
    console.log('');
  }
}

function usageRecord(flags) {
  if (!flags.email || flags.email === true) throw new UsageError('需要 --email <邮箱>');
  const plan = readInput(flags.file);
  const { record, count } = recordUsage(flags.email, plan);
  const parts = record.windows.map((w) => `${fmt.labelText(w.label)} 已用 ${w.percentUsed}%`);
  console.log(`已记录 ${record.email}（${record.plan}）：${parts.join('，')}。共 ${count} 个账号。`);
}

// ---- mail ----

function copyToClipboard(text) {
  const r = spawnSync('clip', { input: text, shell: true });
  return r.status === 0;
}

function openUrl(url) {
  const r = spawnSync('rundll32', ['url.dll,FileProtocolHandler', url], { windowsHide: true });
  return r.status === 0;
}

function mail(email, flags) {
  if (!email || !email.includes('@')) throw new UsageError('用法：claude-help mail <邮箱>');
  const url = mailUrlFor(email);
  if (flags.print) {
    console.log(url || '');
    if (!url) process.exitCode = 2;
    return;
  }
  const copied = copyToClipboard(email);
  if (!url) {
    console.log(`${copied ? '已复制' : '复制失败：'} ${email}；后缀 ${email.split('@')[1]} 还没配置收信地址，可运行 claude-help sites add <后缀> <网址>`);
    process.exitCode = 2;
    return;
  }
  const opened = openUrl(url);
  console.log(`${copied ? '已复制' : '复制失败：'} ${email}，${opened ? '已在浏览器打开' : '打开浏览器失败：'} ${url}`);
}

// ---- sites ----

function sites(args) {
  const [sub, a, b] = args;
  let list;
  if (!sub || sub === 'list') list = readMailSites();
  else if (sub === 'add') {
    if (!a || !b) throw new UsageError('用法：claude-help sites add <后缀> <网址>');
    list = addSite(a, b);
    console.log(`已保存：${a} → ${b}`);
    return;
  } else if (sub === 'remove') {
    if (!a) throw new UsageError('用法：claude-help sites remove <后缀>');
    removeSite(a);
    console.log(`已删除：${a}`);
    return;
  } else if (sub === 'reset') {
    resetSites();
    console.log('已恢复预置的收信地址');
    return;
  } else throw new UsageError(`未知子命令 sites ${sub}`);
  for (const s of list) console.log(`${s.domain.padEnd(16)} ${s.url}`);
}

// ---- config ----

function config(sub) {
  if (sub === 'save') {
    const { saved, skipped } = saveConfig(readInput());
    console.log(`已保存 ${saved.length} 项：${saved.join('、') || '无'}`);
    if (skipped.length) console.log(`未保存（默认值或不可设置）：${skipped.join('、')}`);
  } else if (sub === 'diff') {
    printJson(diffConfig(readInput()));
  } else if (sub === 'show') {
    const c = readConfig();
    if (!c) throw new UsageError('还没有保存过配置');
    printJson(c);
  } else {
    throw new UsageError('用法：claude-help config save|diff|show');
  }
}

function main(argv) {
  const { positional, flags } = parseArgs(argv);
  if (flags.version) return console.log(version);
  if (flags.help || positional[0] === 'help') return console.log(HELP);

  const [cmd, ...rest] = positional;
  if (!cmd || cmd === 'usage') {
    if (rest[0] === 'record') return usageRecord(flags);
    if (rest[0]) throw new UsageError(`未知子命令 usage ${rest[0]}`);
    return showUsage(flags);
  }
  if (cmd === 'mail') return mail(rest[0], flags);
  if (cmd === 'sites') return sites(rest);
  if (cmd === 'config') return config(rest[0]);
  throw new UsageError(`未知命令 ${cmd}，运行 claude-help --help 查看用法`);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof UsageError ? e.message : `出错了：${e.message}`);
  process.exitCode = 1;
}
