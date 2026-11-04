#!/usr/bin/env node
// cchelp 命令行：安装后由 cchelp.cmd 以 ELECTRON_RUN_AS_NODE 方式运行，开发时可直接 node src/cli.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readUsage, recordUsage, addAccount, removeUsage, findByEmail, findByAccountId } = require('./core/usage');
const { readMailSites, addSite, removeSite, mailUrlFor } = require('./core/mailSites');
const { listSessions, findSession, toSession, accountOfSession, resumePrompt } = require('./core/sessions');
const memory = require('./core/memory');
const { USAGE_FILE, MAIL_SITES_FILE, MEMORY_BACKUP_DIR, claudeDir } = require('./core/paths');
const fmt = require('./core/format');
const { version } = require('../package.json');

const HELP = `cchelp ${version} — Claude 账号额度与收信工具（与 Claude Help 桌面软件共用数据）

用法：
  cchelp [usage] [--sort weekly|5h|recorded] [--json]   显示各账号额度（默认按每周剩余排序）
  cchelp usage record [--email <邮箱>] [--reassign] [--file <文件>]
                                                        记录一个账号的额度（plan JSON 从 stdin 或文件读）；
                                                        自动认出当前会话的桌面端账号，记过的账号不用 --email；
                                                        --email 和账号 ID 对不上时不写入，确认后加 --reassign 改记
  cchelp usage add <邮箱>                               添加一个账号，额度先空着，以后记录额度时补上
  cchelp usage remove <邮箱>                            删除一个账号的额度记录（不影响收信地址）
  cchelp mail <邮箱> [--print]                          复制账号，并用默认浏览器打开对应的收信网址
  cchelp sites                                          列出“邮箱后缀 → 收信网址”
  cchelp sites add <后缀> <网址> | remove <后缀>
    匹配规则：邮箱域名等于后缀或以“.后缀”结尾即匹配，多条匹配时取最长的后缀
  cchelp sessions [--json]                              按账号列出桌面端的全部会话（切换账号后桌面端只显示当前账号的）
  cchelp sessions resume <会话ID或前缀>                  打印并复制续接指令：在当前账号新建会话后粘贴，接着旧会话做
  cchelp memory [--json]                                列出 Claude Code 的记忆（用户级 CLAUDE.md 和各项目的 memory 目录）
  cchelp memory export [<项目>...] [--out <文件>]       导出成一个 JSON 文件；项目写 global、目录名、路径或名称的一部分，
                                                        不写就导出全部；默认存到当前目录的 claude-memory-<日期>.json
  cchelp memory import <文件> [--to <项目目录>] [--overwrite] [--dry-run]
                                                        导入记忆：默认按原路径对应项目，--to 改到别的项目（文件里只有一个项目时）；
                                                        同名但内容不同的默认跳过，--overwrite 覆盖（旧文件先备份）；
                                                        新条目自动追加到 MEMORY.md；--dry-run 只看会写什么
  cchelp --version | --help

给 Claude 的说明（额度只有你在 Claude 桌面端会话里能读，本工具只负责存数据）：
  记录额度：调用 mcp__ccd_session_mgmt__get_usage（可能要先用 ToolSearch 加载）；plan.status 为 ok 时，
    把 plan 对象的 JSON 通过 stdin 交给 cchelp usage record（先不带 --email）。
    提示要邮箱时，问用户当前登录的是哪个邮箱，再加 --email <邮箱> 重新运行。
    不要用会话上下文、环境变量或 ~/.claude.json 里的邮箱：桌面端切换账号后它们可能不会更新，会记到别的号上。
    没有 get_usage 这个工具时，告诉用户要在 Claude 桌面端的 Code 页里说，不要编数字。

数据文件：
  ${USAGE_FILE}
  ${MAIL_SITES_FILE}
  记忆：${path.join(claudeDir(), 'CLAUDE.md')}、${path.join(claudeDir(), 'projects', '<项目>', 'memory')}
  导入覆盖前的备份：${MEMORY_BACKUP_DIR}
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
      if (next !== undefined && !next.startsWith('--') && ['sort', 'email', 'file', 'out', 'to'].includes(name)) {
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
    console.log('还没有记录。在 Claude 桌面端里说“用 cchelp 记录额度”，Claude 会读额度并交给 cchelp usage record。');
    return;
  }
  for (const acc of accounts) {
    if (!fmt.hasUsage(acc)) {
      console.log(`${acc.email}  还没有额度记录
