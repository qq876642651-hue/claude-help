// 「记忆」页：按项目列出 Claude Code 的记忆和用户级 CLAUDE.md，查看编辑、删除（移到回收站）、导出导入
(function () {
  var api = window.claudeHelp;
  var fmt = window.UsageFormat;
  var UI = window.UI;
  var t = UI.t;

  var groups = [];
  var query = '';
  var listEl, summaryEl;
  var COLLAPSED_KEY = 'claude-help-collapsed-memory';
  var collapsed = readCollapsed(); // 收起的组：key
  var editing = null; // { key, file, name, mtime, original }
  var importing = null; // { projects, plan, targets }

  function readCollapsed() {
    try { return JSON.parse(UI.storeGet(COLLAPSED_KEY, '[]')); } catch (e) { return []; }
  }

  function baseName(p) {
    return String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
  }

  function groupName(g) {
    return g.kind === 'global' ? t('memory.global') : g.cwd ? baseName(g.cwd) : g.key;
  }

  // 条数不算索引
  function memoryCount(g) {
    return g.entries.filter(function (e) { return e.type !== 'index'; }).length;
  }

  function typeLabel(type) {
    var key = 'memory.type.' + type;
    var s = t(key);
    return s === key ? type : s;
  }

  function latest(g) {
    return g.entries.reduce(function (m, e) { return e.modified && e.modified > m ? e.modified : m; }, '');
  }

  // ---- 列表 ----

  function groupRow(g, now, filtering) {
    var open = filtering || collapsed.indexOf(g.key) < 0;
    var head = UI.el('button', 'project-row' + (open ? ' open' : ''));
    head.type = 'button';
    head.title = g.kind === 'global' ? t('memory.globalMeta') : g.cwd || g.key;
    head.setAttribute('aria-expanded', String(open));
    var meta = g.kind === 'global'
      ? t('memory.globalMeta')
      : t('memory.groupMeta', { n: memoryCount(g), ago: fmt.ago(latest(g), now) });
    head.append(UI.icon('chevron'), UI.icon(g.kind === 'global' ? 'globe' : 'folder'),
      UI.el('span', 'project-name', groupName(g)), UI.el('span', 'muted', meta));
    head.addEventListener('click', function () {
      var i = collapsed.indexOf(g.key);
      if (i >= 0) collapsed.splice(i, 1);
      else collapsed.push(g.key);
      UI.storeSet(COLLAPSED_KEY, JSON.stringify(collapsed));
      render();
    });
    return { head: head, open: open };
  }

  function entryRow(g, e, now) {
    var r = UI.el('div', 'memory-row');
    r.appendChild(UI.el('span', 'mem-type type-' + e.type, typeLabel(e.type)));

    var text = UI.el('div', 'mem-text');
    var name = UI.el('span', 'mem-name', e.name);
    name.title = e.file;
    var desc = e.type === 'index' ? t('memory.indexDesc') : e.description;
    text.appendChild(name);
    if (desc) {
      var d = UI.el('span', 'mem-desc', desc);
      d.title = desc;
      text.appendChild(d);
    }
    var meta = UI.el('span', 'session-meta', fmt.ago(e.modified, now));
    if (e.modified) meta.title = t('memory.modified', { time: new Date(e.modified).toLocaleString(t.locale) });

    var actions = UI.el('div', 'site-actions');
    actions.appendChild(UI.button({ label: t('memory.edit'), icon: 'edit', variant: 'icon', onClick: function () { openEditor(g, e); } }));
    if (e.type !== 'index') {
      var del = UI.button({ label: t('memory.trash'), icon: 'trash', variant: 'icon', onClick: function () { trash(g, e); } });
      del.classList.add('danger-hover');
      actions.appendChild(del);
    }
    r.append(text, meta, actions);
    return r;
  }

  // 没有用户级 CLAUDE.md 时给一个「新建」
  function globalEmptyRow(g) {
    var r = UI.el('div', 'memory-row');
    r.appendChild(UI.el('span', 'mem-text mem-desc', t('memory.globalNone')));
    r.appendChild(UI.button({ label: t('memory.create'), icon: 'plus', onClick: function () { openEditor(g, { file: 'CLAUDE.md', name: 'CLAUDE.md' }); } }));
    return r;
  }

  function matches(g, e, q) {
    return (e.name + ' ' + e.description + ' ' + e.file + ' ' + groupName(g)).toLowerCase().indexOf(q) >= 0;
  }

  function render() {
    var now = Date.now();
    var projects = groups.filter(function (g) { return g.kind === 'project'; });
    var total = groups.reduce(function (n, g) { return n + memoryCount(g); }, 0);
    summaryEl.textContent = t('memory.summary', { projects: projects.length, entries: total });

    var q = query.trim().toLowerCase();
    listEl.textContent = '';
    var panel = UI.el('div', 'panel session-list');
    var shown = 0;
    groups.forEach(function (g) {
      var entries = q ? g.entries.filter(function (e) { return matches(g, e, q); }) : g.entries;
      if (q && !entries.length) return;
      var gr = groupRow(g, now, Boolean(q));
      panel.appendChild(gr.head);
      shown += entries.length;
      if (!gr.open) return;
      if (!entries.length) panel.appendChild(globalEmptyRow(g));
      entries.forEach(function (e) { panel.appendChild(entryRow(g, e, now)); });
    });
    if (panel.children.length) listEl.appendChild(panel);
    if (q && !shown) listEl.appendChild(UI.el('div', 'list-empty', t('memory.noMatch', { q: query.trim() })));
    else if (!projects.length) listEl.appendChild(UI.el('div', 'list-empty', t('memory.none')));
  }

  function load() {
    return api.getMemory().then(function (data) {
      groups = data || [];
      render();
    }, function (e) {
      UI.toast('error', t('memory.loadFailed', { err: UI.errText(e) }));
    });
  }

  function trash(g, e) {
    var text = g.kind === 'global' ? t('memory.trashGlobalConfirm') : t('memory.trashConfirm', { name: e.name });
    UI.confirm(text, t('common.delete')).then(function (ok) {
      if (!ok) return;
      api.trashMemory(g.key, e.file).then(function () {
        UI.toast('success', t('memory.trashed', { name: e.name }));
        load();
      }, function (err) {
        UI.toast('error', t('common.deleteFailed', { err: UI.errText(err) }));
      });
    });
  }

  // ---- 编辑 ----

  function openEditor(g, e) {
    api.readMemory(g.key, e.file).then(function (r) {
      editing = { key: g.key, file: e.file, name: e.name, mtime: r.mtime, original: r.text };
      document.getElementById('memoryEditTitle').textContent = groupName(g) + ' · ' + e.name;
      document.getElementById('memoryEditPath').textContent = r.path;
      var area = document.getElementById('memoryEditText');
      area.value = r.text;
      var dialog = document.getElementById('memoryEditDialog');
      dialog.showModal();
      area.focus();
      area.setSelectionRange(0, 0);
      area.scrollTop = 0;
    }, function (err) {
      UI.toast('error', t('memory.openFailed', { err: UI.errText(err) }));
    });
  }

  function closeEditor(force) {
    var dialog = document.getElementById('memoryEditDialog');
    var dirty = editing && document.getElementById('memoryEditText').value !== editing.original;
    if (force || !dirty) {
      editing = null;
      dialog.close();
      return;
    }
    UI.confirm(t('memory.discard'), t('memory.discardOk')).then(function (ok) {
      if (ok) closeEditor(true);
    });
  }

  function saveEditor() {
    if (!editing) return;
    var e = editing;
    var text = document.getElementById('memoryEditText').value;
    api.writeMemory(e.key, e.file, text, e.mtime).then(function () {
      UI.toast('success', t('memory.saved', { name: e.name }));
      closeEditor(true);
      load();
    }, function (err) {
      UI.toast('error', t('common.saveFailed', { err: UI.errText(err) }));
    });
  }

  function initEditor() {
    var dialog = document.getElementById('memoryEditDialog');
    var area = document.getElementById('memoryEditText');
    document.getElementById('memoryEditForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveEditor();
    });
    document.getElementById('memoryEditCancel').addEventListener('click', function () { closeEditor(false); });
    // Esc 也走“有改动先确认”
    dialog.addEventListener('cancel', function (ev) {
      ev.preventDefault();
      closeEditor(false);
    });
    area.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        saveEditor();
      }
    });
    document.getElementById('memoryEditReveal').addEventListener('click', function () {
      if (!editing) return;
      api.revealMemory(editing.key, editing.file).catch(function (err) {
        UI.toast('error', t('memory.openFailed', { err: UI.errText(err) }));
      });
    });
  }

  // ---- 导出 ----

  function openExport() {
    var list = document.getElementById('memoryExportList');
    list.textContent = '';
    groups.forEach(function (g) {
      if (!g.entries.length) return;
      var label = UI.el('label', 'check io-row');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.value = g.key;
      var text = UI.el('span', 'io-name', groupName(g));
      text.title = g.kind === 'global' ? t('memory.globalMeta') : g.cwd || g.key;
      label.append(box, text, UI.el('span', 'muted', t('memory.exportCount', { n: g.entries.length })));
      list.appendChild(label);
    });
    document.getElementById('memoryExportDialog').showModal();
  }

  function doExport() {
    var keys = [].map.call(document.querySelectorAll('#memoryExportList input:checked'), function (b) { return b.value; });
    if (!keys.length) return UI.toast('warn', t('memory.exportNone'));
    document.getElementById('memoryExportDialog').close();
    api.exportMemory(keys).then(function (r) {
      if (r) UI.toast('success', t('memory.exported', { path: r.path }));
    }, function (err) {
      UI.toast('error', t('memory.exportFailed', { err: UI.errText(err) }));
    });
  }

  // ---- 导入 ----

  function sourceName(p) {
    if (p.kind === 'global') return t('memory.global');
    return p.source.cwd ? baseName(p.source.cwd) : p.source.key;
  }

  // 目标：按原路径，或本机已有的某个项目
  function targetSelect(p, i) {
    var select = document.createElement('select');
    var orig = document.createElement('option');
    orig.value = '';
    orig.textContent = t('memory.importOriginal', { cwd: p.source.cwd || p.source.key });
    select.appendChild(orig);
    importing.projects.forEach(function (proj) {
      var o = document.createElement('option');
      o.value = proj.key;
      o.textContent = proj.cwd || proj.key;
      select.appendChild(o);
    });
    var current = importing.targets[i];
    select.value = current && current.key ? current.key : '';
    select.addEventListener('change', function () {
      importing.targets[i] = select.value ? { key: select.value } : null;
      api.planMemoryImport(importing.targets).then(function (plan) {
        importing.plan = plan;
        renderImport();
      }, function (err) {
        UI.toast('error', t('memory.importFailed', { err: UI.errText(err) }));
      });
    });
    return select;
  }

  function renderImport() {
    var list = document.getElementById('memoryImportList');
    list.textContent = '';
    var conflicts = 0;
    var work = 0;
    importing.plan.forEach(function (p, i) {
      var row = UI.el('div', 'io-row import-row');
      var from = UI.el('span', 'io-name', sourceName(p));
      from.title = p.source.cwd || p.source.key || '';
      var to = p.kind === 'global' ? UI.el('span', 'io-target', t('memory.importGlobal')) : targetSelect(p, i);
      to.classList.add('io-target');
      var counts = UI.el('span', 'io-counts' + (p.counts.conflict ? ' has-conflict' : ''), t('memory.importCounts', p.counts));
      row.append(from, UI.el('span', 'site-arrow', '→'), to, counts);
      list.appendChild(row);
      if (p.kind !== 'global' && !p.target.exists) list.appendChild(UI.el('div', 'io-note', t('memory.importNew')));
      conflicts += p.counts.conflict;
      work += p.counts.new + p.counts.conflict;
    });
    document.getElementById('memoryImportPolicy').hidden = !conflicts;
    document.getElementById('memoryImportOk').disabled = !work;
  }

  function openImport() {
    api.pickMemoryImport().then(function (r) {
      if (!r) return;
      importing = { projects: r.projects, plan: r.plan, targets: [] };
      document.getElementById('memoryImportFile').textContent = r.exportedAt
        ? t('memory.importFile', { file: r.file, time: new Date(r.exportedAt).toLocaleString(t.locale) })
        : r.file;
      document.querySelector('input[name="memoryConflict"][value="skip"]').checked = true;
      renderImport();
      document.getElementById('memoryImportDialog').showModal();
    }, function (err) {
      UI.toast('error', t('memory.importFailed', { err: UI.errText(err) }));
    });
  }

  function doImport() {
    if (!importing) return;
    var overwrite = document.querySelector('input[name="memoryConflict"]:checked').value === 'overwrite';
    var targets = importing.targets;
    document.getElementById('memoryImportDialog').close();
    importing = null;
    api.applyMemoryImport(targets, overwrite).then(function (r) {
      UI.toast('success', t('memory.imported', r));
      if (r.backupDir) {
        UI.toast('info', t('memory.importBackup'), { label: t('memory.openBackup'), onClick: function () { api.openDataDir(); } });
      }
      load();
    }, function (err) {
      UI.toast('error', t('memory.importFailed', { err: UI.errText(err) }));
    });
  }

  function init() {
    listEl = document.getElementById('memoryList');
    summaryEl = document.getElementById('memorySummary');
    var search = document.getElementById('memorySearch');
    search.addEventListener('input', function () {
      query = search.value;
      render();
    });
    document.getElementById('memoryExport').addEventListener('click', openExport);
    document.getElementById('memoryImport').addEventListener('click', openImport);
    document.getElementById('memoryExportForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      doExport();
    });
    document.getElementById('memoryExportCancel').addEventListener('click', function () {
      document.getElementById('memoryExportDialog').close();
    });
    document.getElementById('memoryImportForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      doImport();
    });
    document.getElementById('memoryImportCancel').addEventListener('click', function () {
      importing = null;
      document.getElementById('memoryImportDialog').close();
    });
    initEditor();
    // 记忆目录不监视，回到窗口时重新读一次
    window.addEventListener('focus', function () {
      if (!document.getElementById('page-memory').hidden && !editing) load();
    });
  }

  window.MemoryPage = { init: init, show: load };
})();
