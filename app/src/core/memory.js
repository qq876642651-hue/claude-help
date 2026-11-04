const fs = require('fs');
const path = require('path');
const { claudeDir, MEMORY_BACKUP_DIR } = require('./paths');
const { projectsDir, encodeCwd, safeReaddir, isDir, listSessions } = require('./sessions');

// Claude Code 的记忆：<配置目录>\projects\<cwd 编码>\memory\*.md，MEMORY.md 是索引，其余每条一个文件（带 frontmatter）
// 用户级说明 <配置目录>\CLAUDE.md 当作 key 为 global 的一组
const GLOBAL = 'global';
const INDEX = 'MEMORY.md';
const CLAUDE_MD = 'CLAUDE.md';
const FORMAT = 'claude-help-memory';

const sameText = (a, b) => String(a).replace(/\r\n/g, '\n') === String(b).replace(/\r\n/g, '\n');
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function validKey(key) {
  return key === GLOBAL || (typeof key === 'string' && /^[^\\/:*?"<>|\x00-\x1f]+$/.test(key) && key !== '.' && key !== '..');
}

function validFile(key, file) {
  if (key === GLOBAL) return file === CLAUDE_MD;
  return typeof file === 'string' && /^[^\\/:*?"<>|\x00-\x1f]+\.md$/i.test(file) && !file.startsWith('.');
}

function memoryDir(key) {
  return path.join(projectsDir(), key, 'memory');
}

// 所有读写都过这里：key 是 global 或 projects 下的目录名，file 是不带路径的 .md
function entryPath(key, file, { mustExist = true } = {}) {
  if (!validKey(key) || !validFile(key, file)) throw new Error('记忆路径不对');
  if (key === GLOBAL) return path.join(claudeDir(), CLAUDE_MD);
  if (mustExist && !isDir(path.join(projectsDir(), key))) throw new Error('找不到这个项目');
  return path.join(memoryDir(key), file);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {
    return null;
  }
}

function stat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function unquote(v) {
  const m = /^(["'])(.*)\1$/.exec(v);
  return m ? m[2] : v;
}

// 只认 frontmatter 里的 key: value 和下一层缩进的子字段（metadata:），够用就行，不引 YAML 库
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  const meta = {};
  if (!m) return meta;
  let parent = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\s*)([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, indent, key, raw] = kv;
    const value = unquote(raw.trim());
    if (!indent) {
      parent = value === '' ? key : null;
      meta[key] = value === '' ? {} : value;
    } else if (parent) {
      meta[parent][key] = value;
    }
  }
  return meta;
}

function toEntry(key, file, full) {
  const st = stat(full);
  const text = readText(full) || '';
  const base = { file, mtime: st ? st.mtimeMs : null, size: st ? st.size : 0, modified: st ? st.mtime.toISOString() : null };
  if (key === GLOBAL) return { ...base, name: CLAUDE_MD, description: '', type: 'claude-md' };
  if (file === INDEX) return { ...base, name: INDEX, description: '', type: 'index' };
  const meta = parseFrontmatter(text);
  const sub = meta.metadata && typeof meta.metadata === 'object' ? meta.metadata : {};
  return {
    ...base,
    name: typeof meta.name === 'string' && meta.name ? meta.name : file.replace(/\.md$/i, ''),
    description: typeof meta.description === 'string' ? meta.description : '',
    type: sub.type || (typeof meta.type === 'string' ? meta.type : '') || 'other',
    modified: sub.modified && !isNaN(Date.parse(sub.modified)) ? sub.modified : base.modified,
  };
}

// 项目的真实路径：对话记录每行都带 cwd，读一个 .jsonl 的开头就够；没有对话记录再看桌面端会话列表
function projectCwd(key, sessionCwds) {
  const dir = path.join(projectsDir(), key);
  for (const name of safeReaddir(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    let head = '';
    try {
      const fd = fs.openSync(path.join(dir, name), 'r');
      const buf = Buffer.alloc(65536);
      head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
      fs.closeSync(fd);
    } catch {
      continue;
    }
    const m = /"cwd":("(?:[^"\\]|\\.)*")/.exec(head);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {}
    }
  }
  return sessionCwds.get(key) || null;
}

function sessionCwdMap() {
  const map = new Map();
  try {
    for (const g of listSessions()) for (const s of g.sessions) if (s.cwd) map.set(encodeCwd(s.cwd), s.cwd);
  } catch {}
  return map;
}

// 条目顺序：索引在前，其余按索引里出现的先后，索引里没有的按文件名排在后面
function orderEntries(entries, indexText) {
  const pos = (e) => {
    if (e.file === INDEX) return -1;
    const i = indexText ? indexText.indexOf('](' + e.file + ')') : -1;
    return i < 0 ? Infinity : i;
  };
  return entries.sort((a, b) => pos(a) - pos(b) || a.file.localeCompare(b.file));
}

function listGroup(key, sessionCwds) {
  if (key === GLOBAL) {
    const full = path.join(claudeDir(), CLAUDE_MD);
    return { key, kind: 'global', cwd: null, entries: stat(full) ? [toEntry(key, CLAUDE_MD, full)] : [] };
  }
  const dir = memoryDir(key);
  const entries = safeReaddir(dir)
    .filter((f) => validFile(key, f) && (stat(path.join(dir, f)) || {}).isFile?.())
    .map((f) => toEntry(key, f, path.join(dir, f)));
  return { key, kind: 'project', cwd: projectCwd(key, sessionCwds), entries: orderEntries(entries, readText(path.join(dir, INDEX))) };
}

const latest = (g) => Math.max(0, ...g.entries.map((e) => e.mtime || 0));

// 全局在最前（没有 CLAUDE.md 也列出来，可以新建），项目只列有记忆的，按最近修改倒序
function listMemory() {
  const sessionCwds = sessionCwdMap();
  const projects = safeReaddir(projectsDir())
    .filter((key) => validKey(key) && key !== GLOBAL && isDir(memoryDir(key)))
    .map((key) => listGroup(key, sessionCwds))
    .filter((g) => g.entries.length)
    .sort((a, b) => latest(b) - latest(a));
  return [listGroup(GLOBAL, sessionCwds), ...projects];
}

function readEntry(key, file) {
  const full = entryPath(key, file);
  const text = readText(full);
  if (text === null) {
    if (key === GLOBAL) return { text: '', mtime: null, path: full };
    throw new Error('这条记忆已经不在了');
  }
  return { text, mtime: stat(full).mtimeMs, path: full };
}

// mtime 是打开时读到的；期间文件被改过（比如 Claude 正在写记忆）就不覆盖。只有全局 CLAUDE.md 可以新建
function writeEntry(key, file, text, mtime) {
  const full = entryPath(key, file);
  const st = stat(full);
  if (!st && key !== GLOBAL) throw new Error('这条记忆已经不在了');
  if ((st ? Math.round(st.mtimeMs) : null) !== (mtime == null ? null : Math.round(mtime))) {
    throw new Error('文件在打开后被改过，请关掉重新打开');
  }
  fs.writeFileSync(full, String(text), 'utf8');
  return { mtime: stat(full).mtimeMs };
}

function removeFromIndex(key, file) {
  if (key === GLOBAL || file === INDEX) return false;
  const index = path.join(memoryDir(key), INDEX);
  const text = readText(index);
  if (text === null) return false;
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((l) => !l.includes('](' + file + ')'));
  if (kept.length === lines.length) return false;
  fs.writeFileSync(index, kept.join(text.includes('\r\n') ? '\r\n' : '\n'), 'utf8');
  return true;
}

// ---- 导出导入 ----

// keys 不给就导出全部；空组（比如没有 CLAUDE.md 的全局）不放进去
function exportMemory(keys) {
  const all = listMemory();
  const wanted = keys ? all.filter((g) => keys.includes(g.key)) : all;
  const groups = wanted
    .filter((g) => g.entries.length)
    .map((g) => {
      const files = {};
      for (const e of g.entries) files[e.file] = readText(entryPath(g.key, e.file));
      return g.kind === GLOBAL ? { kind: GLOBAL, files } : { kind: 'project', key: g.key, cwd: g.cwd, files };
    });
  const { version } = require('../../package.json');
  return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), app: version, groups };
}

