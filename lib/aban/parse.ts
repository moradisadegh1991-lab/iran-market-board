// آبان‌تتر — the pure half (rule 101): reading the exchange's answers, building an order, and turning balances into
// the book's assets.
//
// The API reference (docs.abantether.com) could not be opened from where this was written (the site refuses
// non-Iranian addresses); endpoints and fields come from the docs' search snippets and Abantether's own Python SDK
// (github.com/Abantether-com/abantether-python-sdk). So every reader here accepts the shapes an answer plausibly
// takes (wrapped in `data`/`result`/`results` or not, numbers as strings, a few field names) and the page always
// shows the raw answer too. Nothing here touches the network.
import type { Asset, MarketKey } from '@/lib/finance/model';

export type Side = 'buy' | 'sell';
export type Quote = 'IRT' | 'USDT';

export interface TickerRow {
  symbol: string;
  /** what the exchange buys at / sells at, in the quote; null when the answer did not say */
  buy: number | null;
  sell: number | null;
  quote: Quote | null;
}
export interface BalanceRow {
  symbol: string;
  balance: number;
  available: number | null;
  blocked: number | null;
}
export interface OrderRow {
  id: string;
  side: Side | null;
  base: string | null;
  quote: string | null;
  volume: number | null;
  price: number | null;
  status: string | null;
  type: string | null;
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
  return Number.isFinite(v) ? v : null;
}

/** the payload inside the usual wrappers */
export function unwrap(x: unknown): unknown {
  let cur = x;
  for (let i = 0; i < 3 && isObj(cur); i++) {
    const inner = cur.data ?? cur.result ?? cur.results ?? cur.items ?? cur.balances ?? cur.orders;
    if (inner === undefined) break;
    cur = inner;
  }
  return cur;
}

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : typeof x === 'number' ? String(x) : null);
const sym = (x: unknown): string | null => {
  const s = isObj(x) ? str(pick(x, ['symbol', 'code', 'name'])) : str(x);
  return s ? s.toUpperCase() : null;
};

const BUY = ['buy', 'buy_price', 'buyPrice', 'bid', 'price_buy', 'irt_buy', 'toman_buy', 'buy_irt'];
const SELL = ['sell', 'sell_price', 'sellPrice', 'ask', 'price_sell', 'irt_sell', 'toman_sell', 'sell_irt'];
const PRICE = ['price', 'last', 'last_price', 'irt_price', 'toman_price', 'usdt_price'];

function tickerOf(symbol: string, v: unknown): TickerRow | null {
  if (num(v) !== null) return { symbol, buy: num(v), sell: num(v), quote: null };
  if (!isObj(v)) return null;
  const p = num(pick(v, PRICE));
  const buy = num(pick(v, BUY)) ?? p;
  const sell = num(pick(v, SELL)) ?? p;
  if (buy === null && sell === null) {
    // { irt: {buy, sell}, usdt: {…} } — prefer toman
    for (const [q, k] of [['IRT', ['irt', 'IRT', 'toman', 'irr']], ['USDT', ['usdt', 'USDT']]] as [Quote, string[]][]) {
      const inner = pick(v, k);
      if (isObj(inner)) {
        const r = tickerOf(symbol, inner);
        if (r) return { ...r, quote: q };
      }
    }
    return null;
  }
  const q = str(pick(v, ['quote', 'quote_symbol', 'currency']));
  return { symbol, buy, sell, quote: q ? (/usdt/i.test(q) ? 'USDT' : /irt|irr|toman|تومان/i.test(q) ? 'IRT' : null) : null };
}

