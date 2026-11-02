// 「额度」页：账号卡片、排序、筛选
(function () {
  var api = window.claudeHelp;
  var fmt = window.UsageFormat;
  var UI = window.UI;
  var DAY = 86400000;

  var accounts = [];
  var seen = null; // email → recordedAt，用来找出刚更新的卡片
  var flashEmails = {};
  var sortKey = UI.storeGet('claude-help-sort', 'weekly');
  var query = '';
  var cardsEl, summaryEl, sortEl;

  function isWeekly(label) { return /^Weekly/i.test(label); }
  function isFiveHour(label) { return /5-hour/i.test(label); }

  // 只陈述状态，不做推荐
  function status(acc, now) {
    var exhausted = function (test) {
      return acc.windows.some(function (w) { return test(w.label) && !fmt.isRestored(w, now) && Number(w.percentUsed) >= 100; });
    };
    if (exhausted(isWeekly)) return { cls: 'danger', text: '每周已用尽' };
    if (exhausted(isFiveHour)) return { cls: 'warn', text: '5 小时已用尽' };
    return { cls: 'ok', text: '可用' };
  }

  // 进度条表示“剩余”，和大号数字一致；剩得越少颜色越警示
  function level(left) {
    return left <= 10 ? 'danger' : left <= 30 ? 'warn' : '';
  }

  function resetTitle(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return '重置时间：' + d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function meter(w, now) {
    var used = fmt.usedNow(w, now);
    var left = Math.max(0, 100 - used);
    var restored = fmt.isRestored(w, now);
    var box = UI.el('div', 'meter');

    var head = UI.el('div', 'meter-head');
    var value = UI.el('span', 'meter-value');
    value.append(UI.el('b', null, left + '%'), ' 剩余');
    head.append(UI.el('span', 'meter-label', fmt.labelText(w.label)), value);

    var track = UI.el('div', 'track');
    var fill = UI.el('span', 'fill ' + level(left));
    fill.style.width = left + '%';
    track.appendChild(fill);
    track.title = '已用 ' + used + '%，剩余 ' + left + '%';

    var foot = UI.el('div', 'meter-foot' + (restored ? ' restored' : ''));
    if (restored) {
      foot.append(UI.icon('check'), '已恢复');
    } else {
      foot.append(UI.icon('clock'), fmt.duration(new Date(w.resetsAt).getTime() - now) + '后重置');
      foot.title = resetTitle(w.resetsAt);
    }
    box.append(head, track, foot);
    return box;
  }

  function openMail(acc, btn) {
    api.openMail(acc.email).then(function (r) {
      if (r.opened) {
        UI.flashButton(btn, '已打开', 'check');
        UI.toast('success', '已复制 ' + acc.email + '，并在浏览器打开收信页');
      } else {
        UI.toast('warn', '已复制 ' + acc.email + '；还没有 ' + r.domain + ' 的收信地址，请补上网址');
        window.App.go('sites', { prefillDomain: r.domain });
      }
    }, function (e) {
      UI.toast('error', '打开收信页失败：' + UI.errText(e));
    });
  }

  function card(acc, now) {
    var c = UI.el('article', 'card' + (flashEmails[acc.email] ? ' flash' : ''));
    c.dataset.email = acc.email;

    var top = UI.el('div', 'card-top');
    var who = UI.el('div', 'who');
    var email = UI.el('div', 'email', acc.email);
    email.title = acc.email;
    var age = now - new Date(acc.recordedAt).getTime();
    var stale = age > DAY;
    var meta = UI.el('div', 'meta');
    meta.append(UI.el('span', 'plan', acc.plan || '未知套餐'));
    if (stale) {
      var warn = UI.el('span', 'stale');
      warn.append(UI.icon('alert'), Math.floor(age / DAY) + ' 天前记录 · 可能过期');
      warn.title = '在 Claude 里说“记录额度”即可更新';
      meta.append(warn);
    } else {
      meta.append('记录于 ' + fmt.ago(acc.recordedAt, now));
    }
    who.append(email, meta);
    var st = status(acc, now);
    top.append(UI.el('div', 'avatar', acc.email.charAt(0)), who, UI.el('span', 'chip ' + st.cls, st.text));

    var meters = UI.el('div', 'meters');
    acc.windows.forEach(function (w) { meters.appendChild(meter(w, now)); });

    var actions = UI.el('div', 'card-actions');
    var copyBtn = UI.button({ label: '复制账号', icon: 'copy', onClick: function () {
      api.copy(acc.email).then(function () { UI.flashButton(copyBtn, '已复制', 'check'); }, function (e) {
        UI.toast('error', '复制失败：' + UI.errText(e));
      });
    } });
    var mailBtn = UI.button({ label: '收信', icon: 'mail', variant: 'primary', title: '复制账号并在浏览器打开收信页', onClick: function () { openMail(acc, mailBtn); } });
    actions.append(copyBtn, mailBtn);

    c.append(top, meters, actions);
    return c;
  }

  function emptyState(text, steps) {
    var box = UI.el('div', 'empty');
    var ic = UI.el('div', 'empty-icon');
    ic.appendChild(UI.icon('inbox'));
    box.append(ic, UI.el('h2', null, text));
    if (steps) {
      var ol = UI.el('ol');
      steps.forEach(function (s) { ol.appendChild(UI.el('li', null, s)); });
      box.appendChild(ol);
    }
    return box;
  }

  function render() {
    var now = Date.now();
    var latest = accounts.reduce(function (m, a) { return Math.max(m, new Date(a.recordedAt).getTime() || 0); }, 0);
    summaryEl.textContent = accounts.length
      ? accounts.length + ' 个账号 · 最近记录 ' + fmt.ago(new Date(latest).toISOString(), now)
      : '还没有记录';

    [].forEach.call(sortEl.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-checked', String(b.dataset.sort === sortKey));
    });

    var q = query.trim().toLowerCase();
    var list = fmt.sortAccounts(accounts, sortKey, now).filter(function (a) { return !q || a.email.toLowerCase().indexOf(q) >= 0; });

    cardsEl.textContent = '';
    if (!accounts.length) {
      cardsEl.appendChild(emptyState('还没有额度记录', [
        '在 Claude 桌面端对 Claude 说“记录额度”。',
        'Claude 会读取当前账号的额度，并交给命令行 claude-help usage record 保存。',
        '记录完成后，这里会自动出现该账号，不用刷新。',
      ]));
      return;
    }
    if (!list.length) {
      cardsEl.appendChild(emptyState('没有匹配“' + query.trim() + '”的账号'));
      return;
    }
    list.forEach(function (a) { cardsEl.appendChild(card(a, now)); });
    flashEmails = {};
  }

  function setData(data) {
    accounts = (data && data.accounts) || [];
    var next = {};
    accounts.forEach(function (a) {
      next[a.email] = a.recordedAt;
      if (seen && seen[a.email] !== a.recordedAt) flashEmails[a.email] = true;
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

    api.getUsage().then(setData);
    api.onUsage(setData);
    setInterval(render, 30000);
  }

  function focusSearch() {
    document.getElementById('usageSearch').focus();
  }

  window.UsagePage = { init: init, show: function () {}, focusSearch: focusSearch };
})();