function parseBundle(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text.replace(/^﻿/, '')) : text;
  } catch (e) {
    throw new Error('不是有效的 JSON：' + e.message);
  }
  if (!data || data.format !== FORMAT) throw new Error('不是 Claude Help 导出的记忆文件');
  if (data.version !== 1) throw new Error(`记忆文件版本 ${data.version} 不认识，请先更新 Claude Help`);
  if (!Array.isArray(data.groups)) throw new Error('记忆文件里没有 groups');
  data.groups.forEach((g, i) => {
    const where = `第 ${i + 1} 组`;
    if (!g || (g.kind !== GLOBAL && g.kind !== 'project')) throw new Error(`${where}的 kind 不对`);
    if (g.kind === 'project') {
      if (g.cwd != null && typeof g.cwd !== 'string') throw new Error(`${where}的 cwd 不对`);
      if (!g.cwd && !validKey(g.key)) throw new Error(`${where}没有项目路径`);
    }
    if (!g.files || typeof g.files !== 'object') throw new Error(`${where}没有 files`);
    for (const [file, content] of Object.entries(g.files)) {
      if (!validFile(g.kind === GLOBAL ? GLOBAL : 'project', file)) throw new Error(`${where}的文件名不对：${file}`);
      if (typeof content !== 'string') throw new Error(`${where}的 ${file} 内容不是文本`);
    }
  });
  return data;
}

