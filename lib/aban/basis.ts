// «مبنای قیمت: آبان‌تتر» — the bots priced as Abantether prices (rule 102). Pure; used on the device (to build it) and
// on the server (to check what the device sent).
//
// The API reference shows how Abantether makes a toman price: the coin's global USDT price × Abantether's own USDT
// price — the buy one for a buyer, the sell one for a seller (BTC 91,474.68 × 126,170 = 11,541,360,375.6, its
// price_buy to the rial; × 125,350 = its price_sell). On top comes the fee: 0.08% exchange + 0.3% Abantether =
// 0.38% (coin-info, coefficient 0.9962). So a bot that trades a coin against toman at Abantether pays, per side,
// the fee plus half the USDT spread, on the global price × the USDT mid. That is all the engines need: a USDT mid
// for the toman conversion and a cost per side; the global price history (Binance) stays what it was, because it
// is the same price Abantether uses.
import { parseCoinInfo, parseCoins, parseTicker, type TickerRow } from './parse';

export interface AbanBasis {
  /** when the prices were read (ms) */
  at: number;
  /** toman per USDT: the user buys at / sells at */
  usdtBuy: number;
  usdtSell: number;
  /** % per trade (exchange + Abantether fee) */
  feePct: number;
  /** toman, per coin (from the ticker), for the live quotes */
  coins: Record<string, { buy: number; sell: number }>;
}

/** the reference's numbers, used until the exchange is read: fee 0.38%, the USDT spread of its coin-list example */
export const ABAN_FEE_PCT = 0.38;
export const DOC_USDT = { buy: 126170, sell: 125350 };

/** half the gap between buy and sell, as a % of the mid */
export const halfSpreadPct = (buy: number, sell: number) => ((buy - sell) / (buy + sell)) * 100;
export const usdtMidToman = (b: Pick<AbanBasis, 'usdtBuy' | 'usdtSell'>) => (b.usdtBuy + b.usdtSell) / 2;
/** what one side of a coin↔toman trade costs at Abantether, % */
export const perSidePct = (b: Pick<AbanBasis, 'usdtBuy' | 'usdtSell' | 'feePct'>) => b.feePct + halfSpreadPct(b.usdtBuy, b.usdtSell);

/**
 * From the public ticker (and, when read, coin-info for the fee). The USDT price comes from the ticker's USDTIRT, or
 * from the coin list (GET /api/v2/manager/coins) when the ticker leaves it out. Null without a USDT price.
 */
export function basisFrom(tickerJson: unknown, at: number, coinInfoJson?: unknown, coinsJson?: unknown): AbanBasis | null {
  const rows: TickerRow[] = parseTicker(tickerJson).filter((r) => r.quote === 'IRT' && r.active && r.buy && r.sell && r.buy >= r.sell);
  const fromList = coinsJson ? parseCoins(coinsJson).find((c) => c.symbol === 'USDT' && c.buy && c.sell && c.buy >= c.sell) : undefined;
  const usdt = rows.find((r) => r.symbol === 'USDT') ?? (fromList ? { buy: fromList.buy, sell: fromList.sell } : undefined);
  if (!usdt) return null;
  const info = coinInfoJson ? parseCoinInfo(coinInfoJson) : null;
  const feePct = info && info.feePct > 0 && info.feePct < 2 ? info.feePct : ABAN_FEE_PCT;
  const coins: AbanBasis['coins'] = {};
  for (const r of rows) coins[r.symbol] = { buy: r.buy!, sell: r.sell! };
  return { at, usdtBuy: usdt.buy!, usdtSell: usdt.sell!, feePct, coins };
}

/**
 * What the server accepts from a device: positive, buy ≥ sell, a spread under 5%, a fee under 2%, at most 6 hours
 * old, and — when the board's own tether price is known — within 25% of it. Anything else is ignored (the session
 * then runs on the board's prices and says so). Coins outside the same checks are dropped one by one.
 */
export function validBasis(raw: unknown, now: number, boardUsdtToman?: number | null): AbanBasis | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const at = n(r.at), buy = n(r.usdtBuy), sell = n(r.usdtSell), fee = n(r.feePct);
  if (!(buy > 0 && sell > 0 && buy >= sell && halfSpreadPct(buy, sell) < 2.5)) return null;
  if (!(fee >= 0 && fee < 2)) return null;
  if (!(at > 0 && now - at <= 6 * 3_600_000 && at <= now + 60_000)) return null;
  const mid = (buy + sell) / 2;
  if (boardUsdtToman && boardUsdtToman > 0 && Math.abs(mid / boardUsdtToman - 1) > 0.25) return null;
  const coins: AbanBasis['coins'] = {};
  if (r.coins && typeof r.coins === 'object')
    for (const [k, v] of Object.entries(r.coins as Record<string, { buy?: unknown; sell?: unknown }>).slice(0, 500)) {
      const b = n(v?.buy), s = n(v?.sell);
      if (/^[A-Z0-9]{2,15}$/.test(k) && b > 0 && s > 0 && b >= s && halfSpreadPct(b, s) < 5) coins[k] = { buy: b, sell: s };
    }
  return { at, usdtBuy: buy, usdtSell: sell, feePct: fee, coins };
}

/** «تتر ۱۲۶٬۱۷۰ / ۱۲۵٬۳۵۰، کارمزد ۰٫۳۸٪» — what a page says about the basis it ran on */
export function basisNote(b: AbanBasis): string {
  const f = (x: number, d = 0) => x.toLocaleString('fa-IR', { maximumFractionDigits: d });
  return `قیمت آبان‌تتر: تتر خرید ${f(b.usdtBuy)} و فروش ${f(b.usdtSell)} تومان، کارمزد ${f(b.feePct, 2)}٪ — هزینه هر طرف معامله ارز با تومان حدود ${f(perSidePct(b), 2)}٪`;
}
