/**
 * Swing engine v2 invariants, offline (synthetic OHLCV — the real-data evaluation lives in
 * scripts/eval and needs a one-time download). Run: npx tsx scripts/swing-v2-test.ts
 */
import assert from 'node:assert';
import { runSwing, type SwingBar, type SwingConfig, type SwingPreset } from '@/lib/engine/swing';
import { dailyRegime, V2_WARMUP_H } from '@/lib/engine/swing-v2';
import { startSwingLive, swingLiveTick } from '@/lib/engine/swing-live';

let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const H = 3_600_000, DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 1);

/** regime-switching OHLCV: up, chop, down, up — so every branch of the engine gets exercised */
function mk(n: number, drifts = [0.0009, 0, -0.0008, 0.0012]): SwingBar[] {
  const out: SwingBar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const mu = drifts[Math.floor((i / n) * drifts.length)];
    const o = p;
    p = p * Math.exp(mu + 0.009 * gauss());
    const h = Math.max(o, p) * (1 + Math.abs(gauss()) * 0.003);
    const l = Math.min(o, p) * (1 - Math.abs(gauss()) * 0.003);
    out.push({ t: T0 + i * H, p, o, h, l, v: 1e6 * (0.5 + rnd()) * (Math.abs(p / o - 1) > 0.012 ? 2.5 : 1) });
  }
  return out;
}
function daily(bars: SwingBar[]): SwingBar[] {
  const m = new Map<number, number>();
  for (const b of bars) m.set(Math.floor(b.t / DAY) * DAY, b.p);
  return [...m].map(([t, p]) => ({ t, p }));
}
const COIN = { id: 'tst', symbol: 'TST', name: 'تست' };
const bars = mk(4000);
const btc = mk(4000, [0.0007, 0.0002, -0.0006, 0.001]).map((b) => ({ t: b.t, p: b.p }));
const base = (preset: SwingPreset, upto = bars.length): SwingConfig => ({
  capitalToman: 1e8, preset, feePct: 0.4, usdtRial: 1e6, engine: 'v2',
  daily: daily(bars.slice(0, upto)), market: btc.slice(0, upto), marketDaily: daily(btc.slice(0, upto) as SwingBar[]),
});

let checks = 0;
const ok = (name: string) => { checks++; console.log(`✓ ${name}`); };

for (const preset of ['trend', 'calm', 'normal', 'aggressive'] as SwingPreset[]) {
  const r = runSwing(bars, COIN, base(preset));
  const t = r.trades;
  assert.ok(t.length > 0, `${preset}: expected some trades on a regime-switching series`);
  // 1) bookkeeping
  const sum = t.reduce((a, x) => a + x.pnlToman, 0);
  assert.ok(Math.abs(r.metrics.finalEquity - (1e8 + sum)) < 1, `${preset}: equity must reconcile with trade P&L`);
  for (let i = 1; i < t.length; i++) assert.ok(t[i].entryAt >= t[i - 1].exitAt, `${preset}: positions must not overlap`);
  assert.ok(t.every((x) => x.exitAt > x.entryAt && x.qty > 0 && x.feeToman > 0), `${preset}: malformed trade`);
  assert.ok(r.equity.every((e) => e.equity > 0), `${preset}: long-only equity cannot go negative`);
  // 2) execution rules from OHLC
  for (const x of t.filter((x) => x.exit === 'stop')) {
    const bar = bars.find((b) => b.t === x.exitAt)!;
    assert.ok(x.exitPrice <= x.stopPrice * (1 + 1e-9), `${preset}: stop filled above its level`);
    assert.ok(x.exitPrice >= bar.l! * (1 - 1e-9) || x.exitPrice === bar.o, `${preset}: stop filled outside the bar`);
  }
  for (const x of t.filter((x) => x.exit === 'target')) assert.ok(x.exitPrice >= x.targetPrice * (1 - 1e-9), `${preset}: target filled below its level`);
  // nothing trades during warm-up
  if (preset !== 'trend') assert.ok(t[0].entryAt >= bars[V2_WARMUP_H].t, `${preset}: traded during indicator warm-up`);
  // 3) no lookahead: cutting the future off must not change any trade that had already closed
  const cut = 2600;
  const short = runSwing(bars.slice(0, cut), COIN, base(preset, cut));
  const closedBefore = short.trades.filter((x) => x.exit !== 'end');
  const sameInLong = t.slice(0, closedBefore.length);
  assert.deepEqual(sameInLong.map((x) => [x.entryAt, x.exitAt, x.exit]), closedBefore.map((x) => [x.entryAt, x.exitAt, x.exit]), `${preset}: future bars changed a past trade`);
  // 4) costs bite
  const free = runSwing(bars, COIN, { ...base(preset), feePct: 0 });
  assert.ok(free.metrics.returnPct > r.metrics.returnPct, `${preset}: fees did not reduce the return`);
  ok(`${preset}: ${t.length} trades, ret ${r.metrics.returnPct.toFixed(1)}% — bookkeeping, OHLC fills, warm-up, no lookahead, fees`);
}

