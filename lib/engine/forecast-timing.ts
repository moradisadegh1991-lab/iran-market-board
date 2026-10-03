// «When to buy, when to sell» within a forecast horizon — the pure half.
//
// A cone says where the price may be on the last day. A trader who has to buy (or sell) some time
// within the next h days asks something else: how low is it likely to dip first, and when — is a
// limit order below today's price likely to fill, or will waiting cost more than it saves?
//
// This reads the answer the same two ways the ensemble does (CLAUDE.md rule 61), from history that
// was already known on the forecast day only (rule 4):
//  • empirical: every past h-day window of this asset (trailing 8 years) — its lowest point, its
//    highest point, and the day each came;
//  • analog: the same, over the past days whose pattern looked most like today's (analogNeighbours).
// The two are mixed half and half. A buy plan is a limit price the mix says fills with probability
// `fill`; if it does not fill, the plan buys on the last day (it never skips the purchase — the
// comparison with «buy today» would be meaningless otherwise). A sell plan is the mirror image.
//
// Whether such a plan beats simply buying (or selling) today was measured on real prices by
// scripts/eval/timing-eval.ts; `planRecord` replays the same thing for the page.
import { analogNeighbours, forwardIndex, quantileSorted, type AnalogOpts } from './forecast-model';

const DAY = 86_400_000;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** What the price did in the window after day i (rows i+1 … fwd[i]), as log moves from day i's price. */
export interface PathOutcomes {
  /** lowest close in the window */
  min: Float64Array;
  /** calendar days from i to that low */
  minDay: Float64Array;
  max: Float64Array;
  maxDay: Float64Array;
  /** the last close of the window */
  end: Float64Array;
  /** NaN where the window is not complete */
}

export function pathOutcomes(dates: string[], prices: number[], fwd: Int32Array): PathOutcomes {
  const n = dates.length;
  const o: PathOutcomes = {
    min: new Float64Array(n).fill(NaN),
    minDay: new Float64Array(n).fill(NaN),
    max: new Float64Array(n).fill(NaN),
    maxDay: new Float64Array(n).fill(NaN),
    end: new Float64Array(n).fill(NaN),
  };
  for (let i = 0; i < n; i++) {
    const e = fwd[i];
    if (e < 0) continue;
    let lo = Infinity;
    let hi = -Infinity;
    let loAt = i + 1;
    let hiAt = i + 1;
    for (let k = i + 1; k <= e; k++) {
      if (prices[k] < lo) {
        lo = prices[k];
        loAt = k;
      }
      if (prices[k] > hi) {
        hi = prices[k];
        hiAt = k;
      }
    }
    const p = prices[i];
    o.min[i] = Math.log(lo / p);
    o.max[i] = Math.log(hi / p);
    o.minDay[i] = (dayMs(dates[loAt]) - dayMs(dates[i])) / DAY;
    o.maxDay[i] = (dayMs(dates[hiAt]) - dayMs(dates[i])) / DAY;
    o.end[i] = Math.log(prices[e] / p);
  }
  return o;
}

/** A weighted sample of past windows: index and weight (weights of one source sum to 1). */
type Sample = { i: number; w: number }[];

/** Index of the last past day whose window had closed by day t. */
function lastKnown(fwd: Int32Array, t: number): number {
  let i = t - 1;
  while (i >= 0 && (fwd[i] < 0 || fwd[i] > t)) i--;
  return i;
}

function empiricalSample(dates: string[], fwd: Int32Array, t: number, years = 8): Sample | null {
  const end = lastKnown(fwd, t);
  if (end < 0) return null;
  const from = dayMs(dates[t]) - years * 365 * DAY;
  const out: Sample = [];
  for (let i = end; i >= 0 && dayMs(dates[i]) >= from; i--) out.push({ i, w: 1 });
  if (out.length < 30) return null;
  for (const x of out) x.w = 1 / out.length;
  return out;
}

/** A mixture sorted by one outcome, with cumulative weights — quantiles and CDF in one pass each. */
class Sorted {
  private v: Float64Array;
  private c: Float64Array;
  constructor(mix: Sample, xs: Float64Array) {
    const idx = mix.filter((s) => Number.isFinite(xs[s.i])).sort((a, b) => xs[a.i] - xs[b.i]);
    this.v = new Float64Array(idx.length);
    this.c = new Float64Array(idx.length);
    let acc = 0;
    idx.forEach((s, k) => {
      acc += s.w;
      this.v[k] = xs[s.i];
      this.c[k] = acc;
    });
    for (let k = 0; k < idx.length; k++) this.c[k] /= acc || 1;
  }
  /** weighted quantile */
  q(p: number): number {
    for (let k = 0; k < this.v.length; k++) if (this.c[k] >= p - 1e-12) return this.v[k];
    return this.v.length ? this.v[this.v.length - 1] : NaN;
  }
  /** P(x ≤ v) */
  cdf(v: number): number {
    let p = 0;
    for (let k = 0; k < this.v.length && this.v[k] <= v; k++) p = this.c[k];
    return p;
  }
}

