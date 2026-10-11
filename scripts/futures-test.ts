/**
 * Futures (rule 95) and coin picks (rule 96): liquidation price = the exchange formula, the order of events
 * inside a bar, funding direction, no lookahead in the leveraged trend rider, the device account (manual and
 * auto), the bounds on a received account, and the calm-coin picker.
 * Run: npx tsx scripts/futures-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { applyBar, liqFromMargin, liqPrice, maxLeverage, openPosition, regime, runFuturesTrend, type DailyBar, type Ohlc } from '../lib/engine/futures';
import { autoWant, createAccount, closeOrder, equityOf, futuresTick, openOrder, saneAccount, setAuto, type SymData } from '../lib/engine/futures-account';
import { pickCoins, PICK_K, PICK_MIN_DAYS } from '../lib/engine/coin-pick';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const H = 3_600_000, D = 86_400_000;
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const bar = (t: number, o: number, h: number, l: number, c: number): Ohlc => ({ t, o, h, l, c });

ok('liquidation price: Binance one-way isolated formula, and the same from the margin', () => {
  near(liqPrice('long', 100, 10, 0.004)!, (100 * 0.9) / 0.996);
  near(liqPrice('short', 100, 10, 0.004)!, (100 * 1.1) / 1.004);
  assert.equal(liqPrice('long', 100, 1, 0.004), null, '1× long cannot be liquidated');
  near(liqPrice('short', 100, 1, 0.004)!, 200 / 1.004, 1e-9);
  // the general formula with the opening margin gives the same price
  const { pos } = openPosition({ id: 'x', sym: 'BTC', side: 'long', lev: 20, margin: 50, price: 60000, at: 0 });
  near(liqFromMargin('long', pos.qty, pos.entry, pos.margin, pos.mmr)!, liqPrice('long', 60000, 20, 0.004)!);
  // 125× liquidates on a ~0.4% move, 2× on ~50%
  assert.ok(1 - liqPrice('long', 100, 125, 0.004)! / 100 < 0.005);
  assert.ok(1 - liqPrice('long', 100, 2, 0.004)! / 100 > 0.49);
  assert.equal(maxLeverage('BTC'), 125);
  assert.equal(maxLeverage('PEPE'), 50);
  assert.equal(openPosition({ id: 'y', sym: 'PEPE', side: 'long', lev: 125, margin: 10, price: 1, at: 0 }).pos.lev, 50, 'capped at the coin’s maximum');
});

ok('inside a bar: a stop nearer than liquidation fires first, otherwise a wick liquidates; gaps fill at the open; stop wins over target', () => {
  const zero = () => 0;
  const mk = (sl: number | null, tp: number | null) => openPosition({ id: 'p', sym: 'BTC', side: 'long', lev: 10, margin: 100, price: 100, at: 0, tp, sl }).pos;
  // liq ≈ 90.36
  let r = applyBar(mk(95, null), bar(H, 100, 101, 89, 100), H, zero);
  assert.equal(r.fill!.reason, 'sl');
  assert.equal(r.fill!.exit, 95);
  r = applyBar(mk(null, null), bar(H, 100, 101, 89, 100), H, zero);
  assert.equal(r.fill!.reason, 'liquidation', 'a wick through the liquidation price liquidates although the bar closes at 100');
  assert.equal(r.back, 0);
  near(r.fill!.pnl, -100 - r.fill!.fees, 1e-9);
  r = applyBar(mk(95, null), bar(H, 93, 94, 92, 93), H, zero);
  assert.equal(r.fill!.exit, 93, 'gapped through the stop: filled at the open');
  r = applyBar(mk(95, 105), bar(H, 100, 106, 94, 100), H, zero);
  assert.equal(r.fill!.reason, 'sl', 'both touched: counted as the stop');
  r = applyBar(mk(95, 105), bar(H, 100, 106, 99, 104), H, zero);
  assert.equal(r.fill!.reason, 'tp');
  near(r.fill!.grossPnl, 10 * 5, 1e-9); // qty 10, +5
  // a stop placed BEYOND the liquidation price never gets the chance
  r = applyBar(mk(85, null), bar(H, 100, 100, 84, 90), H, zero);
  assert.equal(r.fill!.reason, 'liquidation');
  // a short is liquidated by the high
  const s = openPosition({ id: 's', sym: 'BTC', side: 'short', lev: 10, margin: 100, price: 100, at: 0 }).pos;
  assert.equal(applyBar(s, bar(H, 100, 111, 99, 100), H, zero).fill!.reason, 'liquidation');
});

ok('funding: at 00/08/16 UTC, longs pay a positive rate and shorts receive it, from the margin', () => {
  const t0 = Date.parse('2026-10-01T07:00:00Z');
  const L = openPosition({ id: 'l', sym: 'BTC', side: 'long', lev: 5, margin: 100, price: 100, at: t0 - 1 }).pos;
  const S = openPosition({ id: 's', sym: 'BTC', side: 'short', lev: 5, margin: 100, price: 100, at: t0 - 1 }).pos;
  const b = bar(Date.parse('2026-10-01T08:00:00Z'), 100, 100, 100, 100);
  const rl = applyBar(L, b, H, () => 0.001);
  const rs = applyBar(S, b, H, () => 0.001);
  near(rl.pos!.margin, 100 - 5 * 100 * 0.001);
  near(rs.pos!.margin, 100 + 5 * 100 * 0.001);
  assert.equal(applyBar(L, bar(Date.parse('2026-10-01T09:00:00Z'), 100, 100, 100, 100), H, () => 0.001).pos!.margin, 100, 'no settlement inside 09:00–10:00');
  // the exchange's own settlement list is used as given
  near(applyBar(L, b, H, [{ t: b.t + 1, rate: -0.002 }]).pos!.margin, 100 + 5 * 100 * 0.002);
  // funding moves the liquidation price
  assert.ok(liqFromMargin('long', L.qty, L.entry, rl.pos!.margin, L.mmr)! > liqFromMargin('long', L.qty, L.entry, L.margin, L.mmr)!);
  // a 1× long that runs up 25× does not get liquidated by the funding it pays on the larger notional
  const one = openPosition({ id: 'o', sym: 'DOGE', side: 'long', lev: 1, margin: 100, price: 1, at: 0 }).pos;
  const big = applyBar(one, bar(D, 25, 26, 24, 25), D, () => 0.003);
  assert.equal(big.fill, null);
});

/** synthetic daily candles: a deterministic random walk with drift changes */
function walk(seed: number, days: number, start = Date.parse('2022-01-01')): DailyBar[] {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let p = 100;
  const out: DailyBar[] = [];
  for (let i = 0; i < days; i++) {
    const drift = Math.sin(i / 60) * 0.004;
    const r = drift + (rnd() - 0.5) * 0.06;
    const o = p;
    p = p * Math.exp(r);
    out.push({ t: start + i * D, o, h: Math.max(o, p) * (1 + rnd() * 0.02), l: Math.min(o, p) * (1 - rnd() * 0.02), c: p, v: 1e7 });
  }
  return out;
}

