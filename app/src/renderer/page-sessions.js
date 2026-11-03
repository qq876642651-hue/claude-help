// 「会话」页：按账号列出桌面端的全部会话，复制会话地址，复制续接指令，删除（移到回收站）
(function () {
  var api = window.claudeHelp;
  var fmt = window.UsageFormat;
  var UI = window.UI;
  var t = UI.t;

  var groups = [];
  var query = '';
  var listEl, summaryEl;
  var COLLAPSED_KEY = 'claude-help-collapsed-projects';
  var collapsed = readCollapsed(); // 收起的项目：账号ID + '|' + 目录

  function readCollapsed() {
    try { return JSON.parse(UI.storeGet(COLLAPSED_KEY, '[]')); } catch (e) { return []; }
  }

  function baseName(p) {
    return String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
  }

  // 同一账号下按项目目录分组，项目按最近活动排（会话本来就按最后活动倒序）
  function byProject(sessions) {
    var map = {};
    var order = [];
    sessions.forEach(function (s) {
      var key = s.cwd.toLowerCase();
      if (!map[key]) { map[key] = { cwd: s.cwd, sessions: [] }; order.push(key); }
      map[key].sessions.push(s);
    });
    return order.map(function (k) { return map[k]; });
  }

  function projectRow(accountId, p, now, filtering) {
    var key = accountId + '|' + p.cwd.toLowerCase();
    var open = filtering || collapsed.indexOf(key) < 0;
    var head = UI.el('button', 'project-row' + (open ? ' open' : ''));
    head.type = 'button';
    head.title = p.cwd;
    head.setAttribute('aria-expanded', String(open));
    var name = UI.el('span', 'project-name', baseName(p.cwd));
    head.append(UI.icon('chevron'), UI.icon('folder'), name,
      UI.el('span', 'muted', t('sessions.projectMeta', { n: p.sessions.length, ago: fmt.ago(p.sessions[0].lastActivityAt, now) })));
    head.addEventListener('click', function () {
      var i = collapsed.indexOf(key);
      if (i >= 0) collapsed.splice(i, 1);
      else collapsed.push(key);
      UI.storeSet(COLLAPSED_KEY, JSON.stringify(collapsed));
      render();
    });
    return { head: head, open: open };
  }

  function copyPath(s, btn) {
    api.copy(s.transcript).then(function () {
      UI.flashButton(btn, '', 'check');
      UI.toast('success', t('sessions.copiedPath'));
    }, function (e) {
      UI.toast('error', t('common.copyFailed', { err: UI.errText(e) }));
    });
  }

  function copyResume(s, btn) {
    api.copyResume(s.id).then(function (r) {
      UI.flashButton(btn, t('common.copied'), 'check');
      UI.toast('success', t('sessions.copiedResume', { cwd: r.cwd }));
    }, function (e) {
      UI.toast('error', t('common.copyFailed', { err: UI.errText(e) }));
    });
  }

  function trash(s) {
    UI.confirm(t('sessions.trashConfirm', { title: s.title }), t('common.delete')).then(function (ok) {
      if (!ok) return;
      api.trashSession(s.id).then(function (r) {
        UI.toast('success', t('sessions.trashed', { title: r.title }));
        load();
      }, function (e) {
        UI.toast('error', t('common.deleteFailed', { err: UI.errText(e) }));
      });
    });
  }

  function row(s, now) {
    var r = UI.el('div', 'session-row' + (s.archived ? ' archived' : ''));
    var title = UI.el('span', 'session-title', s.title);
    title.title = s.title + '\n' + s.cwd;
    if (s.archived) title.appendChild(UI.el('span', 'tag', t('sessions.archived')));
    var meta = UI.el('span', 'session-meta', fmt.ago(s.lastActivityAt, now));
    meta.title = t('sessions.lastActive', { time: new Date(s.lastActivityAt).toLocaleString(t.locale) });

    var actions = UI.el('div', 'site-actions');
    if (s.transcript) {
      var path = UI.button({ label: t('sessions.copyPath'), icon: 'link', variant: 'icon', onClick: function () { copyPath(s, path); } });
      var resume = UI.button({ label: t('sessions.copyResume'), title: t('sessions.copyResumeTitle'), icon: 'history', variant: 'ghost', onClick: function () { copyResume(s, resume); } });
      actions.append(path, resume);
    } else {
      actions.appendChild(UI.el('span', 'session-missing', t('sessions.noTranscript')));
    }
    var del = UI.button({ label: t('sessions.trash'), icon: 'trash', variant: 'icon', onClick: function () { trash(s); } });
    del.classList.add('danger-hover');
    actions.appendChild(del);

    r.append(title, meta, actions);
    return r;
  }

  function render() {
    var now = Date.now();
    var total = groups.reduce(function (n, g) { return n + g.sessions.length; }, 0);
    summaryEl.textContent = groups.length
      ? t('sessions.summary', { accounts: groups.length, sessions: total })
      : t('sessions.none');

    var q = query.trim().toLowerCase();
    var match = function (s) { return !q || (s.title + ' ' + baseName(s.cwd)).toLowerCase().indexOf(q) >= 0; };

    listEl.textContent = '';
    var shown = 0;
    groups.forEach(function (g) {
      var list = g.sessions.filter(match);
      if (!list.length) return;
      shown += list.length;
      var box = UI.el('section', 'session-group');
      var head = UI.el('div', 'session-group-head');
      var name = UI.el('h2', null, g.email || t('sessions.account', { id: g.accountId.slice(0, 8) }));
      name.title = t('sessions.accountId', { id: g.accountId });
      head.append(name, UI.el('span', 'muted', t('sessions.count', { n: list.length }) + (g.email ? '' : t('sessions.noEmail'))));
      var panel = UI.el('div', 'panel session-list');
      byProject(list).forEach(function (p) {
        var pr = projectRow(g.accountId, p, now, Boolean(q));
        panel.appendChild(pr.head);
        if (pr.open) p.sessions.forEach(function (s) { panel.appendChild(row(s, now)); });
      });
      box.append(head, panel);
      listEl.appendChild(box);
    });
    if (groups.length && !shown) listEl.appendChild(UI.el('div', 'list-empty', t('sessions.noMatch', { q: query.trim() })));
  }

  function load() {
    return api.getSessions().then(function (data) {
      groups = data || [];
      render();
    }, function (e) {
      UI.toast('error', t('sessions.loadFailed', { err: UI.errText(e) }));
    });
  }

  function init() {
    listEl = document.getElementById('sessionList');
    summaryEl = document.getElementById('sessionsSummary');
    var search = document.getElementById('sessionsSearch');
    search.addEventListener('input', function () {
      query = search.value;
      render();
    });
    // 会话目录不监视，回到窗口时重新读一次
    window.addEventListener('focus', function () {
      if (!document.getElementById('page-sessions').hidden) load();
    });
  }

  window.SessionsPage = { init: init, show: load };
})();
