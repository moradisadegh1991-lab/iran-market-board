// آبان‌تتر — the pure half (rule 101): reading the exchange's answers, building an order, and turning balances into
// the book's assets. Shapes follow the API reference (docs.abantether.com); the readers still accept a missing
// wrapper or a number sent as a string, and the page always shows the raw answer too. Nothing here touches the network.
//
// Prices: «buy» is what the USER pays to buy, «sell» what the user gets selling (the ticker's buy_price is the higher
// one: XRPIRT 262,625 buy / 260,477 sell). IRT is toman.
import type { Asset, MarketKey } from '@/lib/finance/model';

export type Side = 'buy' | 'sell';
export type Quote = 'IRT' | 'USDT';

export interface TickerRow {
  symbol: string;
  quote: Quote;
  /** the user buys at / sells at, in the quote */
  buy: number | null;
  sell: number | null;
  active: boolean;
}
export interface CoinRow {
  symbol: string;
  name: string;
  persian: string | null;
  /** COIN, or FUND — the investment boxes (باکس‌ها) */
  type: string;
  /** toman */
  buy: number | null;
  sell: number | null;
  /** the global price in USDT the toman prices are built from */
  usdt: number | null;
  change24h: number | null;
  canBuy: boolean;
  canSell: boolean;
}
export interface CoinInfo {
  symbol: string;
  /** total cost of one trade, % (exchange + Aban fee) */
  feePct: number;
  minIrt: number | null;
  maxIrt: number | null;
  minUsdt: number | null;
  maxUsdt: number | null;
}
export interface BalanceRow {
  symbol: string;
  balance: number;
  available: number | null;
  blocked: number | null;
}
export interface OrderRow {
  id: string;
  code: string | null;
  side: Side | null;
  base: string | null;
  quote: string | null;
  type: string | null;
  status: string | null;
  /** what was ordered: a buy is set in the quote, a sell in the base (docs) */
  volBase: number | null;
  volQuote: number | null;
  filledBase: number | null;
  filledQuote: number | null;
  price: number | null;
  at: string | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** «1,234.5», «۱۲۳۴»، 1234 → number; anything else → null */
export function num(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  const s = x
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[,،\s]/g, '')
    .replace(/٫/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : null;
}

/** the payload inside `data` (and the docs' `markets` in the ticker) */
export function unwrap(x: unknown): unknown {
  let cur = x;
  for (let i = 0; i < 3 && isObj(cur); i++) {
    const inner = cur.data ?? cur.markets ?? cur.result ?? cur.results;
    if (inner === undefined) break;
    cur = inner;
  }
  return cur;
}

const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : typeof x === 'number' ? String(x) : null);
const up = (x: unknown) => str(x)?.toUpperCase() ?? null;

/**
 * The OTC ticker (GET /api/v1/manager/otc/ticker): {data:{markets:{XRPIRT:{symbol, buy_price, sell_price, active}}}}.
 * The market key says the quote (…IRT / …USDT).
 */