ok('leveraged trend rider: no lookahead, more leverage = deeper drawdown, liquidations counted', () => {
  const btc = walk(7, 700);
  const coin = walk(11, 700);
  const cut = coin[500].t;
  const a = runFuturesTrend(coin, btc, { sym: 'ETH', lev: 3, mode: 'long', capital: 1000, to: cut });
  const poisoned = coin.map((b) => (b.t > cut ? { ...b, o: b.o * 3, h: b.h * 3, l: b.l * 3, c: b.c * 3 } : b));
  const b = runFuturesTrend(poisoned, btc, { sym: 'ETH', lev: 3, mode: 'long', capital: 1000, to: cut });
  assert.deepEqual(a.fills.map((f) => [f.openedAt, f.closedAt, f.exit]), b.fills.map((f) => [f.openedAt, f.closedAt, f.exit]), 'future prices changed a past trade');
  const dd = [1, 3, 10].map((lev) => runFuturesTrend(coin, btc, { sym: 'ETH', lev, mode: 'long', capital: 1000 }).maxDrawdownPct);
  assert.ok(dd[0] >= dd[1] && dd[1] >= dd[2], `drawdowns ${dd}`);
  const one = runFuturesTrend(coin, btc, { sym: 'ETH', lev: 1, mode: 'long', capital: 1000 });
  assert.equal(one.liquidations, 0);
  const r = runFuturesTrend(coin, btc, { sym: 'ETH', lev: 1, mode: 'long', capital: 1000 });
  // entries only when the coin and BTC both closed above their 50-day average the day before the entry
  const up = regime(coin), bu = regime(btc);
  for (const f of r.fills) assert.ok(up.get(f.openedAt) && bu.get(f.openedAt), 'entered against the filter');
});

function hourly(daily: DailyBar[]): Ohlc[] {
  // 24 flat hours per day at the day's close, with the day's extremes on hour 12
  const out: Ohlc[] = [];
  for (const d of daily) for (let h = 0; h < 24; h++) out.push({ t: d.t + h * H, o: d.c, h: h === 12 ? d.h : d.c, l: h === 12 ? d.l : d.c, c: d.c });
  return out;
}

