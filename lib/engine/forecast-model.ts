// Forecast distributions built from what the price itself did before — the pure half.
//
// Two ways to say «where will the price be in h days», both only from history that was already
// known on the forecast day (CLAUDE.md rule 4):
//  • empirical: every past h-day move of this asset (trailing `lookbackYears`), its quantiles.
//  • analog («الگوهای مشابه»): the past days whose recent path looked most like today's — returns
//    over 1 week … 1 year, volatility, distance from the 200-day average, and for gold the bubble
//    over ounce × dollar — and what the price did after each of them. This is how a trader reads a
//    chart («last time it looked like this…»), made explicit and measurable.
// scripts/eval/forecast-eval.ts scores both against the scenario engine on real data.

export interface LogQuantiles {
  q05: number;
  q25: number;
  q50: number;
  q75: number;
  q95: number;
  /** share of the sample that ended higher */
  pUp: number;
  /** how many past moves the numbers stand on */
  n: number;
}

const DAY = 86_400_000;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export function quantileSorted(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const i = (xs.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return xs[lo] + (xs[hi] - xs[lo]) * (i - lo);
}

function weightedQuantiles(vals: number[], w: number[]): Omit<LogQuantiles, 'n'> {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
  const tot = w.reduce((s, x) => s + x, 0);
  const q = (p: number) => {
    let acc = 0;
    for (const i of idx) {
      acc += w[i];
      if (acc >= p * tot) return vals[i];
    }
    return vals[idx[idx.length - 1]];
  };
  let up = 0;
  for (let i = 0; i < vals.length; i++) if (vals[i] > 0) up += w[i];
  return { q05: q(0.05), q25: q(0.25), q50: q(0.5), q75: q(0.75), q95: q(0.95), pUp: up / tot };
}

/**
 * fwd[i] = index of the first price at or after dates[i] + days, or -1. The move from i is
 * log(prices[fwd[i]] / prices[i]); it is known on day t only when dates[fwd[i]] <= dates[t].
 */
export function forwardIndex(dates: string[], days: number): Int32Array {
  const out = new Int32Array(dates.length).fill(-1);
  let j = 0;
  for (let i = 0; i < dates.length; i++) {
    const target = dayMs(dates[i]) + days * DAY;
    if (j < i + 1) j = i + 1;
    while (j < dates.length && dayMs(dates[j]) < target) j++;
    out[i] = j < dates.length ? j : -1;
  }
  return out;
}

/** Index of the last past day whose h-day outcome was known on day t (fwd[i] <= t). */
function lastKnown(fwd: Int32Array, t: number): number {
  let i = t - 1;
  while (i >= 0 && (fwd[i] < 0 || fwd[i] > t)) i--;
  return i;
}

/** Quantiles of every past h-day move whose outcome was known on day t, over the trailing years. */
export function empiricalForecast(dates: string[], prices: number[], fwd: Int32Array, t: number, lookbackYears = 8): LogQuantiles | null {
  const end = lastKnown(fwd, t);
  if (end < 0) return null;
  const from = dayMs(dates[t]) - lookbackYears * 365 * DAY;
  const moves: number[] = [];
  for (let i = end; i >= 0 && dayMs(dates[i]) >= from; i--) moves.push(Math.log(prices[fwd[i]] / prices[i]));
  if (moves.length < 30) return null;
  moves.sort((a, b) => a - b);
  return {
    q05: quantileSorted(moves, 0.05),
    q25: quantileSorted(moves, 0.25),
    q50: quantileSorted(moves, 0.5),
    q75: quantileSorted(moves, 0.75),
    q95: quantileSorted(moves, 0.95),
    pUp: moves.filter((m) => m > 0).length / moves.length,
    n: moves.length,
  };
}

/** The state a chart reader sees on day i, from prices up to i only. Null until 250 rows exist. */
export function patternFeatures(prices: number[], i: number, extra?: (i: number) => number | null): number[] | null {
  if (i < 250) return null;
  const lp = (k: number) => Math.log(prices[i] / prices[i - k]);
  let s = 0;
  let s2 = 0;
  for (let k = i - 19; k <= i; k++) {
    const r = Math.log(prices[k] / prices[k - 1]);
    s += r;
    s2 += r * r;
  }
  const vol20 = Math.sqrt(Math.max(0, s2 / 20 - (s / 20) ** 2));
  let ma = 0;
  for (let k = i - 199; k <= i; k++) ma += prices[k];
  ma /= 200;
  const f = [lp(5), lp(20), lp(60), lp(250), Math.log(vol20 + 1e-6), Math.log(prices[i] / ma)];
  if (extra) {
    const e = extra(i);
    if (e === null || !Number.isFinite(e)) return null;
    f.push(e);
  }
  return f;
}

/** patternFeatures for every day — compute once per series, reuse for every forecast day. */
export function featureMatrix(prices: number[], extra?: (i: number) => number | null): (number[] | null)[] {
  return prices.map((_, i) => patternFeatures(prices, i, extra));
}

export interface AnalogOpts {
  lookbackYears?: number;
  /** share of the candidate days used as neighbours */
  kShare?: number;
  kMin?: number;
  kMax?: number;
  /** feature weights (same order as patternFeatures; extra last) */
  weights?: number[];
  extra?: (i: number) => number | null;
  /** precomputed featureMatrix(prices, extra) */
  feats?: (number[] | null)[];
}

export interface AnalogForecast extends LogQuantiles {
  /** the matched past days, nearest first (for «در موقعیت‌های مشابه» on the page) */
  matches: { date: string; move: number }[];
}

/** Nearest first, but one day per episode: neighbours of a picked day (±20 rows) are the same story. */
function distinctEpisodes<T extends { i: number }>(nearestFirst: T[], max: number): T[] {
  const out: T[] = [];
  for (const c of nearestFirst) {
    if (out.length >= max) break;
    if (out.every((o) => Math.abs(o.i - c.i) > 20)) out.push(c);
  }
  return out;
}

/**
 * The past days that looked most like day t, nearest first, with their weights (1/(1+d)).
 * Features are standardised over the candidates; only candidates whose h-day outcome was known on
 * day t are used. Null when there is too little history.
 */
export function analogNeighbours(dates: string[], prices: number[], fwd: Int32Array, t: number, opts: AnalogOpts = {}): { i: number; move: number; w: number }[] | null {
  const F = (i: number) => (opts.feats ? opts.feats[i] : patternFeatures(prices, i, opts.extra));
  const now = F(t);
  if (!now) return null;
  const end = lastKnown(fwd, t);
  if (end < 250) return null;
  const from = dayMs(dates[t]) - (opts.lookbackYears ?? 15) * 365 * DAY;
  const cand: { i: number; f: number[]; move: number }[] = [];
  for (let i = end; i >= 250 && dayMs(dates[i]) >= from; i--) {
    const f = F(i);
    if (f) cand.push({ i, f, move: Math.log(prices[fwd[i]] / prices[i]) });
  }
  if (cand.length < 60) return null;
  const dim = now.length;
  const sd = new Array(dim).fill(0).map((_, d) => {
    let m = 0;
    for (const c of cand) m += c.f[d];
    m /= cand.length;
    let v = 0;
    for (const c of cand) v += (c.f[d] - m) ** 2;
    return Math.sqrt(v / cand.length) || 1;
  });
  const w = opts.weights ?? new Array(dim).fill(1);
  const dist = cand.map((c) => {
    let s = 0;
    for (let d = 0; d < dim; d++) s += (w[d] ?? 1) * ((c.f[d] - now[d]) / sd[d]) ** 2;
    return Math.sqrt(s);
  });
  const k = Math.max(opts.kMin ?? 30, Math.min(opts.kMax ?? 150, Math.round(cand.length * (opts.kShare ?? 0.08))));
  const order = dist.map((_, i) => i).sort((a, b) => dist[a] - dist[b]).slice(0, k);
  return order.map((j) => ({ i: cand[j].i, move: cand[j].move, w: 1 / (1 + dist[j]) }));
}

/** Forecast from the past days that looked most like day t (analogNeighbours), their moves weighted by closeness. */
export function analogForecast(dates: string[], prices: number[], fwd: Int32Array, t: number, opts: AnalogOpts = {}): AnalogForecast | null {
  const nb = analogNeighbours(dates, prices, fwd, t, opts);
  if (!nb) return null;
  return {
    ...weightedQuantiles(
      nb.map((x) => x.move),
      nb.map((x) => x.w),
    ),
    n: nb.length,
    matches: distinctEpisodes(nb, 12).map((c) => ({ date: dates[c.i], move: c.move })),
  };
}

/** P(move > 0) from five log quantiles, piecewise linear between them. */
export function pUpFromQuantiles(q: [number, number, number, number, number]): number {
  const P = [0.05, 0.25, 0.5, 0.75, 0.95];
  if (0 <= q[0]) return 0.97;
  if (0 >= q[4]) return 0.03;
  for (let k = 0; k < 4; k++)
    if (0 >= q[k] && 0 <= q[k + 1]) {
      const f = q[k + 1] > q[k] ? (0 - q[k]) / (q[k + 1] - q[k]) : 0.5;
      return 1 - (P[k] + f * (P[k + 1] - P[k]));
    }
  return 0.5;
}

/** One past forecast and what happened (log move). */
export interface ScoredForecast {
  q: LogQuantiles;
  y: number;
}

/** Simple average of several forecasts' quantiles (an ensemble — robust where no single method is). */
export function averageQuantiles(...xs: LogQuantiles[]): LogQuantiles {
  const k = (f: (q: LogQuantiles) => number) => xs.reduce((s, x) => s + f(x), 0) / xs.length;
  return { q05: k((q) => q.q05), q25: k((q) => q.q25), q50: k((q) => q.q50), q75: k((q) => q.q75), q95: k((q) => q.q95), pUp: k((q) => q.pUp), n: xs.reduce((s, x) => s + x.n, 0) };
}

/**
 * Widen or narrow a forecast by how its own method fared before (split conformal): each tail is
 * scaled so that, over the `past` forecasts — all with outcomes already known — 5% / 25% ended
 * beyond it. `center` also moves the median by the typical past miss (half of it).
 */
export function conformalAdjust(q: LogQuantiles, past: ScoredForecast[], opts: { center?: boolean; min?: number; recent?: number } = {}): LogQuantiles {
  const xs = past.slice(-(opts.recent ?? 250));
  if (xs.length < (opts.min ?? 40)) return q;
  const res = xs.map((p) => p.y - p.q.q50).sort((a, b) => a - b);
  const shift = opts.center ? 0.5 * quantileSorted(res, 0.5) : 0;
  const ratio = (f: (p: ScoredForecast) => number, p: number) => {
    const r = xs.map(f).filter(Number.isFinite).sort((a, b) => a - b);
    return Math.min(3, Math.max(0.6, quantileSorted(r, p)));
  };
  const eps = 1e-9;
  const sLo = ratio((p) => (p.q.q50 + shift - p.y) / Math.max(eps, p.q.q50 - p.q.q05), 0.95);
  const sHi = ratio((p) => (p.y - p.q.q50 - shift) / Math.max(eps, p.q.q95 - p.q.q50), 0.95);
  const sLi = ratio((p) => (p.q.q50 + shift - p.y) / Math.max(eps, p.q.q50 - p.q.q25), 0.75);
  const sHi2 = ratio((p) => (p.y - p.q.q50 - shift) / Math.max(eps, p.q.q75 - p.q.q50), 0.75);
  const m = q.q50 + shift;
  const out = { ...q, q50: m, q05: m - sLo * (q.q50 - q.q05), q95: m + sHi * (q.q95 - q.q50), q25: m - sLi * (q.q50 - q.q25), q75: m + sHi2 * (q.q75 - q.q50) };
  out.q25 = Math.max(out.q05, Math.min(out.q25, m));
  out.q75 = Math.min(out.q95, Math.max(out.q75, m));
  return out;
}
