/**
 * Which forecast is right more often — on real prices, with no lookahead.
 *
 * At every 5th trading day from 2016, each method forecasts the move h days ahead using only prices
 * known that day; the real price h days later scores it. Methods:
 *   engine    — the scenario engine (/scenarios, today's charts cone), on the board's 460-row window
 *   empirical — quantiles of every past h-day move (trailing 8 years)
 *   analog    — the past days whose pattern looked like today (lib/engine/forecast-model.ts)
 *   blend     — the average of empirical and analog quantiles
 * Scores: pinball loss of the 5/25/50/75/95% quantiles on log price (proper: lower = better forecast),
 * 90%/50% band coverage (should be 90/50), median error, Brier of P(up) (lower = better).
 * Design period 2016–2020, held-out test 2021–2026 (CLAUDE.md rule 21).
 * Run: npx tsx scripts/eval/forecast-eval.ts [--quick]
 */
import fs from 'node:fs';
import { buildScenario } from '@/lib/engine/scenario';
import { analogForecast, conformalAdjust, empiricalForecast, featureMatrix, forwardIndex, type LogQuantiles, type ScoredForecast } from '@/lib/engine/forecast-model';

const CACHE = '.cache/eval';
const QUICK = process.argv.includes('--quick');
const HORIZONS = [
  { key: 'w1', days: 7 },
  { key: 'm1', days: 30 },
  { key: 'm3', days: 90 },
  { key: 'y1', days: 365 },
] as const;

