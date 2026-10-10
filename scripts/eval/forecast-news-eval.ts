/**
 * Would news make the forecast better? On real prices and real headlines (scripts/eval/fetch-news.ts), no lookahead.
 *
 * At every 5th trading day from 2016-07, the three-way ensemble (lib/engine/forecast.ts, what the page shows for rial
 * assets) forecasts the move h days ahead from prices up to that day. News variant: the same five quantiles shifted by
 *   tilt = k · tanh(x / x0) · σh      x  = the news score of the last L days (scoreHeadline effect × weight, summed)
 *                                     σh = (q95 − q05) / 3.29 of the ensemble, x0 = the median |x| of the design years
 * so the news can move the median by at most k standard deviations. k is picked on the design years (2016–2020) only
 * and scored on the held-out years (2021–2026), like every other evaluation here (CLAUDE.md rule 21). Pinball loss of
 * the 5/25/50/75/95% quantiles on log price: lower is better; < 1 means the news variant beat the plain ensemble.
 * Run: npx tsx scripts/eval/forecast-news-eval.ts
 */
import fs from 'node:fs';
import { ensembleAt, type EnsembleSeries } from '@/lib/engine/forecast';
import { featureMatrix } from '@/lib/engine/forecast-model';
import type { ScenarioInput } from '@/lib/engine/scenario';
import { scoreHeadline } from '@/lib/news';
import type { SimAsset } from '@/lib/engine/simulator';

const CACHE = '.cache/eval';
const J = (f: string) => JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8'));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const tehranDay = (ms: number) => new Date(ms + 3.5 * 3600_000).toISOString().slice(0, 10);
const DAY = 86_400_000;
const WINDOW = 460;
const QS = [0.05, 0.25, 0.5, 0.75, 0.95] as const;
const HORIZONS = [
  { days: 7, look: 7 },
  { days: 30, look: 14 },
] as const;
const KS = [-0.3, -0.15, 0, 0.05, 0.1, 0.2, 0.3, 0.5];

function pairs(f: string): { dates: string[]; prices: number[] } {
  const m = new Map<string, number>();
  for (const [d, v] of J(f) as [string | number, number][]) if (v > 0) m.set(typeof d === 'number' ? iso(d) : d, v);
  const dates = [...m.keys()].sort();
  return { dates, prices: dates.map((d) => m.get(d)!) };
}

/** daily news score for one asset from the cached headline files */
function newsDaily(files: string[], asset: SimAsset): { score: Map<string, number>; count: Map<string, number> } {
  const score = new Map<string, number>();
  const count = new Map<string, number>();
  const seen = new Set<string>();
  for (const f of files) {
    if (!fs.existsSync(`${CACHE}/${f}`)) continue;
    for (const items of Object.values(J(f)) as { title: string; ms: number }[][]) {
      for (const it of items) {
        const key = it.title.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        const s = scoreHeadline(it.title);
        const e = s?.effects[asset];
        if (!s || !e) continue;
        const d = tehranDay(it.ms);
        score.set(d, (score.get(d) ?? 0) + e * s.weight);
        count.set(d, (count.get(d) ?? 0) + 1);
      }
    }
  }
  return { score, count };
}

const pinball = (q: number[], y: number) => QS.reduce((s, p, k) => s + (y >= q[k] ? p * (y - q[k]) : (1 - p) * (q[k] - y)), 0) / QS.length;

const ASSETS: { key: string; sim: SimAsset; file: string; group: 'fx' | 'gold'; unit: 'toman'; news: string[] }[] = [
  { key: 'usd', sim: 'usd', file: 'daily-usd.json', group: 'fx', unit: 'toman', news: ['news-iran.json'] },
  { key: 'coin', sim: 'coin', file: 'daily-coin.json', group: 'gold', unit: 'toman', news: ['news-iran.json', 'news-gold.json'] },
  { key: 'g18', sim: 'g18', file: 'daily-g18.json', group: 'gold', unit: 'toman', news: ['news-iran.json', 'news-gold.json'] },
];

