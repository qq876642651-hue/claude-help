// 「收信地址」页：新增、原地编辑、删除、恢复默认，每步立即保存
(function () {
  var api = window.claudeHelp;
  var UI = window.UI;
  var DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

  var sites = [];
  var editing = null; // 正在编辑的后缀
  var highlight = null;
  var listEl, form, domainIn, urlIn, domainHint, urlHint;

  function normDomain(v) {
    return String(v || '').trim().toLowerCase().replace(/^@/, '').replace(/^\./, '');
  }

  function domainError(v) {
    if (!v) return '请填写邮箱后缀';
    if (!DOMAIN_RE.test(v)) return '格式不对，例如 poczta.onet.pl';
    return '';
  }

  function urlError(v) {
    if (!v) return '请填写收信网址';
    try {
      var u = new URL(v);
      if (u.protocol === 'https:' || u.protocol === 'http:') return '';
    } catch (e) {}
    return '网址要以 http:// 或 https:// 开头';
  }

  function setHint(input, hint, msg, isInfo) {
    hint.textContent = msg || '';
    hint.className = 'field-hint' + (isInfo ? ' info' : '');
    input.classList.toggle('invalid', Boolean(msg) && !isInfo);
  }

  function load() {
    return api.getMailSites().then(function (list) {
      sites = list;
      render();
    });
  }

  function saved(list, message, domain) {
    sites = list;
    editing = null;
    highlight = domain || null;
    render();
    UI.toast('success', message);
  }

  function viewRow(s) {
    var row = UI.el('div', 'site-row' + (s.domain === highlight ? ' highlight' : ''));
    var url = UI.el('span', 'site-url', s.url);
    url.title = s.url;
    var actions = UI.el('div', 'site-actions');
    actions.append(
      UI.button({ label: '在浏览器打开', icon: 'external', variant: 'icon', onClick: function () {
        api.openSite(s.url).catch(function (e) { UI.toast('error', '打开失败：' + UI.errText(e)); });
      } }),
      UI.button({ label: '编辑', icon: 'edit', variant: 'icon', onClick: function () { editing = s.domain; render(); } }),
      (function () {
        var b = UI.button({ label: '删除', icon: 'trash', variant: 'icon', onClick: function () {
          UI.confirm('删除 ' + s.domain + ' 的收信地址？', '删除').then(function (ok) {
            if (!ok) return;
            api.removeMailSite(s.domain).then(function (list) { saved(list, '已删除 ' + s.domain); }, function (e) {
              UI.toast('error', UI.errText(e));
            });
          });
        } });
        b.classList.add('danger-hover');
        return b;
      })()
    );
    row.append(UI.el('span', 'site-domain', s.domain), UI.el('span', 'site-arrow', '→'), url, actions);
    return row;
  }

  function editRow(s) {
    var row = UI.el('div', 'site-row editing');
    var d = UI.el('input', 'edit-domain');
    d.value = s.domain;
    d.setAttribute('aria-label', '邮箱后缀');
    var u = UI.el('input', 'edit-url');
    u.value = s.url;
    u.setAttribute('aria-label', '收信网址');

    function save() {
      var dv = normDomain(d.value);
      var uv = u.value.trim();
      var err = domainError(dv) || urlError(uv);
      d.classList.toggle('invalid', Boolean(domainError(dv)));
      u.classList.toggle('invalid', Boolean(urlError(uv)));
      if (err) return UI.toast('warn', err);
      api.updateMailSite(s.domain, dv, uv).then(function (list) { saved(list, '已保存 ' + dv, dv); }, function (e) {
        UI.toast('error', UI.errText(e));
      });
    }
    function cancel() { editing = null; render(); }
    [d, u].forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') cancel();
      });
    });

    var actions = UI.el('div', 'site-actions');
    actions.append(
      UI.button({ label: '保存', variant: 'primary', onClick: save }),
      UI.button({ label: '取消', variant: 'ghost', onClick: cancel })
    );
    row.append(d, u, actions);
    setTimeout(function () { u.focus(); }, 0);
    return row;
  }

  function render() {
    listEl.textContent = '';
    if (!sites.length) {
      listEl.appendChild(UI.el('div', 'list-empty', '还没有收信地址。在上面添加，或点「恢复默认」。'));
    }
    sites.forEach(function (s) { listEl.appendChild(s.domain === editing ? editRow(s) : viewRow(s)); });
    highlight = null;
  }

  function init() {
    listEl = document.getElementById('siteList');
    form = document.getElementById('siteForm');
    domainIn = document.getElementById('siteDomain');
    urlIn = document.getElementById('siteUrl');
    domainHint = document.getElementById('siteDomainHint');
    urlHint = document.getElementById('siteUrlHint');

    // 输入时只清掉错误；离开输入框或提交时再校验，避免边打字边报错
    domainIn.addEventListener('input', function () { setHint(domainIn, domainHint, ''); });
    urlIn.addEventListener('input', function () { setHint(urlIn, urlHint, ''); });
    domainIn.addEventListener('blur', function () { if (domainIn.value) setHint(domainIn, domainHint, domainError(normDomain(domainIn.value))); });
    urlIn.addEventListener('blur', function () { if (urlIn.value) setHint(urlIn, urlHint, urlError(urlIn.value.trim())); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var dv = normDomain(domainIn.value);
      var uv = urlIn.value.trim();
      var de = domainError(dv);
      var ue = urlError(uv);
      setHint(domainIn, domainHint, de);
      setHint(urlIn, urlHint, ue);
      if (de) return domainIn.focus();
      if (ue) return urlIn.focus();
      var exists = sites.some(function (s) { return s.domain === dv; });
      api.addMailSite(dv, uv).then(function (list) {
        domainIn.value = '';
        urlIn.value = '';
        saved(list, (exists ? '已更新 ' : '已添加 ') + dv, dv);
      }, function (err) {
        UI.toast('error', UI.errText(err));
      });
    });

    document.getElementById('sitesReset').addEventListener('click', function () {
      UI.confirm('恢复默认会清掉你添加的所有收信地址，只保留 poczta.onet.pl。继续吗？', '恢复默认').then(function (ok) {
        if (!ok) return;
        api.resetMailSites().then(function (list) { saved(list, '已恢复默认收信地址'); }, function (e) {
          UI.toast('error', UI.errText(e));
        });
      });
    });

    load();
  }

  // opts.prefillDomain：从卡片「收信」跳来时，预填没配置的后缀
  function show(opts) {
    editing = null;
    load();
    if (opts && opts.prefillDomain) {
      domainIn.value = opts.prefillDomain;
      urlIn.value = '';
      setHint(domainIn, domainHint, '');
      setHint(urlIn, urlHint, '为 ' + opts.prefillDomain + ' 填写收信网址后点「添加」', true);
      setTimeout(function () { urlIn.focus(); }, 0);
    }
  }

  window.SitesPage = { init: init, show: show };
})();