type Series = { dates: string[]; prices: number[] };
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pairs = (f: string): Series => {
  const raw = JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')) as [string | number, number][];
  const m = new Map<string, number>();
  for (const [d, v] of raw) if (v > 0) m.set(typeof d === 'number' ? iso(d) : d, v);
  const dates = [...m.keys()].sort();
  return { dates, prices: dates.map((d) => m.get(d)!) };
};
const candles = (f: string): Series => {
  const raw = JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')) as { t: number; c: number }[];
  return { dates: raw.map((c) => iso(c.t)), prices: raw.map((c) => c.c) };
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
const GROUP: Record<string, 'fx' | 'gold' | 'crypto'> = { usd: 'fx', usdt: 'fx', coin: 'gold', g18: 'gold', nim: 'gold', rob: 'gold', ons: 'gold', btc: 'crypto' };

// gold bubble over ounce × dollar, from prices known that day
function lastOnOrBefore(s: Series): (d: string) => number | null {
  return (d) => {
    let lo = 0;
    let hi = s.dates.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (s.dates[m] <= d) {
        ans = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return ans >= 0 ? s.prices[ans] : null;
  };
}
const onsAt = lastOnOrBefore(S.ons);
const usdAt = lastOnOrBefore(S.usd);
const GRAMS: Record<string, number> = { g18: 0.75, coin: 8.133 * 0.9, nim: 4.0665 * 0.9, rob: 2.033 * 0.9 };
function bubble(key: string): ((i: number) => number | null) | undefined {
  const g = GRAMS[key];
  if (!g) return undefined;
  const s = S[key];
  return (i) => {
    const o = onsAt(s.dates[i]);
    const u = usdAt(s.dates[i]);
    return o && u ? Math.log(s.prices[i] / ((o * u * g) / 31.1035)) : null;
  };
}

const QS = [0.05, 0.25, 0.5, 0.75, 0.95] as const;
const qv = (q: LogQuantiles) => [q.q05, q.q25, q.q50, q.q75, q.q95];
const pinball = (q: number[], y: number) => QS.reduce((s, p, k) => s + (y >= q[k] ? p * (y - q[k]) : (1 - p) * (q[k] - y)), 0) / QS.length;
/** P(move > 0) from five quantiles, piecewise linear */
function pUpFrom(q: number[]): number {
  if (0 <= q[0]) return 0.97;
  if (0 >= q[4]) return 0.03;
  for (let k = 0; k < 4; k++)
    if (0 >= q[k] && 0 <= q[k + 1]) {
      const f = q[k + 1] > q[k] ? (0 - q[k]) / (q[k + 1] - q[k]) : 0.5;
      return 1 - (QS[k] + f * (QS[k + 1] - QS[k]));
    }
  return 0.5;
}

const INNER = 0.6745 / 1.6449;
function engineQ(s: Series, key: string, t: number, days: number): LogQuantiles | null {
  const from = Math.max(0, t + 1 - 460);
  const sc = buildScenario({ key, label: key, unit: key === 'ons' || key === 'btc' ? 'usd' : 'toman', group: GROUP[key], price: s.prices[t], dates: s.dates.slice(from, t + 1), prices: s.prices.slice(from, t + 1), basis: 'eval', context: [], bubblePct: null });
  const hz = HORIZONS.find((h) => h.days === days)!;
  const r = sc.rows[hz.key];
  if (!r) return null;
  const lo = Math.log(r.worst / s.prices[t]);
  const mid = Math.log(r.base / s.prices[t]);
  const hi = Math.log(r.best / s.prices[t]);
  const q = [lo, mid - (mid - lo) * INNER, mid, mid + (hi - mid) * INNER, hi];
  return { q05: q[0], q25: q[1], q50: q[2], q75: q[3], q95: q[4], pUp: pUpFrom(q), n: 0 };
}

interface Acc {
  n: number;
  pin: number;
  in90: number;
  in50: number;
  above: number;
  err: number;
  brier: number;
}
const acc = () => ({ n: 0, pin: 0, in90: 0, in50: 0, above: 0, err: 0, brier: 0 });
function add(a: Acc, q: LogQuantiles, y: number) {
  const v = qv(q);
  a.n++;
  a.pin += pinball(v, y);
  if (y >= v[0] && y <= v[4]) a.in90++;
  if (y >= v[1] && y <= v[3]) a.in50++;
  if (y > v[2]) a.above++;
  a.err += Math.abs(y - v[2]);
  a.brier += (q.pUp - (y > 0 ? 1 : 0)) ** 2;
}
const avgQ = (...xs: LogQuantiles[]): LogQuantiles => {
  const v = [0, 1, 2, 3, 4].map((k) => xs.reduce((s, x) => s + qv(x)[k], 0) / xs.length);
  return { q05: v[0], q25: v[1], q50: v[2], q75: v[3], q95: v[4], pUp: xs.reduce((s, x) => s + x.pUp, 0) / xs.length, n: 0 };
};

const METHODS = ['engine', 'empirical', 'analog', 'blend', 'eng+emp', 'all3', 'all3+cw', 'all3+cwc', 'eng+cw'] as const;
type M = (typeof METHODS)[number];
const results: Record<string, Record<'design' | 'test', Record<M, Acc>>> = {};
const t0 = Date.now();
for (const [key, s] of Object.entries(S)) {
  const extra = process.env.NO_BUBBLE ? undefined : bubble(key);
  const feats = featureMatrix(s.prices, extra);
  for (const h of HORIZONS) {
    const fwd = forwardIndex(s.dates, h.days);
    const res = { design: {} as Record<M, Acc>, test: {} as Record<M, Acc> };
    for (const m of METHODS) {
      res.design[m] = acc();
      res.test[m] = acc();
    }
    const step = QUICK ? 15 : 5;
    // past forecasts with their outcome index, for the conformal adjustment (only those already resolved on day t)
    const hist: { all3: (ScoredForecast & { at: number })[]; eng: (ScoredForecast & { at: number })[] } = { all3: [], eng: [] };
    const known = (xs: (ScoredForecast & { at: number })[], t: number) => xs.filter((x) => x.at <= t);
    for (let t = 0; t < s.dates.length; t += step) {
      if (s.dates[t] < '2012-01-01' || fwd[t] < 0) continue;
      const y = Math.log(s.prices[fwd[t]] / s.prices[t]);
      const e = engineQ(s, key, t, h.days);
      const em = empiricalForecast(s.dates, s.prices, fwd, t);
      const an = analogForecast(s.dates, s.prices, fwd, t, { feats });
      if (!e || !em || !an) continue;
      const a3 = avgQ(e, em, an);
      const pastA = known(hist.all3, t);
      const pastE = known(hist.eng, t);
      hist.all3.push({ q: a3, y, at: fwd[t] });
      hist.eng.push({ q: e, y, at: fwd[t] });
      if (s.dates[t] < '2016-01-01') continue;
      const part = s.dates[t] < '2021-01-01' ? res.design : res.test;
      add(part.engine, e, y);
      add(part.empirical, em, y);
      add(part.analog, an, y);
      add(part.blend, avgQ(em, an), y);
      add(part['eng+emp'], avgQ(e, em), y);
      add(part.all3, a3, y);
      add(part['all3+cw'], conformalAdjust(a3, pastA), y);
      add(part['all3+cwc'], conformalAdjust(a3, pastA, { center: true }), y);
      add(part['eng+cw'], conformalAdjust(e, pastE), y);
    }
    results[`${key}:${h.key}`] = res;
  }
  console.error(`${key} done ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const pct = (x: number, n: number) => (n ? ((100 * x) / n).toFixed(0).padStart(3) : '  —');
for (const part of ['design', 'test'] as const) {
  console.log(`\n══ ${part === 'design' ? 'DESIGN 2016–2020' : 'HELD-OUT TEST 2021–2026'} ══  pinball×1000 (lower better) · in90% · in50% · above-median% · |median err|% · Brier`);
  const tot: Record<M, { pin: number; win: number; cells: number; in90: number; brier: number }> = Object.fromEntries(METHODS.map((m) => [m, { pin: 0, win: 0, cells: 0, in90: 0, brier: 0 }])) as never;
  for (const [cell, r] of Object.entries(results)) {
    const row = r[part];
    if (!row.engine.n) continue;
    const best = METHODS.reduce((b, m) => (row[m].pin / row[m].n < row[b].pin / row[b].n ? m : b), METHODS[0]);
    const line = METHODS.map((m) => {
      const a = row[m];
      tot[m].pin += a.pin / a.n / (row.engine.pin / row.engine.n);
      tot[m].cells++;
      tot[m].in90 += a.in90 / a.n;
      tot[m].brier += a.brier / a.n;
      if (m === best) tot[m].win++;
      return `${m === best ? '*' : ' '}${m.slice(0, 7).padEnd(7)} ${((1000 * a.pin) / a.n).toFixed(1).padStart(6)} ${pct(a.in90, a.n)} ${pct(a.in50, a.n)} ${pct(a.above, a.n)} ${((100 * a.err) / a.n).toFixed(1).padStart(5)} ${(a.brier / a.n).toFixed(3)}`;
    });
    console.log(`${cell.padEnd(9)} n=${String(row.engine.n).padStart(4)} | ${line.join(' |')}`);
  }
  console.log('summary (pinball relative to engine, mean over cells; <1 = better than engine):');
  for (const m of METHODS)
    console.log(`  ${m.padEnd(9)} rel.pinball ${(tot[m].pin / tot[m].cells).toFixed(3)}  best-in ${tot[m].win}/${tot[m].cells} cells  mean in90 ${((100 * tot[m].in90) / tot[m].cells).toFixed(0)}%  Brier ${(tot[m].brier / tot[m].cells).toFixed(3)}`);
}