export function parseTicker(json: unknown): TickerRow[] {
  const p = unwrap(json);
  const rows: TickerRow[] = [];
  const add = (key: string, v: unknown) => {
    if (!isObj(v)) return;
    const k = key.toUpperCase();
    const quote: Quote = k.endsWith('USDT') && k !== 'USDT' ? 'USDT' : 'IRT';
    const symbol = up(v.symbol) ?? (k.endsWith(quote) ? k.slice(0, -quote.length) : k);
    const buy = num(v.buy_price ?? v.price_buy);
    const sell = num(v.sell_price ?? v.price_sell);
    if (!symbol || (buy === null && sell === null)) return;
    rows.push({ symbol, quote, buy, sell, active: v.active !== false });
  };
  if (isObj(p)) for (const [k, v] of Object.entries(p)) add(k, v);
  else if (Array.isArray(p)) for (const v of p) if (isObj(v)) add(String(v.symbol ?? ''), v);
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** GET /api/v2/manager/coins */
export function parseCoins(json: unknown): CoinRow[] {
  const p = unwrap(json);
  return (Array.isArray(p) ? p : [])
    .filter(isObj)
    .map((c) => ({
      symbol: up(c.symbol) ?? '',
      name: str(c.name) ?? '',
      persian: str(c.persian_name),
      type: up(c.coin_type) ?? 'COIN',
      buy: num(c.price_buy),
      sell: num(c.price_sell),
      usdt: num(c.tether_price),
      change24h: num(c.percent_change_24h),
      canBuy: c.is_buy_active !== false && c.is_active !== false,
      canSell: c.is_sell_active !== false && c.is_active !== false,
    }))
    .filter((c) => c.symbol);
}

/** GET /api/v1/feecalculator/coin-info: fees are percents (exchange_fee 0.08 + irt_fee 0.3); the coefficient 0.9962 says the same */
export function parseCoinInfo(json: unknown, quote: Quote = 'IRT'): CoinInfo | null {
  const p = unwrap(json);
  if (!isObj(p)) return null;
  const ex = num(p.exchange_fee);
  const own = num(quote === 'IRT' ? p.irt_fee : p.tether_fee);
  const coef = num((p[quote === 'IRT' ? 'irt' : 'usdt'] as { quantity?: { total?: unknown } } | undefined)?.quantity?.total);
  const feePct = ex !== null && own !== null ? ex + own : coef !== null ? (1 - coef) * 100 : 0.38;
  return {
    symbol: up(p.symbol) ?? '',
    feePct,
    minIrt: num(p.irt_min_trade),
    maxIrt: num(p.irt_max_trade),
    minUsdt: num(p.usdt_min_trade),
    maxUsdt: num(p.usdt_max_trade),
  };
}

/** GET /api/v1/accounting/balances: [{symbol, balance, available, blocked, debit, banned}]; zero balances dropped */
export function parseBalances(json: unknown): BalanceRow[] {
  const p = unwrap(json);
  const rows: BalanceRow[] = [];
  const add = (s: string | null, v: unknown) => {
    if (!s || !isObj(v)) return;
    const balance = num(v.balance);
    const available = num(v.available);
    const blocked = num(v.blocked);
    const b = balance ?? (available !== null ? available + (blocked ?? 0) : null);
    if (b !== null && b !== 0) rows.push({ symbol: s, balance: b, available, blocked });
  };
  if (Array.isArray(p)) for (const r of p) add(isObj(r) ? (up(r.symbol) ?? up((r.asset as { symbol?: unknown } | undefined)?.symbol)) : null, r);
  else if (isObj(p)) for (const [k, v] of Object.entries(p)) add(k.toUpperCase(), v);
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

const vol = (v: unknown, k: 'base' | 'quote') => (isObj(v) ? num(v[k]) : null);

/** GET /api/v1/order_handler/orders/otc (and one order: the same fields under `data`) */
export function parseOrders(json: unknown): OrderRow[] {
  const p = unwrap(json);
  const list = Array.isArray(p) ? p : isObj(p) ? [p] : [];
  return list.filter(isObj).map((o) => {
    const side = str(o.side);
    return {
      id: str(o.id) ?? '',
      code: str(o.code),
      side: side === 'buy' || side === 'sell' ? side : null,
      base: up(o.base_symbol),
      quote: up(o.quote_symbol),
      type: str(o.type),
      status: str(o.status),
      volBase: vol(o.volume, 'base'),
      volQuote: vol(o.volume, 'quote'),
      filledBase: vol(o.filled_volume, 'base'),
      filledQuote: vol(o.filled_volume, 'quote'),
      price: num(o.price),
      at: str(o.created_at),
    };
  });
}

/** the docs' order states, in Persian; anything else is shown as sent */
export const STATUS_FA: Record<string, string> = {
  new: 'ثبت شد',
  processing: 'در حال انجام',
  fee_calculated: 'در حال انجام',
  accounting_blocked: 'در حال انجام',
  open: 'باز',
  filled: 'انجام شد',
  filled_and_unblock_requested: 'انجام شد',
  filled_and_unblock_failed: 'انجام شد',
  canceled: 'لغو شد',
  canceled_and_unblock_requested: 'لغو شد',
  rejected: 'رد شد',
  failed: 'ناموفق',
  failed_and_unblock_requested: 'ناموفق',
  failed_and_unblock_failed: 'ناموفق',
};
const OPEN = new Set(['new', 'processing', 'fee_calculated', 'accounting_blocked', 'open']);
/** an order that can still be cancelled */
export const isOpenOrder = (o: Pick<OrderRow, 'status'>) => !!o.status && OPEN.has(o.status);

export interface OrderInput {
  kind: 'market' | 'limit';
  side: Side;
  base: string;
  quote: Quote;
  /** a BUY: how much of the quote to spend (toman or tether); a SELL: how much of the coin (docs: «volume») */
  volume: number;
  /** limit only, per coin, in the quote */
  price?: number | null;
  /** which wallet (docs: spot, credit, collateral, investment) */
  account?: 'spot' | 'credit' | 'collateral' | 'investment';
}

/**
 * A symbol the exchange can mean: letters and digits, and «_» inside — the boxes are AST_FIXBOX, AST_USDTBOX…
 * (the first version allowed no «_», so a box could never be traded: «کدام ارز؟»).
 */
export const isAbanSymbol = (s: string) => /^[A-Z0-9](?:[A-Z0-9_]{0,30}[A-Z0-9])?$/.test(s) && s.length >= 2;

/** The request body; an error message when something is missing. */
export function orderBody(o: OrderInput): Record<string, string> | string {
  const base = o.base.trim().toUpperCase();
  if (!isAbanSymbol(base)) return 'کدام ارز؟';
  if (base === o.quote) return 'ارز و واحد معامله یکی‌اند.';
  if (!(o.volume > 0)) return o.side === 'buy' ? `چقدر ${o.quote === 'IRT' ? 'تومان' : 'تتر'} خرج شود؟` : 'چه مقدار بفروشید؟';
  if (o.kind === 'limit' && !(o.price && o.price > 0)) return 'قیمت سفارش محدود را بنویسید.';
  const body: Record<string, string> = { side: o.side, base_symbol: base, quote_symbol: o.quote, volume: trimNum(o.volume) };
  if (o.kind === 'limit') body.price = trimNum(o.price!);
  if (o.account && o.account !== 'spot') body.account_type = o.account;
  return body;
}
const trimNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''));

