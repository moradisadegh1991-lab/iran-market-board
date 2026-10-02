// Market data for the swing engine, shared by the backtest API, the auto-scan and live sessions.
//
// Engine v2 wants exchange candles (open/high/low/close/volume), ~23 days of indicator warm-up
// before the window it trades, the coin's own daily closes for the 50-day regime filter, and BTC
// (hourly + daily) as the market-regime reference for altcoins. Exchange candles come from Binance's
// public data mirror or OKX (lib/sources/klines.ts); when neither lists the coin, CoinGecko hourly
// closes are used and the result says so.
import { cachedSource } from '@/lib/sources/cache';
import { fetchCgHourly } from '@/lib/sources/coingecko';
import { fetchDailyCandles, fetchHourlyCandles, type Candle } from '@/lib/sources/klines';
import { V2_WARMUP_H } from '@/lib/engine/swing-v2';
import type { SwingBar, SwingEngine } from '@/lib/engine/swing';

const HOUR = 3_600_000;
/** with exchange candles the window can be longer than CoinGecko's 90-day hourly limit */
export const MAX_SWING_DAYS_V2 = 180;
export const MAX_SWING_DAYS_CG = 90;

export interface SwingData {
  bars: SwingBar[];
  daily: SwingBar[] | null;
  via: 'binance' | 'okx' | 'coingecko';
  /** first bar that may trade; earlier bars are indicator warm-up */
  tradeFrom: number;
  /** the window actually available (CoinGecko fallback caps it at 90 days) */
  days: number;
  stale: boolean;
}

const toBars = (c: Candle[]): SwingBar[] => c.map((k) => ({ t: k.t, p: k.c, o: k.o, h: k.h, l: k.l, v: k.v }));

async function candles(symbol: string, hours: number) {
  // a bucketed key, so visitors within the same half hour share one download
  const r = await cachedSource(`swingK:${symbol}:${hours}`, 30 * 60, () => fetchHourlyCandles(symbol, hours), 6 * 3600);
  if (!r.data) throw new Error(r.status.error ?? 'پاسخ خالی');
  return { ...r.data, stale: !!r.status.stale };
}

async function dailyCloses(symbol: string): Promise<SwingBar[] | null> {
  const r = await cachedSource(`swingD:${symbol}`, 6 * 3600, () => fetchDailyCandles(symbol, 200), 3 * 24 * 3600).catch(() => null);
  return r?.data ? r.data.map((k) => ({ t: k.t, p: k.c })) : null;
}

/** Hourly bars (+ daily closes) for one coin, `days` of tradable window plus warm-up for v2. */
/**
 * `anchor` (live sessions): the first bar is pinned to this time, so every tick replays the same
 * history plus the bars that arrived since. Without it the window slides by an hour each tick and
 * the slow averages — which still remember their first bar — could re-decide a past trade.
 */
export async function swingDataFor(coin: { id: string; symbol: string }, days: number, engine: SwingEngine, now = Date.now(), anchor?: number): Promise<SwingData> {
  const warm = engine === 'v2' ? V2_WARMUP_H : 0;
  const tradeFrom = Math.floor(now / HOUR) * HOUR - days * 24 * HOUR;
  const errors: string[] = [];
  try {
    const hours = anchor ? Math.ceil((now - anchor) / HOUR) + 1 : Math.min(MAX_SWING_DAYS_V2 * 24, days * 24) + warm;
    const { candles: c, via, stale } = await candles(coin.symbol, hours);
    const daily = engine === 'v2' ? await dailyCloses(coin.symbol) : null;
    const bars = toBars(anchor ? c.filter((k) => k.t >= anchor) : c);
    return { bars: engine === 'v1' ? bars.filter((b) => b.t >= tradeFrom) : bars, daily, via, tradeFrom, days, stale };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  // CoinGecko fallback: closes only, at most 90 days — warm-up comes out of the window
  const d = Math.min(MAX_SWING_DAYS_CG, days + Math.ceil(warm / 24));
  const r = await cachedSource(`swingBars:${coin.id}:${d}`, 30 * 60, () => fetchCgHourly(coin.id, d), 6 * 3600);
  if (!r.data) throw new Error(`تاریخچه ساعتی ${coin.symbol} در دسترس نیست (${[...errors, r.status.error ?? 'پاسخ خالی'].join(' | ')})`);
  const bars = r.data.map(([t, p]) => ({ t, p }));
  const first = bars[0]?.t ?? tradeFrom;
  const tf = Math.max(tradeFrom, first + warm * HOUR);
  return { bars: engine === 'v1' ? bars.filter((b) => b.t >= tf) : bars, daily: null, via: 'coingecko', tradeFrom: tf, days: Math.round((now - tf) / (24 * HOUR)), stale: !!r.status.stale };
}

/** BTC as the market-regime reference for altcoins (hourly + daily). Null on failure — v2 then judges each coin on its own trend. */
export async function marketContext(days: number, anchor?: number): Promise<{ market: SwingBar[] | null; marketDaily: SwingBar[] | null }> {
  try {
    const d = await swingDataFor({ id: 'bitcoin', symbol: 'BTC' }, days, 'v2', Date.now(), anchor);
    return { market: d.bars.map((b) => ({ t: b.t, p: b.p })), marketDaily: d.daily };
  } catch {
    return { market: null, marketDaily: null };
  }
}
