/** Live swing must reproduce the backtester exactly, and must not act on a forming candle. */
import assert from 'node:assert';
import { runSwing, type SwingBar } from '@/lib/engine/swing';
import { confirmedBars, finishSwingLive, startSwingLive, swingLiveTick, swingLiveReturnPct } from '@/lib/engine/swing-live';

let seed = 8181;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const MIN = 60_000, HOUR = 3600_000;
const T0 = Date.UTC(2026, 0, 1);

function mkBars(n: number, stepMs: number): SwingBar[] {
  const out: SwingBar[] = []; let p = 100;
  for (let i = 0; i < n; i++) { p *= Math.exp(0.0003 + 0.008 * gauss()); out.push({ t: T0 + i * stepMs, p }); }
  return out;
}
const COIN = { id: 'test', symbol: 'TST', name: 'تست' };
const bars = mkBars(900, HOUR);
const cfg = { coins: [COIN], capitalToman: 1e8, preset: 'normal' as const, feePct: 0.4, hours: 168, usdtRial: 1e7 };

// ── 1. forming candle is excluded ──
const now = T0 + 899 * HOUR + 20 * MIN; // 20 minutes into the last hour
const conf = confirmedBars(bars, 60, now);
assert.equal(conf.length, 899, 'the still-forming bar must be dropped');
assert.ok(conf[conf.length - 1].t < now, 'last confirmed bar must be in the past');
console.log('forming candle excluded OK');

// ── 2. replaying tick by tick yields EXACTLY the backtester's trades ──
let s = startSwingLive(cfg, bars[300].t);
for (let i = 301; i <= 899; i++) {
  const t = bars[i].t + 30 * MIN; // half-way into bar i, so bars[0..i-1] are confirmed
  s = swingLiveTick(s, [{ coin: COIN, bars: bars.slice(0, i + 1), livePrice: bars[i].p }], t).session;
}
const batch = runSwing(bars.slice(0, 899), COIN, { capitalToman: 1e8, preset: 'normal', feePct: 0.4, usdtRial: 1e7 });
// the session opened at bar 300, so trades that had already closed before that are history,
// not live fills — compare only against the ones the session could actually have taken
const startedAt = bars[300].t;
const batchDone = batch.trades.filter((t) => t.exit !== 'end' && t.entryAt >= startedAt);
console.log(`live fills ${s.fills.length} vs backtest closed trades ${batchDone.length}`);
assert.equal(s.fills.length, batchDone.length, 'live must produce the same number of closed trades');
for (let i = 0; i < batchDone.length; i++) {
  assert.equal(s.fills[i].entryAt, batchDone[i].entryAt, `fill ${i} entry time differs`);
  assert.equal(s.fills[i].exitAt, batchDone[i].exitAt, `fill ${i} exit time differs`);
  assert.equal(s.fills[i].exit, batchDone[i].exit, `fill ${i} exit reason differs`);
  assert.equal(s.fills[i].netPct.toFixed(6), batchDone[i].netPct.toFixed(6), `fill ${i} P&L differs`);
}
console.log('live replay matches backtest exactly OK');

// ── 2b. a session must start flat: history already in the bars is NOT replayed as new trades ──
const mid0 = 600;
const fresh = swingLiveTick(
  startSwingLive(cfg, bars[mid0].t),
  [{ coin: COIN, bars: bars.slice(0, mid0 + 1), livePrice: bars[mid0].p }],
  bars[mid0].t + 30 * MIN,
);
assert.equal(fresh.newFills.length, 0, 'the first tick must not report pre-existing history as new trades');
assert.equal(fresh.session.fills.length, 0, 'session starts with no fills');
const startEq = fresh.session.equity[fresh.session.equity.length - 1].equity;
assert.ok(Math.abs(startEq - cfg.capitalToman) < 1, `session equity must start at capital, got ${startEq}`);
console.log('session starts flat OK');

// ── 3. fills are append-only: nothing already reported ever changes ──
let s2 = startSwingLive(cfg, bars[300].t);
const snapshots: string[] = [];
for (let i = 301; i <= 899; i++) {
  s2 = swingLiveTick(s2, [{ coin: COIN, bars: bars.slice(0, i + 1), livePrice: bars[i].p }], bars[i].t + 30 * MIN).session;
  snapshots.push(JSON.stringify(s2.fills.map((f) => [f.entryAt, f.exitAt, f.exit])));
}
for (let i = 1; i < snapshots.length; i++) {
  assert.ok(snapshots[i].startsWith(snapshots[i - 1].slice(0, -1)) || snapshots[i - 1] === '[]', `fill history rewritten at tick ${i}`);
}
console.log('fills are append-only OK');

// ── 4. an open position is marked at the live price, not silently closed ──
const mid = 700;
let s3 = startSwingLive(cfg, bars[300].t);
for (let i = 301; i <= mid; i++) s3 = swingLiveTick(s3, [{ coin: COIN, bars: bars.slice(0, i + 1), livePrice: bars[i].p }], bars[i].t + 30 * MIN).session;
if (s3.open.length) {
  const pos = s3.open[0];
  const hi = swingLiveTick(s3, [{ coin: COIN, bars: bars.slice(0, mid + 1), livePrice: pos.entryPrice * 1.05 }], bars[mid].t + 40 * MIN).session;
  const lo = swingLiveTick(s3, [{ coin: COIN, bars: bars.slice(0, mid + 1), livePrice: pos.entryPrice * 0.95 }], bars[mid].t + 40 * MIN).session;
  const vHi = hi.equity[hi.equity.length - 1].equity, vLo = lo.equity[lo.equity.length - 1].equity;
  console.log(`open position marked: +5% -> ${Math.round(vHi)}, -5% -> ${Math.round(vLo)}`);
  assert.ok(vHi > vLo, 'a higher live price must mark the sleeve higher');
  assert.ok(hi.open.length === 1 && hi.open[0].unrealisedPct > 0, 'unrealised P&L should be positive at +5%');
} else {
  console.log('(no open position at that point — marking check skipped)');
}

// ── 5. failed data keeps the sleeve in cash instead of losing it ──
const two = { ...cfg, coins: [COIN, { id: 'b', symbol: 'BBB', name: 'B' }] };
let s4 = startSwingLive(two, bars[300].t);
s4 = swingLiveTick(s4, [
  { coin: COIN, bars: bars.slice(0, 400), livePrice: bars[399].p },
  { coin: two.coins[1], bars: null, livePrice: null, error: 'timeout' },
], bars[399].t + 30 * MIN).session;
assert.ok(s4.events.some((e) => e.kind === 'data' && e.text.includes('BBB')), 'missing data must be reported');
assert.ok(s4.equity[s4.equity.length - 1].equity > two.capitalToman * 0.9, 'the failed sleeve must keep its cash');
console.log('failed sleeve keeps cash OK');

// ── 6. session expiry ──
const exp = swingLiveTick(startSwingLive({ ...cfg, hours: 1 }, T0), [{ coin: COIN, bars: bars.slice(0, 400), livePrice: bars[399].p }], T0 + 2 * HOUR).session;
assert.equal(exp.status, 'finished');
assert.equal(exp.endReason, 'expired');
const stopped = finishSwingLive(startSwingLive(cfg, T0), T0 + HOUR, 'stopped');
assert.equal(stopped.endReason, 'stopped');
assert.ok(Number.isFinite(swingLiveReturnPct(stopped)));
console.log('expiry and manual stop OK');

console.log('\nSWING LIVE OK');
