/**
 * GET /api/forecast?asset=usd&h=m1 — the price history and a forecast cone for one asset and
 * horizon (هفتگی، ماهانه، ۳ ماهه، یک ساله), with the cone method's own past track record.
 *
 * The cone is the scenario engine's (same numbers as /scenarios; lib/engine/forecast.ts draws it
 * between the horizons). Read-only and holds no user data, so the app may call it (middleware.ts).
 */
import { NextResponse } from 'next/server';
import { calibrate, coneFromRows, FORECAST_ASSETS, FORECAST_HORIZONS, type Calibration } from '@/lib/engine/forecast';
import { buildScenario, type ScenarioInput } from '@/lib/engine/scenario';
import { errMsg } from '@/lib/http';
import { isNum } from '@/lib/num';
import { buildSeries, loadSeriesInputs } from '@/lib/series';
import { cachedSource } from '@/lib/sources/cache';
import { fetchTgjuHistory, TGJU_SLUGS, type DatedPairs } from '@/lib/sources/history';
import { fetchDailyCandles } from '@/lib/sources/klines';
import { getSnapshot } from '@/lib/snapshot';
import type { AssetScenario, ScenarioRow, Snapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** how much history to draw before today, per horizon */
const LOOKBACK: Record<string, number> = { w1: 45, m1: 120, m3: 365, y1: 1095 };
const DAY = 86_400_000;

// the calibration replays the engine ~48 times; the outcome changes once a day at most
const calCache = new Map<string, { at: number; v: Calibration | null }>();
const CAL_TTL = 6 * 3600_000;

// The board keeps ~15 months of history — enough for a forecast, too little to score one: a year
// of 1-year forecasts is a single outcome. So the track record replays the engine over the longest
// history the source has (TGJU since 2011; Binance ~1000 days), each forecast still seeing only as
// many rows as the live engine does (`window`). Tether's series is the dollar's (lib/series.ts).
const TGJU_LONG: Record<string, string> = {
  usd: TGJU_SLUGS.usd,
  usdt: TGJU_SLUGS.usd,
  coin: TGJU_SLUGS.coin,
  nim: TGJU_SLUGS.nim,
  rob: TGJU_SLUGS.rob,
  g18: TGJU_SLUGS.g18,
  ons: TGJU_SLUGS.ons,
  silver: TGJU_SLUGS.silver,
};
const BINANCE_LONG: Record<string, string> = { btc: 'BTC', eth: 'ETH' };

async function longHistory(key: string): Promise<DatedPairs | null> {
  const slug = TGJU_LONG[key];
  if (slug) return (await cachedSource<DatedPairs>(`tgjuFull:${slug}`, 12 * 3600, () => fetchTgjuHistory(slug, true), 7 * 86_400)).data;
  const sym = BINANCE_LONG[key];
  if (sym)
    return (
      await cachedSource<DatedPairs>(`dailyFull:${sym}`, 12 * 3600, async () => (await fetchDailyCandles(sym, 999)).map((c) => [new Date(c.t).toISOString().slice(0, 10), c.c] as [string, number]), 7 * 86_400)
    ).data;
  return null;
}

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
    const rows = Object.values(scenario.rows).filter((r): r is ScenarioRow => !!r);
    const row = scenario.rows[hz.key];

    const key = `${meta.key}:${hz.key}`;
    let cal = calCache.get(key);
    if (!cal || Date.now() - cal.at > CAL_TTL) {
      const long = await longHistory(meta.key).catch(() => null);
      // returns are scale-free, so the long series' own unit does not matter here
      const calInput: ScenarioInput = long && long.length > s.prices.length ? { ...input, dates: long.map((p) => p[0]), prices: long.map((p) => p[1]) } : input;
      cal = { at: Date.now(), v: calibrate(calInput, hz.key, { window: s.prices.length }) };
      calCache.set(key, cal);
    }

    const now = Date.now();
    const since = now - LOOKBACK[hz.key] * DAY;
    const history = s.dates.map((d, i) => [Date.parse(`${d}T12:00:00Z`), prices[i]] as [number, number]).filter(([t]) => t >= since);
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
        cone: coneFromRows(anchor, rows, hz.days, 40).map((p) => ({
          ...p,
          t: now + p.day * DAY,
        })),
        row,
        calibration: cal.v,
        annualVolPct: scenario.annualVolPct,
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
