// 「收信地址」页：新增、原地编辑、删除、恢复默认，每步立即保存
(function () {
  var api = window.claudeHelp;
  var UI = window.UI;
  var t = UI.t;
  var DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

  var sites = [];
  var editing = null; // 正在编辑的后缀
  var highlight = null;
  var listEl, form, domainIn, urlIn, domainHint, urlHint;

  function normDomain(v) {
    return String(v || '').trim().toLowerCase().replace(/^@/, '').replace(/^\./, '');
  }

  function domainError(v) {
    if (!v) return t('sites.domainRequired');
    if (!DOMAIN_RE.test(v)) return t('sites.domainInvalid');
    return '';
  }

  function urlError(v) {
    if (!v) return t('sites.urlRequired');
    try {
      var u = new URL(v);
      if (u.protocol === 'https:' || u.protocol === 'http:') return '';
    } catch (e) {}
    return t('sites.urlInvalid');
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
      UI.button({ label: t('sites.open'), icon: 'external', variant: 'icon', onClick: function () {
        api.openSite(s.url).catch(function (e) { UI.toast('error', t('sites.openFailed', { err: UI.errText(e) })); });
      } }),
      UI.button({ label: t('sites.edit'), icon: 'edit', variant: 'icon', onClick: function () { editing = s.domain; render(); } }),
      (function () {
        var b = UI.button({ label: t('common.delete'), icon: 'trash', variant: 'icon', onClick: function () {
          UI.confirm(t('sites.removeConfirm', { domain: s.domain }), t('common.delete')).then(function (ok) {
            if (!ok) return;
            api.removeMailSite(s.domain).then(function (list) { saved(list, t('sites.removed', { domain: s.domain })); }, function (e) {
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
    d.setAttribute('aria-label', t('sites.domain'));
    var u = UI.el('input', 'edit-url');
    u.value = s.url;
    u.setAttribute('aria-label', t('sites.url'));

    function save() {
      var dv = normDomain(d.value);
      var uv = u.value.trim();
      var err = domainError(dv) || urlError(uv);
      d.classList.toggle('invalid', Boolean(domainError(dv)));
      u.classList.toggle('invalid', Boolean(urlError(uv)));
      if (err) return UI.toast('warn', err);
      api.updateMailSite(s.domain, dv, uv).then(function (list) { saved(list, t('sites.saved', { domain: dv }), dv); }, function (e) {
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
      UI.button({ label: t('common.save'), variant: 'primary', onClick: save }),
      UI.button({ label: t('common.cancel'), variant: 'ghost', onClick: cancel })
    );
    row.append(d, u, actions);
    setTimeout(function () { u.focus(); }, 0);
    return row;
  }

  function render() {
    listEl.textContent = '';
    if (!sites.length) {
      listEl.appendChild(UI.el('div', 'list-empty', t('sites.empty')));
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
        saved(list, t(exists ? 'sites.updated' : 'sites.added', { domain: dv }), dv);
      }, function (err) {
        UI.toast('error', UI.errText(err));
      });
    });

    document.getElementById('sitesReset').addEventListener('click', function () {
      UI.confirm(t('sites.resetConfirm'), t('sites.reset')).then(function (ok) {
        if (!ok) return;
        api.resetMailSites().then(function (list) { saved(list, t('sites.resetDone')); }, function (e) {
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
      setHint(urlIn, urlHint, t('sites.prefill', { domain: opts.prefillDomain }), true);
      setTimeout(function () { urlIn.focus(); }, 0);
    }
  }

  window.SitesPage = { init: init, show: show };
})();
