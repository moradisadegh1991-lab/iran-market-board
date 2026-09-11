// Weekly momentum/attention screen for coins & meme coins (CoinGecko markets + 7d hourly sparkline)
import { clamp, fmtPct, isNum } from '@/lib/num';
import type { CgCoin } from '@/lib/sources/coingecko';
import type { CryptoRow } from '@/lib/types';
import { linreg, logReturns, normCdf, pctRank, std } from './stats';

const STABLE = new Set(
  'usdt usdc dai fdusd tusd usde usds pyusd usdd frax gusd busd eurc eurs usdp lusd crvusd gho susd usd0 usdx rlusd usdb usdtb bfusd xaut paxg'.split(' '),
);
const DERIVATIVE_NAME = /wrapped|staked|bridged|restaked|liquid|\bwormhole\b|binance-peg|\bpeg\b/i;

interface Feat {
  c: CgCoin;
  m24: number | null;
  m7: number | null;
  m30: number | null;
  turnover: number;
  trend: number;
  r2: number;
  nearHigh: number;
  weeklyVol: number | null;
  spark: number[];
}

function features(c: CgCoin): Feat | null {
  const raw = (c.sparkline_in_7d?.price ?? []).filter((x): x is number => isNum(x) && x > 0);
  if (!isNum(c.current_price) || !isNum(c.market_cap) || c.market_cap <= 0) return null;
  const logs = raw.map(Math.log);
  const { slope, r2 } = linreg(logs);
  const hourly = logReturns(raw);
  const weeklyVol = hourly.length > 24 ? std(hourly) * Math.sqrt(168) : null;
  const hi = raw.length ? Math.max(...raw) : c.current_price;
  const step = Math.max(1, Math.floor(raw.length / 28));
  return {
    c,
    m24: c.price_change_percentage_24h_in_currency ?? null,
    m7: c.price_change_percentage_7d_in_currency ?? null,
    m30: c.price_change_percentage_30d_in_currency ?? null,
    turnover: c.total_volume / c.market_cap,
    trend: slope * raw.length * r2, // weekly log-drift weighted by linearity
    r2,
    nearHigh: hi > 0 ? c.current_price / hi : 1,
    weeklyVol,
    spark: raw.filter((_, i) => i % step === 0).map((x) => Number(x.toPrecision(5))),
  };
}

function isExcluded(c: CgCoin): boolean {
  const sym = c.symbol.toLowerCase();
  if (STABLE.has(sym) || DERIVATIVE_NAME.test(c.name)) return true;
  const m30 = c.price_change_percentage_30d_in_currency;
  if (c.current_price > 0.97 && c.current_price < 1.03 && isNum(m30) && Math.abs(m30) < 1.5) return true;
  return false;
}

function rank(feats: Feat[], meme: boolean, tradable: Set<string> | null, take = 25): CryptoRow[] {
  if (!feats.length) return [];
  const R = (f: (x: Feat) => number | null) => pctRank(feats.map((x) => f(x) ?? NaN));
  const rTrend = R((x) => x.trend), rM7 = R((x) => x.m7), rM30 = R((x) => x.m30);
  const rTurn = R((x) => x.turnover), rHigh = R((x) => x.nearHigh), rCalm = R((x) => (x.weeklyVol === null ? null : -x.weeklyVol));
  const w = meme
    ? { trend: 0.22, m7: 0.2, m30: 0.08, turn: 0.3, high: 0.12, calm: 0.08 }
    : { trend: 0.25, m7: 0.2, m30: 0.15, turn: 0.2, high: 0.1, calm: 0.1 };
  const k = meme ? 0.2 : 0.1;

  return feats
    .map((f, i) => {
      let s = w.trend * rTrend[i] + w.m7 * rM7[i] + w.m30 * rM30[i] + w.turn * rTurn[i] + w.high * rHigh[i] + w.calm * rCalm[i];
      const reasons: string[] = [];
      if (isNum(f.m24) && f.m24 > (meme ? 35 : 20)) {
        s -= 0.15;
        reasons.push(`جهش ${fmtPct(f.m24, 0)} در ۲۴ ساعت؛ خطر ورود دیرهنگام`);
      }
      if (isNum(f.m7) && f.m7 > (meme ? 120 : 60)) s -= 0.1;
      if (f.m7 !== null && rM7[i] > 0.7) reasons.unshift(`مومنتوم ۷ روزه ${fmtPct(f.m7, 0)}`);
      if (rTurn[i] > 0.7) reasons.push(`گردش معاملات ${fmtPct(f.turnover * 100, 0, false)} ارزش بازار`);
      if (f.r2 > 0.6 && f.trend > 0) reasons.push('روند ۷ روزه منظم و صعودی');
      if (f.nearHigh > 0.97) reasons.push('نزدیک سقف ۷ روزه');
      if (!reasons.length) reasons.push('امتیاز ترکیبی متوازن');
      const riskWeek = f.weeklyVol ? Math.round(clamp((normCdf(Math.log(1 - k) / f.weeklyVol) / 0.5) * 100, 0, 100)) : null;
      return {
        rank: 0,
        id: f.c.id,
        symbol: f.c.symbol.toUpperCase(),
        name: f.c.name,
        image: f.c.image,
        price: f.c.current_price,
        mcap: f.c.market_cap,
        m24: f.m24,
        m7: f.m7,
        m30: f.m30,
        turnoverPct: f.turnover * 100,
        weeklyVolPct: f.weeklyVol === null ? null : f.weeklyVol * 100,
        score: Math.round(clamp(s, 0, 1) * 100),
        riskWeek,
        reasons: reasons.slice(0, 3),
        spark: f.spark,
        onNobitex: tradable ? tradable.has(f.c.symbol.toLowerCase()) : null,
      } satisfies CryptoRow;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** keep the largest market-cap entry per ticker (bridged copies / clones share symbols) */
function uniqBySymbol(list: CgCoin[]): CgCoin[] {
  const best = new Map<string, CgCoin>();
  for (const c of list) {
    const k = c.symbol.toLowerCase();
    const cur = best.get(k);
    if (!cur || (c.market_cap ?? 0) > (cur.market_cap ?? 0)) best.set(k, c);
  }
  return [...best.values()];
}

export function screenCrypto(markets: CgCoin[] | null, memes: CgCoin[] | null, tradable: Set<string> | null) {
  const memeIds = new Set((memes ?? []).map((m) => m.id));
  const memeSyms = new Set((memes ?? []).map((m) => m.symbol.toLowerCase()));
  const coins = uniqBySymbol(markets ?? [])
    .filter((c) => !memeIds.has(c.id) && !memeSyms.has(c.symbol.toLowerCase()) && !isExcluded(c) && c.market_cap >= 300e6 && c.total_volume >= 20e6)
    .map(features)
    .filter((x): x is Feat => !!x);
  const memeFeats = uniqBySymbol(memes ?? [])
    .filter((c) => !isExcluded(c) && c.market_cap >= 20e6 && c.total_volume >= 2e6)
    .map(features)
    .filter((x): x is Feat => !!x);
  return { coins: rank(coins, false, tradable), memes: rank(memeFeats, true, tradable) };
}

/** candidate symbols to check on Nobitex before final ranking (cheap superset) */
export function candidateSymbols(markets: CgCoin[] | null, memes: CgCoin[] | null): string[] {
  return [...(markets ?? []).slice(0, 60), ...(memes ?? []).slice(0, 30)].map((c) => c.symbol);
}