// 5) the daily regime only uses days that have closed
{
  const d = daily(bars);
  const before = dailyRegime(bars, d)!;
  const k = 120; // change one day's close far in the "future" of bar 100*24
  const d2 = d.map((x, i) => (i === k ? { ...x, p: x.p * 3 } : x));
  const after = dailyRegime(bars, d2)!;
  const firstAffected = after.findIndex((v, i) => v !== before[i]);
  assert.ok(firstAffected === -1 || bars[firstAffected].t >= d[k].t + DAY - H, 'a daily close influenced bars before that day had closed');
  ok('daily regime is causal (a day counts only after it closes)');
}

// 6) the trend rider is in the market only when the daily regime says so, and rarely switches
{
  const r = runSwing(bars, COIN, base('trend'));
  const reg = dailyRegime(bars, daily(bars))!;
  const mreg = dailyRegime(bars, daily(btc as SwingBar[]))!;
  for (const x of r.trades) {
    const i = bars.findIndex((b) => b.t === x.entryAt);
    assert.equal(reg[i], true, 'trend ride entered while the coin was below its 50-day average');
    assert.equal(mreg[i], true, 'trend ride entered while BTC was below its 50-day average');
  }
  assert.ok(r.trades.length < 40, `trend ride switched too often (${r.trades.length})`);
  ok(`trend ride: ${r.trades.length} trades, every entry inside an up-regime`);
}

// 7) live replay reproduces the backtest exactly with v2
{
  const cfg = { coins: [COIN], capitalToman: 1e8, preset: 'normal' as const, feePct: 0.4, hours: 168, usdtRial: 1e6, engine: 'v2' as const };
  const startIdx = 3000;
  let s = startSwingLive(cfg, bars[startIdx].t + 10 * 60_000);
  const anchor = s.anchor!;
  const from = bars.findIndex((b) => b.t >= anchor);
  for (let i = startIdx + 1; i < bars.length; i++) {
    const now = bars[i].t + 30 * 60_000; // half-way through bar i → bars < i are confirmed
    const slice = bars.slice(from, i + 1);
    s = swingLiveTick(s, [{ coin: COIN, bars: slice, daily: daily(bars.slice(0, i)), livePrice: bars[i].p }], now, {
      market: btc.slice(from, i + 1), marketDaily: daily(btc.slice(0, i) as SwingBar[]),
    }).session;
  }
  const batch = runSwing(bars.slice(from, bars.length - 1), COIN, { ...base('normal', bars.length - 1), market: btc.slice(from, bars.length - 1), tradeFrom: s.tradeFrom });
  const startedAt = bars[startIdx].t;
  const expected = batch.trades.filter((x) => x.exit !== 'end' && x.entryAt >= startedAt);
  assert.equal(s.fills.length, expected.length, `live fills ${s.fills.length} ≠ backtest ${expected.length}`);
  assert.deepEqual(s.fills.map((f) => [f.entryAt, f.exitAt]), expected.map((x) => [x.entryAt, x.exitAt]));
  ok(`live v2 replay matches the backtest (${s.fills.length} fills)`);
}

console.log(`\n${checks} swing v2 checks passed`);