`);
      continue;
    }
    console.log(`${acc.email}  ${acc.plan || '未知套餐'}  记录于 ${fmt.ago(acc.recordedAt, now)}`);
    for (const w of acc.windows) {
      const used = fmt.usedNow(w, now);
      const reset = fmt.isRestored(w, now) ? '已恢复' : fmt.duration(new Date(w.resetsAt).getTime() - now) + '后重置';
      console.log(`  ${padDisplay(fmt.labelText(w.label), 16)} ${bar(used, 20)} ${String(used).padStart(3)}%  ${reset}`);
    }
    console.log('');
  }
}

// 桌面端给会话设的环境变量（未公开，可能变化）：先查会话文件，读不到再用账号 ID 变量
function currentAccountId() {
  const session = process.env.CLAUDE_CODE_HOST_SESSION_ID;
  return (session && accountOfSession(session)) || process.env.CLAUDE_CODE_ACCOUNT_UUID || null;
}

// 邮箱以会话的账号 ID 为准：会话上下文里的邮箱在桌面端切换账号后不会更新，传进来的 --email 可能是别的号
function usageRecord(flags) {
  let email = typeof flags.email === 'string' ? flags.email.trim() : '';
  const input = readInput(flags.file);
  // 完整的 get_usage 输出（{ plan, context }）也接受
  const plan = input && typeof input.plan === 'object' && input.plan ? input.plan : input;
  const accountId = currentAccountId();
  const known = findByAccountId(accountId);
  if (!email) {
    if (!accountId) {
      throw new UsageError('认不出当前会话的账号，没有写入。问用户当前登录的是哪个邮箱，再加 --email <邮箱> 重新运行；不要用会话上下文或环境变量里的邮箱。');
    }
    if (!known) {
      throw new UsageError(`桌面端账号 ${accountId} 还没对应过邮箱，没有写入。问用户当前登录的是哪个邮箱，再加 --email <邮箱> 重新运行；不要用会话上下文或环境变量里的邮箱。`);
    }
    email = known.email;
  } else if (accountId && !flags.reassign) {
    const target = findByEmail(email);
    if (known && known.email.toLowerCase() !== email.toLowerCase()) {
      throw new UsageError(`桌面端账号 ${accountId} 记的是 ${known.email}，和 --email ${email} 不一致，没有写入。不带 --email 运行会记到 ${known.email}；用户确认是 ${email} 时加 --reassign。`);
    }
    if (target && target.accountId && target.accountId !== accountId) {
      throw new UsageError(`${email} 记的是另一个桌面端账号（${target.accountId}），当前会话是 ${accountId}，没有写入。问用户当前登录的是哪个邮箱；确认是 ${email} 时加 --reassign。`);
    }
  }
  const { record, count } = recordUsage(email, plan, accountId);
  const parts = record.windows.map((w) => `${fmt.labelText(w.label)} 已用 ${w.percentUsed}%`);
  console.log(`已记录 ${record.email}（${record.plan}）：${parts.join('，')}。共 ${count} 个账号。`);
}

function usageAdd(email) {
  if (!email) throw new UsageError('用法：cchelp usage add <邮箱>');
  const { record, count } = addAccount(email);
  console.log(`已添加 ${record.email}（额度为空，在 Claude 里说“用 cchelp 记录额度”后补上）。共 ${count} 个账号。`);
}

function usageRemove(email) {
  if (!email) throw new UsageError('用法：cchelp usage remove <邮箱>');
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
  if (!email || !email.includes('@')) throw new UsageError('用法：cchelp mail <邮箱>');
  const url = mailUrlFor(email);
  if (flags.print) {
    console.log(url || '');
    if (!url) process.exitCode = 2;
    return;
  }
  const copied = copyToClipboard(email);
  if (!url) {
    console.log(`${copied ? '已复制' : '复制失败：'} ${email}；后缀 ${email.split('@')[1]} 还没配置收信地址，可运行 cchelp sites add <后缀> <网址>`);
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
    if (!a || !b) throw new UsageError('用法：cchelp sites add <后缀> <网址>');
    list = addSite(a, b);
    console.log(`已保存：${a} → ${b}`);
    return;
  } else if (sub === 'remove') {
    if (!a) throw new UsageError('用法：cchelp sites remove <后缀>');
    removeSite(a);
    console.log(`已删除：${a}`);
    return;
  } else throw new UsageError(`未知子命令 sites ${sub}`);
  if (!list.length) console.log('还没有收信地址，运行 cchelp sites add <后缀> <网址> 添加');
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
    if (!id) throw new UsageError('用法：cchelp sessions resume <会话ID或前缀>');
    const hit = findSession(id);
    if (!hit) throw new UsageError(`没找到会话 ${id}，运行 cchelp sessions 查看`);
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
  console.log('续接某个会话：cchelp sessions resume <前 8 位 ID>');
}

// ---- memory ----

const MEMORY_TYPES = { user: '用户', feedback: '反馈', project: '项目', reference: '参考', index: '索引', 'claude-md': '说明' };

function groupName(g) {
  if (g.kind === 'global') return '全局（用户级 CLAUDE.md）';
  return g.cwd ? `${path.basename(g.cwd)}（${g.cwd}）` : g.key;
}

// 按 global、目录名、路径或名称的一部分找组；一个名字对上多个组时报错
function pickGroups(groups, names) {
  return names.map((name) => {
    const q = name.toLowerCase();
    const exact = groups.filter((g) => g.key.toLowerCase() === q || (g.cwd && path.resolve(g.cwd).toLowerCase() === path.resolve(name).toLowerCase()));
    const hits = exact.length ? exact : groups.filter((g) => g.kind === 'project' && `${g.key} ${g.cwd || ''}`.toLowerCase().includes(q));
    if (!hits.length) throw new UsageError(`没找到项目 ${name}，运行 cchelp memory 查看`);
    if (hits.length > 1) throw new UsageError(`${name} 对上了 ${hits.length} 个项目：${hits.map(groupName).join('、')}，请写完整一点`);
    return hits[0].key;
  });
}

function memoryList(flags) {
  const groups = memory.listMemory();
  if (flags.json) return printJson(groups);
  const now = Date.now();
  for (const g of groups) {
    console.log(`${groupName(g)}  ${g.entries.length ? g.entries.length + ' 个文件' : '没有'}`);
    for (const e of g.entries) {
      const tag = padDisplay(MEMORY_TYPES[e.type] || e.type, 4);
      console.log(`  ${tag}  ${padDisplay(e.name, 30)} ${fmt.ago(e.modified, now)}${e.description ? '  ' + e.description : ''}`);
    }
    console.log('');
  }
}

function memoryExport(names, flags) {
  const groups = memory.listMemory();
  const keys = names.length ? pickGroups(groups, names) : null;
  const bundle = memory.exportMemory(keys);
  if (!bundle.groups.length) throw new UsageError('没有可导出的记忆');
  const out = path.resolve(typeof flags.out === 'string' ? flags.out : `claude-memory-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  const files = bundle.groups.reduce((n, g) => n + Object.keys(g.files).length, 0);
  console.log(`已导出 ${bundle.groups.length} 组、${files} 个文件到 ${out}`);
  console.log('里面可能有个人信息，发给别人前先看一下。');
}

