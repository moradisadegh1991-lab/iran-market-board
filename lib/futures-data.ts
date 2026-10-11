// Server-side data for «ارزهای پیشنهادی» and «فیوچرز»: daily/hourly exchange candles, last prices and
// funding. Everything here is market data shared by every visitor; nothing about a user's account is
// stored (the account itself travels with each request and goes straight back — rule 13).
import { cachedSource } from '@/lib/sources/cache';
import { fetchDailyCandles, fetchHourlyCandles, type Candle } from '@/lib/sources/klines';
import { binanceFundingDaily, monthsBetween, okxFundingHistory, okxFundingNow } from '@/lib/sources/funding';
import { errMsg, fetchJson } from '@/lib/http';
import { isNum } from '@/lib/num';
import { pickCoins, PICK_UNIVERSE, type Picks } from '@/lib/engine/coin-pick';
import { BASE_FUNDING, LEVERAGES, maxLeverage, runFuturesTrend, type DailyBar, type FuturesMode } from '@/lib/engine/futures';
import { MAX_REPLAY_H, symbolsOf, type FuturesAccount, type SymData } from '@/lib/engine/futures-account';

const HOUR = 3_600_000;
const DAY = 86_400_000;

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** the calm-coin picks, recomputed at most every 6 hours (only the small result is cached) */
export async function coinPicks(): Promise<{ picks: Picks | null; stale: boolean; error?: string }> {
  const r = await cachedSource<Picks>('coinPicks', 6 * 3600, async () => {
    const inputs = await pool(PICK_UNIVERSE, 8, async (u) => {
      try {
        const c = await fetchDailyCandles(u.sym, 430);
        return { ...u, bars: c.map((k) => ({ t: k.t, c: k.c, v: k.v })) };
      } catch {
        return { ...u, bars: null };
      }
    });
    const ok = inputs.filter((x) => x.bars).length;
    if (ok < PICK_UNIVERSE.length / 2) throw new Error(`فقط ${ok} ارز داده داشت`);
    return pickCoins(inputs);
  }, 3 * 24 * 3600);
  return { picks: r.data, stale: r.status.stale, error: r.status.error };
}

/** last trade price per base symbol (Binance spot mirror, one request) */
export async function lastPrices(syms: string[]): Promise<Record<string, number>> {
  if (!syms.length) return {};
  const q = encodeURIComponent(JSON.stringify(syms.map((s) => `${s}USDT`)));
  const out: Record<string, number> = {};
  try {
    const rows = await fetchJson<{ symbol: string; price: string }[]>(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${q}`, { timeoutMs: 10_000, retries: 1 });
    for (const r of rows) if (isNum(+r.price) && +r.price > 0) out[r.symbol.replace(/USDT$/, '')] = +r.price;
  } catch {
    // one unknown symbol fails the whole batch: ask one by one
    await Promise.all(syms.map(async (s) => {
      try {
        const r = await fetchJson<{ price: string }>(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${s}USDT`, { timeoutMs: 8_000 });
        if (isNum(+r.price) && +r.price > 0) out[s] = +r.price;
      } catch {
        /* no price: the caller says so */
      }
    }));
  }
  return out;
}

const toDaily = (c: Candle[]): DailyBar[] => c.map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }));

async function dailyBars(sym: string, days: number): Promise<DailyBar[] | null> {
  const r = await cachedSource(`futD:${sym}:${days}`, 3 * 3600, () => fetchDailyCandles(sym, days), 2 * 24 * 3600).catch(() => null);
  return r?.data ? toDaily(r.data) : null;
}

