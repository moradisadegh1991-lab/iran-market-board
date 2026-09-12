// Offline test: learning loop (bounds, novelty, walk-forward) and live paper trading (hours, stops, finish).
// Run: npx tsx scripts/learn-live-test.ts
import assert from 'node:assert/strict';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;

import { DEFAULT_PARAMS, PARAM_BOUNDS, SIM_ASSETS, simulate, normalizeParams, type SimAsset, type SimParams } from '@/lib/engine/simulator';
import { learnFromResult, paramRows } from '@/lib/engine/learning';
import { lookupFromSeries } from '@/lib/learning';
import { createSession, finishSession, liveTick, marketOpen, type TickContext } from '@/lib/engine/live';
import { regressionInput } from './sim-regression';
import { tehranClock, tehranDate } from '@/lib/num';

const base = regressionInput();
const lookup = lookupFromSeries(base.series);
const iso = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);

function inBounds(p: SimParams) {
  for (const r of paramRows(p)) assert.ok(Number.isFinite(r.value), `finite ${r.key}`);
  for (const w of Object.values(p.weights)) assert.ok(w >= PARAM_BOUNDS.weight[0] && w <= PARAM_BOUNDS.weight[1]);
  assert.ok(p.entryShift >= PARAM_BOUNDS.entryShift[0] && p.entryShift <= PARAM_BOUNDS.entryShift[1]);
  assert.ok(p.stopMult >= PARAM_BOUNDS.stopMult[0] && p.stopMult <= PARAM_BOUNDS.stopMult[1]);
  for (const t of Object.values(p.assetTrust)) assert.ok(t >= PARAM_BOUNDS.assetTrust[0] && t <= PARAM_BOUNDS.assetTrust[1]);
}

// ── 1. single learning step ──
const r1 = simulate({ ...base, start: iso(200), end: iso(320) });
const o1 = learnFromResult(DEFAULT_PARAMS, r1, lookup, 1);
inBounds(o1.after);
assert.ok(o1.lessons.length > 0, 'lessons produced');
for (const f of o1.flags) assert.ok(r1.trades.some((t) => t.n === f.n), 'flag refers to a real trade');
console.log(`learn#1 applied=${o1.applied} v${o1.before.version}→v${o1.after.version} closed=${o1.closedRoundTrips} lessons=${o1.lessons.map((l) => l.code).join(',')}`);
for (const d of o1.deltas) console.log(`   ${d.label}: ${d.from.toFixed(3)} → ${d.to.toFixed(3)}`);
if (o1.applied) assert.equal(o1.after.version, 1);

// ── 2. re-learning the same window must not move parameters ──
const o2 = learnFromResult(o1.after, r1, lookup, 0.05);
assert.equal(o2.applied, false);
assert.ok(o2.reason && o2.reason.includes('بیش‌برازش'));
assert.deepEqual(o2.after, o1.after);
console.log('re-learn same window blocked:', o2.reason);

// ── 3. walk-forward: learn on consecutive windows, evaluate on an unseen one ──
let params: SimParams = DEFAULT_PARAMS;
for (const [a, b] of [[200, 280], [280, 360], [360, 430]]) {
  const r = simulate({ ...base, start: iso(a), end: iso(b) }, params);
  const o = learnFromResult(params, r, lookup, 1);
  inBounds(o.after);
  params = o.after;
}
const test = { ...base, start: iso(430), end: iso(515) };
const rb = simulate(test, DEFAULT_PARAMS);
const rl = simulate(test, params);
console.log(`walk-forward out-of-sample: baseline ${rb.metrics.returnPct.toFixed(2)}% (${rb.metrics.trades} trades) vs learned v${params.version} ${rl.metrics.returnPct.toFixed(2)}% (${rl.metrics.trades} trades)`);
assert.equal(rl.paramsVersion, params.version);
assert.ok(rl.trades.every((t) => t.paramsVersion === params.version));

// extreme stored params get clamped
const wild = normalizeParams({ entryShift: 999, stopMult: -5, weights: { trend: 50 } as any, assetTrust: { btc: 0 } as any });
inBounds(wild);

// ── 4. live session over ~30 days of 10-minute ticks ──
let seed = 99;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const START_DAY = 401;
const t0 = Date.parse(`${iso(START_DAY)}T04:00:00Z`);
const daily: TickContext['daily'] = {};
for (const a of base.assets) {
  const s = base.series[a]!;
  const n = s.dates.findIndex((d) => d >= iso(START_DAY));
  daily[a] = { dates: s.dates.slice(0, n), prices: s.prices.slice(0, n) };
}
const px: Record<string, number> = Object.fromEntries(base.assets.map((a) => [a, daily[a]!.prices.at(-1)!]));
const drift: Record<string, number> = { usd: 0.00004, g18: 0.00003, coin: 0.00005, tse: -0.00002, btc: 0.00012, eth: -0.0001 };
const vol: Record<string, number> = { usd: 0.0012, g18: 0.0013, coin: 0.0015, tse: 0.0014, btc: 0.004, eth: 0.005 };

