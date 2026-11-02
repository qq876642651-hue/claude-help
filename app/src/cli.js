#!/usr/bin/env node
// claude-help 命令行：安装后由 claude-help.cmd 以 ELECTRON_RUN_AS_NODE 方式运行，开发时可直接 node src/cli.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readUsage, recordUsage, removeUsage } = require('./core/usage');
const { readMailSites, addSite, removeSite, resetSites, mailUrlFor } = require('./core/mailSites');
const { listSessions, findSession, toSession, accountOfSession, resumePrompt } = require('./core/sessions');
const { USAGE_FILE, MAIL_SITES_FILE } = require('./core/paths');
const fmt = require('./core/format');
const { version } = require('../package.json');

const HELP = `claude-help ${version} — Claude 账号额度与收信工具（与 Claude Help 桌面软件共用数据）

用法：
  claude-help [usage] [--sort weekly|5h|recorded] [--json]   显示各账号额度（默认按每周剩余排序）
  claude-help usage record --email <邮箱> [--session <会话ID>] [--file <文件>]
                                                             记录一个账号的额度（plan JSON 从 stdin 或文件读）；
                                                             --session 用来找出桌面端账号 ID，把会话对应到邮箱
  claude-help usage remove <邮箱>                            删除一个账号的额度记录（不影响收信地址）
  claude-help mail <邮箱> [--print]                          复制账号，并用默认浏览器打开对应的收信网址
  claude-help sites                                          列出“邮箱后缀 → 收信网址”
  claude-help sites add <后缀> <网址> | remove <后缀> | reset
    匹配规则：邮箱域名等于后缀或以“.后缀”结尾即匹配，多条匹配时取最长的后缀；默认只有 poczta.onet.pl
  claude-help sessions [--json]                              按账号列出桌面端的全部会话（切换账号后桌面端只显示当前账号的）
  claude-help sessions resume <会话ID或前缀>                  打印并复制续接指令：在当前账号新建会话后粘贴，接着旧会话做
  claude-help --version | --help

给 Claude 的说明（额度只有你在 Claude 桌面端会话里能读，本工具只负责存数据）：
  记录额度：调用 mcp__ccd_session_mgmt__get_usage；plan.status 为 ok 时，再调用
    mcp__ccd_session_mgmt__get_session（session_id 填 "self"），把 plan 对象的 JSON 通过 stdin 交给
    claude-help usage record --email <会话上下文里的用户邮箱> --session <get_session 返回的 sessionId>。
    不要读 ~/.claude.json 里的邮箱。

数据文件：
  ${USAGE_FILE}
  ${MAIL_SITES_FILE}
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
      if (next !== undefined && !next.startsWith('--') && ['sort', 'email', 'file', 'session'].includes(name)) {
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
  let accountId = null;
  if (flags.session && flags.session !== true) {
    accountId = accountOfSession(flags.session);
    if (!accountId) console.log(`没找到会话 ${flags.session}，这次不更新账号 ID，照常记录额度。`);
  }
  const { record, count } = recordUsage(flags.email, plan, accountId);
  const parts = record.windows.map((w) => `${fmt.labelText(w.label)} 已用 ${w.percentUsed}%`);
  console.log(`已记录 ${record.email}（${record.plan}）：${parts.join('，')}。共 ${count} 个账号。`);
}

function usageRemove(email) {
  if (!email) throw new UsageError('用法：claude-help usage remove <邮箱>');
  const { removed, count } = removeUsage(email);
  console.log(`已删除 ${removed.email} 的额度记录，还剩 ${count} 个账号。`);
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
    console.log('已恢复默认收信地址');
    return;
  } else throw new UsageError(`未知子命令 sites ${sub}`);
  if (!list.length) console.log('还没有收信地址，运行 claude-help sites add <后缀> <网址> 添加');
  for (const s of list) console.log(`${s.domain.padEnd(20)} ${s.url}`);
}

// ---- sessions ----

function accountName(accountId, accounts) {
  const acc = accounts.find((a) => a.accountId === accountId);
  return acc ? acc.email : `账号 ${accountId.slice(0, 8)}（还没对应邮箱）`;
}

function sessions(args, flags) {
  const [sub, id] = args;
  if (sub === 'resume') {
    if (!id) throw new UsageError('用法：claude-help sessions resume <会话ID或前缀>');
    const hit = findSession(id);
    if (!hit) throw new UsageError(`没找到会话 ${id}，运行 claude-help sessions 查看`);
    const s = toSession(hit.data);
    if (!s.transcript) throw new UsageError(`会话「${s.title}」的对话记录已不在，没法续接`);
    const text = resumePrompt(s);
    console.log(text);
    console.log(copyToClipboard(text)
      ? `\n已复制。在 Claude 桌面端用 ${s.cwd} 新建会话后粘贴。`
      : '\n复制失败，请手动复制上面的内容。');
    return;
  }
  if (sub) throw new UsageError(`未知子命令 sessions ${sub}`);

  const groups = listSessions();
  if (flags.json) return printJson(groups);
  if (!groups.length) {
    console.log('没有找到会话。');
    return;
  }
  const now = Date.now();
  const accounts = readUsage().accounts;
  for (const g of groups) {
    console.log(`${accountName(g.accountId, accounts)}  ${g.sessions.length} 个会话`);
    // 同一账号下按项目目录分组，项目按最近活动排
    const projects = new Map();
    for (const s of g.sessions) {
      const key = s.cwd.toLowerCase();
      if (!projects.has(key)) projects.set(key, { cwd: s.cwd, sessions: [] });
      projects.get(key).sessions.push(s);
    }
    for (const p of projects.values()) {
      console.log(`  ${path.basename(p.cwd)}（${p.cwd}）`);
      for (const s of p.sessions) {
        const tags = [s.archived && '已归档', !s.transcript && '无对话记录'].filter(Boolean);
        const id = s.id.replace(/^local_/, '').slice(0, 8);
        console.log(`    ${id}  ${padDisplay(s.title, 30)} ${fmt.ago(s.lastActivityAt, now)}${tags.length ? '  [' + tags.join('、') + ']' : ''}`);
      }
    }
    console.log('');
  }
  console.log('续接某个会话：claude-help sessions resume <前 8 位 ID>');
}

function main(argv) {
  const { positional, flags } = parseArgs(argv);
  if (flags.version) return console.log(version);
  if (flags.help || positional[0] === 'help') return console.log(HELP);

  const [cmd, ...rest] = positional;
  if (!cmd || cmd === 'usage') {
    if (rest[0] === 'record') return usageRecord(flags);
    if (rest[0] === 'remove') return usageRemove(rest[1]);
    if (rest[0]) throw new UsageError(`未知子命令 usage ${rest[0]}`);
    return showUsage(flags);
  }
  if (cmd === 'mail') return mail(rest[0], flags);
  if (cmd === 'sites') return sites(rest);
  if (cmd === 'sessions') return sessions(rest, flags);
  throw new UsageError(`未知命令 ${cmd}，运行 claude-help --help 查看用法`);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof UsageError ? e.message : `出错了：${e.message}`);
  process.exitCode = 1;
}
