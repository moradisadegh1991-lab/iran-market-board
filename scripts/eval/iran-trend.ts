/**
 * Trend rider for the Iranian assets on real TGJU closes: hold the asset while its last close is
 * above its N-day average, otherwise sit in a fixed-income fund. Compared with holding the asset and
 * with the deposit alone, in two periods (2015–2020, 2021–2026). Costs: the engine's per-side spreads.
 * Run: npx tsx scripts/eval/iran-trend.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './fetch-real';

const read = (f: string): [string, number][] => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
const COST: Record<string, number> = { usd: 0.006, g18: 0.008, coin: 0.006 };
const yieldOf = (d: string) => (d < '2022-01-01' ? 0.2 : 0.28);

export function iranTrend(asset: string, N: number, from: string, to: string, opts: { ensemble?: number[] } = {}) {
  const rows = read(`daily-${asset}.json`);
  const d = rows.map((r) => r[0]), p = rows.map((r) => r[1]);
  const L = opts.ensemble ?? [N];
  const maxL = Math.max(...L);
  let eq = 1, hold = 1, dep = 1, w = 0, peak = 1, dd = 0, sw = 0, started = false;
  for (let i = maxL + 1; i < p.length; i++) {
    if (d[i] < from || d[i] > to) continue;
    const days = (Date.parse(d[i]) - Date.parse(d[i - 1])) / 86_400_000;
    const cash = (1 + yieldOf(d[i])) ** (days / 365) - 1;
    started = true;
    // decide on the previous close
    const above = L.map((l) => { let s = 0; for (let k = i - l; k < i; k++) s += p[k]; return p[i - 1] > s / l; });
    const target = above.filter(Boolean).length / L.length;
    if (target !== w) { eq *= 1 - COST[asset] * Math.abs(target - w); if ((target > 0) !== (w > 0)) sw++; w = target; }
    const r = p[i] / p[i - 1] - 1;
    eq *= 1 + w * r + (1 - w) * cash;
    hold *= 1 + r; dep *= 1 + cash;
    peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1);
  }
  if (!started) return null;
  const yrs = (Date.parse(to) - Date.parse(from)) / (365 * 86_400_000);
  return { cagr: eq ** (1 / yrs) - 1, hold: hold ** (1 / yrs) - 1, dep: dep ** (1 / yrs) - 1, dd, sw };
}

if (process.argv[1]?.endsWith('iran-trend.ts')) {
  for (const [a, b] of [['2015-06-01', '2020-12-31'], ['2021-01-01', '2026-09-30']]) {
    console.log(`\n${a} → ${b}  (annualised)`);
    for (const asset of ['usd', 'g18', 'coin']) {
      for (const [label, N, ens] of [['SMA50', 50, undefined], ['SMA100', 100, undefined], ['SMA200', 200, undefined], ['ensemble 50/100/200', 0, [50, 100, 200]]] as const) {
        const r = iranTrend(asset, N, a, b, { ensemble: ens as number[] | undefined })!;
        console.log(`  ${asset.padEnd(5)} ${label.padEnd(20)} trend ${(r.cagr * 100).toFixed(1).padStart(5)}%  hold ${(r.hold * 100).toFixed(1).padStart(5)}%  deposit ${(r.dep * 100).toFixed(1)}%  maxDD ${(r.dd * 100).toFixed(1).padStart(6)}%  switches ${r.sw}`);
      }
    }
  }
}
