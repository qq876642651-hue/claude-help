// 「关于」页：版本与更新、关闭窗口时、语言、命令行说明、数据位置
(function () {
  var api = window.claudeHelp;
  var UI = window.UI;
  var t = UI.t;

  var COMMANDS = [
    ['claude-help', 'about.cmd.usage'],
    [t('about.cmdMail'), 'about.cmd.mail'],
    ['claude-help sites', 'about.cmd.sites'],
    ['claude-help sessions', 'about.cmd.sessions'],
    ['claude-help --help', 'about.cmd.help'],
  ];

  var UPDATE_STATUSES = ['dev', 'checking', 'latest', 'available', 'downloading', 'downloaded', 'error'];

  var ready = false;
  var readyVersion = '';
  var locked = false;
  var btn, textEl, progress, closeEl, langEl;

  // 安装更新期间整个界面不可操作：主体和提示条设为 inert，盖上遮罩
  function lockForInstall(version) {
    locked = true;
    document.querySelector('.shell').inert = true;
    document.getElementById('toasts').inert = true;
    document.getElementById('installTitle').textContent = t('install.titleVersion', { version: version });
    document.getElementById('installOverlay').hidden = false;
  }

  function unlock() {
    locked = false;
    document.querySelector('.shell').inert = false;
    document.getElementById('toasts').inert = false;
    document.getElementById('installOverlay').hidden = true;
  }

  function checkRadios(group, value) {
    [].forEach.call(group.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-checked', String(b.dataset.value === value));
    });
  }

  function showSettings(s) {
    checkRadios(closeEl, s.closeAction);
    checkRadios(langEl, s.language);
  }

  function setButton(label, iconName, variant) {
    btn.className = 'btn' + (variant ? ' ' + variant : '');
    btn.textContent = '';
    btn.append(UI.icon(iconName), UI.el('span', 'btn-label', label));
  }

  // 由 app.js 转发主进程的更新事件
  function update(info) {
    textEl.textContent = UPDATE_STATUSES.indexOf(info.status) < 0 ? ''
      : t('about.update.' + info.status, { version: info.version, percent: info.percent, message: info.message || t('about.update.unknown') });
    textEl.title = info.message || '';
    progress.hidden = info.status !== 'downloading';
    if (info.status === 'downloading') progress.firstElementChild.style.width = info.percent + '%';
    ready = info.status === 'downloaded';
    if (ready) readyVersion = info.version;
    if (info.status === 'error' && locked) unlock();
    btn.disabled = info.status === 'checking' || info.status === 'downloading';
    if (ready) setButton(t('about.restartInstall'), 'refresh', 'primary');
    else setButton(t('about.check'), 'refresh');
  }

  function init() {
    btn = document.getElementById('updateBtn');
    textEl = document.getElementById('updateText');
    progress = document.getElementById('updateProgress');

    btn.addEventListener('click', function () {
      if (!ready) return api.checkUpdate();
      lockForInstall(readyVersion);
      api.installUpdate().catch(function (e) {
        unlock();
        UI.toast('error', t('about.installFailed', { err: UI.errText(e) }));
      });
    });

    api.version().then(function (v) { document.getElementById('aboutVersion').textContent = 'v' + v; });

    // 关闭窗口时的做法；在关闭弹窗里勾了“以后不再询问”也会同步过来
    closeEl = document.getElementById('closeAction');
    closeEl.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-value]');
      if (!b) return;
      api.setSetting('closeAction', b.dataset.value).then(function (s) {
        showSettings(s);
        UI.toast('success', t('about.closeSaved', { label: b.textContent }));
      }, function (err) { UI.toast('error', t('common.saveFailed', { err: UI.errText(err) })); });
    });

    // 语言：保存后主进程更新托盘菜单并重新加载页面
    langEl = document.getElementById('language');
    langEl.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-value]');
      if (!b || b.getAttribute('aria-checked') === 'true') return;
      api.setSetting('language', b.dataset.value).catch(function (err) {
        UI.toast('error', t('common.saveFailed', { err: UI.errText(err) }));
      });
    });

    api.getSettings().then(showSettings);
    api.onSettings(showSettings);

    var list = document.getElementById('cmdList');
    COMMANDS.forEach(function (c) {
      var li = UI.el('li');
      var copy = UI.button({ label: t('about.copyCommand'), icon: 'copy', variant: 'icon', onClick: function () {
        api.copy(c[0]).then(function () { UI.flashButton(copy, '', 'check'); UI.toast('success', t('about.copiedCommand', { cmd: c[0] })); });
      } });
      li.append(UI.el('code', null, c[0]), UI.el('span', 'cmd-desc', t(c[1])), copy);
      list.appendChild(li);
    });

    api.dataDir().then(function (d) { document.getElementById('dataDir').textContent = d; });
    document.getElementById('openDataDir').addEventListener('click', function () {
      api.openDataDir().catch(function (e) { UI.toast('error', t('about.openDirFailed', { err: UI.errText(e) })); });
    });
  }

  window.AboutPage = { init: init, show: function () {}, update: update, lockForInstall: lockForInstall, unlock: unlock };
})();
