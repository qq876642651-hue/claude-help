var api = window.claudeHelp;
var accounts = [];

var sortSelect = document.getElementById('sort');
var cards = document.getElementById('cards');
var notice = document.getElementById('notice');

try {
  var saved = localStorage.getItem('claude-help-sort');
  if (saved) sortSelect.value = saved;
} catch (e) {}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function button(text, onClick) {
  var b = el('button', 'btn', text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function flash(btn, text) {
  var original = btn.textContent;
  btn.textContent = text;
  setTimeout(function () { btn.textContent = original; }, 1500);
}

var noticeTimer = null;

function showNotice(text, warn) {
  notice.textContent = text;
  notice.className = warn ? 'warn' : '';
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(function () { notice.hidden = true; }, 6000);
}

// ---- 额度卡片 ----

function labelText(label) {
  if (/5-hour/i.test(label)) return '5 小时';
  var m = /^Weekly\s*·\s*(.+)$/i.exec(label);
  if (m) return /all models/i.test(m[1]) ? '每周 · 全部模型' : '每周 · ' + m[1];
  return label;
}

function isRestored(w, now) {
  return w.resetsAt && new Date(w.resetsAt).getTime() <= now;
}

function usedNow(w, now) {
  return isRestored(w, now) ? 0 : Number(w.percentUsed) || 0;
}

function findWindow(acc, test) {
  for (var i = 0; i < acc.windows.length; i++) if (test(acc.windows[i].label)) return acc.windows[i];
  return null;
}

function remaining(acc, kind, now) {
  var w = kind === 'weekly'
    ? findWindow(acc, function (l) { return /^Weekly.*all models/i.test(l); }) || findWindow(acc, function (l) { return /^Weekly/i.test(l); })
    : findWindow(acc, function (l) { return /5-hour/i.test(l); });
  return w ? 100 - usedNow(w, now) : -1;
}

function duration(ms) {
  var min = Math.max(0, Math.floor(ms / 60000));
  var d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60), m = min % 60;
  if (d) return d + ' 天 ' + h + ' 小时';
  if (h) return h + ' 小时 ' + m + ' 分';
  return m + ' 分';
}

function ago(iso, now) {
  var ms = now - new Date(iso).getTime();
  if (ms < 60000) return '刚刚';
  return duration(ms) + '前';
}

function barColor(used) {
  return used >= 80 ? 'var(--high)' : used >= 50 ? 'var(--warn)' : 'var(--ok)';
}

function openMail(email) {
  api.openMail(email).then(function (r) {
    if (r.opened) showNotice('已复制 ' + email + '，已在浏览器打开收信页面');
    else showNotice('已复制 ' + email + '；该邮箱后缀还没配置收信地址，可在底部「收信地址」里添加', true);
  }, function () {
    showNotice('打开浏览器失败，账号已复制', true);
  });
}

function render() {
  var now = Date.now();
  var kind = sortSelect.value;
  var list = accounts.slice().sort(function (a, b) {
    if (kind === 'recorded') return new Date(b.recordedAt) - new Date(a.recordedAt);
    return remaining(b, kind, now) - remaining(a, kind, now);
  });

  cards.textContent = '';
  if (!list.length) {
    var empty = el('p', 'empty');
    empty.append('还没有记录。在 Claude Code 里运行 ', el('code', null, '/ch-usage'), ' 记录当前账号，这里会自动刷新。');
    cards.appendChild(empty);
    return;
  }

  list.forEach(function (acc) {
    var card = el('section', 'card');
    var head = el('div', 'card-head');
    head.append(el('span', 'email', acc.email), el('span', 'plan', acc.plan || '未知套餐'));

    var actions = el('div', 'actions');
    var copyBtn = button('复制', function () {
      api.copy(acc.email).then(function () { flash(copyBtn, '已复制'); }, function () { flash(copyBtn, '复制失败'); });
    });
    actions.append(copyBtn, button('收信', function () { openMail(acc.email); }));

    card.append(head, el('div', 'recorded', '记录于 ' + ago(acc.recordedAt, now)), actions);

    acc.windows.forEach(function (w) {
      var used = usedNow(w, now);
      var box = el('div', 'win');
      var wh = el('div', 'win-head');
      wh.append(el('span', null, labelText(w.label)), el('span', 'pct', '已用 ' + used + '%'));
      var bar = el('div', 'bar-track');
      var fill = el('span');
      fill.style.width = Math.min(100, used) + '%';
      fill.style.background = barColor(used);
      bar.appendChild(fill);
      var reset = isRestored(w, now)
        ? el('div', 'reset restored', '已恢复')
        : el('div', 'reset', duration(new Date(w.resetsAt).getTime() - now) + '后重置');
      box.append(wh, bar, reset);
      card.appendChild(box);
    });

    cards.appendChild(card);
  });
}

sortSelect.addEventListener('change', function () {
  try { localStorage.setItem('claude-help-sort', sortSelect.value); } catch (e) {}
  render();
});

function setData(data) {
  accounts = (data && data.accounts) || [];
  render();
}

api.getUsage().then(setData);
api.onUsage(setData);
setInterval(render, 30000);

// ---- 收信地址设置 ----

var sitesPanel = document.getElementById('sitesPanel');
var sitesRows = document.getElementById('sitesRows');
var sitesMsg = document.getElementById('sitesMsg');

function addSiteRow(site) {
  var row = el('div', 'site-row');
  var domain = el('input');
  domain.placeholder = '邮箱后缀，如 onet.pl';
  domain.value = site ? site.domain : '';
  domain.className = 'site-domain';
  var url = el('input');
  url.placeholder = 'https://…';
  url.value = site ? site.url : '';
  url.className = 'site-url';
  row.append(domain, url, button('删除', function () { row.remove(); }));
  sitesRows.appendChild(row);
  return row;
}

function openSitesPanel() {
  sitesMsg.textContent = '';
  api.getMailSites().then(function (sites) {
    sitesRows.textContent = '';
    sites.forEach(addSiteRow);
    sitesPanel.hidden = false;
  });
}

document.getElementById('sitesBtn').addEventListener('click', function () {
  if (sitesPanel.hidden) openSitesPanel();
  else sitesPanel.hidden = true;
});
document.getElementById('sitesAdd').addEventListener('click', function () {
  addSiteRow().querySelector('input').focus();
});
document.getElementById('sitesCancel').addEventListener('click', function () { sitesPanel.hidden = true; });
document.getElementById('sitesSave').addEventListener('click', function () {
  var list = [].map.call(sitesRows.querySelectorAll('.site-row'), function (row) {
    return { domain: row.querySelector('.site-domain').value, url: row.querySelector('.site-url').value };
  }).filter(function (s) { return s.domain.trim() || s.url.trim(); });
  api.setMailSites(list).then(function (sites) {
    sitesPanel.hidden = true;
    showNotice('收信地址已保存，共 ' + sites.length + ' 条');
  }, function (e) {
    sitesMsg.textContent = String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  });
});

// ---- 技能安装 ----

var skillsStatusEl = document.getElementById('skillsStatus');
var skillsBtn = document.getElementById('skillsBtn');

function showSkills(s) {
  skillsBtn.title = '安装到 ' + s.target + '：' + s.skills.join('、');
  if (!s.installedVersion) {
    skillsStatusEl.textContent = '技能未安装';
    skillsBtn.textContent = '安装技能';
  } else if (s.installedVersion !== s.bundledVersion) {
    skillsStatusEl.textContent = '技能 v' + s.installedVersion + '，有新版 v' + s.bundledVersion;
    skillsBtn.textContent = '更新技能';
  } else {
    skillsStatusEl.textContent = '技能 v' + s.installedVersion + ' 已是最新';
    skillsBtn.textContent = '重新安装技能';
  }
}

api.skillsStatus().then(showSkills);

skillsBtn.addEventListener('click', function () {
  skillsBtn.disabled = true;
  api.installSkills().then(function (s) {
    showSkills(s);
    showNotice('已安装 ' + s.skills.join('、') + ' 到 ' + s.target);
  }, function (e) {
    showNotice('技能安装失败：' + (e && e.message ? e.message : e), true);
  }).then(function () { skillsBtn.disabled = false; });
});

// ---- 版本与更新 ----

var updateStatus = document.getElementById('updateStatus');
var updateBtn = document.getElementById('updateBtn');

var updateText = {
  dev: function () { return '开发模式不检查更新'; },
  checking: function () { return '正在检查更新…'; },
  latest: function () { return '已是最新版本'; },
  available: function (i) { return '发现新版本 ' + i.version + '，正在下载'; },
  downloading: function (i) { return '正在下载新版本 ' + i.percent + '%'; },
  downloaded: function (i) { return '新版本 ' + i.version + ' 已下载'; },
  error: function () { return '检查更新失败'; },
};

var updateReady = false;

api.version().then(function (v) { document.getElementById('version').textContent = v; });

api.onUpdate(function (info) {
  updateStatus.textContent = (updateText[info.status] || function () { return ''; })(info);
  updateStatus.title = info.message || '';
  updateReady = info.status === 'downloaded';
  updateBtn.textContent = updateReady ? '重启并安装' : '检查更新';
});

updateBtn.addEventListener('click', function () {
  if (updateReady) api.installUpdate();
  else api.checkUpdate();
});
