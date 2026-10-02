// Price forecast cones for the charts page — the pure half.
//
// The cone passes through forecast quantiles at 1 day … 1 year; between those horizons the band
// widens with √time and the median moves linearly, so it never claims more precision than the six
// points it is built on. For dollar-priced assets the points are the scenario engine's (/scenarios).
// For rial-priced assets they are an equal-weight ensemble of three readings (ensembleRows): the
// scenario engine, the empirical distribution of past moves, and the past days whose pattern looked
// like today's (forecast-model.ts). On real data 2016–2026 the ensemble beat the engine for every
// rial asset and horizon, in the design years and in the held-out years alike, and was no better for
// dollar assets — so only rial assets use it (scripts/eval/forecast-eval.ts, CLAUDE.md rule 61).
//
// And every cone is shown with its own track record: `calibrate` re-runs the engine on the past —
// at each test date only on prices up to that date (CLAUDE.md rule 4, no lookahead) — and checks
// where the price actually was one horizon later. A 90% band that held the price 90% of the time
// is honest; one that held it 60% of the time says so on the page.
import type { HorizonKey, ScenarioRow } from '@/lib/types';
import type { Calibration } from '../forecast-meta';
import { analogForecast, averageQuantiles, empiricalForecast, forwardIndex, pUpFromQuantiles, type AnalogForecast, type LogQuantiles } from './forecast-model';
import { buildScenario, SCENARIO_HORIZONS, type ScenarioInput } from './scenario';

export { FORECAST_ASSETS, FORECAST_HORIZONS, type Calibration } from '../forecast-meta';

export interface ConePoint {
  /** days from today */
  day: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

/** z of the 25th/75th percentile over z of the 5th/95th — the inner band from the outer one, same skew. */
const INNER = 0.6745 / 1.6449;

/** A forecast at one horizon, in price: 5% / median / 95%, and optionally its own 25% / 75%. */
export type ConeRow = Pick<ScenarioRow, 'days' | 'worst' | 'base' | 'best'> & { lo50?: number; hi50?: number };

/**
 * The cone from today (`anchor`) out to `days`, `steps` points. Built in log space from the
 * rows: median interpolated linearly in time, each half-width with √time. Without lo50/hi50 the
 * inner band is the outer one × INNER.
 */
export function coneFromRows(anchor: number, rows: ConeRow[], days: number, steps = 40): ConePoint[] {
  const known = [
    { days: 0, lo: 0, mid: 0, hi: 0, loI: 0, hiI: 0 },
    ...rows
      .filter((r) => r.days > 0 && r.worst > 0 && r.base > 0 && r.best > 0)
      .sort((a, b) => a.days - b.days)
      .map((r) => {
        const lo = Math.log(r.worst / anchor);
        const mid = Math.log(r.base / anchor);
        const hi = Math.log(r.best / anchor);
        const loI = r.lo50 && r.lo50 > 0 ? Math.min(mid, Math.max(lo, Math.log(r.lo50 / anchor))) : mid - (mid - lo) * INNER;
        const hiI = r.hi50 && r.hi50 > 0 ? Math.max(mid, Math.min(hi, Math.log(r.hi50 / anchor))) : mid + (hi - mid) * INNER;
        return { days: r.days, lo, mid, hi, loI, hiI };
      }),
  ];
  if (known.length < 2) return [];
  const at = (d: number) => {
    let i = 1;
    while (i < known.length - 1 && known[i].days < d) i++;
    const a = known[i - 1];
    const b = known[i];
    // t, ts ∈ [0, 1] between two known horizons; past the last one they extrapolate the same way
    const t = (d - a.days) / (b.days - a.days);
    const ts = (Math.sqrt(d) - Math.sqrt(a.days)) / (Math.sqrt(b.days) - Math.sqrt(a.days));
    const mid = a.mid + (b.mid - a.mid) * t;
    const down = a.mid - a.lo + (b.mid - b.lo - (a.mid - a.lo)) * ts;
    const up = a.hi - a.mid + (b.hi - b.mid - (a.hi - a.mid)) * ts;
    const downI = a.mid - a.loI + (b.mid - b.loI - (a.mid - a.loI)) * ts;
    const upI = a.hiI - a.mid + (b.hiI - b.mid - (a.hiI - a.mid)) * ts;
    const dn = Math.max(0, down);
    const u = Math.max(0, up);
    return { mid, down: dn, up: u, downI: Math.min(dn, Math.max(0, downI)), upI: Math.min(u, Math.max(0, upI)) };
  };
  const out: ConePoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const d = (days * k) / steps;
    const { mid, down, up, downI, upI } = at(d);
    out.push({
      day: d,
      p5: anchor * Math.exp(mid - down),
      p25: anchor * Math.exp(mid - downI),
      p50: anchor * Math.exp(mid),
      p75: anchor * Math.exp(mid + upI),
      p95: anchor * Math.exp(mid + up),
    });
  }
  return out;
}

