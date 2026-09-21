/**
 * The trading half of the app: scenarios, charts, swing backtests, the historical trader, and
 * the live paper trader.
 *
 * Kept out of index.html for the same reason game-engine.js is: the shell was already long
 * enough that finding anything in it had become the hard part.
 *
 * The one that matters architecturally is the live trader. On the website there is a single
 * shared session in Redis — everyone sees the same trader. On a phone that is wrong: each person
 * wants their own run with their own money. So here the session lives in this device's
 * localStorage and never touches server storage. `/api/live/local` is stateless: it takes the
 * session, applies live prices to it with the same engine the website uses, and hands it back.
 * Two phones never see each other, and nothing about either run is stored on the server.
 *
 * Contract with the shell: window.IMB_TRADE(ctx) returns { pages, onClick, onChange }. `ctx`
 * carries the shell's own helpers so nothing here re-implements formatting or storage.
 */
window.IMB_TRADE = function (ctx) {
  'use strict';

  var API = ctx.API, fa = ctx.fa, pct = ctx.pct, esc = ctx.esc, isNum = ctx.isNum;
  var jget = ctx.jget, jset = ctx.jset, notify = ctx.notify, toman = ctx.toman;
  var card = ctx.card, banner = ctx.banner, redraw = ctx.redraw, snapshot = ctx.snapshot;

  var LIVE_KEY = 'imb.live.session.v1';
  var PREF_KEY = 'imb.trade.prefs.v1';
  var CAPITALS = [50e6, 100e6, 500e6, 1e9];

  // Per-page transient state. Kept here rather than in localStorage: a half-finished backtest is
  // not something anyone wants restored three days later.
  var st = {
    chart: { asset: 'usd', tf: '1m', data: null, busy: false, err: null },
    swing: { coin: 'bitcoin', symbol: 'BTC', days: 60, preset: 'normal', res: null, busy: false, err: null, menu: null },
    sim: { res: null, busy: false, err: null, cov: null },
    live: { s: null, busy: false, err: null, meta: null, cfg: null },
    scn: { group: 'all' }
  };

  function prefs() { return jget(PREF_KEY, {}) || {}; }
  function setPref(k, v) { var p = prefs(); p[k] = v; jset(PREF_KEY, p); }

  function api(path, opts) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, (opts && opts.timeout) || 70000);
    var o = { signal: ctl.signal, headers: { 'content-type': 'application/json' } };
    if (opts && opts.body) { o.method = 'POST'; o.body = JSON.stringify(opts.body); }
    return fetch(API + path, o)
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok || (x.j && x.j.error)) throw new Error((x.j && x.j.error) || 'خطای سرور');
        return x.j;
      })
      .then(function (j) { clearTimeout(timer); return j; }, function (e) {
        clearTimeout(timer);
        throw new Error(e && e.name === 'AbortError' ? 'زمان انتظار تمام شد؛ دوباره تلاش کنید.' : (e && e.message) || 'خطای نامشخص');
      });
  }

  // ── small shared bits ──
  function seg(name, opts, val) {
    return '<div class="chips seg" role="group">' + opts.map(function (o) {
      return '<button data-seg="' + name + '" data-v="' + esc(o.k) + '" aria-pressed="' + (String(o.k) === String(val)) + '">' + esc(o.t) + '</button>';
    }).join('') + '</div>';
  }
  function kv(k, v, cls) {
    return '<div class="row"><span class="label">' + esc(k) + '</span><span class="val ' + (cls || '') + '">' + v + '</span></div>';
  }
  function statGrid(items) {
    return '<div class="stat-grid">' + items.map(function (i) {
      return '<div><span class="sg-k">' + esc(i.k) + '</span><span class="sg-v ' + (i.cls || '') + '">' + i.v + '</span></div>';
    }).join('') + '</div>';
  }
  var dirOf = function (n) { return !isNum(n) || n === 0 ? '' : n > 0 ? 'up' : 'down'; };
  function faTime(ms) {
    try { return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)); }
    catch (e) { return ''; }
  }

  /** Inline SVG line chart. No library: one more dependency that fails on a bad connection. */
  function lineChart(points, opts) {
    opts = opts || {};
    if (!points || points.length < 2) return '<div class="center muted">داده کافی برای رسم نمودار نیست.</div>';
    var W = 320, H = 150, P = 4;
    var xs = points.map(function (p) { return p[0]; });
    var ys = points.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var dx = x1 - x0 || 1, dy = y1 - y0 || 1;
    var px = function (v) { return P + ((v - x0) / dx) * (W - 2 * P); };
    var py = function (v) { return H - P - ((v - y0) / dy) * (H - 2 * P); };
    var d = points.map(function (p, i) { return (i ? 'L' : 'M') + px(p[0]).toFixed(1) + ' ' + py(p[1]).toFixed(1); }).join(' ');
    var area = d + ' L' + px(x1).toFixed(1) + ' ' + (H - P) + ' L' + px(x0).toFixed(1) + ' ' + (H - P) + ' Z';
    var rising = ys[ys.length - 1] >= ys[0];
    var col = rising ? '#17804f' : '#b83a2f';
    return '<div class="chart-host"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(opts.label || 'نمودار قیمت') + '">' +
      '<path d="' + area + '" fill="' + col + '" opacity=".10"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '</svg></div>';
  }

  // ─────────────────────────── 1) scenarios ───────────────────────────
  var SCN_GROUPS = [{ k: 'all', t: 'همه' }, { k: 'fx', t: 'ارز' }, { k: 'gold', t: 'طلا و نقره' }, { k: 'crypto', t: 'کریپتو' }, { k: 'tse', t: 'بورس' }];

  function renderScenarios() {
    var snap = snapshot();
    var all = (snap && snap.scenarios && snap.scenarios.assets) || [];
    var list = st.scn.group === 'all' ? all : all.filter(function (a) { return a.group === st.scn.group; });
    var head = '<div class="pad-x">' + seg('scnGroup', SCN_GROUPS, st.scn.group) + '</div>';
    if (!list.length) return head + card('سناریوها', '<div class="center muted">برای این گروه سناریویی موجود نیست.</div>');
    var unit = { toman: 'تومان', usd: 'دلار', point: 'واحد' };
    return head + list.map(function (a) {
      if (a.missingReason) return card(a.label, '<div class="row"><span class="label muted">' + esc(a.missingReason) + '</span></div>');
      var rows = Object.keys(a.rows).map(function (k) { return a.rows[k]; }).filter(Boolean);
      var body = '<div class="scroll"><table><thead><tr><th>افق</th><th>بدترین</th><th>محتمل</th><th>بهترین</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + esc(r.label) + '</td>' +
            '<td class="num down">' + fa(Math.round(r.worst)) + '<small class="muted"> ' + pct(r.worstPct) + '</small></td>' +
            '<td class="num">' + fa(Math.round(r.base)) + '</td>' +
            '<td class="num up">' + fa(Math.round(r.best)) + '<small class="muted"> ' + pct(r.bestPct) + '</small></td></tr>';
        }).join('') + '</tbody></table></div>' +
        (a.summary ? '<div class="row"><span class="label">' + esc(a.summary) + '</span></div>' : '') +
        (a.drivers || []).map(function (d) { return '<div class="row"><span class="label muted">' + esc(d) + '</span></div>'; }).join('');
      return card(a.label + ' <small class="muted">(' + (unit[a.unit] || '') + ')</small>', body);
    }).join('') + banner('بدترین و بهترین یعنی مرز ۵ درصد پایین و بالای توزیع؛ رویداد پیش‌بینی‌نشده می‌تواند قیمت را بیرون از این بازه ببرد.', 'warn');
  }

  // ─────────────────────────── 2) charts ───────────────────────────
  var TFS = [{ k: '1d', t: 'روز' }, { k: '1w', t: 'هفته' }, { k: '1m', t: 'ماه' }, { k: '3m', t: '۳ ماه' }, { k: '6m', t: '۶ ماه' }, { k: '1y', t: 'سال' }];

  function chartAssets() {
    var snap = snapshot();
    var items = (snap && snap.live && snap.live.items) || [];
    var allowed = ['usd', 'usdt', 'coin', 'nim', 'rob', 'g18', 'silver', 'ons', 'silverOns', 'btc', 'eth', 'tse'];
    return allowed.map(function (k) {
      var it = items.filter(function (x) { return x.key === k; })[0];
      return it ? { k: k, t: it.label } : null;
    }).filter(Boolean);
  }

  function loadChart() {
    st.chart.busy = true; st.chart.err = null; redraw();
    api('/api/chart?asset=' + encodeURIComponent(st.chart.asset) + '&tf=' + st.chart.tf, { timeout: 30000 })
      .then(function (j) { st.chart.data = j; })
      .catch(function (e) { st.chart.err = e.message; st.chart.data = null; })
      .then(function () { st.chart.busy = false; redraw(); });
  }

  function renderCharts() {
    var assets = chartAssets();
    var head = '<div class="pad-x">' +
      '<select id="chAsset" aria-label="دارایی">' + assets.map(function (a) {
        return '<option value="' + esc(a.k) + '"' + (a.k === st.chart.asset ? ' selected' : '') + '>' + esc(a.t) + '</option>';
      }).join('') + '</select>' +
      seg('chTf', TFS, st.chart.tf) + '</div>';
    if (st.chart.busy) return head + '<div class="center"><span class="spin"></span></div>';
    if (st.chart.err) return head + banner('نمودار دریافت نشد: ' + esc(st.chart.err), 'err');
    var d = st.chart.data;
    if (!d) return head + '<div class="center muted">برای دیدن نمودار، دارایی و بازه را انتخاب کنید.</div>';
    var s = d.stats;
    var body = lineChart(d.points, { label: d.label }) +
      (s ? statGrid([
        { k: 'تغییر بازه', v: pct(s.changePct), cls: dirOf(s.changePct) },
        { k: 'بیشترین', v: '<span class="num">' + fa(Math.round(s.high)) + '</span>' },
        { k: 'کمترین', v: '<span class="num">' + fa(Math.round(s.low)) + '</span>' },
        { k: 'آخرین', v: '<span class="num">' + fa(Math.round(s.last)) + '</span>' }
      ]) : '') +
      (d.note ? '<div class="row"><span class="label muted">' + esc(d.note) + '</span></div>' : '');
    return head + card(d.label + ' · ' + (d.resolution === 'intraday' ? 'درون‌روزی' : 'روزانه'), body);
  }

  // ─────────────────────────── 3) swing ───────────────────────────
  function loadSwingMenu() {
    if (st.swing.menu) return;
    api('/api/swing', { timeout: 30000 })
      .then(function (j) { st.swing.menu = j; redraw(); })
      .catch(function () { /* the page still works with the default coin */ });
  }

  function runSwing(auto) {
    st.swing.busy = true; st.swing.err = null; st.swing.res = null; redraw();
    var body = auto
      ? { auto: true, days: 90, capitalToman: prefs().capital || 100e6, preset: st.swing.preset, count: 4 }
      : { coinId: st.swing.coin, symbol: st.swing.symbol, days: st.swing.days, preset: st.swing.preset, capitalToman: prefs().capital || 100e6 };
    api('/api/swing', { body: body })
      .then(function (j) {
        st.swing.res = j;
        var m = j.metrics || (j.portfolio && j.portfolio.combined);
        if (m) notify('نتیجه نوسان‌گیری', 'بازده ' + pct(m.returnPct) + (isNum(m.buyHoldPct) ? ' · خرید و نگه‌داری ' + pct(m.buyHoldPct) : ''), 'trade');
      })
      .catch(function (e) { st.swing.err = e.message; })
      .then(function () { st.swing.busy = false; redraw(); });
  }

  function swingMetrics(m) {
    return statGrid([
      { k: 'بازده استراتژی', v: pct(m.returnPct), cls: dirOf(m.returnPct) },
      { k: 'خرید و نگه‌داری', v: pct(m.buyHoldPct), cls: dirOf(m.buyHoldPct) },
      { k: 'فقط تتر', v: isNum(m.usdtPct) ? pct(m.usdtPct) : '—', cls: dirOf(m.usdtPct) },
      { k: 'درآمد ثابت', v: isNum(m.fixedIncomePct) ? pct(m.fixedIncomePct) : '—' },
      { k: 'معاملات', v: fa(m.trades) + (isNum(m.winRatePct) ? ' <small class="muted">' + pct(m.winRatePct) + ' برد</small>' : '') },
      { k: 'بیشترین افت', v: pct(m.maxDrawdownPct), cls: 'down' },
      { k: 'شارپ', v: isNum(m.sharpe) ? fa(m.sharpe, 2) : '—' },
      { k: 'ضریب سود', v: isNum(m.profitFactor) ? fa(m.profitFactor, 2) : '—' }
    ]);
  }

  function renderSwing() {
    var menu = st.swing.menu;
    var coins = (menu && menu.coins) || [{ id: 'bitcoin', symbol: 'BTC', name: 'بیت‌کوین' }];
    var head = '<div class="pad-x">' +
      '<select id="swCoin" aria-label="ارز">' + coins.slice(0, 60).map(function (c) {
        return '<option value="' + esc(c.id) + '|' + esc(c.symbol) + '"' + (c.id === st.swing.coin ? ' selected' : '') + '>' + esc(c.name) + ' (' + esc(c.symbol) + ')</option>';
      }).join('') + '</select>' +
      seg('swPreset', [{ k: 'calm', t: 'کم‌تحرک' }, { k: 'normal', t: 'متعادل' }, { k: 'aggressive', t: 'پرتحرک' }], st.swing.preset) +
      seg('swDays', [{ k: 30, t: '۳۰ روز' }, { k: 60, t: '۶۰ روز' }, { k: 90, t: '۹۰ روز' }], st.swing.days) +
      '<div class="btn-row"><button class="addbtn" id="swRun">اجرای نوسان‌گیری</button>' +
      '<button class="chipbtn big" id="swAuto">غربال خودکار ۴ ارز</button></div></div>';
    if (st.swing.busy) return head + '<div class="center"><span class="spin"></span><p class="muted">در حال محاسبه…</p></div>';
    if (st.swing.err) return head + banner('اجرا نشد: ' + esc(st.swing.err), 'err');
    var r = st.swing.res;
    if (!r) return head + banner('روی داده ساعتی ۹۰ روز اخیر آزمایش می‌شود. نتیجه گذشته تضمین آینده نیست.', 'warn');

    var out = '';
    if (r.scan) {
      out += card('غربال خودکار', '<div class="row"><span class="label">' + esc(r.scan.verdict) + '</span></div>' +
        '<div class="scroll"><table><thead><tr><th>ارز</th><th>نیمه اول</th><th>نیمه دوم</th><th>معاملات</th></tr></thead><tbody>' +
        r.scan.candidates.filter(function (c) { return c.ok; }).map(function (c) {
          return '<tr' + (c.selected ? ' class="sel"' : '') + '><td>' + esc(c.coin.symbol) + '</td>' +
            '<td class="num ' + dirOf(c.inSample.returnPct) + '">' + pct(c.inSample.returnPct) + '</td>' +
            '<td class="num ' + dirOf(c.outSample.returnPct) + '">' + pct(c.outSample.returnPct) + '</td>' +
            '<td class="num">' + fa(c.outSample.trades) + '</td></tr>';
        }).join('') + '</tbody></table></div>');
    }
    var pf = r.portfolio;
    if (pf) out += card('سبد نوسان‌گیری', swingMetrics(pf.combined));
    if (r.metrics) {
      out += card('نتیجه ' + esc((r.coin && r.coin.symbol) || ''), swingMetrics(r.metrics));
      if (r.trades && r.trades.length) {
        out += card('معاملات (' + fa(r.trades.length) + ')', '<div class="scroll"><table><thead><tr><th>#</th><th>ورود</th><th>خروج</th><th>نتیجه</th></tr></thead><tbody>' +
          r.trades.slice(0, 40).map(function (t) {
            return '<tr><td class="num">' + fa(t.n) + '</td><td class="num">' + fa(t.entryPrice, 2) + '</td><td class="num">' + fa(t.exitPrice, 2) + '</td>' +
              '<td class="num ' + dirOf(t.netPct) + '">' + pct(t.netPct) + '</td></tr>';
          }).join('') + '</tbody></table></div>');
      }
    }
    (r.warnings || (pf && pf.warnings) || []).slice(0, 4).forEach(function (w) { out += banner(esc(w), 'warn'); });
    return head + out;
  }

  // ─────────────────────────── 4) historical trader ───────────────────────────
  function runSim() {
    st.sim.busy = true; st.sim.err = null; st.sim.res = null; redraw();
    var end = new Date();
    var start = new Date(end.getTime() - 180 * 86400000);
    api('/api/simulate', {
      body: {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        capitalToman: prefs().capital || 100e6,
        profile: prefs().profile || 'balanced',
        assets: ['usd', 'g18', 'coin', 'tse', 'btc'],
        useNews: true
      }
    })
      .then(function (j) {
        st.sim.res = j;
        if (j.metrics) notify('شبیه‌سازی تمام شد', 'بازده ' + pct(j.metrics.returnPct) + ' در ' + fa(j.metrics.days) + ' روز', 'trade');
      })
      .catch(function (e) { st.sim.err = e.message; })
      .then(function () { st.sim.busy = false; redraw(); });
  }

  function renderSim() {
    var head = '<div class="pad-x">' +
      seg('simProfile', [{ k: 'conservative', t: 'محتاط' }, { k: 'balanced', t: 'متعادل' }, { k: 'aggressive', t: 'جسور' }], prefs().profile || 'balanced') +
      seg('capital', CAPITALS.map(function (c) { return { k: c, t: toman(c) }; }), prefs().capital || 100e6) +
      '<div class="btn-row"><button class="addbtn" id="simRun">اجرای شش ماه اخیر</button></div></div>';
    if (st.sim.busy) return head + '<div class="center"><span class="spin"></span><p class="muted">در حال شبیه‌سازی؛ تا یک دقیقه طول می‌کشد…</p></div>';
    if (st.sim.err) return head + banner('اجرا نشد: ' + esc(st.sim.err), 'err');
    var r = st.sim.res;
    if (!r) return head + banner('معامله‌گر روی شش ماه گذشته با قیمت و خبر همان روزها اجرا می‌شود؛ سفارش‌ها در قیمت پایانی جلسه بعد پر می‌شوند.', 'warn');
    var m = r.metrics;
    var out = card('نتیجه', statGrid([
      { k: 'ارزش نهایی', v: toman(m.finalEquity) },
      { k: 'بازده', v: pct(m.returnPct), cls: dirOf(m.returnPct) },
      { k: 'بازده به دلار', v: isNum(m.usdReturnPct) ? pct(m.usdReturnPct) : '—', cls: dirOf(m.usdReturnPct) },
      { k: 'بیشترین افت', v: pct(m.maxDrawdownPct), cls: 'down' },
      { k: 'شارپ', v: isNum(m.sharpe) ? fa(m.sharpe, 2) : '—' },
      { k: 'معاملات', v: fa(m.trades) }
    ]));
    if (r.benchmarks) {
      out += card('در مقایسه با', r.benchmarks.map(function (b) {
        return kv(b.label, '<span class="num ' + dirOf(b.returnPct) + '">' + pct(b.returnPct) + '</span>');
      }).join(''));
    }
    (r.analysis || []).forEach(function (a) { out += card(a.title, '<div class="row"><span class="label">' + esc(a.body) + '</span></div>'); });
    return head + out;
  }

  // ─────────────────────────── 5) live trader (device-local) ───────────────────────────
  function loadLive() { return jget(LIVE_KEY, null); }
  function saveLive(s) { jset(LIVE_KEY, s); }

  function loadLiveMeta() {
    if (st.live.meta) return;
    api('/api/live/local', { timeout: 20000 })
      .then(function (j) { st.live.meta = j; redraw(); })
      .catch(function () { /* defaults below still work */ });
  }

  function liveCfg() {
    var p = prefs();
    return {
      capitalToman: p.capital || 100e6,
      profile: p.profile || 'balanced',
      assets: p.liveAssets || ['usd', 'g18', 'coin', 'btc'],
      days: p.liveDays || 30,
      activity: p.activity || 'normal',
      useNews: true
    };
  }

  /** Engine asset keys are English ('g18'); nobody wants to read that in a notification. */
  var ASSET_FALLBACK = {
    usd: 'دلار', g18: 'طلای ۱۸', coin: 'سکه امامی', tse: 'صندوق شاخصی',
    btc: 'بیت‌کوین', eth: 'اتریوم', sol: 'سولانا', xrp: 'ریپل', ton: 'تون‌کوین', doge: 'دوج‌کوین'
  };
  function assetLabel(k) {
    var meta = st.live.meta;
    if (meta && meta.assets) {
      var m = meta.assets.filter(function (a) { return a.key === k; })[0];
      if (m) return m.label;
    }
    return ASSET_FALLBACK[k] || k;
  }

  function liveCall(action) {
    st.live.busy = true; st.live.err = null; redraw();
    var body = { action: action };
    if (action === 'start') body.config = liveCfg(); else body.session = loadLive();
    return api('/api/live/local', { body: body })
      .then(function (j) {
        saveLive(j.session);
        st.live.s = j.session;
        (j.newTrades || []).forEach(function (t) {
          notify(
            (t.side === 'buy' ? 'خرید' : 'فروش') + ' ' + assetLabel(t.asset),
            toman(t.valueToman) + (isNum(t.realizedPct) ? ' · نتیجه ' + pct(t.realizedPct) : ''),
            'trade'
          );
        });
        if (j.finished) notify('معامله برخط پایان یافت', 'گزارش نهایی در اپ آماده است.', 'trade');
        else if (action === 'start') notify('معامله برخط شروع شد', 'سرمایه ' + toman(liveCfg().capitalToman) + ' · فقط روی همین گوشی', 'trade');
      })
      .catch(function (e) { st.live.err = e.message; })
      .then(function () { st.live.busy = false; redraw(); });
  }

  /** Called on app open and on manual refresh: a device-local session only advances while the app runs. */
  function liveAutoTick() {
    var s = loadLive();
    if (!s || s.status !== 'running' || st.live.busy) return;
    if (Date.now() - (s.lastTickAt || 0) < 5 * 60000) return;
    liveCall('tick');
  }

  function renderLive() {
    var s = st.live.s || loadLive();
    st.live.s = s;
    var meta = st.live.meta;
    if (st.live.busy) return '<div class="center"><span class="spin"></span><p class="muted">در حال بررسی قیمت‌ها…</p></div>';

    var head = st.live.err ? banner('خطا: ' + esc(st.live.err), 'err') : '';

    if (!s || s.status !== 'running') {
      var assets = (meta && meta.assets) || [
        { key: 'usd', label: 'دلار' }, { key: 'g18', label: 'طلای ۱۸' }, { key: 'coin', label: 'سکه' },
        { key: 'tse', label: 'صندوق شاخصی' }, { key: 'btc', label: 'بیت‌کوین' }, { key: 'eth', label: 'اتریوم' }
      ];
      var chosen = liveCfg().assets;
      var setup = '<div class="pad-x">' +
        '<div class="field-t">سرمایه</div>' + seg('capital', CAPITALS.map(function (c) { return { k: c, t: toman(c) }; }), prefs().capital || 100e6) +
        '<div class="field-t">پروفایل ریسک</div>' + seg('liveProfile', [{ k: 'conservative', t: 'محتاط' }, { k: 'balanced', t: 'متعادل' }, { k: 'aggressive', t: 'جسور' }], prefs().profile || 'balanced') +
        '<div class="field-t">مدت</div>' + seg('liveDays', [{ k: 7, t: '۷ روز' }, { k: 30, t: '۳۰ روز' }, { k: 60, t: '۶۰ روز' }], liveCfg().days) +
        '<div class="field-t">بازارها</div><div class="chips wrapchips">' + assets.map(function (a) {
          return '<button class="chipbtn" data-liveasset="' + esc(a.key) + '" aria-pressed="' + (chosen.indexOf(a.key) >= 0) + '">' + esc(a.label) + '</button>';
        }).join('') + '</div>' +
        '<div class="btn-row"><button class="addbtn" id="liveStart">شروع معامله برخط</button></div></div>';
      var prev = s && s.status === 'finished' ? card('نتیجه جلسه قبل', liveReport(s)) : '';
      return head + setup + banner('این جلسه فقط روی همین گوشی ذخیره می‌شود و به سرور نمی‌رود. پول واقعی جابه‌جا نمی‌شود.', 'warn') + prev;
    }

    var eq = s.equity && s.equity.length ? s.equity[s.equity.length - 1] : null;
    var ret = eq ? (eq.equity / s.config.capitalToman - 1) * 100 : 0;
    var hero = '<div class="hero-card"><div class="hero-top">ارزش سبد · معامله برخط روی این گوشی</div>' +
      '<div class="hero-main"><span class="hero-num num">' + (eq ? fa(Math.round(eq.equity)) : '—') + '</span><span class="hero-unit">تومان</span></div>' +
      '<div class="hero-grid">' +
      '<div><span class="hg-k">بازده</span><span class="hg-v ' + dirOf(ret) + '">' + pct(ret) + '</span></div>' +
      '<div><span class="hg-k">معاملات</span><span class="hg-v">' + fa((s.trades || []).length) + '</span></div>' +
      '<div><span class="hg-k">بررسی‌ها</span><span class="hg-v">' + fa(s.ticks || 0) + '</span></div>' +
      '</div></div>';

    var curve = (s.equity || []).map(function (p) { return [p.at, p.equity]; });
    var body = hero +
      (curve.length > 2 ? card('روند ارزش سبد', lineChart(curve, { label: 'ارزش سبد' })) : '') +
      card('وضعیت', kv('نقد', '<span class="num">' + fa(Math.round(s.acct.cash / 10)) + '</span>') +
        kv('پایان', faTime(s.endsAt)) +
        kv('آخرین بررسی', faTime(s.lastTickAt)) +
        '<div class="btn-row pad-x"><button class="chipbtn big" id="liveTick">بررسی حالا</button><button class="chipbtn big danger" id="liveStop">پایان دادن</button></div>');

    if ((s.trades || []).length) {
      body += card('معاملات', '<div class="scroll"><table><thead><tr><th>زمان</th><th>عمل</th><th>دارایی</th><th>مبلغ</th></tr></thead><tbody>' +
        s.trades.slice().reverse().slice(0, 30).map(function (t) {
          return '<tr><td>' + faTime(t.at) + '</td><td class="' + (t.side === 'buy' ? 'up' : 'down') + '">' + (t.side === 'buy' ? 'خرید' : 'فروش') + '</td>' +
            '<td>' + esc(assetLabel(t.asset)) + '</td><td class="money">' + toman(t.valueToman) + '</td></tr>';
        }).join('') + '</tbody></table></div>');
    }
    if ((s.events || []).length) {
      body += card('رویدادها', s.events.slice(0, 12).map(function (e) {
        return '<div class="row"><span class="label"><small class="muted">' + faTime(e.at) + '</small>' + esc(e.text) + '</span></div>';
      }).join(''));
    }
    return head + body + banner('جلسه فقط وقتی پیش می‌رود که اپ باز شود؛ هر بار که اپ را باز کنید قیمت‌ها بررسی می‌شوند.', 'warn');
  }

  function liveReport(s) {
    var r = s.result;
    if (!r) return '<div class="row"><span class="label muted">گزارشی ثبت نشده است.</span></div>';
    return statGrid([
      { k: 'ارزش نهایی', v: toman(r.metrics.finalEquity) },
      { k: 'بازده', v: pct(r.metrics.returnPct), cls: dirOf(r.metrics.returnPct) },
      { k: 'معاملات', v: fa(r.metrics.trades) },
      { k: 'بیشترین افت', v: pct(r.metrics.maxDrawdownPct), cls: 'down' }
    ]) + (r.benchmarks || []).map(function (b) {
      return kv(b.label, '<span class="num ' + dirOf(b.returnPct) + '">' + pct(b.returnPct) + '</span>');
    }).join('');
  }

  // ─────────────────────────── wiring ───────────────────────────
  var pages = [
    { id: 'scenarios', icon: '🎯', title: 'سناریوها', group: 'بازار', render: renderScenarios },
    { id: 'charts', icon: '📉', title: 'نمودار', group: 'بازار', render: renderCharts, onEnter: function () { if (!st.chart.data && !st.chart.busy) loadChart(); } },
    { id: 'swing', icon: '🌊', title: 'نوسان‌گیری', group: 'ابزار معامله', render: renderSwing, onEnter: loadSwingMenu },
    { id: 'simulator', icon: '🧪', title: 'معامله‌گر گذشته‌نگر', group: 'ابزار معامله', render: renderSim },
    { id: 'live', icon: '⚡', title: 'معامله برخط', group: 'ابزار معامله', render: renderLive, offline: true, onEnter: function () { loadLiveMeta(); liveAutoTick(); } }
  ];

  function onSeg(name, v) {
    if (name === 'scnGroup') st.scn.group = v;
    else if (name === 'chTf') { st.chart.tf = v; loadChart(); return true; }
    else if (name === 'swPreset') st.swing.preset = v;
    else if (name === 'swDays') st.swing.days = Number(v);
    else if (name === 'simProfile' || name === 'liveProfile') setPref('profile', v);
    else if (name === 'capital') setPref('capital', Number(v));
    else if (name === 'liveDays') setPref('liveDays', Number(v));
    else return false;
    return true;
  }

  function onClick(e) {
    var t = e.target.closest ? e.target : null;
    if (!t) return false;
    var s = t.closest('[data-seg]');
    if (s) { if (onSeg(s.getAttribute('data-seg'), s.getAttribute('data-v'))) { redraw(); return true; } }
    var la = t.closest('[data-liveasset]');
    if (la) {
      var k = la.getAttribute('data-liveasset');
      var cur = liveCfg().assets.slice();
      var i = cur.indexOf(k);
      if (i >= 0) { if (cur.length > 1) cur.splice(i, 1); } else cur.push(k);
      setPref('liveAssets', cur); redraw(); return true;
    }
    var id = t.id || (t.closest('button') && t.closest('button').id);
    if (id === 'swRun') { runSwing(false); return true; }
    if (id === 'swAuto') { runSwing(true); return true; }
    if (id === 'simRun') { runSim(); return true; }
    if (id === 'liveStart') { liveCall('start'); return true; }
    if (id === 'liveTick') { liveCall('tick'); return true; }
    if (id === 'liveStop') {
      if (confirm('معامله برخط پایان یابد؟ موقعیت‌های باز با قیمت روز ارزش‌گذاری می‌شوند.')) liveCall('stop');
      return true;
    }
    return false;
  }

  function onChange(e) {
    if (e.target.id === 'chAsset') { st.chart.asset = e.target.value; loadChart(); return true; }
    if (e.target.id === 'swCoin') {
      var v = String(e.target.value).split('|');
      st.swing.coin = v[0]; st.swing.symbol = v[1] || v[0];
      return true;
    }
    return false;
  }

  return { pages: pages, onClick: onClick, onChange: onChange, onAppOpen: liveAutoTick };
};
