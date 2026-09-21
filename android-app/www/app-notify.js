/**
 * One place every notification in the app goes through.
 *
 * Before this, exactly one thing could notify (an SMS import) and it did so with a hard-coded
 * channel id that was never created and a small-icon name that is not in the app's resources —
 * on Android 8+ a notification posted to a missing channel is dropped, so it probably never
 * appeared at all. Channels are created here explicitly, once, before anything is posted.
 *
 * Three delivery paths, in order of preference:
 *   1. Capacitor LocalNotifications — the real thing, appears on the phone's screen and in the
 *      shade. Only present inside the APK.
 *   2. Web Notifications — so the same code path can be exercised in a browser during testing.
 *   3. An in-app toast — always shown, so an event is never silently swallowed when permission
 *      was denied or the app is in the foreground (where Android often suppresses its own).
 *
 * Honest limit: a local notification needs this app to be running, or to have been scheduled in
 * advance. Nothing here can wake the phone for a price move while the app is closed — that needs
 * a background service (native code) or a push server, and neither exists yet. The settings page
 * says so rather than implying alerts arrive while the app is shut.
 */
window.IMB_NOTIFY = function (ctx) {
  'use strict';

  var fa = ctx.fa, pct = ctx.pct, esc = ctx.esc, isNum = ctx.isNum;
  var jget = ctx.jget, jset = ctx.jset, redraw = ctx.redraw, snapshot = ctx.snapshot;

  var PREF_KEY = 'imb.notif.prefs.v2';
  var ALERT_KEY = 'imb.notif.alerts.v1';
  var SEEN_KEY = 'imb.notif.seen.v1';
  var LOG_KEY = 'imb.notif.log.v1';

  var CATS = [
    { k: 'trade', t: 'معاملات برخط', d: 'هر خرید و فروش معامله‌گر برخط و پایان جلسه' },
    { k: 'alert', t: 'هشدار قیمت', d: 'هشدارهایی که خودتان تعریف می‌کنید' },
    { k: 'move', t: 'جهش قیمت', d: 'وقتی دارایی بیش از حد تعیین‌شده در روز جابه‌جا شود' },
    { k: 'sms', t: 'پیامک بانکی', d: 'تراکنش تازه‌ای که از پیامک خوانده شد' },
    { k: 'data', t: 'وضعیت داده', d: 'قطع شدن داده یا کهنه شدن قیمت‌ها' }
  ];

  var DEFAULTS = { on: true, trade: true, alert: true, move: true, sms: true, data: false, movePct: 2 };

  function prefs() {
    var p = jget(PREF_KEY, null);
    if (!p || typeof p !== 'object') return JSON.parse(JSON.stringify(DEFAULTS));
    for (var k in DEFAULTS) if (p[k] === undefined) p[k] = DEFAULTS[k];
    return p;
  }
  function setPref(k, v) { var p = prefs(); p[k] = v; jset(PREF_KEY, p); }
  function alerts() { var a = jget(ALERT_KEY, []); return Array.isArray(a) ? a : []; }
  function setAlerts(a) { jset(ALERT_KEY, a.slice(0, 40)); }
  function log() { var l = jget(LOG_KEY, []); return Array.isArray(l) ? l : []; }

  function plugin() {
    var C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.LocalNotifications) ? C.Plugins.LocalNotifications : null;
  }

  var channelsReady = false;
  /** Android 8+ drops anything posted to a channel that was never created. */
  function ensureChannels(plug) {
    if (channelsReady || !plug || !plug.createChannel) { channelsReady = true; return Promise.resolve(); }
    channelsReady = true;
    return Promise.all(CATS.map(function (c) {
      return plug.createChannel({
        id: 'imb-' + c.k,
        name: c.t,
        description: c.d,
        importance: c.k === 'trade' || c.k === 'alert' ? 4 : 3,
        visibility: 1
      }).catch(function () { /* an older plugin without channels still posts to the default one */ });
    })).catch(function () {});
  }

  // ── in-app toast: the always-available fallback ──
  function toast(title, body) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<b>' + esc(title) + '</b>' + (body ? '<span>' + esc(body) + '</span>' : '');
    host.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, 4200);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4800);
  }

  function remember(title, body, cat) {
    var l = log();
    l.unshift({ at: Date.now(), title: title, body: body, cat: cat });
    jset(LOG_KEY, l.slice(0, 60));
  }

  /**
   * @param cat one of CATS; an unknown category is treated as always-on so a new caller
   *            can never be silently muted by a stale preference object.
   */
  function notify(title, body, cat) {
    cat = cat || 'trade';
    var p = prefs();
    if (!p.on) return;
    if (p[cat] === false) return;
    remember(title, body, cat);
    toast(title, body);

    var plug = plugin();
    if (plug) {
      ensureChannels(plug).then(function () {
        return plug.checkPermissions().then(function (perm) {
          if (perm && perm.display === 'granted') return true;
          return plug.requestPermissions().then(function (r) { return !!(r && r.display === 'granted'); });
        });
      }).then(function (ok) {
        if (!ok) return;
        return plug.schedule({
          notifications: [{
            id: Math.floor(Math.random() * 2000000000),
            title: title,
            body: body || '',
            channelId: 'imb-' + cat
          }]
        });
      }).catch(function () { /* a failed notification must never break what triggered it */ });
      return;
    }
    // browser fallback, used during development and on the web build
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'granted') new Notification(title, { body: body || '' });
      else if (Notification.permission !== 'denied') Notification.requestPermission();
    } catch (e) { /* ignore */ }
  }

  function askPermission() {
    var plug = plugin();
    if (plug) {
      ensureChannels(plug).then(function () { return plug.requestPermissions(); })
        .then(function () { notify('اعلان‌ها فعال شد', 'از این پس رویدادهای اپ اینجا اطلاع داده می‌شوند.', 'trade'); })
        .catch(function () {});
      return;
    }
    try {
      if (typeof Notification !== 'undefined') Notification.requestPermission();
      notify('اعلان‌ها فعال شد', 'در مرورگر فقط تا وقتی اپ باز است کار می‌کند.', 'trade');
    } catch (e) {}
  }

  // ── market watching: custom alerts + big daily moves ──
  function seen() { var s = jget(SEEN_KEY, {}); return (s && typeof s === 'object') ? s : {}; }
  function today() { return new Date().toISOString().slice(0, 10); }

  function itemsOf(snap) { return (snap && snap.live && snap.live.items) || []; }

  /**
   * Run after every successful data refresh. Alerts fire once and then disarm, so a price
   * hovering on the threshold cannot produce a stream of identical notifications.
   */
  function check(snap) {
    var p = prefs();
    if (!p.on) return;
    var items = itemsOf(snap);
    if (!items.length) return;
    var byKey = {};
    items.forEach(function (i) { byKey[i.key] = i; });

    if (p.alert !== false) {
      var list = alerts(), changed = false;
      list.forEach(function (a) {
        if (a.fired) return;
        var it = byKey[a.asset];
        if (!it || !isNum(it.price)) return;
        var hit = a.dir === 'above' ? it.price >= a.value : it.price <= a.value;
        if (!hit) return;
        a.fired = Date.now();
        changed = true;
        notify(
          'هشدار: ' + it.label,
          'قیمت به ' + fa(Math.round(it.price)) + ' رسید (' + (a.dir === 'above' ? 'بالاتر از ' : 'پایین‌تر از ') + fa(a.value) + ')',
          'alert'
        );
      });
      if (changed) setAlerts(list);
    }

    if (p.move !== false) {
      var thr = isNum(p.movePct) ? Math.abs(p.movePct) : 2;
      var raw = jget(SEEN_KEY, null);
      // First ever run: half the board is usually already past the threshold, and firing one
      // notification per asset the moment the app is installed is how people turn notifications
      // off. Record today's moves silently and start notifying from the next change.
      var priming = !raw || typeof raw !== 'object';
      var s = priming ? {} : raw;
      var d = today(), touched = false, sent = 0, skipped = 0;
      items.forEach(function (it) {
        if (!isNum(it.changePct) || Math.abs(it.changePct) < thr) return;
        var key = d + ':' + it.key;
        if (s[key]) return;
        s[key] = 1;
        touched = true;
        if (priming) return;
        // a burst of identical notifications is noise; past a few, summarise instead
        if (sent >= 3) { skipped++; return; }
        sent++;
        notify(
          it.label + ' ' + (it.changePct > 0 ? 'جهش کرد' : 'افت کرد'),
          'تغییر امروز ' + pct(it.changePct) + ' · قیمت ' + fa(Math.round(it.price)),
          'move'
        );
      });
      if (skipped) notify('حرکت گسترده بازار', fa(skipped + sent) + ' دارایی امروز بیش از ' + fa(thr) + '٪ جابه‌جا شدند.', 'move');
      if (touched || priming) {
        // keep only today's marks, or this grows forever
        var keep = {};
        Object.keys(s).forEach(function (k) { if (k.indexOf(d + ':') === 0) keep[k] = 1; });
        jset(SEEN_KEY, keep);
      }
    }
  }

  // ── settings page ──
  function renderSettings() {
    var p = prefs();
    var items = itemsOf(snapshot());
    var out = '<div class="pad-x"><div class="btn-row">' +
      '<button class="addbtn" id="ntfAsk">فعال‌سازی اعلان روی گوشی</button></div></div>';

    out += ctx.card('اعلان‌ها', '<div class="row"><span class="label">همه اعلان‌ها<small>اگر خاموش باشد هیچ اعلانی فرستاده نمی‌شود</small></span>' +
      '<button class="sw" data-ntf="on" aria-pressed="' + (p.on !== false) + '" aria-label="همه اعلان‌ها"></button></div>' +
      CATS.map(function (c) {
        return '<div class="row"><span class="label">' + esc(c.t) + '<small>' + esc(c.d) + '</small></span>' +
          '<button class="sw" data-ntf="' + c.k + '" aria-pressed="' + (p[c.k] !== false) + '" aria-label="' + esc(c.t) + '"></button></div>';
      }).join('') +
      '<div class="row"><span class="label">آستانه جهش روزانه<small>بالاتر از این درصد، اعلان می‌فرستد</small></span>' +
      '<input id="ntfMove" class="mini-num num" inputmode="decimal" value="' + esc(String(p.movePct)) + '" aria-label="آستانه جهش" /><span class="unit">٪</span></div>');

    var list = alerts();
    out += ctx.card('هشدارهای قیمت من', (list.length
      ? list.map(function (a, i) {
        var it = items.filter(function (x) { return x.key === a.asset; })[0];
        return '<div class="row"><span class="label">' + esc(it ? it.label : a.asset) +
          '<small>' + (a.dir === 'above' ? 'وقتی بالاتر از ' : 'وقتی پایین‌تر از ') + fa(a.value) + (a.fired ? ' · اجرا شد' : '') + '</small></span>' +
          '<button class="iconbtn dark" data-ntfdel="' + i + '" aria-label="حذف">✕</button></div>';
      }).join('')
      : '<div class="row"><span class="label muted">هنوز هشداری تعریف نشده است.</span></div>') +
      '<div class="row wrap"><select id="ntfAsset" aria-label="دارایی">' +
      items.filter(function (i) { return isNum(i.price); }).map(function (i) {
        return '<option value="' + esc(i.key) + '">' + esc(i.label) + '</option>';
      }).join('') + '</select>' +
      '<select id="ntfDir" aria-label="جهت"><option value="above">بالاتر از</option><option value="below">پایین‌تر از</option></select>' +
      '<input id="ntfVal" class="num" inputmode="numeric" placeholder="قیمت" aria-label="قیمت" />' +
      '<button class="chipbtn" id="ntfAdd">افزودن</button></div>');

    var l = log();
    out += ctx.card('اعلان‌های اخیر', l.length
      ? l.slice(0, 20).map(function (e) {
        return '<div class="row"><span class="label">' + esc(e.title) + '<small>' + esc(e.body || '') + '</small></span>' +
          '<span class="muted" style="font-size:11.5px">' + esc(new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(new Date(e.at))) + '</span></div>';
      }).join('')
      : '<div class="row"><span class="label muted">هنوز اعلانی ثبت نشده است.</span></div>');

    return out + ctx.banner('اعلان‌ها وقتی اپ بسته است فرستاده نمی‌شوند. هر بار که اپ را باز کنید قیمت‌ها بررسی و هشدارهای رسیده اعلام می‌شوند.', 'warn');
  }

  function onClick(e) {
    var t = e.target;
    var sw = t.closest && t.closest('[data-ntf]');
    if (sw) {
      var k = sw.getAttribute('data-ntf');
      setPref(k, sw.getAttribute('aria-pressed') !== 'true');
      redraw();
      return true;
    }
    var del = t.closest && t.closest('[data-ntfdel]');
    if (del) {
      var i = Number(del.getAttribute('data-ntfdel'));
      var l = alerts();
      if (i >= 0 && i < l.length) { l.splice(i, 1); setAlerts(l); redraw(); }
      return true;
    }
    if (t.id === 'ntfAsk') { askPermission(); return true; }
    if (t.id === 'ntfAdd') {
      var a = document.getElementById('ntfAsset'), d = document.getElementById('ntfDir'), v = document.getElementById('ntfVal');
      var val = Number(String(v && v.value).replace(/[^\d.]/g, ''));
      if (!a || !isNum(val) || val <= 0) { toast('قیمت نامعتبر', 'یک عدد مثبت وارد کنید.'); return true; }
      var list = alerts();
      list.unshift({ asset: a.value, dir: d ? d.value : 'above', value: val, fired: 0 });
      setAlerts(list);
      redraw();
      return true;
    }
    return false;
  }

  function onChange(e) {
    if (e.target.id === 'ntfMove') {
      var n = Number(String(e.target.value).replace(/[^\d.]/g, ''));
      setPref('movePct', isNum(n) && n > 0 ? n : 2);
      return true;
    }
    return false;
  }

  return {
    notify: notify,
    check: check,
    pages: [{ id: 'notif', icon: '🔔', title: 'اعلان‌ها', group: 'شخصی', render: renderSettings, offline: true }],
    onClick: onClick,
    onChange: onChange
  };
};
