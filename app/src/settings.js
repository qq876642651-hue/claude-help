// 软件自己的设置，只给主进程用；存在 userData\settings.json（测试时 --user-data-dir 会隔离）
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = { closeAction: 'ask', language: 'system' };
const ALLOWED = { closeAction: ['ask', 'tray', 'quit'], language: ['system', 'zh', 'en'] };

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function get() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function set(key, value) {
  if (!ALLOWED[key] || !ALLOWED[key].includes(value)) throw new Error(`不支持的设置：${key}=${value}`);
  const next = { ...get(), [key]: value };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { get, set };
