/**
 * GET /api/forecast?asset=usd&h=m1 — the price history and a forecast cone for one asset and
 * horizon (هفتگی، ماهانه، ۳ ماهه، یک ساله), with the cone method's own past track record.
 *
 * The cone is the scenario engine's (same numbers as /scenarios; lib/engine/forecast.ts draws it
 * between the horizons). Read-only and holds no user data, so the app may call it (middleware.ts).
 */
import { NextResponse } from 'next/server';
import { calibrate, calibrateEnsemble, coneFromRows, ENSEMBLE_ASSETS, ensembleRows, FORECAST_ASSETS, FORECAST_HORIZONS, type Calibration, type ConeRow, type EnsembleSeries } from '@/lib/engine/forecast';
import { featureMatrix, forwardIndex, pUpFromQuantiles, type LogQuantiles } from '@/lib/engine/forecast-model';
import { analogPaths, trendFacts } from '@/lib/engine/forecast-why';
import { pathOutcomes, planRecord, PLAN_FILL, timingDist, timingFrom, type PlanRecord } from '@/lib/engine/forecast-timing';
import { buildScenario, type ScenarioInput } from '@/lib/engine/scenario';
import { errMsg } from '@/lib/http';
import { isNum } from '@/lib/num';
import { buildSeries, loadSeriesInputs } from '@/lib/series';
import type { DatedPairs } from '@/lib/sources/history';
import { longHistory } from '@/lib/long-history';
import { getSnapshot } from '@/lib/snapshot';
import type { AssetScenario, ScenarioRow, Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** how much history to draw before today, per horizon */
const LOOKBACK: Record<string, number> = { w1: 45, m1: 120, m3: 365, y1: 1095 };
const DAY = 86_400_000;

// the calibration replays the engine ~48 times; the outcome changes once a day at most
const calCache = new Map<string, { at: number; v: Calibration | null; partial?: boolean }>();
const CAL_TTL = 6 * 3600_000;
/** a record scored without the long history is retried soon */
const PARTIAL_TTL = 10 * 60_000;
const LONG_BUDGET_MS = 6_000;

// The board keeps ~15 months of history — enough for a forecast, too little to score one: a year
// of 1-year forecasts is a single outcome. So the track record replays the engine over the longest
// history the source has (lib/long-history.ts), each forecast still seeing only as many rows as the
// live engine does (`window`).

// featureMatrix of each long series, rebuilt when the series changes (once a day at most)
const featCache = new Map<string, { last: string; len: number; s: EnsembleSeries }>();
function ensembleSeries(key: string, long: DatedPairs): EnsembleSeries {
  const c = featCache.get(key);
  const last = long[long.length - 1][0];
  if (c && c.last === last && c.len === long.length) return c.s;
  const prices = long.map((p) => p[1]);
  const s = { dates: long.map((p) => p[0]), prices, feats: featureMatrix(prices) };
  featCache.set(key, { last, len: long.length, s });
  return s;
}

/** the engine row as log quantiles (25/75 from the 5/95 by the z ratio, as the cone draws it) */
function engineQ(r: { worst: number; base: number; best: number }, anchor: number): [number, number, number, number, number] {
  const lo = Math.log(r.worst / anchor);
  const mid = Math.log(r.base / anchor);
  const hi = Math.log(r.best / anchor);
  const k = 0.6745 / 1.6449;
  return [lo, mid - (mid - lo) * k, mid, mid + (hi - mid) * k, hi];
}
const pctOf = (x: number) => (Math.exp(x) - 1) * 100;

// the buy/sell plan's track record replays ~60 timing forecasts; like the cone's, once a day is enough
const planCache = new Map<string, { at: number; last: string; v: PlanRecord | null }>();
/** rows before the drawn history, so a 200-day average exists from its first day (lib/indicators.ts) */
const WARM_ROWS = 260;
const summary = (q: LogQuantiles) => ({ lowPct: pctOf(q.q05), midPct: pctOf(q.q50), highPct: pctOf(q.q95), pUp: q.pUp });

export async function GET(req: Request) {
  const u = new URL(req.url);
  const meta = FORECAST_ASSETS.find((a) => a.key === u.searchParams.get('asset'));
  const hz = FORECAST_HORIZONS.find((h) => h.key === u.searchParams.get('h'));
  if (!meta || !hz) return NextResponse.json({ error: 'دارایی یا افق نامعتبر است.' }, { status: 400 });
  try {
    const [inputs, snap] = await Promise.all([loadSeriesInputs(), Promise.race<Snapshot | null>([getSnapshot().catch(() => null), new Promise((r) => setTimeout(() => r(null), 8_000))])]);
    const s = buildSeries(inputs, meta.key);
    if (s.prices.length < 30) return NextResponse.json({ error: 'تاریخچه این دارایی برای پیش‌بینی کافی نیست.' }, { status: 422 });
    const disp = (v: number) => (meta.unit === 'toman' ? v / 10 : v);
    const prices = s.prices.map(disp);
    const live = snap?.live.items.find((x) => x.key === meta.key);
    const price = isNum(live?.price) && live!.price! > 0 ? live!.price! : prices[prices.length - 1];

    const input: ScenarioInput = {
      key: meta.key,
      label: meta.label,
      unit: meta.unit,
      group: meta.group,
      price,
      dates: s.dates,
      prices,
      basis: s.basis,
      reconstructed: s.reconstructed,
    };
    // the same scenario the /scenarios page shows (it carries the bubble adjustment); else built here
    const shown: AssetScenario | undefined = snap?.scenarios.assets.find((a) => a.key === meta.key && !a.missingReason);
    const scenario = shown ?? buildScenario(input);
    if (scenario.missingReason) return NextResponse.json({ error: scenario.missingReason }, { status: 422 });
    const anchor = isNum(scenario.price) && scenario.price > 0 ? scenario.price : price;
    const window = s.prices.length;

    // the long history: the ensemble's empirical and pattern readings, and every track record.
    // Never let a slow source push the response past maxDuration — without it the engine alone answers.
    const long = await Promise.race([longHistory(meta.key).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), LONG_BUDGET_MS))]);
    const hasLong = !!long && long.length > window;
    const useEnsemble = ENSEMBLE_ASSETS.has(meta.key) && hasLong && long!.length >= 600;

    let rows: ConeRow[] = Object.values(scenario.rows).filter((r): r is ScenarioRow => !!r);
    let row: ScenarioRow | null = scenario.rows[hz.key];
    let pUp: number | null = row ? pUpFromQuantiles(engineQ(row, anchor)) : null;
    let ensemble: Record<string, unknown> | null = null;
    let es: EnsembleSeries | null = null;
    if (useEnsemble) {
      es = ensembleSeries(meta.key, long!);
      const er = ensembleRows(input, es, anchor, window);
      const at = er.find((r) => r.days === hz.days);
      if (at && er.length >= 4) {
        rows = er;
        const q = at.parts.ensemble;
        row = {
          h: hz.key,
          label: row?.label ?? hz.label,
          days: hz.days,
          worst: at.worst,
          base: at.base,
          best: at.best,
          worstPct: pctOf(q.q05),
          basePct: pctOf(q.q50),
          bestPct: pctOf(q.q95),
          histWorstPct: row?.histWorstPct ?? null,
          histBestPct: row?.histBestPct ?? null,
          confidence: row?.confidence ?? 1,
        };
        pUp = q.pUp;
        const a = at.parts.analog;
        ensemble = {
          parts: { engine: summary(at.parts.engine), empirical: summary(at.parts.empirical), analog: summary(a) },
          analog: {
            n: a.n,
            matches: a.matches.slice(0, 6).map((m) => ({ date: m.date, movePct: pctOf(m.move) })),
            // what the price did after each of those days, day by day — for the «چرا این پیش‌بینی؟» chart (lib/engine/forecast-why.ts)
            paths: analogPaths(es.dates, es.prices, a.matches.slice(0, 6).map((m) => ({ date: m.date, movePct: pctOf(m.move) })), hz.days),
          },
          empiricalN: at.parts.empirical.n,
          since: es.dates[0],
        };
      } else es = null;
    }

    const key = `${meta.key}:${hz.key}:${es ? 'ens' : 'eng'}`;
    let cal = calCache.get(key);
    if (!cal || Date.now() - cal.at > (cal.partial ? PARTIAL_TTL : CAL_TTL)) {
      // returns are scale-free, so the long series' own unit does not matter here
      const calInput: ScenarioInput = hasLong ? { ...input, dates: long!.map((p) => p[0]), prices: long!.map((p) => p[1]) } : input;
      const v = es ? calibrateEnsemble(input, es, hz.key, window) : calibrate(calInput, hz.key, { window });
      cal = { at: Date.now(), v, partial: !hasLong };
      calCache.set(key, cal);
    }

    // «when to buy, when to sell» within the horizon: the lowest and highest point of similar past
    // windows (lib/engine/forecast-timing.ts), and what following such a plan really did before
    let timing: Record<string, unknown> | null = null;
    if (hasLong && long!.length >= 600) {
      const lp = long!.map((p) => p[1]);
      const ld = long!.map((p) => p[0]);
      const feats = es?.feats ?? ensembleSeries(meta.key, long!).feats;
      const fwd = forwardIndex(ld, hz.days);
      const out = pathOutcomes(ld, lp, fwd);
      const dist = timingDist(ld, lp, fwd, out, ld.length - 1, { analog: { feats } });
      if (dist) {
        const f = timingFrom(dist, PLAN_FILL);
        const pk = `${meta.key}:${hz.key}`;
        let rec = planCache.get(pk);
        if (!rec || rec.last !== ld[ld.length - 1] || Date.now() - rec.at > CAL_TTL) {
          rec = { at: Date.now(), last: ld[ld.length - 1], v: planRecord(ld, lp, hz.days, { samples: 60, feats }) };
          planCache.set(pk, rec);
        }
        const px = (x: number) => anchor * Math.exp(x);
        timing = {
          fill: f.fill,
          buy: px(f.buyAt),
          buyPct: pctOf(f.buyAt),
          sell: px(f.sellAt),
          sellPct: pctOf(f.sellAt),
          low: f.low.map(px),
          lowPct: f.low.map(pctOf),
          lowDay: f.lowDay,
          high: f.high.map(px),
          highPct: f.high.map(pctOf),
          highDay: f.highDay,
          pDip: f.pDip,
          n: f.n,
          record: rec.v,
        };
      }
    }

    const now = Date.now();
    const since = now - LOOKBACK[hz.key] * DAY;
    const all = s.dates.map((d, i) => [Date.parse(`${d}T12:00:00Z`), prices[i]] as [number, number]);
    const history = all.filter(([t]) => t >= since);
    const warmup = all.filter(([t]) => t < since).slice(-WARM_ROWS);
    history.push([now, anchor]);

    return NextResponse.json(
      {
        asset: meta.key,
        label: meta.label,
        unit: meta.unit,
        horizon: hz,
        anchor,
        now,
        history,
        warmup,
        timing,
        cone: coneFromRows(anchor, rows, hz.days, 40).map((p) => ({
          ...p,
          t: now + p.day * DAY,
        })),
        row,
        method: es ? 'ensemble' : 'engine',
        pUp,
        ensemble,
        calibration: cal.v,
        annualVolPct: scenario.annualVolPct,
        trend: trendFacts(s.dates, prices, anchor),
        drivers: scenario.drivers.slice(0, 4),
        basis: s.basis,
        reconstructed: s.reconstructed,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
        },
      },
    );
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}
