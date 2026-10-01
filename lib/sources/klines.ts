// Hourly OHLCV candles for crypto swing trading.
//
// CoinGecko (the old source) gives one price per hour: no high, no low, no volume. That made every
// stop "fire at the close that breaches it" and every breakout unconfirmable. Exchange candles fix
// both. Sources, in order:
//  • data-api.binance.vision — Binance's public market-data mirror. Unlike api.binance.com it is
//    not geo-blocked for US hosts (Vercel's default region), 1000 candles per request.
//  • OKX — 100 candles per request, also reachable from US hosts.
// Callers fall back to CoinGecko closes when neither lists the coin.
import { fetchJson } from '@/lib/http';
import { isNum } from '@/lib/num';

export interface Candle {
  t: number; // open time, ms
  o: number;
  h: number;
  l: number;
  c: number;
  /** traded value in USDT during the hour */
  v: number;
}

const HOUR = 3600_000;

function tidy(rows: Candle[]): Candle[] {
  const m = new Map<number, Candle>();
  for (const r of rows) if (isNum(r.t) && r.c > 0 && r.h >= r.l && r.h > 0 && r.l > 0) m.set(r.t, r);
  return [...m.values()].sort((a, b) => a.t - b.t);
}

async function binance(symbol: string, hours: number, now: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let end = now;
  const want = Math.ceil(hours);
  for (let page = 0; page < 12 && out.length < want; page++) {
    const limit = Math.min(1000, want - out.length);
    const rows = await fetchJson<unknown[][]>(
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}USDT&interval=1h&limit=${limit}&endTime=${end}`,
      { timeoutMs: 15_000, retries: 1 },
    );
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) out.push({ t: +r[0]!, o: +r[1]!, h: +r[2]!, l: +r[3]!, c: +r[4]!, v: +r[7]! });
    const first = +rows[0][0]!;
    if (rows.length < limit) break;
    end = first - 1;
  }
  return tidy(out);
}

async function okx(symbol: string, hours: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let after = '';
  const want = Math.ceil(hours);
  for (let page = 0; page < 40 && out.length < want; page++) {
    const j = await fetchJson<{ code: string; data: string[][] }>(
      `https://www.okx.com/api/v5/market/history-candles?instId=${symbol}-USDT&bar=1H&limit=100${after ? `&after=${after}` : ''}`,
      { timeoutMs: 15_000, retries: 1 },
    );
    if (j?.code !== '0' || !Array.isArray(j.data) || !j.data.length) break;
    for (const r of j.data) out.push({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[7] });
    after = j.data[j.data.length - 1][0]; // newest-first; page backwards
    if (j.data.length < 100) break;
  }
  return tidy(out);
}

/**
 * Up to `hours` closed hourly candles ending now, newest last. Throws when no exchange lists the
 * coin against USDT (stablecoins, tiny caps) — the caller then uses CoinGecko closes instead.
 */
export async function fetchHourlyCandles(symbol: string, hours: number, now = Date.now()): Promise<{ candles: Candle[]; via: 'binance' | 'okx' }> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!sym) throw new Error('نماد خالی است');
  // drop the still-forming hour: its high/low/volume are partial
  const closedBefore = Math.floor(now / HOUR) * HOUR;
  const errors: string[] = [];
  for (const [via, fn] of [
    ['binance', () => binance(sym, hours + 1, now)],
    ['okx', () => okx(sym, hours + 1)],
  ] as const) {
    try {
      const c = (await fn()).filter((x) => x.t < closedBefore);
      if (c.length >= Math.min(48, hours)) return { candles: c.slice(-Math.ceil(hours)), via };
      errors.push(`${via}: ${c.length} candles`);
    } catch (e) {
      errors.push(`${via}: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
    }
  }
  throw new Error(`کندل ساعتی ${sym} پیدا نشد (${errors.join(' | ')})`);
}

/**
 * Daily candles (up to 1000 days, one request) for the long-term regime filter. Only fully closed
 * days are returned — today's candle is still moving and must not decide anything.
 */
export async function fetchDailyCandles(symbol: string, days = 400, now = Date.now()): Promise<Candle[]> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  try {
    const rows = await fetchJson<unknown[][]>(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=${Math.min(1000, days + 1)}`, { timeoutMs: 15_000, retries: 1 });
    const c = tidy(rows.map((r) => ({ t: +r[0]!, o: +r[1]!, h: +r[2]!, l: +r[3]!, c: +r[4]!, v: +r[7]! }))).filter((x) => x.t < dayStart);
    if (c.length >= 60) return c;
  } catch {
    /* try OKX */
  }
  const j = await fetchJson<{ code: string; data: string[][] }>(`https://www.okx.com/api/v5/market/history-candles?instId=${sym}-USDT&bar=1Dutc&limit=100`, { timeoutMs: 15_000, retries: 1 });
  const c = tidy((j?.data ?? []).map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[7] }))).filter((x) => x.t < dayStart);
  if (c.length < 60) throw new Error(`کندل روزانه ${sym} کافی نیست`);
  return c;
}
