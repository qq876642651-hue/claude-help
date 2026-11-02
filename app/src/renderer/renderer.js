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

// ---- 额度卡片（显示辅助函数来自 core/format.js） ----

var fmt = window.UsageFormat;

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
  var list = fmt.sortAccounts(accounts, sortSelect.value, now);

  cards.textContent = '';
  if (!list.length) {
    var empty = el('p', 'empty');
    empty.append('还没有记录。在 Claude 桌面端里说“记录额度”，Claude 会读额度并交给 ', el('code', null, 'claude-help usage record'), '，这里会自动刷新。');
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

    card.append(head, el('div', 'recorded', '记录于 ' + fmt.ago(acc.recordedAt, now)), actions);

    acc.windows.forEach(function (w) {
      var used = fmt.usedNow(w, now);
      var box = el('div', 'win');
      var wh = el('div', 'win-head');
      wh.append(el('span', null, fmt.labelText(w.label)), el('span', 'pct', '已用 ' + used + '%'));
      var bar = el('div', 'bar-track');
      var fill = el('span');
      fill.style.width = Math.min(100, used) + '%';
      fill.style.background = barColor(used);
      bar.appendChild(fill);
      var reset = fmt.isRestored(w, now)
        ? el('div', 'reset restored', '已恢复')
        : el('div', 'reset', fmt.duration(new Date(w.resetsAt).getTime() - now) + '后重置');
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