export interface TimingForecast {
  /** horizon in calendar days */
  days: number;
  /** quantiles (25/50/75) of the lowest point of the window, log move from today */
  low: [number, number, number];
  /** median day the low came */
  lowDay: number;
  high: [number, number, number];
  highDay: number;
  /** P(the low goes under today's price at all) */
  pDip: number;
  /** buy limit (log move from today, ≤ 0) that the mix fills with probability `fill` */
  buyAt: number;
  /** sell limit (≥ 0) reached with probability `fill` */
  sellAt: number;
  fill: number;
  /** how many past windows the numbers stand on (empirical, analog) */
  n: { empirical: number; analog: number };
}

export interface TimingOpts {
  /** target fill probability of the plan's limit prices (default PLAN_FILL) */
  fill?: number;
  analog?: AnalogOpts;
  /** use only the empirical half (for the eval's comparison) */
  only?: 'empirical' | 'analog';
}

/**
 * Chosen on the design years only (2016–2020, scripts/eval/timing-eval.ts): the share of past
 * windows in which the limit price was reached.
 */
export const PLAN_FILL = 0.7;

/** The past windows behind a timing forecast on day t, sorted by each outcome. */
export interface TimingDist {
  low: Sorted;
  high: Sorted;
  lowDay: Sorted;
  highDay: Sorted;
  n: { empirical: number; analog: number };
  days: number;
}

/** The mixture of past windows (closed by day t) a timing forecast stands on. */
export function timingDist(dates: string[], prices: number[], fwd: Int32Array, out: PathOutcomes, t: number, opts: Omit<TimingOpts, 'fill'> = {}): TimingDist | null {
  const emp = opts.only === 'analog' ? null : empiricalSample(dates, fwd, t);
  const nb = opts.only === 'empirical' ? null : analogNeighbours(dates, prices, fwd, t, opts.analog);
  if ((opts.only !== 'analog' && !emp) || (opts.only !== 'empirical' && !nb)) return null;
  const mix: Sample = [];
  const parts = (emp ? 1 : 0) + (nb ? 1 : 0);
  if (emp) for (const s of emp) mix.push({ i: s.i, w: s.w / parts });
  if (nb) {
    const tot = nb.reduce((s, x) => s + x.w, 0);
    for (const x of nb) mix.push({ i: x.i, w: x.w / tot / parts });
  }
  return {
    low: new Sorted(mix, out.min),
    high: new Sorted(mix, out.max),
    lowDay: new Sorted(mix, out.minDay),
    highDay: new Sorted(mix, out.maxDay),
    n: { empirical: emp?.length ?? 0, analog: nb?.length ?? 0 },
    days: horizonDays(dates, fwd),
  };
}

/** The forecast read from a distribution at a fill probability. */
export function timingFrom(d: TimingDist, fill = PLAN_FILL): TimingForecast {
  return {
    days: d.days,
    low: [d.low.q(0.25), d.low.q(0.5), d.low.q(0.75)],
    lowDay: d.lowDay.q(0.5),
    high: [d.high.q(0.25), d.high.q(0.5), d.high.q(0.75)],
    highDay: d.highDay.q(0.5),
    pDip: d.low.cdf(-1e-9),
    // the buy limit: P(low ≤ limit) = fill, never above today; the sell limit mirrors it
    buyAt: Math.min(0, d.low.q(fill)),
    sellAt: Math.max(0, d.high.q(1 - fill)),
    fill,
    n: d.n,
  };
}

/** The timing forecast for day t, h = the window of `fwd`, from windows closed by day t only. */
export function timingAt(dates: string[], prices: number[], fwd: Int32Array, out: PathOutcomes, t: number, opts: TimingOpts = {}): TimingForecast | null {
  const d = timingDist(dates, prices, fwd, out, t, opts);
  return d ? timingFrom(d, opts.fill) : null;
}

const hdCache = new WeakMap<Int32Array, number>();
function horizonDays(dates: string[], fwd: Int32Array): number {
  let d = hdCache.get(fwd);
  if (d === undefined) {
    // the smallest calendar distance of a complete window = the horizon (windows end at the first row ≥ h days)
    d = Infinity;
    for (let i = 0; i < fwd.length; i++) if (fwd[i] > 0) d = Math.min(d, (dayMs(dates[fwd[i]]) - dayMs(dates[i])) / DAY);
    hdCache.set(fwd, d);
  }
  return d;
}

/** What following a plan from day t did: entry (buy) or exit (sell) price as a log move from day t's close. */
export interface PlanResult {
  /** buy plan: log(entry / today) — lower is better; buying today = 0 */
  buy: number;
  buyFilled: boolean;
  /** sell plan: log(exit / today) — higher is better; selling today = 0 */
  sell: number;
  sellFilled: boolean;
  /** the window's last close (buying or selling on the last day instead) */
  end: number;
  /** the true low and high of the window */
  low: number;
  high: number;
  lowDay: number;
  highDay: number;
}

