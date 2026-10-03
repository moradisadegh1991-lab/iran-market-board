/**
 * «When to buy, when to sell» — does a timing plan beat simply acting today? On real prices, no lookahead.
 *
 * At every 5th trading day from 2016, lib/engine/forecast-timing.ts reads the coming h days from
 * windows already closed that day (every past window = empirical; the past days that looked like
 * today = analog; and their half-and-half mix), and sets:
 *   buy plan  — a limit under today's price that the forecast fills with probability `fill`; if the
 *               price never gets there, buy on the last day;
 *   sell plan — a limit above today's price, reached with probability `fill`; else sell on the last day.
 * Scored against what really came next (closes only):
 *   buy  vs now: mean log(entry / today) — negative = the plan bought cheaper than buying today
 *   sell vs now: mean log(exit / today) — positive = the plan sold higher than selling today
 *   sell vs end: the plan against simply holding to the last day
 *   filled%: how often the limit was reached — should be near `fill` if the forecast is calibrated
 *   day err: median |predicted day of the low − the real one|, against the unconditional median day
 * `fill` is chosen on the design years (2016–2020) only, then read on 2021–2026 (CLAUDE.md rule 21).
 * Run: npx tsx scripts/eval/timing-eval.ts [--quick]
 */
import fs from 'node:fs';
import { featureMatrix, forwardIndex } from '@/lib/engine/forecast-model';
import { followPlan, pathOutcomes, timingDist, timingFrom, type PlanResult } from '@/lib/engine/forecast-timing';

const CACHE = '.cache/eval';
const QUICK = process.argv.includes('--quick');
const HORIZONS = [
  { key: 'w1', days: 7 },
  { key: 'm1', days: 30 },
  { key: 'm3', days: 90 },
  { key: 'y1', days: 365 },
] as const;
const FILLS = [0.5, 0.6, 0.7, 0.8, 0.9];

type Series = { dates: string[]; prices: number[] };
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pairs = (f: string): Series => {
  const raw = JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')) as [string | number, number][];
  const m = new Map<string, number>();
  for (const [d, v] of raw) if (v > 0) m.set(typeof d === 'number' ? iso(d) : d, v);
  const dates = [...m.keys()].sort();
  return { dates, prices: dates.map((d) => m.get(d)!) };
};
const S: Record<string, Series> = {
  usd: pairs('daily-usd.json'),
  coin: pairs('daily-coin.json'),
  g18: pairs('daily-g18.json'),
  nim: pairs('daily-nim.json'),
  rob: pairs('daily-rob.json'),
  ons: pairs('daily-ons.json'),
  btc: pairs('btc-daily-long.json'),
};
if (fs.existsSync(`${CACHE}/daily-usdt.json`)) S.usdt = pairs('daily-usdt.json');

interface Acc {
  n: number;
  buy: number;
  buyBetter: number;
  buyFill: number;
  sell: number;
  sellEnd: number;
  sellFill: number;
  end: number;
  dayErr: number[];
  dayErrNaive: number[];
}
const acc = (): Acc => ({ n: 0, buy: 0, buyBetter: 0, buyFill: 0, sell: 0, sellEnd: 0, sellFill: 0, end: 0, dayErr: [], dayErrNaive: [] });
function add(a: Acc, r: PlanResult, lowDay?: number, naiveDay?: number) {
  a.n++;
  a.buy += r.buy;
  if (r.buy < 0) a.buyBetter++;
  if (r.buyFilled) a.buyFill++;
  a.sell += r.sell;
  a.sellEnd += r.sell - r.end;
  if (r.sellFilled) a.sellFill++;
  a.end += r.end;
  if (lowDay !== undefined && naiveDay !== undefined) {
    a.dayErr.push(Math.abs(lowDay - r.lowDay));
    a.dayErrNaive.push(Math.abs(naiveDay - r.lowDay));
  }
}
const med = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

