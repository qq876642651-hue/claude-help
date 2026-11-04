const os = require('os');
const path = require('path');

// 软件和 CLI 共用的数据目录，不放进任何项目仓库
const DATA_DIR = path.join(os.homedir(), '.claude', 'claude-help');

// Claude Code 的配置目录（projects、CLAUDE.md 都在这里），CLAUDE_CONFIG_DIR 可以改；用时才读，方便测试
function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

module.exports = {
  DATA_DIR,
  USAGE_FILE: path.join(DATA_DIR, 'usage.json'),
  MAIL_SITES_FILE: path.join(DATA_DIR, 'mail-sites.json'),
  MEMORY_BACKUP_DIR: path.join(DATA_DIR, 'memory-backups'),
  claudeDir,
};