/** separate horizon-long windows a track record must span */
export const MIN_PERIODS = 4;

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export interface CalibrationOpts {
  /** past forecasts to check (default 48) */
  samples?: number;
  /** rows of history a forecast needs before the first test date (default 120) */
  minHistory?: number;
  /** each forecast sees only its last `window` rows — the length the live engine gets — so a long
   *  history scores the method as it runs, not a variant with more data */
  window?: number;
  /** the forecast to score on day t (price space); default: the scenario engine on prices up to t */
  forecastAt?: (t: number, days: number) => { worst: number; base: number; best: number } | null;
}

export interface CalibrationSample {
  /** the day the forecast was made — built from prices up to and including this day only */
  date: string;
  worst: number;
  base: number;
  best: number;
  /** the first recorded price at or after `date` + horizon */
  actual: number;
}

/**
 * Re-runs the scenario engine at up to `samples` past dates — each time on history up to that date
 * only — and pairs each forecast with the price really seen one horizon later. Newest first.
 */
export function calibrationSamples(inp: ScenarioInput, h: HorizonKey, opts: CalibrationOpts = {}): CalibrationSample[] {
  const hz = SCENARIO_HORIZONS.find((x) => x.key === h);
  if (!hz) return [];
  const { dates, prices } = inp;
  const minHistory = opts.minHistory ?? 120;
  const samples = opts.samples ?? 48;
  if (dates.length <= minHistory) return [];
  const lastMs = dayMs(dates[dates.length - 1]);
  // test dates whose outcome is already known
  const eligible: number[] = [];
  for (let i = minHistory; i < dates.length; i++) if (dayMs(dates[i]) + hz.days * 86_400_000 <= lastMs) eligible.push(i);
  const step = Math.max(1, Math.floor(eligible.length / samples));
  const out: CalibrationSample[] = [];
  for (let k = eligible.length - 1; k >= 0 && out.length < samples; k -= step) {
    const t = eligible[k];
    let row: { worst: number; base: number; best: number } | null;
    if (opts.forecastAt) row = opts.forecastAt(t, hz.days);
    else {
      const from = opts.window ? Math.max(0, t + 1 - opts.window) : 0;
      row = buildScenario({ ...inp, price: prices[t], dates: dates.slice(from, t + 1), prices: prices.slice(from, t + 1), context: [], bubblePct: null }).rows[h];
    }
    if (!row) continue;
    const target = dayMs(dates[t]) + hz.days * 86_400_000;
    let m = t + 1;
    while (m < dates.length && dayMs(dates[m]) < target) m++;
    if (m >= dates.length) continue;
    out.push({
      date: dates[t],
      worst: row.worst,
      base: row.base,
      best: row.best,
      actual: prices[m],
    });
  }
  return out;
}

/** The cone method's track record at horizon `h`; null when fewer than 12 past forecasts, or fewer than MIN_PERIODS separate windows, can be checked. */
export function calibrate(inp: ScenarioInput, h: HorizonKey, opts: CalibrationOpts = {}): Calibration | null {
  const xs = calibrationSamples(inp, h, opts);
  const n = xs.length;
  if (n < 12) return null;
  // 48 one-year forecasts made over two months are one outcome, not 48: overlapping windows move
  // together. Below four separate windows there is no track record to speak of.
  const hzDays = SCENARIO_HORIZONS.find((x) => x.key === h)!.days;
  const periods = Math.floor((dayMs(xs[0].date) - dayMs(xs[n - 1].date)) / (hzDays * 86_400_000)) + 1;
  if (periods < MIN_PERIODS) return null;
  const below = xs.filter((x) => x.actual < x.worst).length;
  const above = xs.filter((x) => x.actual > x.best).length;
  const errs = xs.map((x) => Math.abs(x.actual / x.base - 1) * 100).sort((a, b) => a - b);
  return {
    n,
    insidePct: ((n - below - above) / n) * 100,
    abovePct: (above / n) * 100,
    belowPct: (below / n) * 100,
    aboveMedianPct: (xs.filter((x) => x.actual > x.base).length / n) * 100,
    medianErrPct: errs[Math.floor(n / 2)],
    periods,
    from: xs[n - 1].date,
    to: xs[0].date,
  };
}

