// 额度显示用的辅助函数，写成 UMD 形式，页面用 <script src> 加载
// 默认中文；软件按界面语言调用 setLang('en')
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UsageFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var en = false;

  function setLang(lang) {
    en = lang === 'en';
  }

  function labelText(label) {
    if (/5-hour/i.test(label)) return en ? '5-hour' : '5 小时';
    var m = /^Weekly\s*·\s*(.+)$/i.exec(label);
    if (m) {
      if (/all models/i.test(m[1])) return en ? 'Weekly · all models' : '每周 · 全部模型';
      return (en ? 'Weekly · ' : '每周 · ') + m[1];
    }
    return label;
  }

  function isRestored(w, now) {
    return Boolean(w.resetsAt) && new Date(w.resetsAt).getTime() <= now;
  }

  // 过了重置时间按 0% 算
  function usedNow(w, now) {
    return isRestored(w, now) ? 0 : Number(w.percentUsed) || 0;
  }

  function findWindow(acc, test) {
    for (var i = 0; i < acc.windows.length; i++) if (test(acc.windows[i].label)) return acc.windows[i];
    return null;
  }

  // kind: weekly | fiveHour；找不到对应额度时返回 -1，排到最后
  function remaining(acc, kind, now) {
    var w = kind === 'weekly'
      ? findWindow(acc, function (l) { return /^Weekly.*all models/i.test(l); }) || findWindow(acc, function (l) { return /^Weekly/i.test(l); })
      : findWindow(acc, function (l) { return /5-hour/i.test(l); });
    return w ? 100 - usedNow(w, now) : -1;
  }

  // 手动添加、还没记录过额度的账号 recordedAt 为 null
  function hasUsage(acc) {
    return Boolean(acc.recordedAt);
  }

  function recordedTime(acc) {
    return new Date(acc.recordedAt).getTime() || 0;
  }

  function sortAccounts(accounts, kind, now) {
    return accounts.slice().sort(function (a, b) {
      if (kind === 'recorded') return recordedTime(b) - recordedTime(a);
      return remaining(b, kind, now) - remaining(a, kind, now);
    });
  }

  function duration(ms) {
    var min = Math.max(0, Math.floor(ms / 60000));
    var d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60), m = min % 60;
    if (en) return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
    if (d) return d + ' 天 ' + h + ' 小时';
    if (h) return h + ' 小时 ' + m + ' 分';
    return m + ' 分';
  }

  function ago(iso, now) {
    var ms = now - new Date(iso).getTime();
    if (ms < 60000) return en ? 'just now' : '刚刚';
    return en ? duration(ms) + ' ago' : duration(ms) + '前';
  }

  return {
    setLang: setLang,
    labelText: labelText,
    isRestored: isRestored,
    usedNow: usedNow,
    remaining: remaining,
    hasUsage: hasUsage,
    sortAccounts: sortAccounts,
    duration: duration,
    ago: ago,
  };
});
