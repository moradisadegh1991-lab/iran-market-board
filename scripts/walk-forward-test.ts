/**
 * Walk-forward evaluation of the trading engine's learning loop.
 *
 * The question a trader actually cares about: after the engine "learns" from a period,
 * does it do BETTER on the next period than an engine that never learned?
 *
 * Method: split the history into consecutive windows. For each step, run the learned engine
 * and the fixed-default engine on the SAME window, then let only the learned one update its
 * parameters from that window and move on. Every comparison is therefore out-of-sample: the
 * learned engine has never seen the window it is being scored on.
 *
 * Reporting both totals matters more than the direction they point: an honest "learning did
 * not help" is a usable result, a flattering in-sample number is not.
 */
import assert from 'node:assert';
import { DEFAULT_PARAMS, PROFILES, SIM_ASSETS, simulate, type SimAsset, type SimParams, type SimSeries } from '@/lib/engine/simulator';
import { learnFromResult } from '@/lib/engine/learning';
import { lookupFromSeries } from '@/lib/learning';

let seed = 20260912;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

const DAY = 86400000;
const START = Date.UTC(2023, 0, 1);
const N = 900; // calendar days of synthetic history

function iso(i: number) {
  return new Date(START + i * DAY).toISOString().slice(0, 10);
}

/** A market with regime shifts, so no single parameter set is right for the whole span. */
function makeSeries(key: SimAsset, base: number, vol: number, phase: number): SimSeries {
  const dates: string[] = [];
  const prices: number[] = [];
  let p = base;
  for (let i = 0; i < N; i++) {
    // drift flips every ~150 days, offset per asset so they don't all turn together
    const regime = Math.floor((i + phase) / 150) % 3;
    const drift = regime === 0 ? 0.0016 : regime === 1 ? -0.0011 : 0.0002;
    p *= Math.exp(drift + vol * gauss());
    dates.push(iso(i));
    prices.push(p);
  }
  return { key, dates, prices, basis: 'synthetic', reconstructed: false };
}

const series: Partial<Record<SimAsset, SimSeries>> = {
  usd: makeSeries('usd', 600_000, 0.006, 0),
  g18: makeSeries('g18', 30_000_000, 0.009, 40),
  coin: makeSeries('coin', 400_000_000, 0.011, 80),
  btc: makeSeries('btc', 900_000_000, 0.025, 120),
  eth: makeSeries('eth', 50_000_000, 0.030, 160),
};
const assets = Object.keys(series) as SimAsset[];
const lookup = lookupFromSeries(series);

function run(params: SimParams, from: number, to: number, profile: 'conservative' | 'balanced' | 'aggressive') {
  // params is a SECOND argument, not a field of SimInput — passing it inside the object
  // silently runs the defaults and makes every comparison come out identical.
  return simulate(
    { start: iso(from), end: iso(to), capitalToman: 1_000_000_000, profile, assets, series, news: [], fixedIncomeYield: 0.3 },
    params,
  );
}

const WINDOW = 120;
const WARMUP = 90; // the engine needs prior sessions before the first tradable day
const steps: { from: number; to: number }[] = [];
for (let s = WARMUP; s + WINDOW < N; s += WINDOW) steps.push({ from: s, to: s + WINDOW });

console.log(`walk-forward: ${steps.length} windows × ${WINDOW} days, assets: ${assets.join(', ')}\n`);

let failures = 0;
for (const profile of ['conservative', 'balanced', 'aggressive'] as const) {
  let learned: SimParams = structuredClone(DEFAULT_PARAMS);
  let learnedEquity = 1;
  let baseEquity = 1;
  const rows: string[] = [];

  for (const [i, w] of steps.entries()) {
    const withLearning = run(learned, w.from, w.to, profile);
    const withDefaults = run(DEFAULT_PARAMS, w.from, w.to, profile);

    // scored BEFORE this window is learned from — strictly out-of-sample
    learnedEquity *= 1 + withLearning.metrics.returnPct / 100;
    baseEquity *= 1 + withDefaults.metrics.returnPct / 100;
    rows.push(
      `  window ${i + 1}: learned ${withLearning.metrics.returnPct.toFixed(1).padStart(6)}%  ` +
        `default ${withDefaults.metrics.returnPct.toFixed(1).padStart(6)}%  ` +
        `(v${learned.version}, ${withLearning.trades.length} trades)`,
    );

    const out = learnFromResult(learned, withLearning, lookup, 1);
    learned = out.after;

    // the learned engine must stay inside its declared bounds, or later windows are meaningless
    for (const { key } of SIM_ASSETS) {
      assert.ok(learned.assetTrust[key] >= 0.2 && learned.assetTrust[key] <= 2, `assetTrust ${key} out of bounds: ${learned.assetTrust[key]}`);
    }
    assert.ok(learned.minHoldDays >= 0 && learned.cooldownDays >= 0, 'negative hold/cooldown');
    assert.ok(Number.isFinite(withLearning.metrics.returnPct), 'non-finite return');
  }

  const learnedTotal = (learnedEquity - 1) * 100;
  const baseTotal = (baseEquity - 1) * 100;
  const edge = learnedTotal - baseTotal;
  console.log(`${PROFILES[profile].label} (${profile})`);
  console.log(rows.join('\n'));
  console.log(`  TOTAL  learned ${learnedTotal.toFixed(1)}%  vs  default ${baseTotal.toFixed(1)}%  → edge ${edge >= 0 ? '+' : ''}${edge.toFixed(1)} pp  (final version v${learned.version})\n`);
  if (edge < 0) failures++;
}

console.log(failures === 0
  ? 'learning beat the fixed defaults in every profile'
  : `learning LOST to the fixed defaults in ${failures} of 3 profiles — reported as-is, not tuned away`);

console.log('\nWALK-FORWARD OK');
