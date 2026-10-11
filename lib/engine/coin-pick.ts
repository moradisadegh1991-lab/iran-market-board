// «ارزهای پیشنهادی» — which coins the trend rider should trade, chosen by a rule that was measured, not by
// last month's winners. scripts/eval/coin-pick-eval.ts ran the trend rider over 40 coins (including ones
// that collapsed — FTT, LUNA, EOS, AXS…) with six selection rules fixed in advance, choosing on 2018–2022
// and testing on 2023–2026 (rule 21). Ranking by recent winners (90-day momentum) and by "where the rider
// worked best last year" did not beat simply holding every liquid coin. The rule that did, in both periods:
// the CALMEST liquid coins — lowest 20-day volatility — top 3 (K picked on the design years).
// Why it can work: in a falling market the volatile alts fall furthest and whipsaw the 50-day filter most,
// and vol-targeted sizing gives them little weight anyway. It is a selection, not a forecast; in the 2021
// and 2023 bull runs the calm basket made LESS than the whole market.
// Pure: callers pass daily candles (close + traded value in USDT).
import { isNum } from '@/lib/num';

export interface PickBar { t: number; c: number; v: number }

/** the trend rider's 3 calmest liquid coins (K chosen on 2018–2022: 3 > 5 > 8 by Sharpe) */
export const PICK_K = 3;
/** a coin needs this much history before it can be judged (and the 50-day filter is long settled) */
export const PICK_MIN_DAYS = 400;
/** average daily traded value over 90 days, USDT; thinner coins cannot be traded at size */
export const PICK_MIN_VALUE = 5e6;

/** Coins the live picker looks at: Binance-listed, USDT pairs, no stablecoins. The evaluation universe
 *  minus the delisted ones (FTT, old LUNA). `id` is CoinGecko's, which the swing pages use. */
export const PICK_UNIVERSE: { sym: string; id: string; name: string }[] = [
  { sym: 'BTC', id: 'bitcoin', name: 'Bitcoin' }, { sym: 'ETH', id: 'ethereum', name: 'Ethereum' },
  { sym: 'BNB', id: 'binancecoin', name: 'BNB' }, { sym: 'SOL', id: 'solana', name: 'Solana' },
  { sym: 'XRP', id: 'ripple', name: 'XRP' }, { sym: 'DOGE', id: 'dogecoin', name: 'Dogecoin' },
  { sym: 'ADA', id: 'cardano', name: 'Cardano' }, { sym: 'TRX', id: 'tron', name: 'TRON' },
  { sym: 'LINK', id: 'chainlink', name: 'Chainlink' }, { sym: 'AVAX', id: 'avalanche-2', name: 'Avalanche' },
  { sym: 'DOT', id: 'polkadot', name: 'Polkadot' }, { sym: 'LTC', id: 'litecoin', name: 'Litecoin' },
  { sym: 'BCH', id: 'bitcoin-cash', name: 'Bitcoin Cash' }, { sym: 'XLM', id: 'stellar', name: 'Stellar' },
  { sym: 'ETC', id: 'ethereum-classic', name: 'Ethereum Classic' }, { sym: 'ATOM', id: 'cosmos', name: 'Cosmos' },
  { sym: 'NEAR', id: 'near', name: 'NEAR' }, { sym: 'UNI', id: 'uniswap', name: 'Uniswap' },
  { sym: 'FIL', id: 'filecoin', name: 'Filecoin' }, { sym: 'ICP', id: 'internet-computer', name: 'Internet Computer' },
  { sym: 'AAVE', id: 'aave', name: 'Aave' }, { sym: 'HBAR', id: 'hedera-hashgraph', name: 'Hedera' },
  { sym: 'APT', id: 'aptos', name: 'Aptos' }, { sym: 'ARB', id: 'arbitrum', name: 'Arbitrum' },
  { sym: 'OP', id: 'optimism', name: 'Optimism' }, { sym: 'SUI', id: 'sui', name: 'Sui' },
  { sym: 'INJ', id: 'injective-protocol', name: 'Injective' }, { sym: 'SHIB', id: 'shiba-inu', name: 'Shiba Inu' },
  { sym: 'PEPE', id: 'pepe', name: 'Pepe' }, { sym: 'TON', id: 'the-open-network', name: 'Toncoin' },
  { sym: 'EOS', id: 'eos', name: 'EOS' }, { sym: 'XTZ', id: 'tezos', name: 'Tezos' },
  { sym: 'THETA', id: 'theta-token', name: 'Theta' }, { sym: 'VET', id: 'vechain', name: 'VeChain' },
  { sym: 'ALGO', id: 'algorand', name: 'Algorand' }, { sym: 'SAND', id: 'the-sandbox', name: 'The Sandbox' },
  { sym: 'MANA', id: 'decentraland', name: 'Decentraland' }, { sym: 'AXS', id: 'axie-infinity', name: 'Axie Infinity' },
];

/** annualised volatility of the 20 daily returns ending at bar i (closes up to i only) */
export function vol20At(bars: PickBar[], i: number): number | null {
  if (i < 20) return null;
  const r: number[] = [];
  for (let j = i - 19; j <= i; j++) r.push(Math.log(bars[j].c / bars[j - 1].c));
  const m = r.reduce((a, b) => a + b, 0) / 20;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / 20) * Math.sqrt(365);
}
/** average daily traded value (USDT) over the n days ending at i */
export function valueAt(bars: PickBar[], i: number, n = 90): number | null {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += bars[k].v;
  return s / n;
}
/** close above its 50-day simple average (closes up to i) */
export function aboveSma(bars: PickBar[], i: number, n = 50): boolean | null {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += bars[k].c;
  return bars[i].c > s / n;
}

