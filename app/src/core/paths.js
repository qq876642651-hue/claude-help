const fs = require('fs');
const os = require('os');
const path = require('path');

// 软件的数据目录，不放进任何项目仓库
const DATA_DIR = path.join(os.homedir(), '.claude', 'claude-help');

// Claude Code 的配置目录（projects、CLAUDE.md 都在这里），CLAUDE_CONFIG_DIR 可以改；用时才读，方便测试
function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Claude 桌面端的数据目录：商店版在 %LOCALAPPDATA%\Claude-Data\<包名>\（可能有多份），旧版在 %APPDATA%\Claude\
function desktopDataDirs() {
  const dirs = [];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const root = path.join(local, 'Claude-Data');
    let names = [];
    try { names = fs.readdirSync(root); } catch {}
    for (const name of names) dirs.push(path.join(root, name));
  }
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'Claude'));
  return dirs;
}

module.exports = {
  DATA_DIR,
  USAGE_FILE: path.join(DATA_DIR, 'usage.json'),
  MAIL_SITES_FILE: path.join(DATA_DIR, 'mail-sites.json'),
  MEMORY_BACKUP_DIR: path.join(DATA_DIR, 'memory-backups'),
  claudeDir,
  desktopDataDirs,
};