const rows: string[] = [];
for (const a of ASSETS) {
  const { dates, prices } = pairs(a.file);
  const s: EnsembleSeries = { dates, prices, feats: featureMatrix(prices) };
  const inp: ScenarioInput = { key: a.key as never, label: a.key, unit: a.unit, group: a.group, price: prices[0], dates, prices, basis: 'eval', context: [], bubblePct: null };
  const { score, count } = newsDaily(a.news, a.sim);
  for (const hz of HORIZONS) {
    const back = (i: number) => {
      let x = 0;
      let n = 0;
      for (let k = 0; k < hz.look; k++) {
        const d = iso(Date.parse(dates[i]) - k * DAY);
        x += score.get(d) ?? 0;
        n += count.get(d) ?? 0;
      }
      return { x, n };
    };
    interface Obs {
      date: string;
      q: number[];
      y: number;
      x: number;
      n: number;
    }
    const obs: Obs[] = [];
    for (let t = 300; t < dates.length - 1; t += 5) {
      if (dates[t] < '2016-07-01') continue;
      const target = Date.parse(dates[t]) + hz.days * DAY;
      let m = t + 1;
      while (m < dates.length && Date.parse(dates[m]) < target) m++;
      if (m >= dates.length) break;
      const p = ensembleAt(inp, s, t, hz.days, WINDOW);
      if (!p) continue;
      const e = p.ensemble;
      const { x, n } = back(t);
      obs.push({ date: dates[t], q: [e.q05, e.q25, e.q50, e.q75, e.q95], y: Math.log(prices[m] / prices[t]), x, n });
    }
    const design = obs.filter((o) => o.date <= '2020-12-31');
    const test = obs.filter((o) => o.date > '2020-12-31');
    const x0 = (() => {
      const v = design.filter((o) => o.n > 0).map((o) => Math.abs(o.x)).sort((p, q) => p - q);
      return v.length ? v[Math.floor(v.length / 2)] || 1 : 1;
    })();
    const tilted = (o: Obs, k: number) => {
      const sd = (o.q[4] - o.q[0]) / 3.29;
      const tilt = o.n ? k * Math.tanh(o.x / x0) * sd : 0;
      return o.q.map((v) => v + tilt);
    };
    const loss = (set: Obs[], k: number) => set.reduce((sum, o) => sum + pinball(tilted(o, k), o.y), 0) / Math.max(1, set.length);
    const base = { d: loss(design, 0), t: loss(test, 0) };
    const best = KS.reduce((b, k) => (loss(design, k) < loss(design, b) ? k : b), 0);
    // direction on days that had news: does the sign of the score predict the sign of the move (net of the ensemble median)?
    const hit = (set: Obs[]) => {
      const w = set.filter((o) => o.n > 0 && o.x !== 0);
      const ok = w.filter((o) => Math.sign(o.x) === Math.sign(o.y - o.q[2])).length;
      return { n: w.length, pct: w.length ? (ok / w.length) * 100 : NaN };
    };
    const hd = hit(design);
    const ht = hit(test);
    const yearCells = [...new Set(test.map((o) => o.date.slice(0, 4)))].map((yr) => {
      const set = test.filter((o) => o.date.startsWith(yr));
      return `${yr}:${(loss(set, best) / loss(set, 0)).toFixed(3)}`;
    });
    // a fixed, positive tilt over every year — the pattern in the held-out loss row — to see whether it holds up year by year
    const fixed = [...new Set(obs.map((o) => o.date.slice(0, 4)))].map((yr) => {
      const set = obs.filter((o) => o.date.startsWith(yr));
      return `${yr}:${(loss(set, 0.2) / loss(set, 0)).toFixed(3)}`;
    });
    rows.push(
      `${a.key.padEnd(5)} h=${String(hz.days).padStart(2)}  news on ${((obs.filter((o) => o.n > 0).length / obs.length) * 100).toFixed(0)}% of days | best k on design ${best >= 0 ? '+' : ''}${best}` +
        ` | pinball news/plain: design ${(loss(design, best) / base.d).toFixed(3)}  test ${(loss(test, best) / base.t).toFixed(3)}` +
        ` | sign hit design ${hd.pct.toFixed(0)}% (${hd.n}) test ${ht.pct.toFixed(0)}% (${ht.n})` +
        `\n        test by year (best k vs plain): ${yearCells.join(' ')}` +
        `\n        k=+0.2 vs plain, EVERY year: ${fixed.join(' ')}` +
        `\n        test loss by k: ${KS.map((k) => `${k}:${(loss(test, k) / base.t).toFixed(3)}`).join(' ')}`,
    );
    console.log(rows[rows.length - 1]);
  }
}