export interface PickRow {
  sym: string;
  id: string;
  name: string;
  eligible: boolean;
  /** why not, when not eligible */
  why?: string;
  vol20Pct: number | null;
  value90: number | null;
  days: number;
  /** close above its own 50-day average, and BTC above its own: the trend rider would hold it now */
  trendUp: boolean | null;
  holdNow: boolean;
  rank: number | null;
  picked: boolean;
}
export interface Picks {
  rows: PickRow[];
  picked: PickRow[];
  btcUp: boolean | null;
  /** last closed day the decision is based on */
  asOf: number | null;
}

/** Rank `inputs` as of their last closed day. Coins whose data failed are listed as not eligible. */
export function pickCoins(inputs: { sym: string; id: string; name: string; bars: PickBar[] | null }[], k = PICK_K): Picks {
  const btc = inputs.find((x) => x.sym === 'BTC')?.bars ?? null;
  const btcUp = btc && btc.length ? aboveSma(btc, btc.length - 1) : null;
  const rows: PickRow[] = inputs.map(({ sym, id, name, bars }) => {
    const base = { sym, id, name, vol20Pct: null, value90: null, days: bars?.length ?? 0, trendUp: null, holdNow: false, rank: null, picked: false };
    if (!bars || bars.length < 21) return { ...base, eligible: false, why: 'داده نرسید' };
    const i = bars.length - 1;
    const v = vol20At(bars, i);
    const val = valueAt(bars, i);
    const up = aboveSma(bars, i);
    const trendUp = up === null ? null : up && (sym === 'BTC' || btcUp === true);
    const row = { ...base, vol20Pct: isNum(v) ? v! * 100 : null, value90: val, trendUp, holdNow: trendUp === true };
    if (bars.length < PICK_MIN_DAYS) return { ...row, eligible: false, why: `تاریخچه کوتاه (${bars.length.toLocaleString('fa-IR')} روز)` };
    if (!val || val < PICK_MIN_VALUE) return { ...row, eligible: false, why: 'حجم معامله کم' };
    return { ...row, eligible: v !== null };
  });
  const ranked = rows.filter((r) => r.eligible).sort((a, b) => (a.vol20Pct ?? Infinity) - (b.vol20Pct ?? Infinity));
  ranked.forEach((r, n) => {
    r.rank = n + 1;
    r.picked = n < k;
  });
  const asOf = btc && btc.length ? (btc[btc.length - 1] as PickBar).t : null;
  return { rows: [...ranked, ...rows.filter((r) => !r.eligible)], picked: ranked.slice(0, k), btcUp, asOf };
}

/**
 * What the evaluation measured (scripts/eval/coin-pick-eval.ts, 40 coins, fee 0.4% per side, trend rider
 * with vol targeting inside each sleeve). Shown on the page next to the picks. Update together with the eval.
 */
export const PICK_EVIDENCE = {
  design: '۲۰۱۸–۲۰۲۲',
  test: '۲۰۲۳–۲۰۲۶',
  rows: [
    { label: 'همه ارزهای پرمعامله (معیار)', designCagr: 47, designDd: -32, testCagr: 20, testDd: -38 },
    { label: 'آرام‌ترین ۳ ارز (انتخاب این صفحه)', designCagr: 61, designDd: -35, testCagr: 39, testDd: -25 },
    { label: 'فقط بیت‌کوین و اتریوم', designCagr: 52, designDd: -48, testCagr: 39, testDd: -30 },
    { label: 'پرمعامله‌ترین ۳ ارز', designCagr: 44, designDd: -44, testCagr: 25, testDd: -38 },
    { label: 'برندگان ۹۰ روز اخیر (۳ تا)', designCagr: 43, designDd: -41, testCagr: 16, testDd: -49 },
    { label: 'بیشترین سود روندسوار در سال قبل (۳ تا)', designCagr: 45, designDd: -40, testCagr: 26, testDd: -44 },
    { label: 'همیشه در بازار، بی فیلتر روند', designCagr: 21, designDd: -67, testCagr: 13, testDd: -63 },
  ],
  years: 'سال‌به‌سال در برابر همه ارزها: ۵ سال بهتر (۲۰۱۹، ۲۰۲۰، ۲۰۲۴، ۲۰۲۵، ۲۰۲۶)، ۲ سال بدتر (۲۰۲۱ و ۲۰۲۳ — بازارهای پرشتاب) و ۲ سال تقریباً برابر.',
  rules: 'قاعده روند هم دوباره سنجیده شد (میانگین ۲۰ و ۱۰۰ روزه، مومنتوم ۳۰ و ۹۰ روزه، دانچیان ۲۰ و ۵۵ روزه): در سال‌های طراحی هیچ‌کدام از میانگین ۵۰ روزه فعلی بهتر نبود، پس عوض نشد.',
  caveat: 'نتیجه گذشته است، نه وعده سود. فهرست ۴۰ ارز امروز انتخاب شده (با ۱۰ ارزی که سقوط کردند یا کم‌رنگ شدند)؛ ارزهایی که پیش از ۲۰۲۰ کاملاً حذف شدند در آن نیستند، پس نتیجه کمی خوش‌بینانه است.',
};
