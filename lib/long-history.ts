// The longest daily history each source has — TGJU since 2011 (dollar, coins, gold, silver, ounce), Binance ~1000 days
// (BTC, ETH). Used to score the forecast (rule 59) and to price a purchase on its own day (/api/price-on). Cached
// 12 h per series (the source changes once a day). Tether's series is the dollar's (lib/series.ts).
import { cachedSource } from '@/lib/sources/cache';
import { fetchTgjuHistory, TGJU_SLUGS, type DatedPairs } from '@/lib/sources/history';
import { fetchDailyCandles } from '@/lib/sources/klines';

export const TGJU_LONG: Record<string, string> = {
  usd: TGJU_SLUGS.usd,
  usdt: TGJU_SLUGS.usd,
  coin: TGJU_SLUGS.coin,
  nim: TGJU_SLUGS.nim,
  rob: TGJU_SLUGS.rob,
  g18: TGJU_SLUGS.g18,
  ons: TGJU_SLUGS.ons,
  silver: TGJU_SLUGS.silver,
};
export const BINANCE_LONG: Record<string, string> = { btc: 'BTC', eth: 'ETH' };
/** rial for the TGJU rial series, dollars for the ounce and the coins */
export const LONG_UNIT: Record<string, 'rial' | 'usd'> = { usd: 'rial', usdt: 'rial', coin: 'rial', nim: 'rial', rob: 'rial', g18: 'rial', silver: 'rial', ons: 'usd', btc: 'usd', eth: 'usd' };

export async function longHistory(key: string): Promise<DatedPairs | null> {
  const slug = TGJU_LONG[key];
  if (slug) return (await cachedSource<DatedPairs>(`tgjuFull:${slug}`, 12 * 3600, () => fetchTgjuHistory(slug, true), 7 * 86_400)).data;
  const sym = BINANCE_LONG[key];
  if (sym)
    return (
      await cachedSource<DatedPairs>(`dailyFull:${sym}`, 12 * 3600, async () => (await fetchDailyCandles(sym, 999)).map((c) => [new Date(c.t).toISOString().slice(0, 10), c.c] as [string, number]), 7 * 86_400)
    ).data;
  return null;
}

/** The close on `date`, or on the last trading day before it — never after (rule 4). Null before the series starts. */
export function closeOnOrBefore(series: DatedPairs, date: string): { date: string; value: number } | null {
  let lo = 0;
  let hi = series.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= date) ((best = mid), (lo = mid + 1));
    else hi = mid - 1;
  }
  return best < 0 ? null : { date: series[best][0], value: series[best][1] };
}
