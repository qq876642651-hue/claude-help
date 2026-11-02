// 按上次 v* 标签以来的提交前缀算出新版本号并发布。
//   break: / 正文含 BREAKING → 主版本；feat: → 次版本；其余 → 修订号
// 用法：node scripts/release.mjs --dry-run   只打印新版本号和分组的提交
//       node scripts/release.mjs             改版本号、提交、推送、建 Release、上传安装包并核对
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const REPO = 'qq876642651-hue/claude-help';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim();
}

function lastTag() {
  try {
    return run('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*']);
  } catch {
    return null;
  }
}

function commitsSince(tag) {
  const range = tag ? [`${tag}..HEAD`] : ['HEAD'];
  const out = run('git', ['log', ...range, '--format=%H%x1f%s%x1f%b%x1e']);
  return out.split('\x1e').map((s) => s.trim()).filter(Boolean).map((rec) => {
    const [hash, subject, body] = rec.split('\x1f');
    let type = 'other';
    if (/^break(\(.+\))?!?:/i.test(subject) || /BREAKING/.test(body || '')) type = 'break';
    else if (/^feat(\(.+\))?:/i.test(subject)) type = 'feat';
    else if (/^fix(\(.+\))?:/i.test(subject)) type = 'fix';
    return { hash: hash.slice(0, 7), subject, type };
  });
}

function bump(version, commits) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (commits.some((c) => c.type === 'break')) return { level: '主版本', next: `${major + 1}.0.0` };
  if (commits.some((c) => c.type === 'feat')) return { level: '次版本', next: `${major}.${minor + 1}.0` };
  return { level: '修订号', next: `${major}.${minor}.${patch + 1}` };
}

function notes(commits) {
  const groups = [['break', '不兼容改动'], ['feat', '新功能'], ['fix', '修复'], ['other', '其他']];
  return groups
    .map(([type, title]) => {
      const list = commits.filter((c) => c.type === type);
      return list.length ? `### ${title}\n${list.map((c) => `- ${c.subject} (${c.hash})`).join('\n')}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

run('git', ['fetch', '--tags', '--quiet']);
const pkgPath = path.join(appDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const tag = lastTag();
// 基准版本取上次标签；没有标签时取 package.json 里的版本
const base = tag ? tag.replace(/^v/, '') : pkg.version;
const commits = commitsSince(tag).filter((c) => !/^chore: 发布 v/.test(c.subject));
if (!commits.length) {
  console.log(`自 ${tag || '开始'} 以来没有新提交，不需要发版。`);
  process.exit(0);
}
const { level, next } = bump(base, commits);
const releaseNotes = notes(commits);

console.log(`上次版本：${tag || '(无标签) ' + base}`);
console.log(`新版本：v${next}（升${level}）\n`);
console.log(releaseNotes);
if (dryRun) process.exit(0);

// ---- 正式发布 ----
if (run('git', ['status', '--porcelain'])) throw new Error('工作区有未提交的改动，先提交再发版');
if (run('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') throw new Error('只在 main 分支发版');

pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
run('npm', ['install', '--package-lock-only', '--ignore-scripts'], { shell: true });
run('git', ['add', 'package.json', 'package-lock.json']);
run('git', ['commit', '-m', `chore: 发布 v${next}`]);
run('git', ['push']);

// 先建 Release：让 electron-builder 自己建会并发两次，其中一个 422，导致 latest.yml 漏传
run('gh', ['release', 'create', `v${next}`, '--repo', REPO, '--target', 'main', '--title', `v${next}`, '--notes', releaseNotes]);
const token = run('gh', ['auth', 'token']);
execFileSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'], {
  cwd: appDir, stdio: 'inherit', shell: true, env: { ...process.env, GH_TOKEN: token },
});

const assets = JSON.parse(run('gh', ['release', 'view', `v${next}`, '--repo', REPO, '--json', 'assets'])).assets;
const exe = assets.find((a) => a.name.endsWith('.exe'));
const yml = fs.readFileSync(path.join(appDir, 'dist', 'latest.yml'), 'utf8');
const ymlSize = Number((/^\s+size: (\d+)/m.exec(yml) || [])[1]);
const names = assets.map((a) => a.name);
const ok = exe && names.some((n) => n.endsWith('.blockmap')) && names.includes('latest.yml') && exe.size === ymlSize;
console.log(`\nRelease 文件：${names.join('、')}`);
if (!ok) throw new Error(`Release 文件不完整或 latest.yml 的 size(${ymlSize}) 和 exe(${exe && exe.size}) 不一致`);
console.log(`v${next} 发布完成：https://github.com/${REPO}/releases/tag/v${next}`);
