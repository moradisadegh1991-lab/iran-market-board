/**
 * Measures what raising the engine's activity actually buys you.
 * More trades is easy to produce; more money is not. Return, fees and trade count are printed
 * together so the setting can be chosen on evidence.
 */
import { DEFAULT_PARAMS, PROFILES, ACTIVITY_LABEL, applyActivity, simulate, type Activity, type SimAsset, type SimSeries } from '@/lib/engine/simulator';

let seed = 31337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const DAY = 86400000, START = Date.UTC(2024, 0, 1), N = 720;
const iso = (i: number) => new Date(START + i * DAY).toISOString().slice(0, 10);

function mk(key: SimAsset, base: number, vol: number, phase: number): SimSeries {
  const dates: string[] = [], prices: number[] = [];
  let p = base;
  for (let i = 0; i < N; i++) {
    const regime = Math.floor((i + phase) / 140) % 3;
    const drift = regime === 0 ? 0.0015 : regime === 1 ? -0.001 : 0.0002;
    p *= Math.exp(drift + vol * gauss());
    dates.push(iso(i)); prices.push(p);
  }
  return { key, dates, prices, basis: 'synthetic', reconstructed: false };
}
const series: Partial<Record<SimAsset, SimSeries>> = {
  usd: mk('usd', 600_000, 0.006, 0), g18: mk('g18', 30_000_000, 0.009, 35),
  coin: mk('coin', 400_000_000, 0.011, 70), btc: mk('btc', 9e8, 0.025, 105), eth: mk('eth', 5e7, 0.03, 140),
};
const assets = Object.keys(series) as SimAsset[];

console.log('profile       activity     return    trades   fees(M)   net of fees');
console.log('─'.repeat(70));
const summary: Record<Activity, number[]> = { calm: [], normal: [], active: [] };

for (const profile of ['conservative', 'balanced', 'aggressive'] as const) {
  for (const level of ['calm', 'normal', 'active'] as Activity[]) {
    const r = simulate(
      { start: iso(90), end: iso(N - 1), capitalToman: 1_000_000_000, profile, assets, series, news: [], fixedIncomeYield: 0.3 },
      applyActivity(DEFAULT_PARAMS, level),
    );
    const fees = r.metrics.feesToman / 1e6;
    summary[level].push(r.metrics.returnPct);
    console.log(
      `${PROFILES[profile].label.padEnd(8)} ${ACTIVITY_LABEL[level].padEnd(12)} ` +
      `${r.metrics.returnPct.toFixed(1).padStart(7)}%  ${String(r.trades.length).padStart(6)}  ` +
      `${fees.toFixed(0).padStart(7)}  ${(r.metrics.returnPct).toFixed(1).padStart(8)}%`,
    );
  }
  console.log('─'.repeat(70));
}

const mean = (xs: number[]) => xs.reduce((a, v) => a + v, 0) / xs.length;
console.log(`\naverage return — calm ${mean(summary.calm).toFixed(1)}%  normal ${mean(summary.normal).toFixed(1)}%  active ${mean(summary.active).toFixed(1)}%`);
const best = (['calm', 'normal', 'active'] as Activity[]).sort((a, b) => mean(summary[b]) - mean(summary[a]))[0];
console.log(`highest average on this data: ${ACTIVITY_LABEL[best]}`);
console.log('\nACTIVITY MEASURED');
