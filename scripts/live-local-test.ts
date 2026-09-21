// The device-owned live session: the engine must advance a session handed to it and hand it back
// without keeping anything, so two devices running side by side never touch each other's run.
// Exercises lib/engine/live.ts directly (the route is a thin wrapper around exactly these calls).
import assert from 'node:assert';
import { createSession, finishSession, liveTick, type LiveConfig, type TickContext } from '../lib/engine/live';
import { DEFAULT_PARAMS, type SimAsset } from '../lib/engine/simulator';

const DAY = 86400000;
let seed = 777;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A weekday inside Tehran market hours, so orders can actually fill. */
const baseNow = Date.parse('2026-09-21T09:00:00Z'); // 12:30 Tehran, Monday

function history(days: number, start: number, drift: number, vol: number) {
  const dates: string[] = [];
  const prices: number[] = [];
  let p = start;
  for (let i = days; i > 0; i--) {
    p *= Math.exp(drift + vol * (rnd() - 0.5) * 2);
    dates.push(new Date(baseNow - i * DAY).toISOString().slice(0, 10));
    prices.push(p);
  }
  return { dates, prices };
}

const ASSETS: SimAsset[] = ['usd', 'g18', 'btc'];
const config: LiveConfig = {
  capitalToman: 500_000_000, profile: 'balanced', assets: ASSETS, days: 30,
  reviewEveryDays: 1, activity: 'normal', fixedIncomeYield: 0.3, useNews: false,
};

const daily = {
  usd: history(200, 900_000, 0.0012, 0.009),
  g18: history(200, 85_000_000, 0.0013, 0.011),
  btc: history(200, 1.8e12, 0.0016, 0.03),
};
const ctxAt = (now: number, bump = 1): TickContext => ({
  now,
  quotes: {
    usd: daily.usd.prices[daily.usd.prices.length - 1] * bump,
    g18: daily.g18.prices[daily.g18.prices.length - 1] * bump,
    btc: daily.btc.prices[daily.btc.prices.length - 1] * bump,
  },
  usdRial: daily.usd.prices[daily.usd.prices.length - 1] * bump,
  daily,
  usdRef: daily.usd,
  news: [],
});

// ── 1. a session advances, and every tick leaves it serialisable ──
const s = createSession('t1', config, DEFAULT_PARAMS, baseNow);
const first = liveTick(s, ctxAt(baseNow));
assert.equal(s.ticks, 1, 'the first tick must be counted');
assert.ok(s.equity.length >= 1, 'the first tick must record an equity point');
const roundTrip = JSON.parse(JSON.stringify(s));
assert.deepEqual(roundTrip.config.assets, ASSETS, 'a session must survive JSON round-trip — that is how the device stores it');
console.log(`first tick: ${first.newTrades.length} trades, equity ${Math.round(s.equity[0].equity).toLocaleString('en-US')} toman`);

// ── 2. THE point of this endpoint: two sessions must not influence each other ──
const a = createSession('a', { ...config, capitalToman: 100_000_000 }, DEFAULT_PARAMS, baseNow);
const b = createSession('b', { ...config, capitalToman: 900_000_000, profile: 'aggressive' }, DEFAULT_PARAMS, baseNow);
for (let d = 0; d < 6; d++) {
  const t = baseNow + d * DAY;
  liveTick(a, ctxAt(t, 1 + d * 0.01));
  liveTick(b, ctxAt(t, 1 + d * 0.01));
}
assert.notEqual(a.id, b.id);
assert.equal(a.config.capitalToman, 100_000_000, "one device's capital must not be touched by another's");
assert.equal(b.config.capitalToman, 900_000_000);
assert.ok(a.acct.cash !== b.acct.cash, 'two different books must diverge');
assert.ok(
  Math.abs(a.equity[a.equity.length - 1].equity / 100_000_000 - b.equity[b.equity.length - 1].equity / 900_000_000) < 0.5,
  'but the same strategy on the same prices should give comparable returns per toman',
);
console.log(`isolation OK — device A ${a.trades.length} trades on 100m, device B ${b.trades.length} trades on 900m`);

// ── 3. interest accrues on idle cash between ticks, exactly as in the shared engine ──
const idle = createSession('idle', { ...config, assets: ['usd'], reviewEveryDays: 90 }, DEFAULT_PARAMS, baseNow);
liveTick(idle, { ...ctxAt(baseNow), quotes: {}, usdRial: null, daily: {} }); // no quotes → no trading
const cash0 = idle.acct.cash;
liveTick(idle, { ...ctxAt(baseNow + 10 * DAY), quotes: {}, usdRial: null, daily: {} });
const expected = cash0 * Math.pow(1.3, 10 / 365);
assert.ok(Math.abs(idle.acct.cash - expected) / expected < 1e-9, `idle cash must earn the fixed-income rate (${idle.acct.cash} vs ${expected})`);
console.log(`idle cash OK — 10 days at 30%/yr turned ${Math.round(cash0 / 10).toLocaleString('en-US')} into ${Math.round(idle.acct.cash / 10).toLocaleString('en-US')} toman`);

// ── 4. expiry closes the session by itself, so a phone that stops opening the app still ends ──
const short = createSession('short', { ...config, days: 2 }, DEFAULT_PARAMS, baseNow);
liveTick(short, ctxAt(baseNow));
const late = liveTick(short, ctxAt(baseNow + 3 * DAY, 1.05));
assert.equal(late.finished, true, 'a tick after the end date must finish the session');
assert.equal(short.status, 'finished');
assert.equal(short.endReason, 'expired');
assert.ok(short.result, 'a finished session must carry its report');
assert.ok(short.result!.benchmarks.some((x) => x.key === 'deposit'), 'and the report must compare against fixed income');
console.log(`expiry OK — ${short.result!.metrics.returnPct.toFixed(2)}% vs deposit ${short.result!.benchmarks.find((x) => x.key === 'deposit')!.returnPct.toFixed(2)}%`);

// ── 5. a manual stop marks positions to market rather than pretending they were sold ──
const stopped = createSession('stop', config, DEFAULT_PARAMS, baseNow);
for (let d = 0; d < 4; d++) liveTick(stopped, ctxAt(baseNow + d * DAY, 1 + d * 0.02));
const held = Object.values(stopped.positions).filter((p: any) => p && p.qty > 0).length;
const res = finishSession(stopped, 'stopped', { now: baseNow + 4 * DAY });
assert.equal(stopped.status, 'finished');
assert.equal(stopped.endReason, 'stopped');
assert.ok(Number.isFinite(res.metrics.finalEquity) && res.metrics.finalEquity > 0);
if (held > 0) {
  assert.ok(
    res.attribution.some((x) => x.unrealizedToman !== 0),
    'open positions must appear as unrealised, not silently liquidated',
  );
}
console.log(`manual stop OK — ${held} open position(s) marked to market, final ${Math.round(res.metrics.finalEquity).toLocaleString('en-US')} toman`);

// ── 6. a tick on a finished session is a no-op, not a resurrection ──
const after = liveTick(stopped, ctxAt(baseNow + 5 * DAY));
assert.equal(after.newTrades.length, 0);
assert.equal(stopped.status, 'finished');
console.log('finished sessions stay finished OK');

// ── 7. the stored session must stay small enough for localStorage ──
const bytes = JSON.stringify(b).length;
assert.ok(bytes < 1_500_000, `a session must fit comfortably in localStorage, got ${bytes} bytes`);
console.log(`session size after 6 days: ${(bytes / 1024).toFixed(0)} KB`);

console.log('\nLIVE LOCAL OK');
