// فیوچرز (قرارداد دائمی) — paper perpetual futures with the mechanics an exchange applies, so a leveraged
// result here is what the same trades would have done there, not a multiplied spot return.
//
//  • isolated margin: each position has its own margin; losing it ends that position, nothing else
//  • liquidation when margin + unrealised P&L falls to the maintenance margin (MMR × notional at mark),
//    checked against the bar's worst price (low for a long, high for a short), before stops and targets
//    in the same bar — a wick through the liquidation price liquidates even if the bar closes higher
//  • funding every 8 hours (00/08/16 UTC) on the notional: longs pay a positive rate, shorts receive it;
//    taken from the position's margin, so it moves the liquidation price, as on Binance/OKX isolated
//  • taker fee on the notional at open and at close
// Prices are USDT. Pure: callers supply bars and funding rates. Liquidation price = Binance's
// one-way isolated formula with tier-1 maintenance margin (no cumulative amount), see liqPrice.
import { isNum } from '@/lib/num';

export type Side = 'long' | 'short';
export const sideSign = (s: Side) => (s === 'long' ? 1 : -1);

/** the leverage steps exchanges offer in their slider (Binance, OKX, Bybit; Iranian exchanges up to 10–20×) */
export const LEVERAGES = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125] as const;
/** VIP-0 taker fee on Binance USDⓈ-M (OKX 0.05%, Bybit 0.055%); Iranian exchanges' futures are higher */
export const TAKER_FEE = 0.0005;
/** the default 8-hour funding rate when the live one is unavailable (Binance base interest 0.01%/8h) */
export const BASE_FUNDING = 0.0001;

