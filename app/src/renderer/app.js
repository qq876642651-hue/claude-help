// 页面切换、快捷键、更新事件分发
(function () {
  var api = window.claudeHelp;
  var UI = window.UI;
  var PAGES = { usage: window.UsagePage, sites: window.SitesPage, sessions: window.SessionsPage, about: window.AboutPage };
  var ORDER = ['usage', 'sites', 'sessions', 'about'];
  var current = null;

  function go(name, opts) {
    if (!PAGES[name]) name = 'usage';
    ORDER.forEach(function (p) {
      document.getElementById('page-' + p).hidden = p !== name;
    });
    [].forEach.call(document.querySelectorAll('.nav-item'), function (b) {
      var active = b.dataset.page === name;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (current !== name) document.querySelector('.main').scrollTop = 0;
    current = name;
    UI.storeSet('claude-help-page', name);
    PAGES[name].show(opts);
  }

  UI.applyI18n(document);
  UI.hydrateIcons(document);
  [].forEach.call(document.querySelectorAll('.nav-item'), function (b) {
    b.title = UI.t('nav.shortcut', { name: UI.t('nav.' + b.dataset.page), n: ORDER.indexOf(b.dataset.page) + 1 });
  });
  ORDER.forEach(function (p) { PAGES[p].init(); });

  document.querySelector('.nav').addEventListener('click', function (e) {
    var b = e.target.closest('.nav-item');
    if (b) go(b.dataset.page);
  });

  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey || e.altKey || e.shiftKey) return;
    if (document.querySelector('.shell').inert) return; // 安装更新时界面锁定
    var n = Number(e.key);
    if (n >= 1 && n <= ORDER.length) {
      e.preventDefault();
      go(ORDER[n - 1]);
    } else if (e.key.toLowerCase() === 'f' && current === 'usage') {
      e.preventDefault();
      window.UsagePage.focusSearch();
    }
  });

  api.version().then(function (v) { document.getElementById('navVersion').textContent = v; });

  var dot = document.getElementById('updateDot');
  api.onUpdate(function (info) {
    window.AboutPage.update(info);
    dot.hidden = !(info.status === 'available' || info.status === 'downloading' || info.status === 'downloaded');
    if (info.status === 'downloaded') UI.toast('info', UI.t('app.updateReady', { version: info.version }));
  });

  // 主进程在点 × 时来问：回到后台、退出还是取消
  api.onCloseRequest(function (req) {
    var asked = UI.askClose();
    api.answerClose({ id: req.id, shown: true });
    asked.then(function (a) {
      api.answerClose({ id: req.id, action: a.action, remember: a.remember });
    });
  });

  window.App = { go: go };
  go(UI.storeGet('claude-help-page', 'usage'));
})();
