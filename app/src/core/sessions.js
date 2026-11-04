const fs = require('fs');
const path = require('path');
const { claudeDir } = require('./paths');

// 桌面端的会话列表按账号分目录：claude-code-sessions\<账号ID>\<组织ID>\local_*.json
// 完整对话不分账号：<Claude 配置目录>\projects\<cwd 编码>\<cliSessionId>.jsonl
// 这些是桌面端的内部文件，格式没有公开：只读需要的几个字段，读不到就当没有
function sessionRoots() {
  if (process.env.CLAUDE_HELP_SESSIONS_DIR) return [process.env.CLAUDE_HELP_SESSIONS_DIR];
  const roots = [];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const dataDir = path.join(local, 'Claude-Data');
    for (const name of safeReaddir(dataDir)) roots.push(path.join(dataDir, name, 'claude-code-sessions'));
  }
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'Claude', 'claude-code-sessions'));
  return roots.filter(isDir);
}

function projectsDir() {
  return path.join(claudeDir(), 'projects');
}

// Claude Code 按 cwd 给项目目录起名：非字母数字字符都换成 -（路径太长时会截断，所以只能正向算，不能反推）
function encodeCwd(cwd) {
  return String(cwd || '').replace(/[^A-Za-z0-9]/g, '-');
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// 先按 cwd 编码找；对不上时（比如路径太长被截断）再到各项目目录里找
function findTranscript(cwd, cliSessionId) {
  if (!cliSessionId) return null;
  const file = cliSessionId + '.jsonl';
  const root = projectsDir();
  const direct = path.join(root, encodeCwd(cwd), file);
  if (fs.existsSync(direct)) return direct;
  for (const dir of safeReaddir(root)) {
    const p = path.join(root, dir, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function iso(ms) {
  const n = Number(ms);
  return n ? new Date(n).toISOString() : null;
}

// 遍历每个会话文件：{ accountId, file, data }
function eachSessionFile(fn) {
  for (const root of sessionRoots()) {
    for (const accountId of safeReaddir(root)) {
      const accountDir = path.join(root, accountId);
      for (const org of safeReaddir(accountDir)) {
        const orgDir = path.join(accountDir, org);
        for (const name of safeReaddir(orgDir)) {
          if (!/^local_.+\.json$/.test(name)) continue;
          const file = path.join(orgDir, name);
          let data;
          try {
            data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
          } catch {
            continue;
          }
          if (fn({ accountId, file, data }) === false) return;
        }
      }
    }
  }
}

function toSession(data) {
  return {
    id: String(data.sessionId || ''),
    title: String(data.title || '（无标题）'),
    cwd: String(data.cwd || ''),
    createdAt: iso(data.createdAt),
    lastActivityAt: iso(data.lastActivityAt || data.createdAt),
    archived: Boolean(data.isArchived),
    transcript: findTranscript(data.cwd, data.cliSessionId),
  };
}

function byRecent(a, b) {
  return String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || ''));
}

// 账号按最近活动倒序，会话也按最后活动倒序
function listSessions() {
  const groups = new Map();
  eachSessionFile(({ accountId, data }) => {
    if (!data.sessionId) return;
    if (!groups.has(accountId)) groups.set(accountId, []);
    groups.get(accountId).push(toSession(data));
  });
  return [...groups].map(([accountId, sessions]) => ({ accountId, sessions: sessions.sort(byRecent) }))
    .sort((a, b) => byRecent(a.sessions[0], b.sessions[0]));
}

// 找到会话：id 可以是会话 ID（local_… 可省）或对话记录 ID，也可以只写开头几位
function findSession(id) {
  const key = String(id || '').trim().replace(/^local_/, '');
  if (!key) return null;
  const ids = (data) => [String(data.sessionId || '').replace(/^local_/, ''), String(data.cliSessionId || '')];
  const hits = [];
  eachSessionFile(({ accountId, file, data }) => {
    if (ids(data).some((x) => x && x.startsWith(key))) hits.push({ accountId, file, data });
  });
  const exact = hits.find((h) => ids(h.data).includes(key));
  if (exact) return exact;
  if (hits.length > 1) throw new Error(`有 ${hits.length} 个会话以 ${key} 开头，请写长一点`);
  return hits[0] || null;
}

function accountOfSession(id) {
  const hit = findSession(id);
  return hit ? hit.accountId : null;
}

function resumePrompt(session) {
  return [
    `请接着之前的会话「${session.title}」继续。`,
    `项目目录：${session.cwd}`,
    `完整对话记录：${session.transcript}（JSONL 格式，每行一条消息）`,
    '记录可能很大，先看最后几十行和我说过的话，概括目前的进度和还没做完的事，等我确认后再继续。',
  ].join('\n');
}

// 删除时要移走的文件：会话列表文件、对话记录、同名的子代理记录目录
function sessionFiles(id) {
  const hit = findSession(id);
  if (!hit) throw new Error('找不到这个会话，可能已经删除');
  const files = [hit.file];
  const transcript = findTranscript(hit.data.cwd, hit.data.cliSessionId);
  if (transcript) {
    files.push(transcript);
    const sub = transcript.replace(/\.jsonl$/, '');
    if (isDir(sub)) files.push(sub);
  }
  return { session: toSession(hit.data), files };
}

module.exports = { projectsDir, encodeCwd, safeReaddir, isDir, listSessions, findSession, toSession, accountOfSession, resumePrompt, sessionFiles };