const session = createSession('test', { capitalToman: 500_000_000, profile: 'aggressive', assets: base.assets, days: 30, reviewEveryDays: 1, fixedIncomeYield: 0.3, useNews: false }, params, t0);
let lastDate = tehranDate(new Date(t0));
let ticks = 0;
let trades = 0;
const STEP = 10 * 60_000;
for (let now = t0; session.status === 'running'; now += STEP) {
  const date = tehranDate(new Date(now));
  if (date !== lastDate) {
    for (const a of base.assets) {
      daily[a]!.dates.push(lastDate);
      daily[a]!.prices.push(px[a]);
    }
    lastDate = date;
  }
  const quotes: Partial<Record<SimAsset, number>> = {};
  for (const a of base.assets) {
    const moves = SIM_ASSETS.find((x) => x.key === a)!.crypto || marketOpen(a, now);
    if (moves) px[a] *= Math.exp(drift[a] - vol[a] ** 2 / 2 + vol[a] * gauss());
    quotes[a] = px[a];
  }
  // mid-session crash in ETH to force a trailing stop
  if (now > t0 + 12 * 86400000 && now < t0 + 13 * 86400000) px.eth *= 0.9985;
  const out = liveTick(session, { now, quotes, usdRial: px.usd, daily, ons: base.ons, usdRef: base.usdRef, news: [] });
  ticks++;
  trades += out.newTrades.length;
  for (const t of out.newTrades) {
    if (!SIM_ASSETS.find((x) => x.key === t.asset)!.crypto) assert.ok(marketOpen(t.asset, t.at), `non-crypto fill only in market hours (${t.asset} ${new Date(t.at).toISOString()} Tehran ${JSON.stringify(tehranClock(new Date(t.at)))})`);
    assert.ok(session.acct.cash > -1, 'cash never negative');
  }
  if (ticks > 30 * 144 + 10) throw new Error('session did not expire');
}
assert.equal(session.endReason, 'expired');
const lr = session.result!;
assert.ok(lr.metrics && Number.isFinite(lr.metrics.finalEquity));
// equity keeps intraday detail for recent days but is bounded: older days collapse to one sample each
assert.ok(session.equity.length <= 600, `equity bounded (${session.equity.length})`);
{
  const byDate = new Map<string, number>();
  for (const p of session.equity) byDate.set(p.date, (byDate.get(p.date) ?? 0) + 1);
  const days = [...byDate.keys()].sort();
  assert.ok(days.length >= 28, `one sample per day kept (${days.length} days)`);
  const intradayDays = days.filter((d) => (byDate.get(d) ?? 0) > 1);
  assert.ok(intradayDays.length >= 1, `recent days keep intraday samples (${intradayDays.length})`);
  const ats = session.equity.map((p) => p.at);
  assert.deepEqual(ats, [...ats].sort((a, b) => a - b), 'equity stays chronological after thinning');
}
assert.ok(trades > 0, 'live session traded');
const kinds = [...new Set(session.trades.map((t) => t.kind))];
console.log(`live: ${ticks} ticks, ${trades} trades (${kinds.join(',')}), equity points ${session.equity.length}, return ${lr.metrics.returnPct.toFixed(2)}%, stops ${lr.metrics.stops}, events ${session.events.length}`);
console.log('   first events:', session.events.slice(-3).map((e) => e.text.slice(0, 90)));
assert.ok(lr.analysis.at(-1)!.body.includes('قیمت‌های زنده'));

const lo = learnFromResult(params, lr, lookupFromSeries(daily as any), 1);
inBounds(lo.after);
console.log(`learn from live: applied=${lo.applied} lessons=${lo.lessons.map((l) => l.code).join(',')}${lo.reason ? ` reason=${lo.reason}` : ''}`);

// ── 5. manual stop ──
const s2 = createSession('stop', { capitalToman: 100_000_000, profile: 'balanced', assets: ['btc', 'usd'], days: 30, reviewEveryDays: 7, fixedIncomeYield: 0.3, useNews: false }, DEFAULT_PARAMS, t0);
liveTick(s2, { now: t0, quotes: { btc: px.btc, usd: px.usd }, usdRial: px.usd, daily, news: [] });
liveTick(s2, { now: t0 + STEP, quotes: { btc: px.btc * 1.01, usd: px.usd }, usdRial: px.usd, daily, news: [] });
const res2 = finishSession(s2, 'stopped', { now: t0 + 2 * STEP });
assert.equal(s2.status, 'finished');
assert.equal(s2.endReason, 'stopped');
assert.ok(Number.isFinite(res2.metrics.returnPct));
const after = liveTick(s2, { now: t0 + 3 * STEP, quotes: { btc: px.btc }, usdRial: px.usd, daily, news: [] });
assert.equal(after.newTrades.length, 0, 'finished sessions do not trade');
console.log(`manual stop: ${s2.trades.length} trades, return ${res2.metrics.returnPct.toFixed(3)}%`);

// JSON round-trip (sessions live in Redis)
const clone = JSON.parse(JSON.stringify(session));
assert.equal(clone.trades.length, session.trades.length);
console.log(`session JSON size ${(JSON.stringify(session).length / 1024).toFixed(0)} KB`);
console.log('\nLEARN+LIVE OK');
for (const k of Object.keys(session) as (keyof typeof session)[]) {
  const n = JSON.stringify(session[k]).length;
  if (n > 2000) console.log(`   ${k}: ${(n / 1024).toFixed(0)} KB`);
}
