const fs = require('fs');
const { DATA_DIR, CONFIG_FILE } = require('./paths');

// result 是桌面端 get_settings 的完整返回值（含 settings 和 read_only 两个列表）
function checkResult(result) {
  if (!result || !Array.isArray(result.settings)) throw new Error('需要 get_settings 的完整返回值（含 settings 列表）');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// 只收可设置且不是默认值（null）的项：set_setting 没法把值设回 null
function saveConfig(result) {
  checkResult(result);
  const settings = {};
  const skipped = [];
  for (const s of result.settings) {
    if (s.settable && s.value !== null && s.value !== undefined) settings[s.key] = s.value;
    else skipped.push(s.key);
  }
  const readOnly = {};
  for (const r of result.read_only || []) readOnly[r.name] = r.value;

  const config = { savedAt: new Date().toISOString(), settings, readOnly };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  return { saved: Object.keys(settings), skipped };
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffConfig(result) {
  checkResult(result);
  const config = readConfig();
  if (!config) throw new Error('还没有保存过配置，先在配好习惯的账号上运行 claude-help config save');

  const current = {};
  for (const s of result.settings) current[s.key] = s;
  const toSet = [];
  const unchanged = [];
  const unavailable = [];
  for (const [key, value] of Object.entries(config.settings || {})) {
    const s = current[key];
    if (!s || !s.settable) unavailable.push(key);
    else if (same(s.value, value)) unchanged.push(key);
    else toSet.push({ key, value, current: s.value });
  }

  const readOnlyDiffs = [];
  for (const r of result.read_only || []) {
    if (config.readOnly && r.name in config.readOnly && !same(config.readOnly[r.name], r.value)) {
      readOnlyDiffs.push({ name: r.name, saved: config.readOnly[r.name], current: r.value });
    }
  }
  return { savedAt: config.savedAt, toSet, unchanged, unavailable, readOnlyDiffs };
}

module.exports = { readConfig, saveConfig, diffConfig };
