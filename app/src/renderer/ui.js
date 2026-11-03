// 各页面共用的小工具：界面文字、图标、DOM、按钮、提示条、确认框
(function () {
  // 界面语言由主进程算好（跟随系统 / 中文 / English），切换后整页重新加载
  var t = window.I18n.create(window.claudeHelp.lang);
  window.UsageFormat.setLang(t.lang);
  document.documentElement.lang = t.locale;

  // 静态 HTML 里的文字用 data-i18n（正文）、data-i18n-placeholder、data-i18n-title、data-i18n-aria 标出 key
  function applyI18n(root) {
    var attrs = { 'data-i18n-placeholder': 'placeholder', 'data-i18n-title': 'title', 'data-i18n-aria': 'aria-label' };
    [].forEach.call(root.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    Object.keys(attrs).forEach(function (a) {
      [].forEach.call(root.querySelectorAll('[' + a + ']'), function (node) {
        node.setAttribute(attrs[a], t(node.getAttribute(a)));
      });
    });
  }

  var P = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONS = {
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.5"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4"/><path d="M12 17v.5"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    history:'<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
  };

  function iconSvg(name) {
    return P + (ICONS[name] || '') + '</svg>';
  }

  function icon(name) {
    var span = document.createElement('span');
    span.className = 'icon';
    span.innerHTML = iconSvg(name);
    return span;
  }

  // 静态 HTML 里的 <span class="icon" data-icon="..."> 在启动时填充
  function hydrateIcons(root) {
    [].forEach.call((root || document).querySelectorAll('[data-icon]'), function (node) {
      node.innerHTML = iconSvg(node.getAttribute('data-icon'));
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // variant: primary | ghost | danger | icon；icon 型按钮只显示图标，文字放进 title
  function button(opts) {
    var b = el('button', 'btn' + (opts.variant ? ' ' + opts.variant : ''));
    b.type = 'button';
    if (opts.icon) b.appendChild(icon(opts.icon));
    if (opts.variant === 'icon') {
      b.title = opts.label;
      b.setAttribute('aria-label', opts.label);
    } else {
      b.appendChild(el('span', 'btn-label', opts.label));
      if (opts.title) b.title = opts.title;
    }
    if (opts.onClick) b.addEventListener('click', opts.onClick);
    return b;
  }

  // 按钮上短暂显示结果，比如“已复制 ✓”
  function flashButton(b, text, iconName) {
    var label = b.querySelector('.btn-label');
    var ic = b.querySelector('.icon');
    if (b._flashTimer) clearTimeout(b._flashTimer);
    else b._orig = { text: label && label.textContent, icon: ic && ic.innerHTML };
    if (label) label.textContent = text;
    if (ic && iconName) ic.innerHTML = iconSvg(iconName);
    b.classList.add('flashed');
    b._flashTimer = setTimeout(function () {
      if (label) label.textContent = b._orig.text;
      if (ic) ic.innerHTML = b._orig.icon;
      b.classList.remove('flashed');
      b._flashTimer = null;
    }, 1600);
  }

  var TOAST_ICONS = { success: 'check', warn: 'alert', error: 'error', info: 'info' };

  // action：{ label, onClick }，在提示条右侧放一个按钮（比如「撤销」），有按钮时多停留几秒
  function toast(type, text, action) {
    var box = document.getElementById('toasts');
    var t = el('div', 'toast ' + type);
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.append(icon(TOAST_ICONS[type] || 'info'), el('span', 'toast-text', text));
    function dismiss() {
      t.classList.add('leaving');
      setTimeout(function () { t.remove(); }, 200);
    }
    if (action) {
      var b = el('button', 'toast-action', action.label);
      b.type = 'button';
      b.addEventListener('click', function () { dismiss(); action.onClick(); });
      t.appendChild(b);
    }
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(dismiss, action ? 8000 : type === 'error' ? 5000 : 3000);
  }

  function confirm(text, okText) {
    var dialog = document.getElementById('confirmDialog');
    document.getElementById('confirmText').textContent = text;
    document.getElementById('confirmOk').textContent = okText || t('common.ok');
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(function (resolve) {
      dialog.addEventListener('close', function () { resolve(dialog.returnValue === 'ok'); }, { once: true });
    });
  }

  // 点 × 时的询问：返回 { action: 'tray' | 'quit' | 'cancel', remember }；Esc 算取消
  function askClose() {
    var dialog = document.getElementById('closeDialog');
    var remember = document.getElementById('closeRemember');
    remember.checked = false;
    dialog.returnValue = '';
    if (!dialog.open) dialog.showModal();
    return new Promise(function (resolve) {
      dialog.addEventListener('close', function () {
        var action = dialog.returnValue || 'cancel';
        resolve({ action: action, remember: action !== 'cancel' && remember.checked });
      }, { once: true });
    });
  }

  // 主进程抛出的错误带着 “Error invoking remote method …” 前缀，只留真正的原因
  function errText(e) {
    return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  function storeGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  function storeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  window.UI = {
    t: t,
    applyI18n: applyI18n,
    icon: icon,
    hydrateIcons: hydrateIcons,
    el: el,
    button: button,
    flashButton: flashButton,
    toast: toast,
    confirm: confirm,
    askClose: askClose,
    errText: errText,
    storeGet: storeGet,
    storeSet: storeSet,
  };
})();