/**
 * What to check before sending — warnings, never a block; the user decides: the coin the order buys (or the quote it
 * brings), the exchange's min/max, more than the free balance, a limit price far from the market.
 */
export function orderChecks(o: OrderInput, ticker: TickerRow[], balances: BalanceRow[], info?: CoinInfo | null): { price: number | null; coinQty: number | null; quoteValue: number | null; feePct: number; warnings: string[] } {
  const t = ticker.find((x) => x.symbol === o.base.toUpperCase() && x.quote === o.quote);
  const market = t ? (o.side === 'buy' ? t.buy : t.sell) : null;
  const price = o.kind === 'limit' ? (o.price ?? null) : market;
  const feePct = info?.feePct ?? 0.38;
  const keep = 1 - feePct / 100;
  let coinQty: number | null = null;
  let quoteValue: number | null = null;
  if (o.volume > 0 && price) {
    if (o.side === 'buy') {
      quoteValue = o.volume;
      coinQty = (o.volume / price) * keep;
    } else {
      coinQty = o.volume;
      quoteValue = o.volume * price * keep;
    }
  }
  const warnings: string[] = [];
  const free = (s: string) => {
    const b = balances.find((x) => x.symbol === s);
    return b ? (b.available ?? b.balance) : null;
  };
  const qFa = o.quote === 'IRT' ? 'تومان' : 'تتر';
  if (o.side === 'buy') {
    const f = free(o.quote === 'IRT' ? 'IRT' : 'USDT');
    if (f !== null && o.volume > f) warnings.push(`موجودی آزاد ${qFa} شما ${f.toLocaleString('fa-IR')} است؛ این سفارش بیشتر از آن است.`);
  } else {
    const f = free(o.base.toUpperCase());
    if (f !== null && o.volume > f) warnings.push(`موجودی آزاد ${o.base.toUpperCase()} شما ${f.toLocaleString('fa-IR')} است؛ این سفارش بیشتر از آن است.`);
  }
  const tradeValue = o.side === 'buy' ? o.volume : quoteValue;
  const min = o.quote === 'IRT' ? info?.minIrt : info?.minUsdt;
  const max = o.quote === 'IRT' ? info?.maxIrt : info?.maxUsdt;
  if (tradeValue !== null && tradeValue > 0 && min && tradeValue < min) warnings.push(`کمتر از حداقل معامله صرافی (${min.toLocaleString('fa-IR')} ${qFa}) است؛ احتمالاً رد می‌شود.`);
  if (tradeValue !== null && max && tradeValue > max) warnings.push(`بیشتر از حداکثر معامله صرافی (${max.toLocaleString('fa-IR')} ${qFa}) است.`);
  if (t && !t.active) warnings.push('صرافی این بازار را فعلاً غیرفعال اعلام کرده است.');
  if (o.kind === 'limit' && o.price && market) {
    const gap = (o.price - market) / market;
    if (Math.abs(gap) > 0.1) warnings.push(`قیمت سفارش ${Math.round(Math.abs(gap) * 100).toLocaleString('fa-IR')}٪ ${gap > 0 ? 'بالاتر' : 'پایین‌تر'} از قیمت فعلی صرافی است.`);
    if (o.side === 'buy' && gap > 0) warnings.push('قیمت خرید محدود بالاتر از قیمت فعلی است — احتمالاً همین حالا با قیمت بالاتر پر می‌شود.');
    if (o.side === 'sell' && gap < 0) warnings.push('قیمت فروش محدود پایین‌تر از قیمت فعلی است — احتمالاً همین حالا با قیمت پایین‌تر پر می‌شود.');
  }
  return { price, coinQty, quoteValue, feePct, warnings };
}