/** Everything a tick needs for the account's symbols, from `lastTickAt` (at most MAX_REPLAY_H back) to now. */
export async function gatherFutures(a: FuturesAccount, extra: string[] = [], now = Date.now()): Promise<{ data: Record<string, SymData>; btcDaily: DailyBar[] | null; notes: string[] }> {
  const syms = [...new Set([...symbolsOf(a), ...extra])];
  const earliest = Math.min(a.lastTickAt, ...a.positions.map((p) => p.seenTo));
  const from = Math.max(earliest, now - MAX_REPLAY_H * HOUR);
  const hours = Math.max(2, Math.ceil((now - from) / HOUR) + 2);
  const notes: string[] = [];
  const needDaily = new Set(a.auto?.coins ?? []);
  const [prices, btcDaily] = await Promise.all([lastPrices(syms), a.auto ? dailyBars('BTC', 120) : Promise.resolve(null)]);
  const data: Record<string, SymData> = {};
  await Promise.all(syms.map(async (sym) => {
    let hourly: SymData['hourly'] = [];
    try {
      hourly = (await fetchHourlyCandles(sym, hours, now)).candles.map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c }));
    } catch (e) {
      notes.push(`کندل ${sym} نرسید (${errMsg(e).slice(0, 60)})؛ موقعیت‌های آن در این بررسی جلو نرفتند.`);
    }
    let funding: SymData['funding'] = null;
    let rate = BASE_FUNDING;
    try {
      funding = await okxFundingHistory(sym, from - 8 * HOUR);
      const nowRate = await okxFundingNow(sym);
      if (nowRate) rate = nowRate.rate;
    } catch {
      /* fall back below */
    }
    if (!funding) notes.push(`نرخ تأمین مالی ${sym} از صرافی نرسید؛ ${(BASE_FUNDING * 100).toFixed(2)}٪ هر ۸ ساعت فرض شد.`);
    const daily = needDaily.has(sym) ? (await dailyBars(sym, 120)) ?? [] : [];
    data[sym] = { hourly, daily, funding, rate, last: prices[sym] ?? null };
  }));
  return { data, btcDaily, notes };
}

export interface LevRow {
  lev: number;
  returnPct: number;
  cagrPct: number | null;
  maxDrawdownPct: number;
  liquidations: number;
  ruined: boolean;
  fundingPaid: number;
  feesPaid: number;
  trades: number;
}
export interface FuturesBacktest {
  sym: string;
  mode: FuturesMode;
  from: number;
  to: number;
  rows: LevRow[];
  /** equity curves (thinned) for a few leverages, per 1000 USDT */
  curves: Record<number, [number, number][]>;
  fundingDays: number;
  fundingAssumedDays: number;
}

/** the trend rider on the coin's perpetual at every leverage step, over the last ~1000 days */
export async function futuresBacktest(sym: string, mode: FuturesMode): Promise<FuturesBacktest> {
  const r = await cachedSource<FuturesBacktest>(`futBT:${sym}:${mode}`, 12 * 3600, async () => {
    // fetched directly: 1000 candles are too big to park in Redis (rule 82); only the small result is cached
    const [bars, btc] = await Promise.all([fetchDailyCandles(sym, 1000).then(toDaily), sym === 'BTC' ? Promise.resolve(null) : fetchDailyCandles('BTC', 1000).then(toDaily).catch(() => null)]);
    if (!bars || bars.length < 120) throw new Error(`تاریخچه روزانه ${sym} کافی نیست`);
    const from = bars[51].t;
    const to = bars[bars.length - 1].t;
    const funding = await binanceFundingDaily(sym, monthsBetween(from, to + DAY));
    const days = Math.round((to - from) / DAY) + 1;
    let have = 0;
    for (const b of bars) if (b.t >= from && funding.has(b.t)) have++;
    const rows: LevRow[] = [];
    const curves: FuturesBacktest['curves'] = {};
    for (const lev of LEVERAGES) {
      if (lev > maxLeverage(sym)) continue;
      const x = runFuturesTrend(bars, btc, { sym, lev, mode, capital: 1000, fundingByDay: funding });
      rows.push({ lev, returnPct: x.returnPct, cagrPct: x.cagrPct, maxDrawdownPct: x.maxDrawdownPct, liquidations: x.liquidations, ruined: x.ruined, fundingPaid: x.fundingPaid, feesPaid: x.feesPaid, trades: x.fills.length });
      if ([1, 3, 10].includes(lev)) {
        const step = Math.max(1, Math.floor(x.equity.length / 160));
        curves[lev] = x.equity.filter((_, i) => i % step === 0 || i === x.equity.length - 1).map((e) => [e.t, Math.round(e.v * 100) / 100]);
      }
    }
    return { sym, mode, from, to, rows, curves, fundingDays: have, fundingAssumedDays: Math.max(0, days - have) };
  }, 3 * 24 * 3600);
  if (!r.data) throw new Error(r.status.error ?? 'بک‌تست ممکن نشد');
  return r.data;
}