const IMPORT_STATUS = { new: '新增', same: '相同，跳过', conflict: '同名但内容不同' };

function memoryImport(file, flags) {
  if (!file) throw new UsageError('用法：cchelp memory import <文件> [--to <项目目录>] [--overwrite] [--dry-run]');
  let bundle;
  try {
    bundle = memory.parseBundle(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new UsageError(e.code === 'ENOENT' ? `找不到文件 ${file}` : e.message);
  }
  const targets = [];
  if (typeof flags.to === 'string') {
    const projects = bundle.groups.map((g, i) => (g.kind === 'project' ? i : -1)).filter((i) => i >= 0);
    if (projects.length !== 1) throw new UsageError(`文件里有 ${projects.length} 个项目，--to 只能用在只有一个项目的时候`);
    targets[projects[0]] = { cwd: path.resolve(flags.to) };
  } else if (flags.to) {
    throw new UsageError('--to 后面要写项目目录');
  }
  const plan = memory.planImport(bundle, targets);
  for (const p of plan) {
    const from = p.kind === 'global' ? '全局 CLAUDE.md' : p.source.cwd || p.source.key;
    const to = p.kind === 'global' ? '' : ` → ${p.target.cwd || p.target.key}${p.target.exists ? '' : '（本机还没有，会新建）'}`;
    console.log(`${from}${to}`);
    for (const f of p.files) {
      const note = f.status === 'conflict' ? (flags.overwrite ? '，覆盖（旧文件先备份）' : '，跳过') : '';
      console.log(`  ${padDisplay(IMPORT_STATUS[f.status], 16)} ${f.file}${note}`);
    }
  }
  if (flags['dry-run']) {
    console.log('\n只是预览，没有写入。');
    return;
  }
  const r = memory.applyImport(bundle, targets, { overwrite: Boolean(flags.overwrite) });
  const parts = [`新增 ${r.written} 个`, r.overwritten && `覆盖 ${r.overwritten} 个`, r.same && `相同 ${r.same} 个`, r.skipped && `跳过 ${r.skipped} 个（加 --overwrite 覆盖）`, r.indexed && `索引补了 ${r.indexed} 行`];
  console.log(`\n已导入：${parts.filter(Boolean).join('，')}。`);
  if (r.backupDir) console.log(`覆盖前的旧文件在 ${r.backupDir}`);
}

function memoryCmd(args, flags) {
  const [sub, ...rest] = args;
  if (!sub || sub === 'list') return memoryList(flags);
  if (sub === 'export') return memoryExport(rest, flags);
  if (sub === 'import') return memoryImport(rest[0], flags);
  throw new UsageError(`未知子命令 memory ${sub}`);
}

function main(argv) {
  const { positional, flags } = parseArgs(argv);
  if (flags.version) return console.log(version);
  if (flags.help || positional[0] === 'help') return console.log(HELP);

  const [cmd, ...rest] = positional;
  if (!cmd || cmd === 'usage') {
    if (rest[0] === 'record') return usageRecord(flags);
    if (rest[0] === 'add') return usageAdd(rest[1]);
    if (rest[0] === 'remove') return usageRemove(rest[1]);
    if (rest[0]) throw new UsageError(`未知子命令 usage ${rest[0]}`);
    return showUsage(flags);
  }
  if (cmd === 'mail') return mail(rest[0], flags);
  if (cmd === 'sites') return sites(rest);
  if (cmd === 'sessions') return sessions(rest, flags);
  if (cmd === 'memory') return memoryCmd(rest, flags);
  throw new UsageError(`未知命令 ${cmd}，运行 cchelp --help 查看用法`);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof UsageError ? e.message : `出错了：${e.message}`);
  process.exitCode = 1;
}