const MAJORS = new Set(['BTC', 'ETH']);
const LARGE = new Set(['BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'LINK', 'LTC', 'BCH', 'AVAX', 'DOT', 'TRX', 'TON']);

/** Highest leverage the largest exchanges allow on a small position (it falls as the position grows). Approximate. */
export function maxLeverage(sym: string): number {
  const s = sym.toUpperCase();
  return MAJORS.has(s) ? 125 : LARGE.has(s) ? 75 : 50;
}
/** Tier-1 maintenance margin rate (smallest notional bracket). Approximate; bigger positions need more. */
export function mmrOf(sym: string): number {
  const s = sym.toUpperCase();
  return MAJORS.has(s) ? 0.004 : LARGE.has(s) ? 0.005 : 0.01;
}

/**
 * Liquidation price of a fresh isolated position with margin = notional ÷ leverage:
 *   long  LP = entry × (1 − 1/L) / (1 − MMR)        short  LP = entry × (1 + 1/L) / (1 + MMR)
 * (Binance: LP = (WB − side·Q·EP) / (Q·MMR − side·Q) with WB = Q·EP/L.) At 1× a long has no liquidation price.
 */
export function liqPrice(side: Side, entry: number, lev: number, mmr: number): number | null {
  if (side === 'long') return lev <= 1 ? null : (entry * (1 - 1 / lev)) / (1 - mmr);
  return (entry * (1 + 1 / lev)) / (1 + mmr);
}

/** Same, for a position whose margin has since changed (funding, added margin): margin + side·Q·(P−E) = MMR·Q·P. */
export function liqFromMargin(side: Side, qty: number, entry: number, margin: number, mmr: number): number | null {
  if (side === 'long') {
    const p = (qty * entry - margin) / (qty * (1 - mmr));
    return p > 0 ? p : null;
  }
  return (margin + qty * entry) / (qty * (1 + mmr));
}

export interface FuturesPosition {
  id: string;
  sym: string;
  side: Side;
  lev: number;
  qty: number;
  entry: number;
  /** isolated margin, USDT: what this position can lose */
  margin: number;
  openedAt: number;
  /** optional take-profit / stop-loss prices */
  tp: number | null;
  sl: number | null;
  fundingPaid: number; // + paid, − received
  feesPaid: number;
  mmr: number;
  /** for the record: how the position was opened (manual / engine signal) */
  note?: string;
}

export type CloseReason = 'tp' | 'sl' | 'liquidation' | 'manual' | 'signal' | 'end';
export const CLOSE_LABEL: Record<CloseReason, string> = {
  tp: 'حد سود',
  sl: 'حد ضرر',
  liquidation: 'لیکویید شد',
  manual: 'بستن دستی',
  signal: 'سیگنال خروج',
  end: 'پایان دوره',
};

export interface FuturesFill {
  id: string;
  sym: string;
  side: Side;
  lev: number;
  qty: number;
  entry: number;
  exit: number;
  margin: number;
  openedAt: number;
  closedAt: number;
  reason: CloseReason;
  /** price P&L, before fees and funding */
  grossPnl: number;
  fees: number;
  funding: number;
  /** what came back to the wallet minus the margin put in */
  pnl: number;
  /** on the margin: −100% = the margin is gone */
  roePct: number;
}

export interface Ohlc { t: number; o: number; h: number; l: number; c: number }

export const unrealised = (p: FuturesPosition, mark: number) => sideSign(p.side) * p.qty * (mark - p.entry);
export const notional = (p: FuturesPosition, mark: number) => p.qty * mark;
/** margin + unrealised P&L as a share of the margin put in: below 0 is impossible, liquidation happens first */
export const roe = (p: FuturesPosition, mark: number) => (p.margin + unrealised(p, mark)) / Math.max(1e-9, p.margin + p.fundingPaid) - 1;

export function openPosition(o: {
  id: string; sym: string; side: Side; lev: number; margin: number; price: number; at: number;
  tp?: number | null; sl?: number | null; fee?: number; mmr?: number; note?: string;
}): { pos: FuturesPosition; fee: number } {
  if (!(o.margin > 0) || !(o.price > 0)) throw new Error('مبلغ وجه تضمین و قیمت باید مثبت باشند.');
  const lev = Math.max(1, Math.min(maxLeverage(o.sym), Math.round(o.lev)));
  const fee = (o.fee ?? TAKER_FEE) * o.margin * lev;
  const qty = (o.margin * lev) / o.price;
  const mmr = o.mmr ?? mmrOf(o.sym);
  const tp = isNum(o.tp) && o.tp! > 0 ? o.tp! : null;
  const sl = isNum(o.sl) && o.sl! > 0 ? o.sl! : null;
  if (tp !== null && (o.side === 'long' ? tp <= o.price : tp >= o.price)) throw new Error('حد سود باید در جهت سود باشد (خرید: بالاتر از قیمت، فروش: پایین‌تر).');
  if (sl !== null && (o.side === 'long' ? sl >= o.price : sl <= o.price)) throw new Error('حد ضرر باید در جهت ضرر باشد (خرید: پایین‌تر از قیمت، فروش: بالاتر).');
  return { pos: { id: o.id, sym: o.sym, side: o.side, lev, qty, entry: o.price, margin: o.margin, openedAt: o.at, tp, sl, fundingPaid: 0, feesPaid: fee, mmr, note: o.note }, fee };
}

/** Close at `price`: the wallet gets margin + P&L − closing fee (never below zero for isolated margin). */
export function closePosition(p: FuturesPosition, price: number, at: number, reason: CloseReason, fee = TAKER_FEE): { fill: FuturesFill; back: number } {
  const gross = unrealised(p, price);
  const closeFee = reason === 'liquidation' ? 0 : fee * p.qty * price;
  const back = reason === 'liquidation' ? 0 : Math.max(0, p.margin + gross - closeFee);
  const putIn = p.margin + p.fundingPaid; // margin at open (funding was taken from it since)
  const fill: FuturesFill = {
    id: p.id, sym: p.sym, side: p.side, lev: p.lev, qty: p.qty, entry: p.entry, exit: price, margin: putIn, openedAt: p.openedAt, closedAt: at, reason,
    grossPnl: reason === 'liquidation' ? -(putIn) : gross,
    fees: p.feesPaid + closeFee,
    funding: p.fundingPaid,
    pnl: back - putIn - p.feesPaid,
    roePct: ((back - putIn - p.feesPaid) / Math.max(1e-9, putIn)) * 100,
  };
  return { fill, back };
}

const EIGHT_H = 8 * 3_600_000;
/** funding settlement times in (from, to]: 00:00, 08:00, 16:00 UTC */
export function fundingTimes(from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = Math.floor(from / EIGHT_H) * EIGHT_H + EIGHT_H; t <= to; t += EIGHT_H) out.push(t);
  return out;
}

export interface BarOutcome {
  pos: FuturesPosition | null;
  fill: FuturesFill | null;
  back: number;
}

/**
 * Walk one position through one bar. Order inside the bar, worst case first:
 *   1. funding settlements that fall inside the bar (rate per settlement, from `rateAt`)
 *   2. the adverse extreme: a stop-loss nearer than the liquidation price fires at the stop (or at the
 *      open if the bar gapped through it); otherwise reaching the liquidation price liquidates
 *   3. the favourable extreme: take-profit (at the target, or the open if it gapped past)
 * A bar that touches both the stop and the target counts as the stop — the same rule as swing v2.
 */
export type FundingSource = ((t: number) => number) | FundingEvent[];
export interface FundingEvent { t: number; rate: number }

/** settlements inside [from, to): either the exchange's own (a list) or 00/08/16 UTC at a rate per time */
export function settlementsIn(src: FundingSource, from: number, to: number): FundingEvent[] {
  if (Array.isArray(src)) return src.filter((e) => e.t >= from && e.t < to);
  return fundingTimes(from - 1, to - 1).map((t) => ({ t, rate: src(t) }));
}

export function applyBar(p: FuturesPosition, bar: Ohlc, barMs: number, funding: FundingSource, fee = TAKER_FEE): BarOutcome {
  const pos = { ...p };
  for (const e of settlementsIn(funding, bar.t, bar.t + barMs)) {
    if (e.t <= pos.openedAt) continue;
    const pay = sideSign(pos.side) * pos.qty * bar.o * e.rate;
    pos.margin -= pay;
    pos.fundingPaid += pay;
  }
  const liq = liqFromMargin(pos.side, pos.qty, pos.entry, pos.margin, pos.mmr);
  const long = pos.side === 'long';
  const worst = long ? bar.l : bar.h;
  const reached = (lvl: number | null) => lvl !== null && (long ? worst <= lvl : worst >= lvl);
  const gapped = (lvl: number) => (long ? bar.o <= lvl : bar.o >= lvl);
  if (liq !== null && gapped(liq)) {
    const r = closePosition(pos, liq ?? bar.o, bar.t, 'liquidation', fee);
    return { pos: null, ...r };
  }
  const slFirst = pos.sl !== null && (liq === null || (long ? pos.sl > liq : pos.sl < liq));
  if (slFirst && reached(pos.sl)) {
    const r = closePosition(pos, gapped(pos.sl!) ? bar.o : pos.sl!, bar.t, 'sl', fee);
    return { pos: null, ...r };
  }
  if (reached(liq)) {
    const r = closePosition(pos, liq!, bar.t, 'liquidation', fee);
    return { pos: null, ...r };
  }
  const best = long ? bar.h : bar.l;
  if (pos.tp !== null && (long ? best >= pos.tp : best <= pos.tp)) {
    const px = (long ? bar.o >= pos.tp : bar.o <= pos.tp) ? bar.o : pos.tp;
    const r = closePosition(pos, px, bar.t, 'tp', fee);
    return { pos: null, ...r };
  }
  return { pos, fill: null, back: 0 };
}

// ── the trend rider on perpetuals ────────────────────────────────────────────────────────────────

export interface DailyBar extends Ohlc { v?: number }
export type FuturesMode = 'long' | 'longshort';
export interface FuturesRunConfig {
  sym: string;
  lev: number;
  mode: FuturesMode;
  /** start capital, USDT */
  capital: number;
  fee?: number;
  /** funding rate per 8h settlement by day (UTC midnight ms); missing days use BASE_FUNDING */
  fundingByDay?: Map<number, number> | null;
  from?: number;
  to?: number;
  /** 'margin' (default): the whole sized share of the account is margin, so the position is L× the account
   *  share — what "trade at 10×" means to most people. 'exposure': the position stays 1× the share and
   *  leverage only shrinks the margin put up (the rest stays in the wallet) — liquidation then costs only
   *  that margin, like a stop at the liquidation price. */
  sizing?: 'margin' | 'exposure';
}
export interface FuturesRunResult {
  sym: string;
  lev: number;
  mode: FuturesMode;
  fills: FuturesFill[];
  equity: { t: number; v: number }[];
  final: number;
  returnPct: number;
  cagrPct: number | null;
  maxDrawdownPct: number;
  liquidations: number;
  fundingPaid: number;
  feesPaid: number;
  /** days the account held a position */
  daysIn: number;
  days: number;
  /** true once the account fell below 1% of its capital — nothing left to trade with */
  ruined: boolean;
}

const DAY = 86_400_000;
export const FUT_VOL_TARGET = 0.6;
export const FUT_EXPOSURE = 0.9;

/**
 * Daily trend rider (the spot engine's rule: coin and BTC above their 50-day average) traded on a perpetual
 * at leverage L: at each daily close the signal is read from closes up to that day; a new position puts
 * margin = equity × exposure × min(1, 60% ÷ 20-day vol) in at L×, held until the signal flips (no daily
 * re-leveraging, as a person on an exchange would do). `longshort` also sells short while both are below.
 * The position is walked through each following day's high/low for liquidation (rule above).
 */
export function runFuturesTrend(bars: DailyBar[], btc: DailyBar[] | null, cfg: FuturesRunConfig): FuturesRunResult {
  const fee = cfg.fee ?? TAKER_FEE;
  const lev = Math.max(1, Math.min(maxLeverage(cfg.sym), cfg.lev));
  const B = bars.filter((b) => b.c > 0).sort((a, b) => a.t - b.t);
  const btcUp = btc ? regime(btc) : null;
  const own = regime(B);
  const vol = vol20(B);
  const rateAt = (t: number) => cfg.fundingByDay?.get(Math.floor(t / DAY) * DAY) ?? BASE_FUNDING;
  let wallet = cfg.capital;
  let pos: FuturesPosition | null = null;
  const fills: FuturesFill[] = [];
  const equity: FuturesRunResult['equity'] = [];
  let peak = cfg.capital, dd = 0, liqs = 0, daysIn = 0, days = 0, n = 0, ruined = false;
  const from = cfg.from ?? -Infinity, to = cfg.to ?? Infinity;
  for (let i = 51; i < B.length; i++) {
    const b = B[i];
    if (b.t < from || b.t > to) continue;
    days++;
    // 1. today's bar against the open position (decided at yesterday's close)
    if (pos) {
      daysIn++;
      const out = applyBar(pos, b, DAY, rateAt, fee);
      if (out.fill) {
        fills.push(out.fill);
        wallet += out.back;
        if (out.fill.reason === 'liquidation') liqs++;
      }
      pos = out.pos;
    }
    // 2. the decision at today's close, from closes up to today
    const up = own.get(b.t);
    const m = btcUp && cfg.sym.toUpperCase() !== 'BTC' ? btcUp.get(b.t) : up;
    let want: Side | null = null;
    if (up === true && m === true) want = 'long';
    else if (cfg.mode === 'longshort' && up === false && m === false) want = 'short';
    if (pos && pos.side !== want) {
      const r = closePosition(pos, b.c, b.t, 'signal', fee);
      fills.push(r.fill);
      wallet += r.back;
      pos = null;
    }
    if (!pos && want && wallet > cfg.capital * 0.01) {
      const v = vol.get(b.t);
      const share = FUT_EXPOSURE * (v ? Math.min(1, FUT_VOL_TARGET / v) : 1);
      const margin = (wallet * share) / (cfg.sizing === 'exposure' ? lev : 1);
      const o = openPosition({ id: `${cfg.sym}-${++n}`, sym: cfg.sym, side: want, lev, margin, price: b.c, at: b.t, fee });
      pos = o.pos;
      wallet -= margin + o.fee;
    }
    const eq = wallet + (pos ? Math.max(0, pos.margin + unrealised(pos, b.c)) : 0);
    if (eq < cfg.capital * 0.01) ruined = true;
    equity.push({ t: b.t, v: eq });
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq / peak - 1);
  }
  if (pos && equity.length) {
    const last = equity[equity.length - 1];
    const lb = B.find((x) => x.t === last.t)!;
    const r = closePosition(pos, lb.c, lb.t, 'end', fee);
    fills.push(r.fill);
    wallet += r.back;
    last.v = wallet;
  }
  const final = equity.length ? equity[equity.length - 1].v : cfg.capital;
  const yrs = equity.length > 1 ? (equity[equity.length - 1].t - equity[0].t) / (365 * DAY) : 0;
  return {
    sym: cfg.sym, lev, mode: cfg.mode, fills, equity, final,
    returnPct: (final / cfg.capital - 1) * 100,
    cagrPct: yrs >= 0.5 ? ((final / cfg.capital) ** (1 / yrs) - 1) * 100 : null,
    maxDrawdownPct: dd * 100,
    liquidations: liqs,
    fundingPaid: fills.reduce((a, f) => a + f.funding, 0),
    feesPaid: fills.reduce((a, f) => a + f.fees, 0),
    daysIn, days, ruined,
  };
}

