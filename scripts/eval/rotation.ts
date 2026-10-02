/**
 * Cross-sectional rotation vs the equal-weight trend rider, 14-coin basket, real daily closes.
 * Every 7 days: among coins above their 50-day average (and BTC above its own), hold the top K by
 * 30-day return, equal weight; otherwise cash. Fee 0.4% per side on turnover. Reported per year.
 * Run: npx tsx scripts/eval/rotation.ts
 */
import { BASKET } from './fetch-real';
import { dailyCloses } from './crypto-factors';

const DAY = 86_400_000, FEE = 0.004;
const series = BASKET.map((s) => ({ s, px: dailyCloses(s) }));
const btc = series.find((x) => x.s === 'BTC')!.px;
const days = [...btc.keys()].filter((d) => d >= Date.parse('2023-12-01'));
const at = (m: Map<number, number>, d: number) => m.get(d);
const sma = (m: Map<number, number>, d: number, n: number) => { let s = 0; for (let k = 1; k <= n; k++) { const v = m.get(d - k * DAY); if (v === undefined) return null; s += v; } return s / n; };

function run(mode: 'trend-ew' | 'rotate', K = 3) {
  let w = new Map<string, number>(); let eq = 1; const byYear = new Map<number, number>(); let yStart = 1, curY = new Date(days[0]).getUTCFullYear(), peak = 1, dd = 0;
  for (let i = 1; i < days.length; i++) {
    const d = days[i], prev = days[i - 1];
    // returns of the held weights over the day
    let r = 0; for (const [s, wt] of w) { const p0 = at(series.find((x) => x.s === s)!.px, prev), p1 = at(series.find((x) => x.s === s)!.px, d); if (p0 && p1) r += wt * (p1 / p0 - 1); }
    eq *= 1 + r; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1);
    const y = new Date(d).getUTCFullYear(); if (y !== curY) { byYear.set(curY, eq / yStart - 1); yStart = eq; curY = y; }
    const rebalance = mode === 'rotate' ? i % 7 === 0 : true;
    if (!rebalance) continue;
    const bs = sma(btc, d + DAY, 50); const btcUp = bs !== null && at(btc, d)! > bs;
    const ok = series.filter(({ s, px }) => { const p = at(px, d), m = sma(px, d + DAY, 50); return p && m && p > m && (s === 'BTC' || btcUp); });
    let pick = ok;
    if (mode === 'rotate') pick = ok.map((x) => ({ ...x, mom: at(x.px, d)! / (at(x.px, d - 30 * DAY) ?? at(x.px, d)!) - 1 })).sort((a, b) => b.mom - a.mom).slice(0, K);
    const nw = new Map<string, number>();
    const slot = mode === 'rotate' ? 1 / K : 1 / BASKET.length;
    for (const x of pick) nw.set(x.s, slot);
    let turn = 0; for (const s of new Set([...w.keys(), ...nw.keys()])) turn += Math.abs((nw.get(s) ?? 0) - (w.get(s) ?? 0));
    eq *= 1 - FEE * turn; w = nw;
  }
  byYear.set(curY, eq / yStart - 1);
  return { total: eq - 1, dd, byYear };
}
for (const [label, m, k] of [['trend rider, equal weight (all 14)', 'trend-ew', 0], ['rotation top 3', 'rotate', 3], ['rotation top 5', 'rotate', 5]] as const) {
  const r = run(m as any, k || 3);
  console.log(`${label.padEnd(36)} total ${(r.total * 100).toFixed(0).padStart(5)}%  maxDD ${(r.dd * 100).toFixed(1)}%  ` + [...r.byYear].map(([y, v]) => `${y}: ${(v * 100).toFixed(0)}%`).join('  '));
}