/** The OTC ticker: one row per coin, whatever the answer's shape (an array of rows, or an object keyed by symbol). */
export function parseTicker(json: unknown): TickerRow[] {
  const p = unwrap(json);
  const out: TickerRow[] = [];
  if (Array.isArray(p)) {
    for (const r of p) {
      if (!isObj(r)) continue;
      const s = sym(pick(r, ['symbol', 'coin', 'base_symbol', 'base', 'currency_symbol', 'name']));
      const t = s ? tickerOf(s, r) : null;
      if (t) out.push(t);
    }
  } else if (isObj(p)) {
    for (const [k, v] of Object.entries(p)) {
      const t = tickerOf(k.toUpperCase(), v);
      if (t) out.push(t);
    }
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Balances: the docs show [{symbol, balance, available, blocked, debit}]; an object keyed by symbol is read too. */
export function parseBalances(json: unknown): BalanceRow[] {
  const p = unwrap(json);
  const rows: BalanceRow[] = [];
  const add = (s: string | null, v: unknown) => {
    if (!s) return;
    if (num(v) !== null) return void rows.push({ symbol: s, balance: num(v)!, available: null, blocked: null });
    if (!isObj(v)) return;
    const balance = num(pick(v, ['balance', 'total', 'amount', 'value']));
    const available = num(pick(v, ['available', 'free', 'available_balance']));
    const blocked = num(pick(v, ['blocked', 'locked', 'frozen', 'in_order']));
    const b = balance ?? (available !== null ? available + (blocked ?? 0) : null);
    if (b !== null) rows.push({ symbol: s, balance: b, available, blocked });
  };
  if (Array.isArray(p)) for (const r of p) add(isObj(r) ? sym(pick(r, ['symbol', 'coin', 'currency', 'asset'])) : null, r);
  else if (isObj(p)) for (const [k, v] of Object.entries(p)) add(k.toUpperCase(), v);
  return rows.filter((r) => r.balance !== 0).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function parseOrders(json: unknown): OrderRow[] {
  const p = unwrap(json);
  const list = Array.isArray(p) ? p : [];
  return list.filter(isObj).map((o) => {
    const side = str(pick(o, ['side', 'type_side', 'order_side']));
    return {
      id: str(pick(o, ['id', 'order_id', 'uuid', 'track_id'])) ?? '',
      side: side && /buy|خرید/i.test(side) ? 'buy' : side && /sell|فروش/i.test(side) ? 'sell' : null,
      base: sym(pick(o, ['base_symbol', 'base', 'coin', 'symbol'])),
      quote: sym(pick(o, ['quote_symbol', 'quote', 'currency'])),
      volume: num(pick(o, ['volume', 'quantity', 'amount', 'base_amount'])),
      price: num(pick(o, ['price', 'coin_price', 'avg_price', 'average_price'])),
      status: str(pick(o, ['status', 'state'])),
      type: str(pick(o, ['order_type', 'type', 'kind'])),
      at: str(pick(o, ['created_at', 'created', 'date', 'time'])),
    };
  });
}

/** An order still open on the exchange (cancel makes sense) */
export const isOpenOrder = (o: OrderRow) => !o.status || /open|pending|new|active|waiting|partial|باز|در انتظار/i.test(o.status);

export interface OrderInput {
  kind: 'market' | 'limit';
  side: Side;
  base: string;
  quote: Quote;
  /** in the base coin */
  volume: number;
  /** limit only, in the quote */
  price?: number | null;
}

/** The request body (field names from the docs and the SDK); an error message when something is missing. */
export function orderBody(o: OrderInput): Record<string, string> | string {
  const base = o.base.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(base)) return 'کدام ارز؟';
  if (base === o.quote) return 'ارز و واحد معامله یکی‌اند.';
  if (!(o.volume > 0)) return 'مقدار را بنویسید.';
  if (o.kind === 'limit' && !(o.price && o.price > 0)) return 'قیمت سفارش محدود را بنویسید.';
  const body: Record<string, string> = { side: o.side, base_symbol: base, quote_symbol: o.quote, volume: trimNum(o.volume) };
  if (o.kind === 'limit') body.price = trimNum(o.price!);
  return body;
}
const trimNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''));

/**
 * What to check before sending: the value of the order in its quote, and warnings — never a block, the user
 * decides: more than the free balance, a limit price far from the market.
 */
