var api = window.claudeHelp;
var accounts = [];
var activeEmail = null;

var appEl = document.getElementById('app');
var sortSelect = document.getElementById('sort');
var cards = document.getElementById('cards');
var mailPane = document.getElementById('mail');
var mailHost = document.getElementById('mailHost');
var mailHint = document.getElementById('mailHint');
var updateStatus = document.getElementById('updateStatus');
var updateBtn = document.getElementById('updateBtn');

try {
  var saved = localStorage.getItem('claude-help-sort');
  if (saved) sortSelect.value = saved;
} catch (e) {}

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
    var card = el('section', 'card' + (acc.email === activeEmail ? ' active' : ''));
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
      var bar = el('div', 'bar');
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

// ---- 收信分栏 ----

function hostBounds() {
  var r = mailHost.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function openMail(email) {
  activeEmail = email;
  api.copy(email);
  mailHint.textContent = '已复制 ' + email + '，粘贴到账号框即可';
  var wasHidden = mailPane.hidden;
  mailPane.hidden = false;
  appEl.classList.add('mail-open');
  render();
  if (wasHidden) requestAnimationFrame(function () { api.showMail(hostBounds()); });
}

function closeMail() {
  activeEmail = null;
  mailPane.hidden = true;
  appEl.classList.remove('mail-open');
  api.hideMail();
  render();
}

new ResizeObserver(function () {
  if (!mailPane.hidden) api.setMailBounds(hostBounds());
}).observe(mailHost);

document.getElementById('mailClose').addEventListener('click', closeMail);
document.getElementById('mailReload').addEventListener('click', function () { api.reloadMail(); });
document.getElementById('mailExternal').addEventListener('click', function () { api.openMailExternal(); });

// ---- 版本与更新 ----

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
