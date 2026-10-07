// How an asset did since it was bought (rule 83): in toman, against the dollar (what the same money in dollars would
// be worth now) and against inflation (what it buys now). Pure: the dollar on the purchase day comes from
// /api/price-on and is kept on the asset (Asset.usdRialAtBuy) — a fact about the past that never changes.
import { inflationBetween, type InflationSpan } from './inflation';
import type { Asset, Iso } from './model';

export interface AssetPerf {
  id: string;
  name: string;
  boughtOn: Iso;
  years: number;
  costRial: number;
  valueRial: number;
  /** toman growth, percent; per year once held three months or more */
  growthPct: number;
  annualPct: number | null;
  /** the dollar then and now (rial), and the asset priced in dollars then and now */
  usdThenRial: number | null;
  usdNowRial: number | null;
  costUsd: number | null;
  valueUsd: number | null;
  /** growth in dollars (did it beat holding dollars?) and the dollar's own move */
  usdGrowthPct: number | null;
  dollarMovePct: number | null;
  inflation: InflationSpan | null;
  /** growth after inflation: what the money buys now against then */
  realPct: number | null;
  /** «beat»: real gain over 2%; «kept»: within ±2%; «lost»: real loss over 2% */
  vsInflation: 'beat' | 'kept' | 'lost' | null;
  vsDollar: 'beat' | 'kept' | 'lost' | null;
}

const DAY = 86_400_000;
const verdict = (pct: number | null) => (pct == null ? null : pct > 2 ? 'beat' : pct < -2 ? 'lost' : 'kept');

export function assetPerformance(a: Asset, valueRial: number | null, usdNowRial: number | null, today: Iso, assumedInflationPct: number): AssetPerf | null {
  if (!a.boughtOn || !a.costRial || a.costRial <= 0 || valueRial == null || valueRial <= 0 || a.boughtOn > today) return null;
  const years = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${a.boughtOn}T00:00:00Z`)) / (365.25 * DAY);
  const growth = valueRial / a.costRial;
  const usdThen = a.usdRialAtBuy && a.usdRialAtBuy > 0 ? a.usdRialAtBuy : null;
  const usdNow = usdNowRial && usdNowRial > 0 ? usdNowRial : null;
  const costUsd = usdThen ? a.costRial / usdThen : null;
  const valueUsd = usdNow ? valueRial / usdNow : null;
  const usdGrowthPct = costUsd && valueUsd ? (valueUsd / costUsd - 1) * 100 : null;
  const inflation = inflationBetween(a.boughtOn, today, assumedInflationPct);
  const realPct = inflation ? (growth / (1 + inflation.pct / 100) - 1) * 100 : null;
  return {
    id: a.id,
    name: a.name,
    boughtOn: a.boughtOn,
    years,
    costRial: a.costRial,
    valueRial,
    growthPct: (growth - 1) * 100,
    annualPct: years >= 0.25 ? (Math.pow(growth, 1 / years) - 1) * 100 : null,
    usdThenRial: usdThen,
    usdNowRial: usdNow,
    costUsd,
    valueUsd,
    usdGrowthPct,
    dollarMovePct: usdThen && usdNow ? (usdNow / usdThen - 1) * 100 : null,
    inflation,
    realPct,
    vsInflation: verdict(realPct),
    vsDollar: verdict(usdGrowthPct),
  };
}

/** All dated assets together: cost then, value now, both in dollars of their own day, and inflation weighted by cost. */
export function portfolioPerformance(rows: AssetPerf[]) {
  if (!rows.length) return null;
  const cost = rows.reduce((s, r) => s + r.costRial, 0);
  const value = rows.reduce((s, r) => s + r.valueRial, 0);
  const withUsd = rows.filter((r) => r.costUsd != null && r.valueUsd != null);
  const withInf = rows.filter((r) => r.inflation);
  // cost in today's money: each purchase grown by inflation since its own day
  const costToday = withInf.reduce((s, r) => s + r.costRial * (1 + r.inflation!.pct / 100), 0);
  const valueInf = withInf.reduce((s, r) => s + r.valueRial, 0);
  const costUsd = withUsd.reduce((s, r) => s + r.costUsd!, 0);
  const valueUsd = withUsd.reduce((s, r) => s + r.valueUsd!, 0);
  return {
    count: rows.length,
    costRial: cost,
    valueRial: value,
    growthPct: (value / cost - 1) * 100,
    costUsd: withUsd.length ? costUsd : null,
    valueUsd: withUsd.length ? valueUsd : null,
    usdGrowthPct: withUsd.length && costUsd > 0 ? (valueUsd / costUsd - 1) * 100 : null,
    realPct: withInf.length && costToday > 0 ? (valueInf / costToday - 1) * 100 : null,
    partial: withUsd.length < rows.length || withInf.length < rows.length,
  };
}
