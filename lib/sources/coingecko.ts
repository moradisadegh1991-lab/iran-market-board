import { fetchJson } from '@/lib/http';

const BASE = 'https://api.coingecko.com/api/v3';
const headers = (): Record<string, string> =>
  process.env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } : {};

export interface CgCoin {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price: number;
  market_cap: number;
  market_cap_rank?: number;
  total_volume: number;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  sparkline_in_7d?: { price: (number | null)[] };
}

export const fetchCgMarkets = (category?: string, perPage = 250) =>
  fetchJson<CgCoin[]>(
    `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true&price_change_percentage=24h,7d,30d${
      category ? `&category=${category}` : ''
    }`,
    { headers: headers(), timeoutMs: 20_000 },
  );

/** Daily prices for ~1y: [[ms, price], ...] */
export async function fetchCgDaily(id: string, days = 365): Promise<[number, number][]> {
  const json = await fetchJson(`${BASE}/coins/${id}/market_chart?vs_currency=usd&days=${days}`, {
    headers: headers(),
    timeoutMs: 20_000,
  });
  if (!Array.isArray(json?.prices)) throw new Error(`market_chart ${id}: bad response`);
  return json.prices as [number, number][];
}

/** Intraday prices: days=1 → ~5-minute points, days=7 → hourly points */
export async function fetchCgRange(id: string, days: 1 | 7): Promise<[number, number][]> {
  const json = await fetchJson(`${BASE}/coins/${id}/market_chart?vs_currency=usd&days=${days}`, { headers: headers(), timeoutMs: 20_000 });
  if (!Array.isArray(json?.prices)) throw new Error(`market_chart ${id} ${days}d: bad response`);
  return json.prices as [number, number][];
}

/**
 * Hourly prices for the swing simulator. CoinGecko returns hourly granularity for 2–90 days
 * on the public/demo tier; asking for more silently downgrades to daily, so `days` is capped at 90.
 */
/**
 * 5-minute candles. CoinGecko only serves this granularity for a 1-day window, which
 * `fetchCgHourly` cannot request (it clamps to 2 days and therefore always returns hourly).
 * Short live sessions need this: two days of hourly data is only ~48 candles, far fewer
 * than the swing presets require.
 */
export async function fetchCgMinutely(id: string): Promise<[number, number][]> {
  const json = await fetchJson(`${BASE}/coins/${id}/market_chart?vs_currency=usd&days=1`, { headers: headers(), timeoutMs: 25_000 });
  if (!Array.isArray(json?.prices)) throw new Error(`market_chart ${id} 1d: bad response`);
  return json.prices as [number, number][];
}

export async function fetchCgHourly(id: string, days: number): Promise<[number, number][]> {
  const d = Math.max(2, Math.min(90, Math.round(days)));
  const json = await fetchJson(`${BASE}/coins/${id}/market_chart?vs_currency=usd&days=${d}`, { headers: headers(), timeoutMs: 25_000 });
  if (!Array.isArray(json?.prices)) throw new Error(`market_chart ${id} ${d}d: bad response`);
  return json.prices as [number, number][];
}