export function orderChecks(o: OrderInput, ticker: TickerRow[], balances: BalanceRow[]): { value: number | null; marketPrice: number | null; warnings: string[] } {
  const t = ticker.find((x) => x.symbol === o.base.toUpperCase());
  // the exchange sells to a buyer at its sell price and buys from a seller at its buy price
  const marketPrice = t ? (o.side === 'buy' ? (t.sell ?? t.buy) : (t.buy ?? t.sell)) : null;
  const tickerInQuote = !t?.quote || t.quote === o.quote;
  const price = o.kind === 'limit' ? (o.price ?? null) : tickerInQuote ? marketPrice : null;
  const value = price !== null && o.volume > 0 ? price * o.volume : null;
  const warnings: string[] = [];
  const free = (s: string) => {
    const b = balances.find((x) => x.symbol === s);
    return b ? (b.available ?? b.balance) : null;
  };
  if (o.side === 'sell') {
    const f = free(o.base.toUpperCase());
    if (f !== null && o.volume > f) warnings.push(`موجودی آزاد ${o.base.toUpperCase()} شما ${f.toLocaleString('fa-IR')} است؛ این سفارش بیشتر از آن است.`);
  } else if (value !== null) {
    const f = free(o.quote);
    if (f !== null && value > f) warnings.push(`ارزش سفارش از موجودی آزاد ${o.quote === 'IRT' ? 'تومانی' : 'تتری'} شما بیشتر است.`);
  }
  if (o.kind === 'limit' && o.price && marketPrice && tickerInQuote) {
    const gap = (o.price - marketPrice) / marketPrice;
    if (Math.abs(gap) > 0.1) warnings.push(`قیمت سفارش ${Math.round(Math.abs(gap) * 100).toLocaleString('fa-IR')}٪ ${gap > 0 ? 'بالاتر' : 'پایین‌تر'} از قیمت فعلی صرافی است.`);
    if (o.side === 'buy' && gap > 0) warnings.push('قیمت خرید محدود بالاتر از قیمت فعلی است — احتمالاً همین حالا با قیمت بالاتر پر می‌شود.');
    if (o.side === 'sell' && gap < 0) warnings.push('قیمت فروش محدود پایین‌تر از قیمت فعلی است — احتمالاً همین حالا با قیمت پایین‌تر پر می‌شود.');
  }
  return { value, marketPrice, warnings };
}

/** coins the board already prices (the rest are kept as hand-valued assets) */
export const BOARD_KEY: Record<string, MarketKey> = { USDT: 'usdt', BTC: 'btc', ETH: 'eth' };
export const ABAN_TAG = 'آبان‌تتر';

/**
 * Exchange balances → the book's assets, one per coin, named «آبان‌تتر — …» so a later sync updates the same asset
 * instead of adding another. USDT/BTC/ETH become market assets the board prices; any other coin a hand-valued
 * asset at the exchange's own toman price (from the ticker; skipped when there is none). The toman wallet is cash,
 * not an asset — it is left to the user's accounts. Purchase cost is unknown here: profit shows «نامشخص» (rule 98).
 */
export function assetsFromBalances(existing: Asset[], balances: BalanceRow[], ticker: TickerRow[], newId: () => string): { upsert: Asset[]; skipped: string[] } {
  const upsert: Asset[] = [];
  const skipped: string[] = [];
  for (const b of balances) {
    if (b.balance <= 0 || ['IRT', 'IRR', 'TOMAN'].includes(b.symbol)) continue;
    const name = `${ABAN_TAG} — ${b.symbol}`;
    const prev = existing.find((a) => a.name === name);
    const key = BOARD_KEY[b.symbol];
    if (key) {
      upsert.push({ ...(prev ?? {}), id: prev?.id ?? newId(), name, kind: 'market', key, qty: b.balance, valueRial: undefined });
      continue;
    }
    const t = ticker.find((x) => x.symbol === b.symbol && (!x.quote || x.quote === 'IRT'));
    const p = t ? (t.buy ?? t.sell) : null; // what the exchange would pay for it now
    if (!p) {
      skipped.push(b.symbol);
      continue;
    }
    upsert.push({ ...(prev ?? {}), id: prev?.id ?? newId(), name, kind: 'manual', valueRial: Math.round(p * b.balance * 10), liquid: true, key: undefined, qty: undefined });
  }
  return { upsert, skipped };
}

/** باکس‌های سرمایه‌گذاری — no public API for them was found; the page records them by hand as assets */
export const BOX_KINDS = ['فیکس‌باکس', 'گلدباکس', 'سیلورباکس', 'کریپتوباکس', 'بورس‌باکس', 'دیفای‌باکس', 'پروباکس'];
