// 「额度」页：账号卡片、排序、筛选
(function () {
  var api = window.claudeHelp;
  var fmt = window.UsageFormat;
  var UI = window.UI;
  var t = UI.t;
  var DAY = 86400000;

  var accounts = [];
  var seen = null; // email → recordedAt，用来找出刚更新的卡片
  var flashUntil = {}; // email → 高亮截止时间；按时间判断，中途重绘也不会丢
  var FLASH_MS = 1800;
  var sortKey = UI.storeGet('claude-help-sort', 'weekly');
  var query = '';
  var cardsEl, summaryEl, sortEl;
  var addDialog, addInput, addHint;
  var mailBusy = null; // 正在收信的邮箱

  function isWeekly(label) { return /^Weekly/i.test(label); }
  function isFiveHour(label) { return /5-hour/i.test(label); }

  // 只陈述状态，不做推荐
  function status(acc, now) {
    if (!fmt.hasUsage(acc)) return { cls: 'muted', text: t('usage.notRecorded') };
    var exhausted = function (test) {
      return acc.windows.some(function (w) { return test(w.label) && !fmt.isRestored(w, now) && Number(w.percentUsed) >= 100; });
    };
    if (exhausted(isWeekly)) return { cls: 'danger', text: t('usage.weeklyOut') };
    if (exhausted(isFiveHour)) return { cls: 'warn', text: t('usage.fiveHourOut') };
    return { cls: 'ok', text: t('usage.available') };
  }

  // 进度条表示“剩余”，和大号数字一致；剩得越少颜色越警示
  function level(left) {
    return left <= 10 ? 'danger' : left <= 30 ? 'warn' : '';
  }

  function resetTitle(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return t('usage.resetAt', { time: d.toLocaleString(t.locale, { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }) });
  }

  function meter(w, now) {
    var used = fmt.usedNow(w, now);
    var left = Math.max(0, 100 - used);
    var restored = fmt.isRestored(w, now);
    var box = UI.el('div', 'meter');

    var head = UI.el('div', 'meter-head');
    var value = UI.el('span', 'meter-value');
    value.append(UI.el('b', null, left + '%'), t('usage.left'));
    head.append(UI.el('span', 'meter-label', fmt.labelText(w.label)), value);

    var track = UI.el('div', 'track');
    var fill = UI.el('span', 'fill ' + level(left));
    fill.style.width = left + '%';
    track.appendChild(fill);
    track.title = t('usage.trackTitle', { used: used, left: left });

    var foot = UI.el('div', 'meter-foot' + (restored ? ' restored' : ''));
    if (restored) {
      foot.append(UI.icon('check'), t('usage.restored'));
    } else if (w.resetsAt) {
      // 自动同步推算出的重置时间前面加“约”
      var key = w.resetsAtEstimated ? 'usage.resetsInApprox' : 'usage.resetsIn';
      foot.append(UI.icon('clock'), t(key, { time: fmt.duration(new Date(w.resetsAt).getTime() - now) }));
      foot.title = resetTitle(w.resetsAt) + (w.resetsAtEstimated ? '\n' + t('usage.resetApprox') : '');
    }
    box.append(head, track, foot);
    return box;
  }

  // 收信进行中（可能要操作桌面端十几秒）：所有收信按钮禁用，正在处理的那张显示“处理中…”；中途重绘也保持
  function setMailBusy(email) {
    mailBusy = email;
    [].forEach.call(cardsEl.querySelectorAll('button[data-mail]'), function (b) { markMailButton(b, b.dataset.mail); });
  }

  function markMailButton(b, email) {
    b.disabled = Boolean(mailBusy);
    b.querySelector('.btn-label').textContent = mailBusy === email ? t('usage.mailWorking') : t('usage.mail');
  }

  function mailButtonOf(email) {
    return [].filter.call(cardsEl.querySelectorAll('button[data-mail]'), function (b) { return b.dataset.mail === email; })[0];
  }

  // 认不出桌面端当前的号时问一句：返回 same | switch，取消返回空串
  function askSame(email) {
    var dialog = document.getElementById('sameDialog');
    document.getElementById('sameTitle').textContent = t('usage.sameTitle', { email: email });
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(function (resolve) {
      dialog.addEventListener('close', function () { resolve(dialog.returnValue); }, { once: true });
    });
  }

  // 主进程先判断桌面端是不是这个号：是就只读额度；不是就读旧账号的额度，再退出登录、填邮箱、点继续，然后打开收信页
  function openMail(acc, answer) {
    setMailBusy(acc.email);
    api.openMail(acc.email, answer).then(function (r) {
      setMailBusy(null);
      if (r.ask) {
        return askSame(acc.email).then(function (a) { if (a) openMail(acc, a); });
      }
      var login = r.login;
      var usage = r.usage;
      if (login && !login.ok) {
        UI.toast('warn', t('usage.loginFailed', { email: acc.email, step: t('usage.step.' + login.step) }));
      } else if (login && login.action === 'filled') {
        UI.toast('success', t('usage.loginFilled', { email: acc.email }));
      }
      // 同号只记额度，不打开收信页
      if (login && login.ok && login.action === 'none') {
        if (usage && usage.ok) UI.toast('success', t('usage.usageRecordedOnly', { email: usage.email }));
        else if (usage) UI.toast('warn', t('usage.usageFailedOnly', { step: t('usage.usageStep.' + usage.step) }));
        return;
      }
      // 读额度失败不影响收信，单独提示
      if (usage && !usage.ok) UI.toast('warn', t('usage.usageFailed', { step: t('usage.usageStep.' + usage.step) }));
      if (r.opened) {
        var btn = mailButtonOf(acc.email);
        if (btn) UI.flashButton(btn, t('usage.opened'), 'check');
        if (usage && usage.ok) UI.toast('success', t('usage.usageRecorded', { email: usage.email }));
        else if (!usage && (!login || login.action === 'none')) UI.toast('success', t('usage.mailOpened', { email: acc.email }));
      } else {
        UI.toast('warn', t('usage.mailNoSite', { email: acc.email, domain: r.domain }));
        window.App.go('sites', { prefillDomain: r.domain });
      }
    }, function (e) {
      setMailBusy(null);
      UI.toast('error', t('usage.mailFailed', { err: UI.errText(e) }));
    });
  }

  // 删除前确认；删除后提示条里可「撤销」，把原记录（含记录时间）放回
  function removeAccount(acc) {
    UI.confirm(t('usage.removeConfirm', { email: acc.email }), t('common.delete')).then(function (ok) {
      if (!ok) return;
      api.removeUsage(acc.email).then(function (r) {
        accounts = accounts.filter(function (a) { return a.email !== r.removed.email; });
        render();
        UI.toast('success', t('usage.removed', { email: r.removed.email }), { label: t('common.undo'), onClick: function () {
          api.restoreUsage(r.removed).then(function () {
            flashUntil[r.removed.email] = Date.now() + FLASH_MS;
            return api.getUsage().then(setData);
          }, function (e) { UI.toast('error', t('usage.undoFailed', { err: UI.errText(e) })); });
        } });
      }, function (e) {
        UI.toast('error', t('common.deleteFailed', { err: UI.errText(e) }));
      });
    });
  }

  function card(acc, now) {
    var c = UI.el('article', 'card' + (flashUntil[acc.email] > now ? ' flash' : ''));
    c.dataset.email = acc.email;

    var top = UI.el('div', 'card-top');
    var who = UI.el('div', 'who');
    var email = UI.el('div', 'email', acc.email);
    email.title = acc.email;
    var age = now - new Date(acc.recordedAt).getTime();
    var stale = age > DAY;
    var meta = UI.el('div', 'meta');
    if (!fmt.hasUsage(acc)) {
      meta.append(t('usage.noUsage'));
      meta.title = t('usage.noUsageTitle');
    } else if (stale) {
      meta.append(UI.el('span', 'plan', acc.plan || t('usage.unknownPlan')));
      var warn = UI.el('span', 'stale');
      warn.append(UI.icon('alert'), t('usage.stale', { days: Math.floor(age / DAY) }));
      warn.title = t('usage.staleTitle');
      meta.append(warn);
    } else {
      meta.append(UI.el('span', 'plan', acc.plan || t('usage.unknownPlan')), t('usage.recordedAgo', { ago: fmt.ago(acc.recordedAt, now) }));
      // 自动同步来的记录只有百分比，标出来
      if (acc.source === 'desktop') {
        var auto = UI.el('span', 'auto', t('usage.auto'));
        auto.title = t('usage.autoTitle');
        meta.append(auto);
      }
    }
    who.append(email, meta);
    var st = status(acc, now);
    var del = UI.button({ label: t('usage.deleteRecord'), icon: 'trash', variant: 'icon', onClick: function () { removeAccount(acc); } });
    del.classList.add('danger-hover');
    top.append(UI.el('div', 'avatar', acc.email.charAt(0)), who, UI.el('span', 'chip ' + st.cls, st.text), del);

    var meters = UI.el('div', 'meters');
    if (fmt.hasUsage(acc)) acc.windows.forEach(function (w) { meters.appendChild(meter(w, now)); });
    else meters.appendChild(UI.el('div', 'no-usage', t('usage.noUsageText')));

    var actions = UI.el('div', 'card-actions');
    var copyBtn = UI.button({ label: t('usage.copyAccount'), icon: 'copy', onClick: function () {
      api.copy(acc.email).then(function () { UI.flashButton(copyBtn, t('common.copied'), 'check'); }, function (e) {
        UI.toast('error', t('common.copyFailed', { err: UI.errText(e) }));
      });
    } });
    var mailBtn = UI.button({ label: t('usage.mail'), icon: 'mail', variant: 'primary', title: t('usage.mailTitle'), onClick: function () { openMail(acc); } });
    mailBtn.dataset.mail = acc.email;
    markMailButton(mailBtn, acc.email);
    actions.append(copyBtn, mailBtn);

    c.append(top, meters, actions);
    return c;
  }

  function emptyState(text, steps, action) {
    var box = UI.el('div', 'empty');
    var ic = UI.el('div', 'empty-icon');
    ic.appendChild(UI.icon('inbox'));
    box.append(ic, UI.el('h2', null, text));
    if (steps) {
      var ol = UI.el('ol');
      steps.forEach(function (s) { ol.appendChild(UI.el('li', null, s)); });
      box.appendChild(ol);
    }
    if (action) box.appendChild(action);
    return box;
  }

  // 手动添加账号：额度先空着，以后记录额度时整条覆盖
  function openAddDialog() {
    addInput.value = '';
    setAddHint('');
    addDialog.showModal();
    addInput.focus();
  }

  function setAddHint(msg) {
    addHint.textContent = msg;
    addInput.classList.toggle('invalid', Boolean(msg));
  }

  function submitAdd(e) {
    e.preventDefault();
    var email = addInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAddHint(t(email ? 'usage.emailInvalid' : 'usage.emailRequired'));
      return addInput.focus();
    }
    var key = email.toLowerCase();
    if (accounts.some(function (a) { return a.email.toLowerCase() === key; })) {
      setAddHint(t('usage.emailExists'));
      return addInput.focus();
    }
    api.addAccount(email).then(function (r) {
      addDialog.close();
      flashUntil[r.record.email] = Date.now() + FLASH_MS;
      UI.toast('success', t('usage.added', { email: r.record.email }));
      return api.getUsage().then(setData);
    }, function (err) {
      setAddHint(UI.errText(err));
    });
  }

  function render() {
    var now = Date.now();
    var latest = accounts.reduce(function (m, a) { return Math.max(m, new Date(a.recordedAt).getTime() || 0); }, 0);
    summaryEl.textContent = !accounts.length ? t('usage.summaryNone')
      : t('usage.accounts', { n: accounts.length }) + ' · ' + (latest ? t('usage.lastRecorded', { ago: fmt.ago(new Date(latest).toISOString(), now) }) : t('usage.noUsage'));

    [].forEach.call(sortEl.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-checked', String(b.dataset.sort === sortKey));
    });

    var q = query.trim().toLowerCase();
    var list = fmt.sortAccounts(accounts, sortKey, now).filter(function (a) { return !q || a.email.toLowerCase().indexOf(q) >= 0; });

    cardsEl.textContent = '';
    if (!accounts.length) {
      cardsEl.appendChild(emptyState(t('usage.emptyTitle'), [
        t('usage.emptyStep1'),
        t('usage.emptyStep2'),
        t('usage.emptyStep3'),
      ], UI.button({ label: t('usage.add'), icon: 'plus', variant: 'primary', onClick: openAddDialog })));
      return;
    }
    if (!list.length) {
      cardsEl.appendChild(emptyState(t('usage.noMatch', { q: query.trim() })));
      return;
    }
    list.forEach(function (a) { cardsEl.appendChild(card(a, now)); });
  }

  function setData(data) {
    accounts = (data && data.accounts) || [];
    var next = {};
    accounts.forEach(function (a) {
      next[a.email] = a.recordedAt;
      if (seen && seen[a.email] !== a.recordedAt) flashUntil[a.email] = Date.now() + FLASH_MS;
    });
    seen = next;
    render();
  }

  function init() {
    cardsEl = document.getElementById('cards');
    summaryEl = document.getElementById('usageSummary');
    sortEl = document.getElementById('usageSort');
    var search = document.getElementById('usageSearch');

    sortEl.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-sort]');
      if (!b) return;
      sortKey = b.dataset.sort;
      UI.storeSet('claude-help-sort', sortKey);
      render();
    });
    search.addEventListener('input', function () {
      query = search.value;
      render();
    });

    addDialog = document.getElementById('addAccountDialog');
    addInput = document.getElementById('addAccountEmail');
    addHint = document.getElementById('addAccountHint');
    document.getElementById('usageAdd').addEventListener('click', openAddDialog);
    document.getElementById('addAccountForm').addEventListener('submit', submitAdd);
    document.getElementById('addAccountCancel').addEventListener('click', function () { addDialog.close(); });
    addInput.addEventListener('input', function () { setAddHint(''); });

    api.getUsage().then(setData);
    api.onUsage(setData);
    setInterval(render, 30000);
  }

  function focusSearch() {
    document.getElementById('usageSearch').focus();
  }

  window.UsagePage = { init: init, show: function () {}, focusSearch: focusSearch };
})();
