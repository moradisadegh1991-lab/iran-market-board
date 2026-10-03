/**
 * Pins «when to buy, when to sell» (lib/engine/forecast-timing.ts) and the user's drawing on the
 * forecast chart (lib/forecast-draw.ts): window lows/highs computed by hand, a forecast on day t that
 * does not change whatever happens after t (CLAUDE.md rule 4), limit fills on closes only, a plan
 * record that compares honestly with buying today, and the probabilities read off the cone.
 * With the real data of scripts/eval (.cache/eval, optional) it prints the plan's record per asset.
 * Run: npx tsx scripts/timing-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { featureMatrix, forwardIndex } from '../lib/engine/forecast-model';
import { followPlan, pathOutcomes, planRecord, PLAN_FILL, timingAt, timingDist, timingFrom } from '../lib/engine/forecast-timing';
import { addMark, addTrend, coneAt, emptyDrawing, normalizeDrawings, probBelow, readouts, removeItem, trendAt } from '../lib/forecast-draw';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const DAY = 86_400_000;
const isoAt = (i: number) => new Date(Date.parse('2015-01-01T00:00:00Z') + i * DAY).toISOString().slice(0, 10);

function walk(days: number, seed: number, vol = 0.012, drift = 0.0008) {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const dates: string[] = [];
  const prices: number[] = [];
  let p = 1000;
  for (let i = 0; i < days; i++) {
    p *= Math.exp(drift + vol * g());
    dates.push(isoAt(i));
    prices.push(p);
  }
  return { dates, prices };
}

ok('window low/high and their days, by hand', () => {
  const dates = [0, 1, 2, 3, 4, 5].map(isoAt);
  const prices = [100, 104, 97, 99, 110, 105];
  const fwd = forwardIndex(dates, 3);
  const o = pathOutcomes(dates, prices, fwd);
  // day 0's window is days 1..3: low 97 on day 2, high 104 on day 1, ends at 99
  close(o.min[0], Math.log(97 / 100));
  close(o.minDay[0], 2);
  close(o.max[0], Math.log(104 / 100));
  close(o.maxDay[0], 1);
  close(o.end[0], Math.log(99 / 100));
  assert.ok(Number.isNaN(o.min[3]), 'an incomplete window has no outcome');
});

ok('a buy limit fills on the first close at or under it, at the limit; else the plan buys on the last day', () => {
  const dates = [0, 1, 2, 3, 4].map(isoAt);
  const prices = [100, 99, 96, 103, 108];
  const fwd = forwardIndex(dates, 4);
  const o = pathOutcomes(dates, prices, fwd);
  const filled = followPlan(prices, fwd, o, 0, Math.log(0.97), Math.log(1.2))!;
  assert.ok(filled.buyFilled);
  close(filled.buy, Math.log(0.97));
  assert.ok(!filled.sellFilled, 'never reached +20%');
  close(filled.sell, Math.log(1.08), 1e-12);
  const missed = followPlan(prices, fwd, o, 0, Math.log(0.9), Math.log(1.05))!;
  assert.ok(!missed.buyFilled);
  close(missed.buy, Math.log(1.08), 1e-12); // bought at the window's last close — the honest cost of waiting
  assert.ok(missed.sellFilled);
  close(missed.sell, Math.log(1.05));
});

const w = walk(1500, 11);
const feats = featureMatrix(w.prices);

ok('a forecast on day t is the same whatever happened after t', () => {
  const t = 1100;
  const fwd = forwardIndex(w.dates, 30);
  const out = pathOutcomes(w.dates, w.prices, fwd);
  const a = timingAt(w.dates, w.prices, fwd, out, t, { analog: { feats } })!;
  // rewrite the future: a crash after day t
  const prices2 = w.prices.map((p, i) => (i > t ? p * 0.3 : p));
  const feats2 = featureMatrix(prices2);
  const fwd2 = forwardIndex(w.dates, 30);
  const out2 = pathOutcomes(w.dates, prices2, fwd2);
  const b = timingAt(w.dates, prices2, fwd2, out2, t, { analog: { feats: feats2 } })!;
  assert.deepEqual(a, b);
});

ok('limits and quantiles are ordered; the fill probability is what the past windows say', () => {
  const fwd = forwardIndex(w.dates, 30);
  const out = pathOutcomes(w.dates, w.prices, fwd);
  const d = timingDist(w.dates, w.prices, fwd, out, 1400, { analog: { feats } })!;
  const f = timingFrom(d, PLAN_FILL);
  assert.ok(f.low[0] <= f.low[1] && f.low[1] <= f.low[2]);
  assert.ok(f.high[0] <= f.high[1] && f.high[1] <= f.high[2]);
  assert.ok(f.buyAt <= 0 && f.sellAt >= 0);
  assert.ok(f.lowDay >= 1 && f.lowDay <= 30 && f.highDay >= 1 && f.highDay <= 30);
  // a higher fill probability means a limit closer to today
  assert.ok(timingFrom(d, 0.9).buyAt >= timingFrom(d, 0.5).buyAt);
  assert.ok(timingFrom(d, 0.9).sellAt <= timingFrom(d, 0.5).sellAt);
  assert.ok(f.n.empirical > 100 && f.n.analog >= 30);
});

ok('the plan record compares with buying today and with holding to the end', () => {
  const r = planRecord(w.dates, w.prices, 30, { samples: 40, feats })!;
  assert.ok(r.n >= 12 && r.periods >= 4);
  assert.ok(r.buyFilledPct >= 0 && r.buyFilledPct <= 100);
  assert.ok(Number.isFinite(r.buyVsNowPct) && Number.isFinite(r.sellVsEndPct));
  assert.ok(r.from < r.to);
  // with a rising walk, waiting for a dip costs on average — the record must be able to say so
  const up = walk(1500, 5, 0.01, 0.003);
  const ru = planRecord(up.dates, up.prices, 30, { samples: 40, feats: featureMatrix(up.prices) })!;
  assert.ok(ru.buyVsNowPct > 0, `rising market: the plan bought dearer (${ru.buyVsNowPct})`);
  assert.ok(ru.sellVsEndPct < 0, 'and selling at the target beat nothing over holding');
});

// ── the user's drawing ──
const cone = [0, 10, 20, 30].map((d) => ({ t: Date.parse('2026-10-03T00:00:00Z') + d * DAY, p5: 100 - d, p25: 100 - d / 3, p50: 100 + d / 5, p75: 100 + d / 2, p95: 100 + d * 1.5 }));

ok('probability under a price, read off the cone; clamped beyond the 90% band', () => {
  const c = cone[3]; // p5 70, p25 90, p50 106, p75 115, p95 145
  close(probBelow(c, 106), 0.5, 1e-12);
  close(probBelow(c, 90), 0.25, 1e-12);
  close(probBelow(c, 145), 0.95, 1e-12);
  assert.equal(probBelow(c, 50), 0.025);
  assert.equal(probBelow(c, 500), 0.975);
  const mid = probBelow(c, 98);
  assert.ok(mid > 0.25 && mid < 0.5);
  // between two cone points it interpolates; outside it says nothing
  const at = coneAt(cone, cone[1].t + 5 * DAY)!;
  assert.ok(at.p50 > cone[1].p50 && at.p50 < cone[2].p50);
  assert.equal(coneAt(cone, cone[3].t + DAY), null);
});

ok('trend lines are straight in log price; drawings keep order, cap and survive bad storage', () => {
  const t0 = cone[0].t;
  const tr = { id: 'a', a: [t0, 100] as [number, number], b: [t0 + 10 * DAY, 110] as [number, number] };
  close(trendAt(tr, t0 + 20 * DAY), 121, 1e-9);
  let d = addTrend(emptyDrawing(), tr.b, tr.a, 't1');
  assert.ok(d.trends[0].a[0] < d.trends[0].b[0], 'points sorted by time');
  assert.equal(addTrend(d, [t0, 1], [t0, 2], 'x').trends.length, 1, 'a vertical line is not a trend');
  for (let i = 0; i < 30; i++) d = addMark(d, 'buy', [t0 + i, 100], `m${i}`);
  assert.equal(d.marks.length, 16);
  assert.equal(removeItem(d, 't1').trends.length, 0);
  const back = normalizeDrawings(JSON.parse(JSON.stringify({ usd: d, bad: { trends: [{ id: 'z', a: [1, -5], b: [2, 3] }], marks: [{ id: 'q', kind: 'hold', at: [1, 2] }] }, junk: 5 })));
  assert.equal(back.usd.marks.length, 16);
  assert.equal(back.bad, undefined, 'invalid objects dropped');
});

ok('readouts: trend end vs the cone, future buy/sell probabilities, past points, a buy→sell pair', () => {
  const t0 = cone[0].t;
  let d = emptyDrawing();
  d = addTrend(d, [t0 - 30 * DAY, 90], [t0, 100], 'tr');
  d = addMark(d, 'buy', [t0 + 20 * DAY, 100 - 20 / 3], 'b'); // the 25th percentile that day
  d = addMark(d, 'sell', [t0 + 30 * DAY, 115], 's'); // the 75th
  d = addMark(d, 'sell', [t0 - 5 * DAY, 99], 'old');
  const r = readouts(
    d,
    cone,
    [
      [t0 - 5 * DAY, 97],
      [t0, 100],
    ],
    100,
  );
  const tr = r.find((x) => x.kind === 'trend')!;
  assert.ok(tr.kind === 'trend' && tr.endPrice > 100 && tr.pAbove > 0 && tr.pAbove < 1);
  const b = r.find((x) => x.id === 'b')!;
  assert.ok(b.kind === 'buy' && b.future && Math.abs(b.p - 0.25) < 1e-9, 'buy at the 25th percentile ≈ 25%');
  const s = r.find((x) => x.id === 's')!;
  assert.ok(s.kind === 'sell' && s.future && Math.abs(s.p - 0.25) < 1e-9, 'sell at the 75th percentile ≈ 25%');
  const old = r.find((x) => x.id === 'old')!;
  assert.ok(old.kind === 'sell' && !old.future && old.actual === 97);
  const pair = r.find((x) => x.kind === 'pair')!;
  assert.ok(pair.kind === 'pair');
  close(pair.returnPct, (115 / (100 - 20 / 3) - 1) * 100, 1e-9);
});

// real data: the record the page shows, per asset (the full study is scripts/eval/timing-eval.ts)
const CACHE = '.cache/eval';
if (fs.existsSync(`${CACHE}/daily-usd.json`)) {
  console.log('\nreal data — buy plan vs buying today / sell plan vs holding to the end (60 past days per horizon):');
  for (const k of ['usd', 'coin', 'g18']) {
    const raw = JSON.parse(fs.readFileSync(`${CACHE}/daily-${k}.json`, 'utf8')) as [string, number][];
    const dates = raw.map((x) => x[0]);
    const prices = raw.map((x) => x[1]);
    const f = featureMatrix(prices);
    const cells = [7, 30, 90].map((days) => {
      const r = planRecord(dates, prices, days, { samples: 60, feats: f })!;
      return `${days}d buy ${r.buyVsNowPct >= 0 ? '+' : ''}${r.buyVsNowPct.toFixed(1)}% (filled ${r.buyFilledPct.toFixed(0)}%) sell-vs-end ${r.sellVsEndPct.toFixed(1)}%`;
    });
    console.log(`  ${k.padEnd(5)} ${cells.join(' · ')}`);
  }
}

console.log(`\ntiming: ${n} checks OK`);