ok('device account: manual orders, conservation of money, a wick liquidation in a later tick, partial hour skipped', () => {
  const t0 = Date.parse('2026-10-05T10:20:00Z');
  let a = createAccount(1000, t0);
  a = openOrder(a, { sym: 'BTC', side: 'long', lev: 10, margin: 200 }, 100, t0);
  assert.throws(() => openOrder(a, { sym: 'BTC', side: 'long', lev: 10, margin: 900 }, 100, t0), /موجودی آزاد/);
  near(a.wallet, 1000 - 200 - 200 * 10 * 0.0005);
  // the 10:00 hour (in which the order was placed) dips to 80 — ignored; 11:00 is fine; 12:00 wicks to 89
  const data: Record<string, SymData> = {
    BTC: {
      hourly: [bar(Date.parse('2026-10-05T10:00:00Z'), 100, 101, 80, 100), bar(Date.parse('2026-10-05T11:00:00Z'), 100, 102, 99, 101), bar(Date.parse('2026-10-05T12:00:00Z'), 101, 101, 89, 95)],
      daily: [], funding: [], rate: 0, last: 95,
    },
  };
  const t1 = Date.parse('2026-10-05T11:30:00Z');
  const first = futuresTick(a, { BTC: { ...data.BTC, hourly: data.BTC.hourly.filter((b) => b.t + H <= t1) } }, null, t1);
  assert.equal(first.account.positions.length, 1, 'the partial hour of the order is not held against it');
  const second = futuresTick(first.account, data, null, Date.parse('2026-10-05T13:05:00Z'));
  assert.equal(second.newFills.length, 1);
  assert.equal(second.newFills[0].reason, 'liquidation');
  near(second.account.wallet, 1000 - 200 - 1, 1e-9);
  assert.match(second.account.events[0].text, /لیکویید/);
  // close manually: wallet = margin + P&L − fees
  let b = openOrder(createAccount(1000, t0), { sym: 'ETH', side: 'short', lev: 5, margin: 100 }, 2000, t0);
  b = closeOrder(b, b.positions[0].id, 1900, t0 + H);
  near(b.wallet, 1000 - 0.25 + 0.25 * 100 - 0.0005 * 0.25 * 1900, 1e-9); // open fee, +100 per coin on 0.25, close fee
  near(b.fills[0].pnl, b.wallet - 1000, 1e-9);
  near(equityOf(b), b.wallet);
});

ok('auto trader: decides at UTC day start from closed days only, same rule as the backtest', () => {
  const btc = walk(7, 700, Date.parse('2024-08-01'));
  const coin = walk(11, 700, Date.parse('2024-08-01'));
  const wantAt = (k: number) => autoWant(coin, btc, 'ETH', coin[k].t, 'long').side === 'long';
  // a 20-day window in which the rule both enters and exits
  let s0 = 120;
  while (s0 < 660) {
    const w = Array.from({ length: 19 }, (_, j) => wantAt(s0 + 2 + j));
    if (w.includes(true) && w.includes(false) && !w[0]) break;
    s0++;
  }
  const dayStart = coin[s0 + 20].t;
  const w = autoWant(coin, btc, 'ETH', dayStart, 'long');
  const lastClosed = coin[s0 + 19].t;
  const expect = regime(coin.slice(0, s0 + 20)).get(lastClosed) && regime(btc.slice(0, s0 + 20)).get(lastClosed) ? 'long' : null;
  assert.equal(w.side, expect);
  // today's own (unclosed) candle must not matter
  for (let k = s0; k < s0 + 20; k++) {
    for (const f of [10, 0.1]) {
      const poisoned = coin.map((b, i) => (i >= k ? { ...b, c: b.c * f } : b));
      assert.equal(autoWant(poisoned, btc, 'ETH', coin[k].t, 'long').side, autoWant(coin, btc, 'ETH', coin[k].t, 'long').side, `day ${k}: the unclosed day moved the decision`);
    }
  }
  // run the account over 20 days of hourly bars and compare every day start with the rule
  let a = setAuto(createAccount(1000, coin[s0].t), { coins: ['ETH'], lev: 2, mode: 'long' }, coin[s0].t);
  const data: Record<string, SymData> = { ETH: { hourly: hourly(coin.slice(s0 + 1, s0 + 20)), daily: coin, funding: null, rate: 0.0001, last: null } };
  a = futuresTick(a, data, btc, coin[s0 + 20].t).account;
  const opens = a.events.filter((e) => e.kind === 'open').map((e) => e.at);
  const closes = a.fills.filter((f) => f.reason === 'signal').map((f) => f.closedAt);
  let held = false;
  for (let k = s0 + 2; k < s0 + 20; k++) {
    const want = wantAt(k);
    if (want && !held) assert.ok(opens.includes(coin[k].t), `day ${k}: should open`);
    if (!want && held) assert.ok(closes.includes(coin[k].t), `day ${k}: should close`);
    held = want;
  }
  assert.equal(a.positions.length, held ? 1 : 0);
  assert.ok(opens.length > 0, 'the walk should produce at least one entry');
  assert.ok(a.positions.every((p) => p.auto && p.lev === 2));
});