/**
 * Follows the plan from day t on what really came next. Closes only: a buy limit fills on the first
 * close at or under it, at the limit price (the price passed through it on the way down — a gap
 * under it would have filled cheaper, so this is the conservative side); otherwise the plan buys at
 * the window's last close.
 */
export function followPlan(prices: number[], fwd: Int32Array, out: PathOutcomes, t: number, buyAt: number, sellAt: number): PlanResult | null {
  const e = fwd[t];
  if (e < 0) return null;
  const p = prices[t];
  let buy = NaN;
  let sell = NaN;
  for (let k = t + 1; k <= e; k++) {
    const m = Math.log(prices[k] / p);
    if (Number.isNaN(buy) && m <= buyAt) buy = buyAt;
    if (Number.isNaN(sell) && m >= sellAt) sell = sellAt;
  }
  const end = out.end[t];
  return {
    buy: Number.isNaN(buy) ? end : buy,
    buyFilled: !Number.isNaN(buy),
    sell: Number.isNaN(sell) ? end : sell,
    sellFilled: !Number.isNaN(sell),
    end,
    low: out.min[t],
    high: out.max[t],
    lowDay: out.minDay[t],
    highDay: out.maxDay[t],
  };
}

export interface PlanRecord {
  /** past days the plan was followed */
  n: number;
  /** separate horizon-long windows those days span (the real sample size) */
  periods: number;
  from: string;
  to: string;
  /** buy plan: mean entry vs buying today, in % (negative = the plan bought cheaper) */
  buyVsNowPct: number;
  /** share of days the plan's entry was cheaper than buying today */
  buyBetterPct: number;
  buyFilledPct: number;
  /** sell plan: mean exit vs selling today, in % (positive = the plan sold higher) */
  sellVsNowPct: number;
  /** sell plan vs simply holding to the last day */
  sellVsEndPct: number;
  sellFilledPct: number;
  /** the predicted fill probability, for comparison with the filled shares */
  fill: number;
  /** median |predicted day of the low − real day| and the same for «no idea» (the unconditional median day) */
  lowDayErr: number;
  lowDayErrNaive: number;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const pct = (x: number) => (Math.exp(x) - 1) * 100;

/**
 * The plan's track record: at up to `samples` past days between `fromIso` and the last closed
 * window, a timing forecast from what was known then, followed on what really came next.
 */
export function planRecord(dates: string[], prices: number[], days: number, opts: { samples?: number; fromIso?: string; fill?: number; feats?: (number[] | null)[] } = {}): PlanRecord | null {
  const fwd = forwardIndex(dates, days);
  const out = pathOutcomes(dates, prices, fwd);
  const eligible: number[] = [];
  for (let t = 260; t < dates.length; t++) if (fwd[t] >= 0 && (!opts.fromIso || dates[t] >= opts.fromIso)) eligible.push(t);
  if (!eligible.length) return null;
  const samples = opts.samples ?? 60;
  const step = Math.max(1, Math.floor(eligible.length / samples));
  const rs: { r: PlanResult; f: TimingForecast; naive: number; t: number }[] = [];
  for (let k = eligible.length - 1; k >= 0 && rs.length < samples; k -= step) {
    const t = eligible[k];
    const f = timingAt(dates, prices, fwd, out, t, { fill: opts.fill, analog: { feats: opts.feats } });
    if (!f) continue;
    const r = followPlan(prices, fwd, out, t, f.buyAt, f.sellAt);
    if (!r) continue;
    const emp = timingDist(dates, prices, fwd, out, t, { only: 'empirical' })!;
    rs.push({ r, f, naive: emp.lowDay.q(0.5), t });
  }
  const n = rs.length;
  if (n < 12) return null;
  const first = rs[n - 1].t;
  const last = rs[0].t;
  const periods = Math.floor((dayMs(dates[last]) - dayMs(dates[first])) / (days * DAY)) + 1;
  const med = (xs: number[]) =>
    quantileSorted(
      xs.slice().sort((a, b) => a - b),
      0.5,
    );
  return {
    n,
    periods,
    from: dates[first],
    to: dates[last],
    buyVsNowPct: pct(mean(rs.map((x) => x.r.buy))),
    buyBetterPct: (rs.filter((x) => x.r.buy < 0).length / n) * 100,
    buyFilledPct: (rs.filter((x) => x.r.buyFilled).length / n) * 100,
    sellVsNowPct: pct(mean(rs.map((x) => x.r.sell))),
    sellVsEndPct: pct(mean(rs.map((x) => x.r.sell - x.r.end))),
    sellFilledPct: (rs.filter((x) => x.r.sellFilled).length / n) * 100,
    fill: rs[0].f.fill,
    lowDayErr: med(rs.map((x) => Math.abs(x.f.lowDay - x.r.lowDay))),
    lowDayErrNaive: med(rs.map((x) => Math.abs(x.naive - x.r.lowDay))),
  };
}