const VARIANTS = ['mix', 'empirical', 'analog'] as const;
type Part = 'design' | 'test';
const res: Record<string, Record<Part, Record<string, Acc>>> = {};
const t0 = Date.now();
for (const [key, s] of Object.entries(S)) {
  const feats = featureMatrix(s.prices);
  for (const h of HORIZONS) {
    const fwd = forwardIndex(s.dates, h.days);
    const out = pathOutcomes(s.dates, s.prices, fwd);
    const cell: Record<Part, Record<string, Acc>> = { design: {}, test: {} };
    for (let t = 0; t < s.dates.length; t += QUICK ? 15 : 5) {
      if (s.dates[t] < '2016-01-01' || fwd[t] < 0) continue;
      const part: Part = s.dates[t] < '2021-01-01' ? 'design' : 'test';
      const get = (k: string) => (cell[part][k] ??= acc());
      const empD = timingDist(s.dates, s.prices, fwd, out, t, { only: 'empirical' });
      const anD = timingDist(s.dates, s.prices, fwd, out, t, { only: 'analog', analog: { feats } });
      const mixD = timingDist(s.dates, s.prices, fwd, out, t, { analog: { feats } });
      if (!empD || !anD || !mixD) continue;
      const naive = empD.lowDay.q(0.5);
      for (const fill of FILLS) {
        const f = timingFrom(mixD, fill);
        const r = followPlan(s.prices, fwd, out, t, f.buyAt, f.sellAt);
        if (r) add(get(`mix@${fill}`), r, f.lowDay, naive);
      }
      for (const [v, d] of [
        ['empirical', empD],
        ['analog', anD],
      ] as const) {
        const f = timingFrom(d);
        const r = followPlan(s.prices, fwd, out, t, f.buyAt, f.sellAt);
        if (r) add(get(v), r, f.lowDay, naive);
      }
    }
    res[`${key}:${h.key}`] = cell;
  }
  console.error(`${key} done ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const pc = (x: number) => ((Math.exp(x) - 1) * 100).toFixed(2).padStart(6);
const sh = (x: number, n: number) => ((100 * x) / n).toFixed(0).padStart(3);
for (const part of ['design', 'test'] as const) {
  console.log(`\n══ ${part === 'design' ? 'DESIGN 2016–2020' : 'HELD-OUT TEST 2021–2026'} ══`);
  console.log('cell      variant    n   | buy vs now%  better% filled% | sell vs now% vs end% filled% | hold-to-end% | low-day err (naive)');
  const sum: Record<string, { buy: number; sellEnd: number; sell: number; cells: number; fillErr: number }> = {};
  for (const [c, r] of Object.entries(res)) {
    for (const [v, a] of Object.entries(r[part])) {
      if (!a.n) continue;
      const fill = v.startsWith('mix@') ? +v.slice(4) : 0.7;
      const x = (sum[v] ??= { buy: 0, sellEnd: 0, sell: 0, cells: 0, fillErr: 0 });
      x.buy += a.buy / a.n;
      x.sell += a.sell / a.n;
      x.sellEnd += a.sellEnd / a.n;
      x.fillErr += Math.abs(a.buyFill / a.n - fill) + Math.abs(a.sellFill / a.n - fill);
      x.cells++;
      if (v !== 'mix@0.7' && !VARIANTS.includes(v as never)) continue;
      console.log(
        `${c.padEnd(9)} ${v.padEnd(9)} ${String(a.n).padStart(4)} | ${pc(a.buy / a.n)}      ${sh(a.buyBetter, a.n)}     ${sh(a.buyFill, a.n)}   |  ${pc(a.sell / a.n)}   ${pc(a.sellEnd / a.n)}   ${sh(a.sellFill, a.n)}   |  ${pc(a.end / a.n)}      | ${med(a.dayErr).toFixed(0).padStart(3)} (${med(a.dayErrNaive).toFixed(0)})`,
      );
    }
  }
  console.log('summary over cells (mean of cell means, %): buy vs now (−=better) · sell vs now (+=better) · sell vs hold-to-end · mean |filled − fill|');
  for (const [v, x] of Object.entries(sum))
    console.log(
      `  ${v.padEnd(10)} buy ${pc(x.buy / x.cells)}  sell ${pc(x.sell / x.cells)}  vs-end ${pc(x.sellEnd / x.cells)}  fill-miss ${((100 * x.fillErr) / x.cells / 2).toFixed(1)}pt  (${x.cells} cells)`,
    );
}
