// 「关于」页：版本与更新、命令行说明、数据位置
(function () {
  var api = window.claudeHelp;
  var UI = window.UI;

  var COMMANDS = [
    ['claude-help', '查看各账号额度'],
    ['claude-help mail <邮箱>', '复制账号并打开收信页'],
    ['claude-help sites', '查看收信地址'],
    ['claude-help sessions', '按账号列出全部会话'],
    ['claude-help --help', '全部命令，以及给 Claude 的流程说明'],
  ];

  var TEXT = {
    dev: function () { return '开发模式不检查更新'; },
    checking: function () { return '正在检查更新…'; },
    latest: function () { return '已是最新版本'; },
    available: function (i) { return '发现新版本 v' + i.version + '，正在下载'; },
    downloading: function (i) { return '正在下载新版本 ' + i.percent + '%'; },
    downloaded: function (i) { return '新版本 v' + i.version + ' 已下载，重启即可安装'; },
    error: function (i) { return '检查更新失败：' + (i.message || '未知原因'); },
  };

  var ready = false;
  var btn, textEl, progress, closeEl;

  function showSettings(s) {
    [].forEach.call(closeEl.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-checked', String(b.dataset.value === s.closeAction));
    });
  }

  function setButton(label, iconName, variant) {
    btn.className = 'btn' + (variant ? ' ' + variant : '');
    btn.textContent = '';
    btn.append(UI.icon(iconName), UI.el('span', 'btn-label', label));
  }

  // 由 app.js 转发主进程的更新事件
  function update(info) {
    textEl.textContent = (TEXT[info.status] || function () { return ''; })(info);
    textEl.title = info.message || '';
    progress.hidden = info.status !== 'downloading';
    if (info.status === 'downloading') progress.firstElementChild.style.width = info.percent + '%';
    ready = info.status === 'downloaded';
    btn.disabled = info.status === 'checking' || info.status === 'downloading';
    if (ready) setButton('重启并安装', 'refresh', 'primary');
    else setButton('检查更新', 'refresh');
  }

  function init() {
    btn = document.getElementById('updateBtn');
    textEl = document.getElementById('updateText');
    progress = document.getElementById('updateProgress');

    btn.addEventListener('click', function () {
      if (ready) api.installUpdate();
      else api.checkUpdate();
    });

    api.version().then(function (v) { document.getElementById('aboutVersion').textContent = 'v' + v; });

    // 关闭窗口时的做法；在关闭弹窗里勾了“以后不再询问”也会同步过来
    closeEl = document.getElementById('closeAction');
    closeEl.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-value]');
      if (!b) return;
      api.setSetting('closeAction', b.dataset.value).then(function (s) {
        showSettings(s);
        UI.toast('success', '已保存：关闭窗口时' + b.textContent);
      }, function (err) { UI.toast('error', '保存失败：' + UI.errText(err)); });
    });
    api.getSettings().then(showSettings);
    api.onSettings(showSettings);

    var list = document.getElementById('cmdList');
    COMMANDS.forEach(function (c) {
      var li = UI.el('li');
      var copy = UI.button({ label: '复制命令', icon: 'copy', variant: 'icon', onClick: function () {
        api.copy(c[0]).then(function () { UI.flashButton(copy, '', 'check'); UI.toast('success', '已复制：' + c[0]); });
      } });
      li.append(UI.el('code', null, c[0]), UI.el('span', 'cmd-desc', c[1]), copy);
      list.appendChild(li);
    });

    api.dataDir().then(function (d) { document.getElementById('dataDir').textContent = d; });
    document.getElementById('openDataDir').addEventListener('click', function () {
      api.openDataDir().catch(function (e) { UI.toast('error', '打开文件夹失败：' + UI.errText(e)); });
    });
  }

  window.AboutPage = { init: init, show: function () {}, update: update };
})();