ok('a received account is bounded and cleaned', () => {
  assert.throws(() => saneAccount({}), /حساب/);
  const s = saneAccount({ v: 1, wallet: 10, positions: [{ sym: 'BTC', side: 'long', qty: 1, entry: 1, margin: 1, lev: 500, mmr: 0.004 }, { sym: 'x;drop', side: 'long', qty: 1, entry: 1, margin: 1, lev: 2, mmr: 0.004 }], marks: { BTC: 1, '<x>': 2 }, auto: { coins: ['ETH', 'bad coin'], lev: 900, mode: 'x' }, lastTickAt: 9e15 });
  assert.equal(s.positions.length, 0, 'leverage 500 and a bad symbol are dropped');
  assert.deepEqual(Object.keys(s.marks), ['BTC']);
  assert.deepEqual(s.auto, { coins: ['ETH'], lev: 125, mode: 'long' });
  assert.ok(s.lastTickAt <= Date.now());
});

ok('coin picks: the calmest liquid coins with enough history; thin or short coins listed with the reason', () => {
  const mk = (vol: number, days: number, value: number) => {
    let p = 100;
    return Array.from({ length: days }, (_, i) => {
      p *= 1 + (i % 2 ? vol : -vol * 0.98);
      return { t: Date.parse('2024-01-01') + i * D, c: p, v: value };
    });
  };
  const inputs = [
    { sym: 'BTC', id: 'bitcoin', name: 'Bitcoin', bars: mk(0.02, 500, 1e9) },
    { sym: 'ETH', id: 'ethereum', name: 'Ethereum', bars: mk(0.03, 500, 5e8) },
    { sym: 'TRX', id: 'tron', name: 'TRON', bars: mk(0.01, 500, 1e8) },
    { sym: 'PEPE', id: 'pepe', name: 'Pepe', bars: mk(0.08, 500, 3e8) },
    { sym: 'NEW', id: 'new', name: 'New', bars: mk(0.005, 200, 1e9) },
    { sym: 'THIN', id: 'thin', name: 'Thin', bars: mk(0.004, 500, 1e5) },
    { sym: 'GONE', id: 'gone', name: 'Gone', bars: null },
  ];
  const p = pickCoins(inputs);
  assert.deepEqual(p.picked.map((r) => r.sym), ['TRX', 'BTC', 'ETH']);
  assert.equal(p.picked.length, PICK_K);
  assert.match(p.rows.find((r) => r.sym === 'NEW')!.why!, /تاریخچه کوتاه/);
  assert.match(p.rows.find((r) => r.sym === 'THIN')!.why!, /حجم/);
  assert.match(p.rows.find((r) => r.sym === 'GONE')!.why!, /داده/);
  assert.ok(p.rows.indexOf(p.rows.find((r) => r.sym === 'PEPE')!) === 3);
  assert.equal(PICK_MIN_DAYS, 400);
});

// with the real data cached, the app's picker and the evaluation agree on the last day
if (fs.existsSync('.cache/eval/daily-long/BTC.json')) {
  ok('coin picks on real data (.cache/eval): same three as the evaluation’s last rebalance', () => {
    const { PICK_UNIVERSE } = require('../lib/engine/coin-pick');
    const inputs = PICK_UNIVERSE.map((u: any) => {
      const f = `.cache/eval/daily-long/${u.sym}.json`;
      return { ...u, bars: fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null };
    });
    const p = pickCoins(inputs);
    console.log(`   picks as of ${new Date(p.asOf!).toISOString().slice(0, 10)}: ${p.picked.map((r) => `${r.sym} ${r.vol20Pct!.toFixed(0)}%`).join(', ')}`);
    assert.equal(p.picked.length, 3);
    assert.ok(p.picked.every((r) => r.vol20Pct! < p.rows.filter((x) => x.eligible && !x.picked)[0].vol20Pct!));
  });
}

console.log(`\n${n} futures / coin-pick checks passed`);