/** coins the board already prices (the rest are kept as hand-valued assets) */
export const BOARD_KEY: Record<string, MarketKey> = { USDT: 'usdt', BTC: 'btc', ETH: 'eth' };
export const ABAN_TAG = 'آبان‌تتر';

/** the toman wallet's symbol at the exchange (IRT = toman, as every price on Abantether) */
export const isTomanSymbol = (s: string) => ['IRT', 'IRR', 'TOMAN'].includes(s);

/**
 * Each wallet row with what it is worth in toman now — the toman balance as is, a coin at what the exchange would pay for
 * it (its sell price, from the ticker or the coin list) — and the wallet's total. A coin with no toman price is named,
 * not counted as 0 (rule 18).
 */
export function walletValues(balances: BalanceRow[], ticker: TickerRow[], coins: CoinRow[] = []): { rows: (BalanceRow & { toman: number | null; unitToman: number | null })[]; totalToman: number; unpriced: string[] } {
  const rows = balances.map((b) => {
    if (isTomanSymbol(b.symbol)) return { ...b, toman: b.balance, unitToman: 1 };
    const t = ticker.find((x) => x.symbol === b.symbol && x.quote === 'IRT');
    const p = t?.sell ?? coins.find((c) => c.symbol === b.symbol)?.sell ?? null;
    return { ...b, toman: p ? p * b.balance : null, unitToman: p };
  });
  return {
    rows,
    totalToman: rows.reduce((s, r) => s + (r.toman ?? 0), 0),
    unpriced: rows.filter((r) => r.toman === null).map((r) => r.symbol),
  };
}

/** a coin amount for reading: whole tomans, a few decimals for big amounts, up to 8 for small ones; never «۱۲۳٫۴۵۶۷۸۹۰۱» noise */
export function coinDigits(n: number): number {
  const a = Math.abs(n);
  return a >= 1000 ? 2 : a >= 1 ? 4 : 8;
}

/**
 * Exchange balances → the book's assets, one per coin, named «آبان‌تتر — …» so a later sync updates the same asset
 * instead of adding another. USDT/BTC/ETH become market assets the board prices; any other coin (and the boxes) a
 * hand-valued asset at what the exchange would pay for it now (its sell price, from the ticker or the coin list;
 * skipped when there is none). The toman wallet is cash, not an asset — it is left to the user's accounts. Purchase
 * cost is unknown here: profit shows «نامشخص» (rule 98).
 */
export function assetsFromBalances(existing: Asset[], balances: BalanceRow[], ticker: TickerRow[], newId: () => string, coins: CoinRow[] = []): { upsert: Asset[]; skipped: string[] } {
  const upsert: Asset[] = [];
  const skipped: string[] = [];
  for (const b of balances) {
    if (b.balance <= 0 || isTomanSymbol(b.symbol)) continue;
    const name = `${ABAN_TAG} — ${b.symbol}`;
    const prev = existing.find((a) => a.name === name);
    const key = BOARD_KEY[b.symbol];
    if (key) {
      upsert.push({ ...(prev ?? {}), id: prev?.id ?? newId(), name, kind: 'market', key, qty: b.balance, valueRial: undefined });
      continue;
    }
    const t = ticker.find((x) => x.symbol === b.symbol && x.quote === 'IRT');
    const p = t?.sell ?? coins.find((c) => c.symbol === b.symbol)?.sell ?? null;
    if (!p) {
      skipped.push(b.symbol);
      continue;
    }
    upsert.push({ ...(prev ?? {}), id: prev?.id ?? newId(), name, kind: 'manual', valueRial: Math.round(p * b.balance * 10), liquid: true, key: undefined, qty: undefined });
  }
  return { upsert, skipped };
}