/** day → is the close above its 50-day simple average (closes up to that day) */
export function regime(bars: DailyBar[], n = 50): Map<number, boolean> {
  const m = new Map<number, boolean>();
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= n) sum -= bars[i - n].c;
    if (i + 1 >= n) m.set(bars[i].t, bars[i].c > sum / n);
  }
  return m;
}

/** day → annualised volatility of the last 20 daily returns */
export function vol20(bars: DailyBar[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 20; i < bars.length; i++) {
    const r: number[] = [];
    for (let j = i - 19; j <= i; j++) r.push(Math.log(bars[j].c / bars[j - 1].c));
    const mu = r.reduce((a, b) => a + b, 0) / 20;
    m.set(bars[i].t, Math.sqrt(r.reduce((a, b) => a + (b - mu) ** 2, 0) / 20) * Math.sqrt(365));
  }
  return m;
}

/**
 * What leverage did to the trend rider, measured (scripts/eval/futures-eval.ts): 8 coins (BTC, ETH, TRX, LTC,
 * BNB, SOL, XRP, DOGE), real daily candles and real Binance funding, liquidation on each day's low/high,
 * taker fee 0.05% per side, the whole sized share of the account as margin. Medians over the 8 coins.
 * Update together with the eval.
 */
export const FUTURES_EVIDENCE = {
  design: '۲۰۲۰–۲۰۲۲',
  test: '۲۰۲۳–۲۰۲۶',
  rows: [
    { lev: 1, design: { cagr: 85, dd: -45, lost90: 0, wiped: 0 }, test: { cagr: 38, dd: -44, lost90: 0, wiped: 0 } },
    { lev: 2, design: { cagr: 158, dd: -66, lost90: 0, wiped: 0 }, test: { cagr: 72, dd: -57, lost90: 2, wiped: 0 } },
    { lev: 3, design: { cagr: 207, dd: -80, lost90: 1, wiped: 0 }, test: { cagr: 100, dd: -65, lost90: 2, wiped: 1 } },
    { lev: 5, design: { cagr: 169, dd: -93, lost90: 6, wiped: 0 }, test: { cagr: 85, dd: -80, lost90: 4, wiped: 2 } },
    { lev: 10, design: { cagr: -73, dd: -100, lost90: 8, wiped: 3 }, test: { cagr: -71, dd: -100, lost90: 8, wiped: 5 } },
    { lev: 20, design: { cagr: -84, dd: -100, lost90: 8, wiped: 8 }, test: { cagr: -76, dd: -100, lost90: 8, wiped: 8 } },
  ],
  coins: 8,
  notes: [
    'از ۲۰× به بالا (۵۰، ۱۰۰ و ۱۲۵) در هر دو دوره همه ۸ حساب صفر شدند.',
    'با ۲× و ۳× میانه بازده بالاتر رفت، ولی بیشترین افت سرمایه به ‎−۶۶٪ تا ‎−۸۰٪ رسید و در ۲۰۲۳–۲۰۲۶ از هر ۸ حساب ۲ تا بیش از ۹۰٪ سرمایه را از دست دادند.',
    'اگر اهرم فقط وجه تضمین را کم کند و اندازه موقعیت همان ۱× بماند، بازده بهتر نشد؛ بالای ۱۰× فقط لیکویید شدن با نوسان عادی بیشتر شد.',
    'فروش (شورت) وقتی ارز و بیت‌کوین زیر میانگین ۵۰ روزه‌اند در ۱× بازده را بهتر نکرد و افت را بیشتر کرد (۲۰۲۳–۲۰۲۶: افت ‎−۵۴٪ در برابر ‎−۴۴٪)؛ برای همین روندسوار پیش‌فرض فقط خرید است.',
    'نرخ تأمین مالی (funding) هزینه واقعی است: در بازار صعودی خریدار هر ۸ ساعت آن را می‌پردازد و در اهرم بالا روی کل قرارداد حساب می‌شود.',
  ],
  caveat: 'لیکویید روی کمترین/بیشترین قیمت روز بازار نقدی سنجیده شده، نه «قیمت نشانه» صرافی؛ صرافی‌ها با قیمت نشانه لیکویید می‌کنند که معمولاً سایه کوتاه‌تری دارد. پله‌های وجه تضمین نگه‌داری برای موقعیت‌های بزرگ بالاتر است. گذشته وعده آینده نیست.',
};