// 本机全部项目（包括还没有记忆的），导入时可以选作目标
function localProjects() {
  const sessionCwds = sessionCwdMap();
  return safeReaddir(projectsDir())
    .filter((key) => validKey(key) && key !== GLOBAL && isDir(path.join(projectsDir(), key)))
    .map((key) => ({ key, cwd: projectCwd(key, sessionCwds) }));
}

// 导入到哪个项目：target 可以是 { key }（本机已有的项目）或 { cwd }；不给就按原路径
// 按路径找时先认本机已有、cwd 相同的项目目录（长路径的目录名会被截断，自己编码可能对不上）
function resolveTarget(group, target, locals) {
  if (group.kind === GLOBAL) return { key: GLOBAL, cwd: null, exists: true };
  if (target && target.key) {
    const local = locals.find((l) => l.key === target.key);
    if (!local) throw new Error('找不到目标项目');
    return { key: local.key, cwd: local.cwd, exists: true };
  }
  const cwd = (target && target.cwd) || group.cwd;
  if (!cwd) {
    const local = locals.find((l) => l.key === group.key);
    return { key: group.key, cwd: local ? local.cwd : null, exists: Boolean(local) };
  }
  const local = locals.find((l) => l.cwd && samePath(l.cwd, cwd)) || locals.find((l) => l.key === encodeCwd(cwd));
  if (local) return { key: local.key, cwd, exists: true };
  const key = encodeCwd(cwd);
  if (!validKey(key)) throw new Error('目标路径不对：' + cwd);
  return { key, cwd, exists: false };
}

// 预览：每个文件标成 new / same / conflict；MEMORY.md 不直接写，导入时把新条目合并进本地索引
function planImport(bundle, targets = []) {
  const locals = localProjects();
  return bundle.groups.map((g, i) => {
    const target = resolveTarget(g, targets[i], locals);
    const files = Object.keys(g.files)
      .filter((f) => f !== INDEX)
      .map((file) => {
        const local = readText(entryPath(target.key, file, { mustExist: false }));
        const status = local === null ? 'new' : sameText(local, g.files[file]) ? 'same' : 'conflict';
        return { file, status };
      });
    const counts = { new: 0, same: 0, conflict: 0 };
    files.forEach((f) => counts[f.status]++);
    return { kind: g.kind, source: { key: g.key || null, cwd: g.cwd || null }, target, files, counts };
  });
}

// 索引行：优先用导入包索引里的那一行，没有就按 frontmatter 生成
function indexLine(group, file) {
  const index = group.files[INDEX] || '';
  const line = index.split(/\r?\n/).find((l) => l.includes('](' + file + ')'));
  if (line) return line;
  const e = toEntryFromText(file, group.files[file]);
  return `- [${e.name}](${file})${e.description ? ' — ' + e.description : ''}`;
}

function toEntryFromText(file, text) {
  const meta = parseFrontmatter(text);
  return { name: typeof meta.name === 'string' && meta.name ? meta.name : file.replace(/\.md$/i, ''), description: typeof meta.description === 'string' ? meta.description : '' };
}

// 写入：new 直接写，conflict 默认跳过，overwrite 时先把旧文件备份到 memory-backups\<时间>\<key>\ 再覆盖
// 写进去或内容相同的条目，本地索引里没有就追加一行
function applyImport(bundle, targets, { overwrite = false } = {}) {
  const plan = planImport(bundle, targets);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(MEMORY_BACKUP_DIR, stamp);
  const result = { written: 0, overwritten: 0, skipped: 0, same: 0, indexed: 0, backupDir: null };
  plan.forEach((p, i) => {
    const g = bundle.groups[i];
    const key = p.target.key;
    if (key !== GLOBAL) fs.mkdirSync(memoryDir(key), { recursive: true });
    const imported = [];
    for (const f of p.files) {
      const full = entryPath(key, f.file);
      if (f.status === 'same') {
        result.same++;
        imported.push(f.file);
        continue;
      }
      if (f.status === 'conflict') {
        if (!overwrite) {
          result.skipped++;
          continue;
        }
        const backup = path.join(backupDir, key, f.file);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(full, backup);
        result.backupDir = backupDir;
        result.overwritten++;
      } else {
        result.written++;
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, g.files[f.file], 'utf8');
      imported.push(f.file);
    }
    if (key === GLOBAL) return;
    const indexPath = path.join(memoryDir(key), INDEX);
    let index = readText(indexPath) || '';
    const missing = imported.filter((file) => !index.includes('](' + file + ')'));
    if (!missing.length) return;
    const eol = index.includes('\r\n') ? '\r\n' : '\n';
    if (index && !index.endsWith('\n')) index += eol;
    index += missing.map((file) => indexLine(g, file)).join(eol) + eol;
    fs.writeFileSync(indexPath, index, 'utf8');
    result.indexed += missing.length;
  });
  return result;
}

module.exports = {
  GLOBAL,
  INDEX,
  listMemory,
  readEntry,
  writeEntry,
  entryPath,
  removeFromIndex,
  exportMemory,
  parseBundle,
  localProjects,
  planImport,
  applyImport,
};