// ── the ensemble for rial-priced assets ──

/** Assets whose forecast is the three-way ensemble (rial-priced; see the header). */
export const ENSEMBLE_ASSETS = new Set(['usd', 'usdt', 'coin', 'nim', 'rob', 'g18', 'silver']);

export interface EnsembleSeries {
  dates: string[];
  prices: number[];
  /** featureMatrix(prices) — computed once */
  feats: (number[] | null)[];
}

export interface EnsembleParts {
  engine: LogQuantiles;
  empirical: LogQuantiles;
  analog: AnalogForecast;
  ensemble: LogQuantiles;
}

const fwdCache = new WeakMap<string[], Map<number, Int32Array>>();
function fwdFor(dates: string[], days: number): Int32Array {
  let m = fwdCache.get(dates);
  if (!m) fwdCache.set(dates, (m = new Map()));
  let f = m.get(days);
  if (!f) m.set(days, (f = forwardIndex(dates, days)));
  return f;
}

function engineLogQ(row: { worst: number; base: number; best: number }, price: number): LogQuantiles {
  const lo = Math.log(row.worst / price);
  const mid = Math.log(row.base / price);
  const hi = Math.log(row.best / price);
  const q: [number, number, number, number, number] = [lo, mid - (mid - lo) * INNER, mid, mid + (hi - mid) * INNER, hi];
  return { q05: q[0], q25: q[1], q50: q[2], q75: q[3], q95: q[4], pUp: pUpFromQuantiles(q), n: 0 };
}

/**
 * The three readings and their average for day t of `s`, h = `days` ahead, from prices up to t only.
 * `price` is today's live price when t is the last row (the moves are applied to it); the engine
 * sees the last `window` rows, as it does on the board.
 */
export function ensembleAt(inp: ScenarioInput, s: EnsembleSeries, t: number, days: number, window: number, price = s.prices[t]): EnsembleParts | null {
  const hz = SCENARIO_HORIZONS.find((x) => x.days === days);
  if (!hz) return null;
  const from = Math.max(0, t + 1 - window);
  const row = buildScenario({ ...inp, price, dates: s.dates.slice(from, t + 1), prices: s.prices.slice(from, t + 1), context: [], bubblePct: null }).rows[hz.key];
  if (!row) return null;
  const fwd = fwdFor(s.dates, days);
  const empirical = empiricalForecast(s.dates, s.prices, fwd, t);
  const analog = analogForecast(s.dates, s.prices, fwd, t, { feats: s.feats });
  if (!empirical || !analog) return null;
  const engine = engineLogQ(row, price);
  return { engine, empirical, analog, ensemble: averageQuantiles(engine, empirical, analog) };
}

/** Ensemble rows for every scenario horizon at the last day, in price around `anchor`. */
export function ensembleRows(inp: ScenarioInput, s: EnsembleSeries, anchor: number, window: number): (ConeRow & { parts: EnsembleParts })[] {
  const t = s.prices.length - 1;
  const out: (ConeRow & { parts: EnsembleParts })[] = [];
  for (const h of SCENARIO_HORIZONS) {
    const p = ensembleAt(inp, s, t, h.days, window, anchor);
    if (!p) continue;
    const q = p.ensemble;
    out.push({ days: h.days, worst: anchor * Math.exp(q.q05), lo50: anchor * Math.exp(q.q25), base: anchor * Math.exp(q.q50), hi50: anchor * Math.exp(q.q75), best: anchor * Math.exp(q.q95), parts: p });
  }
  return out;
}

/** calibrate() for the ensemble: the same past days, the same scoring, the ensemble's forecasts. */
export function calibrateEnsemble(inp: ScenarioInput, s: EnsembleSeries, h: HorizonKey, window: number, opts: Omit<CalibrationOpts, 'forecastAt' | 'window'> = {}): Calibration | null {
  return calibrate({ ...inp, dates: s.dates, prices: s.prices }, h, {
    minHistory: 260,
    ...opts,
    forecastAt: (t, days) => {
      const p = ensembleAt(inp, s, t, days, window);
      if (!p) return null;
      const q = p.ensemble;
      const px = s.prices[t];
      return { worst: px * Math.exp(q.q05), base: px * Math.exp(q.q50), best: px * Math.exp(q.q95) };
    },
  });
}
