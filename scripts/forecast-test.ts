/**
 * Pins the forecast cones of the charts page (lib/engine/forecast.ts): the cone passes exactly
 * through the scenario engine's numbers at its horizons, widens with time, keeps its percentiles in
 * order; the track record uses only prices up to each forecast day (CLAUDE.md rule 4).
 * With the real data of scripts/eval (.cache/eval, optional) it also prints how often the 90% band
 * really held the price — the number the page shows.
 * Run: npx tsx scripts/forecast-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { calibrate, calibrateEnsemble, calibrationSamples, coneFromRows, ensembleAt, ensembleRows, FORECAST_HORIZONS, MIN_PERIODS, type EnsembleSeries } from '../lib/engine/forecast';
import { featureMatrix } from '../lib/engine/forecast-model';
import { buildScenario, SCENARIO_HORIZONS, type ScenarioInput } from '../lib/engine/scenario';
import type { ScenarioRow } from '../lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};

// a seeded random walk with drift, one price a day
function walk(days: number, seed: number, volDaily = 0.012, drift = 0.0008): ScenarioInput {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const dates: string[] = [];
  const prices: number[] = [];
  let p = 50_000;
  const t0 = Date.parse('2022-01-01T00:00:00Z');
  for (let i = 0; i < days; i++) {
    p *= Math.exp(drift + volDaily * gauss());
    dates.push(new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
    prices.push(p);
  }
  return {
    key: 'usd',
    label: 'دلار',
    unit: 'toman',
    group: 'fx',
    price: prices[prices.length - 1],
    dates,
    prices,
    basis: 'test',
  };
}

const inp = walk(1200, 7);
const sc = buildScenario(inp);
const rows = Object.values(sc.rows).filter((r): r is ScenarioRow => !!r);

ok('the scenario engine gives a row at every charted horizon', () => {
  for (const h of FORECAST_HORIZONS) assert.ok(sc.rows[h.key], h.key);
  for (const h of FORECAST_HORIZONS) assert.equal(SCENARIO_HORIZONS.find((x) => x.key === h.key)?.days, h.days);
});

ok('the cone starts at today’s price and ends exactly on the scenario row of its horizon', () => {
  for (const h of FORECAST_HORIZONS) {
    const cone = coneFromRows(sc.price!, rows, h.days, 40);
    assert.equal(cone.length, 41);
    const first = cone[0];
    for (const k of ['p5', 'p25', 'p50', 'p75', 'p95'] as const) assert.ok(Math.abs(first[k] / sc.price! - 1) < 1e-9, `${h.key} ${k} at day 0`);
    const last = cone[cone.length - 1];
    const r = sc.rows[h.key]!;
    assert.equal(last.day, h.days);
    assert.ok(Math.abs(last.p5 / r.worst - 1) < 1e-9, `${h.key} p5`);
    assert.ok(Math.abs(last.p50 / r.base - 1) < 1e-9, `${h.key} p50`);
    assert.ok(Math.abs(last.p95 / r.best - 1) < 1e-9, `${h.key} p95`);
  }
  // the year cone also passes through the 1-week, 1-month, 3- and 6-month rows on its way
  const year = coneFromRows(sc.price!, rows, 365, 365);
  for (const k of ['w1', 'm1', 'm3', 'm6'] as const) {
    const r = sc.rows[k]!;
    const p = year.find((c) => Math.abs(c.day - r.days) < 1e-9)!;
    assert.ok(Math.abs(p.p5 / r.worst - 1) < 1e-9 && Math.abs(p.p95 / r.best - 1) < 1e-9, k);
  }
});

ok('percentiles stay ordered and the 90% band only widens with time', () => {
  for (const h of FORECAST_HORIZONS) {
    const cone = coneFromRows(sc.price!, rows, h.days, 60);
    let prev = 0;
    for (const c of cone) {
      assert.ok(c.p5 <= c.p25 && c.p25 <= c.p50 && c.p50 <= c.p75 && c.p75 <= c.p95, `${h.key} day ${c.day}`);
      const w = Math.log(c.p95 / c.p5);
      assert.ok(w >= prev - 1e-12, `${h.key} narrows at day ${c.day}`);
      prev = w;
    }
    // the 50% band sits inside the 90% one with the same skew: (p75−p50)/(p95−p50) in log space
    const end = cone[cone.length - 1];
    const ratioUp = Math.log(end.p75 / end.p50) / Math.log(end.p95 / end.p50);
    assert.ok(Math.abs(ratioUp - 0.6745 / 1.6449) < 1e-9);
  }
});

ok('no scenario rows → no cone (nothing is invented)', () => {
  assert.deepEqual(coneFromRows(100, [], 30), []);
  assert.deepEqual(coneFromRows(100, [{ days: 30, worst: 0, base: 100, best: 120 }], 30), []);
});

ok('track record: each past forecast uses only prices up to its own day', () => {
  // the same history, with everything after day 900 replaced by a crash
  const crashed: ScenarioInput = {
    ...inp,
    prices: inp.prices.map((p, i) => (i > 900 ? p * 0.3 : p)),
  };
  const a = calibrationSamples(inp, 'm1', { samples: 200 });
  const b = calibrationSamples(crashed, 'm1', { samples: 200 });
  assert.equal(a.length, b.length);
  let before = 0;
  let straddle = 0;
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].date, b[i].date);
    const idx = inp.dates.indexOf(a[i].date);
    if (idx <= 900) {
      // forecast made before the crash: identical forecast, whatever came after
      assert.equal(a[i].worst, b[i].worst);
      assert.equal(a[i].base, b[i].base);
      assert.equal(a[i].best, b[i].best);
      before++;
      if (idx + 30 > 900) {
        assert.notEqual(a[i].actual, b[i].actual, 'the outcome is the later price');
        straddle++;
      }
    }
  }
  assert.ok(before > 50 && straddle >= 1, `${before} before, ${straddle} straddling`);
  // the newest sample's outcome is already known
  const last = Date.parse(`${inp.dates[inp.dates.length - 1]}T00:00:00Z`);
  for (const s of a) assert.ok(Date.parse(`${s.date}T00:00:00Z`) + 30 * 86_400_000 <= last);
});

ok('on a random walk the 90% band holds roughly 90% of outcomes', () => {
  const c = calibrate(walk(1500, 11), 'm1', { samples: 120 })!;
  assert.ok(c);
  console.log(`   random walk, 1 month: ${c.n} forecasts, inside ${c.insidePct.toFixed(0)}%, above median ${c.aboveMedianPct.toFixed(0)}%`);
  assert.ok(c.insidePct >= 75 && c.insidePct <= 100, `${c.insidePct}`);
  assert.equal(Math.round(c.insidePct + c.abovePct + c.belowPct), 100);
});

ok('too little history → no track record rather than a made-up one', () => {
  assert.equal(calibrate(walk(130, 3), 'y1'), null);
  assert.equal(calibrate(walk(100, 3), 'w1'), null);
  // ~18 months of history: plenty of 1-year forecasts to check, but all made within ~2.5 months —
  // one outcome, not 48 (what the server's TGJU history gives today)
  const short = walk(560, 5);
  assert.ok(calibrationSamples(short, 'y1').length >= 12);
  assert.equal(calibrate(short, 'y1'), null);
  // the same history is plenty for a weekly track record
  const w = calibrate(short, 'w1')!;
  assert.ok(w && w.periods >= MIN_PERIODS, `${w?.periods}`);
});

ok('a row with its own 25%/75% puts the inner band exactly there', () => {
  const rows = [{ days: 30, worst: 80, lo50: 97, base: 102, hi50: 110, best: 130 }];
  const c = coneFromRows(100, rows, 30, 10);
  const end = c[c.length - 1];
  assert.ok(Math.abs(end.p25 - 97) < 1e-9 && Math.abs(end.p75 - 110) < 1e-9 && Math.abs(end.p5 - 80) < 1e-9 && Math.abs(end.p95 - 130) < 1e-9);
  for (const p of c) assert.ok(p.p5 <= p.p25 && p.p25 <= p.p50 && p.p50 <= p.p75 && p.p75 <= p.p95);
});

const ens: EnsembleSeries = { dates: inp.dates, prices: inp.prices, feats: featureMatrix(inp.prices) };

ok('ensemble: the average of engine, empirical and analog, ordered, at every horizon', () => {
  const rows = ensembleRows(inp, ens, inp.prices[inp.prices.length - 1], 460);
  assert.equal(rows.length, SCENARIO_HORIZONS.length);
  for (const r of rows) {
    assert.ok(r.worst <= r.lo50! && r.lo50! <= r.base && r.base <= r.hi50! && r.hi50! <= r.best, `${r.days}`);
    const { engine, empirical, analog, ensemble } = r.parts;
    assert.ok(Math.abs(ensemble.q50 - (engine.q50 + empirical.q50 + analog.q50) / 3) < 1e-12);
    assert.ok(ensemble.pUp >= 0 && ensemble.pUp <= 1);
    assert.ok(analog.matches.length > 0 && analog.matches.every((m) => m.date < inp.dates[inp.dates.length - 1]));
  }
});

ok('ensemble: a forecast on day t is the same whatever happened after t', () => {
  const t = 900;
  const crashed: EnsembleSeries = { dates: inp.dates, prices: inp.prices.map((p, i) => (i > t ? p * 0.3 : p)), feats: [] };
  crashed.feats = featureMatrix(crashed.prices);
  for (const days of [7, 30, 90, 365]) {
    const a = ensembleAt(inp, ens, t, days, 460)!;
    const b = ensembleAt(inp, crashed, t, days, 460)!;
    assert.ok(a && b);
    assert.deepEqual(a.ensemble, b.ensemble, `${days}`);
    // every matched past day had its outcome known by day t
    const last = Date.parse(`${inp.dates[t]}T00:00:00Z`);
    for (const m of a.analog.matches) assert.ok(Date.parse(`${m.date}T00:00:00Z`) + days * 86_400_000 <= last);
  }
});

// ── real data (scripts/eval/fetch-real.ts); skipped when not downloaded ──
const real: [string, string, ScenarioInput['unit'], ScenarioInput['group']][] = [
  ['usd', 'daily-usd.json', 'toman', 'fx'],
  ['coin', 'daily-coin.json', 'toman', 'gold'],
  ['g18', 'daily-g18.json', 'toman', 'gold'],
  ['ons', 'daily-ons.json', 'usd', 'gold'],
];
if (fs.existsSync('.cache/eval/daily-usd.json')) {
  console.log('\nreal data — how often the 90% band held the price (48 forecasts per horizon, spread over the whole history):');
  for (const [key, file, unit, group] of real) {
    const raw = JSON.parse(fs.readFileSync(`.cache/eval/${file}`, 'utf8')) as [string, number][];
    const dates = raw.map((r) => r[0]);
    const prices = raw.map((r) => r[1]);
    const x: ScenarioInput = {
      key,
      label: key,
      unit,
      group,
      price: prices[prices.length - 1],
      dates,
      prices,
      basis: 'tgju',
    };
    const line = FORECAST_HORIZONS.map((h) => {
      const c = calibrate(x, h.key, { window: 460 }); // as on the server: each forecast sees the board's ~15 months
      return c ? `${h.key} ${c.insidePct.toFixed(0)}% [${c.periods}p] (↑${c.abovePct.toFixed(0)} ↓${c.belowPct.toFixed(0)}, err ${c.medianErrPct.toFixed(1)}%)` : `${h.key} —`;
    });
    console.log(`  ${key.padEnd(5)} ${line.join(' · ')}`);
    if (key !== 'ons') {
      const es: EnsembleSeries = { dates, prices, feats: featureMatrix(prices) };
      const le = FORECAST_HORIZONS.map((h) => {
        const c = calibrateEnsemble(x, es, h.key, 460);
        return c ? `${h.key} ${c.insidePct.toFixed(0)}% [${c.periods}p] (↑${c.abovePct.toFixed(0)} ↓${c.belowPct.toFixed(0)}, err ${c.medianErrPct.toFixed(1)}%)` : `${h.key} —`;
      });
      console.log(`  ${(key + '*').padEnd(5)} ${le.join(' · ')}   ← ensemble`);
    }
  }
} else console.log('\n(.cache/eval not present — real-data track record skipped)');

console.log(`\nforecast: ${n} checks OK`);
