const os = require('os');
const path = require('path');

// 软件和 CLI 共用的数据目录，不放进任何项目仓库
const DATA_DIR = path.join(os.homedir(), '.claude', 'claude-help');

module.exports = {
  DATA_DIR,
  USAGE_FILE: path.join(DATA_DIR, 'usage.json'),
  MAIL_SITES_FILE: path.join(DATA_DIR, 'mail-sites.json'),
  CONFIG_FILE: path.join(DATA_DIR, 'desktop-settings.json'),
};
