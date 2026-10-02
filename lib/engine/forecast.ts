// Price forecast cones for the charts page — the pure half.
//
// Not a new model: the cone is drawn from the same scenario engine as /scenarios (scenario.ts:
// 5th percentile, median, 95th percentile at 1 day … 1 year). Between those horizons the band
// widens with √time and the median moves linearly, so the cone never claims more precision than
// the six points it is built on.
//
// And every cone is shown with its own track record: `calibrate` re-runs the engine on the past —
// at each test date only on prices up to that date (CLAUDE.md rule 4, no lookahead) — and checks
// where the price actually was one horizon later. A 90% band that held the price 90% of the time
// is honest; one that held it 60% of the time says so on the page.
import type { HorizonKey, ScenarioRow } from '@/lib/types';
import type { Calibration } from '../forecast-meta';
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

/**
 * The cone from today (`anchor`) out to `days`, `steps` points. Built in log space from the
 * scenario rows: median interpolated linearly in time, each half-width with √time.
 */
export function coneFromRows(anchor: number, rows: Pick<ScenarioRow, 'days' | 'worst' | 'base' | 'best'>[], days: number, steps = 40): ConePoint[] {
  const known = [
    { days: 0, lo: 0, mid: 0, hi: 0 },
    ...rows
      .filter((r) => r.days > 0 && r.worst > 0 && r.base > 0 && r.best > 0)
      .sort((a, b) => a.days - b.days)
      .map((r) => ({
        days: r.days,
        lo: Math.log(r.worst / anchor),
        mid: Math.log(r.base / anchor),
        hi: Math.log(r.best / anchor),
      })),
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
    return { mid, down: Math.max(0, down), up: Math.max(0, up) };
  };
  const out: ConePoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const d = (days * k) / steps;
    const { mid, down, up } = at(d);
    out.push({
      day: d,
      p5: anchor * Math.exp(mid - down),
      p25: anchor * Math.exp(mid - down * INNER),
      p50: anchor * Math.exp(mid),
      p75: anchor * Math.exp(mid + up * INNER),
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
    const from = opts.window ? Math.max(0, t + 1 - opts.window) : 0;
    const s = buildScenario({ ...inp, price: prices[t], dates: dates.slice(from, t + 1), prices: prices.slice(from, t + 1), context: [], bubblePct: null });
    const row = s.rows[h];
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
