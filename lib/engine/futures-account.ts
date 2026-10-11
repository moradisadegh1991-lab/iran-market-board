// «فیوچرز من» — a paper perpetual-futures account that belongs to the device (rule 13's pattern): the phone
// keeps the account in localStorage and posts it to the stateless /api/futures/local, which walks every
// open position through the hourly candles since the last look (liquidation, stop, target, funding —
// lib/engine/futures.ts) and hands the account back. Two kinds of trading:
//   • manual: the user opens long/short at a leverage, with optional take-profit and stop-loss
//   • auto («روندسوار با اهرم»): the trend rider on chosen coins at a chosen leverage — at each UTC day
//     start it reads the coin's and BTC's last closed day against their 50-day average; long while both
//     are above, flat otherwise (long+short also sells while both are below). The evaluation behind the
//     default (long-only, low leverage) is in FUTURES_EVIDENCE.
// The partial hour in which a position is opened is not checked against that hour's high/low (the
// extreme may have come before the order); checking starts with the next full hour.
import { isNum } from '@/lib/num';
import {
  applyBar, closePosition, FUT_EXPOSURE, FUT_VOL_TARGET, maxLeverage, openPosition, regime, unrealised, vol20,
  type DailyBar, type FundingEvent, type FuturesFill, type FuturesMode, type FuturesPosition, type Ohlc, type Side,
} from './futures';

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** how far back a tick will replay hourly candles; beyond that the gap is reported, not guessed */
export const MAX_REPLAY_H = 40 * 24;
const MAX_EVENTS = 150;
const MAX_FILLS = 500;
const MAX_EQUITY = 800;

export interface FuturesAuto {
  coins: string[];
  lev: number;
  mode: FuturesMode;
}

export interface FuturesEvent {
  at: number;
  kind: 'start' | 'open' | 'close' | 'liquidation' | 'auto' | 'data' | 'gap';
  text: string;
}

export interface AccountPosition extends FuturesPosition {
  /** candles before this time were already walked (or predate the order) */
  seenTo: number;
  auto?: boolean;
}

export interface FuturesAccount {
  v: 1;
  id: string;
  createdAt: number;
  startCapital: number;
  /** USDT not tied up as margin */
  wallet: number;
  positions: AccountPosition[];
  fills: FuturesFill[];
  events: FuturesEvent[];
  equity: { t: number; v: number }[];
  lastTickAt: number;
  auto: FuturesAuto | null;
  /** the last UTC day start at which the auto trader decided */
  autoDay: number;
  seq: number;
  /** last known price per symbol (for marking and the next order) */
  marks: Record<string, number>;
}

export interface SymData {
  hourly: Ohlc[];
  daily: DailyBar[];
  /** the exchange's settlements over the replayed span; null = unknown (then `rate` every 8 hours) */
  funding: FundingEvent[] | null;
  rate: number;
  last: number | null;
}

const fmt = (n: number, d = 2) => n.toLocaleString('fa-IR', { maximumFractionDigits: d });
const sideFa = (s: Side) => (s === 'long' ? 'خرید (لانگ)' : 'فروش (شورت)');

export function createAccount(capital: number, now: number): FuturesAccount {
  if (!(capital >= 10 && capital <= 1e9)) throw new Error('سرمایه حساب باید بین ۱۰ و یک میلیارد تتر باشد.');
  return {
    v: 1, id: now.toString(36), createdAt: now, startCapital: capital, wallet: capital, positions: [], fills: [], events: [{ at: now, kind: 'start', text: `حساب فیوچرز کاغذی با ${fmt(capital)} تتر باز شد. هیچ سفارشی به صرافی نمی‌رود.` }],
    equity: [{ t: now, v: capital }], lastTickAt: now, auto: null, autoDay: Math.floor(now / DAY) * DAY, seq: 0, marks: {},
  };
}

export function equityOf(a: FuturesAccount, marks: Record<string, number> = a.marks): number {
  return a.wallet + a.positions.reduce((s, p) => s + Math.max(0, p.margin + unrealised(p, marks[p.sym] ?? p.entry)), 0);
}

function push<T>(arr: T[], x: T, cap: number, front = false) {
  if (front) arr.unshift(x);
  else arr.push(x);
  if (arr.length > cap) front ? (arr.length = cap) : arr.splice(0, arr.length - cap);
}

function record(a: FuturesAccount, fill: FuturesFill, back: number, at: number) {
  a.wallet += back;
  push(a.fills, fill, MAX_FILLS);
  const what = fill.reason === 'liquidation'
    ? `${fill.sym} ${sideFa(fill.side)} ${fmt(fill.lev, 0)}× لیکویید شد در ${fmt(fill.exit, 6)}: کل وجه تضمین (${fmt(fill.margin)} تتر) از دست رفت.`
    : `${fill.sym} ${sideFa(fill.side)} ${fmt(fill.lev, 0)}× بسته شد (${({ tp: 'حد سود', sl: 'حد ضرر', manual: 'دستی', signal: 'سیگنال خروج', end: 'پایان', liquidation: '' } as const)[fill.reason]}) در ${fmt(fill.exit, 6)}؛ سود/زیان ${fill.pnl >= 0 ? '+' : ''}${fmt(fill.pnl)} تتر (${fill.roePct >= 0 ? '+' : ''}${fmt(fill.roePct, 0)}٪ وجه تضمین).`;
  push(a.events, { at, kind: fill.reason === 'liquidation' ? 'liquidation' : 'close', text: what }, MAX_EVENTS, true);
}

export interface OpenOrder { sym: string; side: Side; lev: number; margin: number; tp?: number | null; sl?: number | null }

export function openOrder(a0: FuturesAccount, o: OpenOrder, price: number, now: number, auto = false): FuturesAccount {
  const a = clone(a0);
  const sym = o.sym.toUpperCase();
  if (!(o.margin > 0)) throw new Error('مبلغ وجه تضمین را وارد کنید.');
  const fee = 0.0005 * o.margin * Math.min(o.lev, maxLeverage(sym));
  if (o.margin + fee > a.wallet + 1e-9) throw new Error(`موجودی آزاد کافی نیست (${fmt(a.wallet)} تتر).`);
  const { pos, fee: f } = openPosition({ id: `${a.id}-${++a.seq}`, sym, side: o.side, lev: o.lev, margin: o.margin, price, at: now, tp: o.tp, sl: o.sl, note: auto ? 'auto' : 'manual' });
  a.wallet -= o.margin + f;
  a.positions.push({ ...pos, seenTo: Math.ceil(now / HOUR) * HOUR, ...(auto ? { auto: true } : {}) });
  a.marks[sym] = price;
  push(a.events, { at: now, kind: 'open', text: `${auto ? 'روندسوار: ' : ''}${sym} ${sideFa(o.side)} با اهرم ${fmt(pos.lev, 0)}× در ${fmt(price, 6)}؛ وجه تضمین ${fmt(o.margin)} تتر، ارزش قرارداد ${fmt(pos.qty * price)} تتر.` }, MAX_EVENTS, true);
  return a;
}

export function closeOrder(a0: FuturesAccount, posId: string, price: number, now: number): FuturesAccount {
  const a = clone(a0);
  const k = a.positions.findIndex((p) => p.id === posId);
  if (k < 0) throw new Error('این موقعیت باز نیست.');
  const r = closePosition(a.positions[k], price, now, 'manual');
  a.positions.splice(k, 1);
  record(a, r.fill, r.back, now);
  a.marks[r.fill.sym] = price;
  return a;
}

export function setAuto(a0: FuturesAccount, auto: FuturesAuto | null, now: number): FuturesAccount {
  const a = clone(a0);
  a.auto = auto ? { coins: [...new Set(auto.coins.map((c) => c.toUpperCase()))].slice(0, 6), lev: Math.max(1, Math.round(auto.lev)), mode: auto.mode === 'longshort' ? 'longshort' : 'long' } : null;
  // decide at the next day start, not retroactively over days the user had not switched it on
  a.autoDay = Math.floor(now / DAY) * DAY;
  push(a.events, { at: now, kind: 'auto', text: a.auto ? `روندسوار با اهرم روشن شد: ${a.auto.coins.join('، ')} با ${fmt(a.auto.lev, 0)}×، ${a.auto.mode === 'long' ? 'فقط خرید' : 'خرید و فروش'}. اولین تصمیم با بسته شدن روز (ساعت ۳:۳۰ بامداد تهران) گرفته می‌شود — یا همین حالا با «تصمیم امروز».` : 'روندسوار با اهرم خاموش شد؛ موقعیت‌های بازش دست نخوردند.' }, MAX_EVENTS, true);
  return a;
}

/** what the trend rider wants for `sym` given closed days before `dayStart` */
export function autoWant(daily: DailyBar[], btcDaily: DailyBar[] | null, sym: string, dayStart: number, mode: FuturesMode): { side: Side | null; vol: number | null } {
  const closed = daily.filter((b) => b.t + DAY <= dayStart);
  const last = closed[closed.length - 1];
  if (!last) return { side: null, vol: null };
  const up = regime(closed).get(last.t);
  let mkt = up;
  if (sym !== 'BTC' && btcDaily) {
    const bc = btcDaily.filter((b) => b.t + DAY <= dayStart);
    mkt = bc.length ? regime(bc).get(bc[bc.length - 1].t) : undefined;
  }
  const vol = vol20(closed).get(last.t) ?? null;
  if (up === true && mkt === true) return { side: 'long', vol };
  if (mode === 'longshort' && up === false && mkt === false) return { side: 'short', vol };
  return { side: null, vol };
}

/** apply the auto trader's decision for one day start, at `price` per symbol, executed at time `at`
 *  (the day start itself during a replay; "now" for «تصمیم امروز») */
export function autoDecide(a: FuturesAccount, dayStart: number, data: Record<string, SymData>, btcDaily: DailyBar[] | null, priceOf: (sym: string) => number | null, at = dayStart): void {
  if (!a.auto) return;
  const coins = a.auto.coins;
  for (const sym of coins) {
    const d = data[sym];
    const px = priceOf(sym);
    if (!d || !px) continue;
    const { side, vol } = autoWant(d.daily, btcDaily, sym, dayStart, a.auto.mode);
    const cur = a.positions.find((p) => p.auto && p.sym === sym);
    if (cur && cur.side !== side) {
      const r = closePosition(cur, px, at, 'signal');
      a.positions = a.positions.filter((p) => p.id !== cur.id);
      record(a, r.fill, r.back, at);
    }
    if (side && !a.positions.some((p) => p.auto && p.sym === sym)) {
      const share = (FUT_EXPOSURE * (vol ? Math.min(1, FUT_VOL_TARGET / vol) : 1)) / coins.length;
      const margin = equityOf(a) * share;
      const lev = Math.min(a.auto.lev, maxLeverage(sym));
      if (margin * (1 + 0.0005 * lev) > a.wallet || margin < 1) {
        push(a.events, { at, kind: 'auto', text: `روندسوار: ${sym} سیگنال ${sideFa(side)} داد ولی موجودی آزاد کافی نبود.` }, MAX_EVENTS, true);
        continue;
      }
      const next = openOrder(a, { sym, side, lev, margin }, px, at, true);
      Object.assign(a, next);
    }
  }
}

function clone(a: FuturesAccount): FuturesAccount {
  return { ...a, positions: a.positions.map((p) => ({ ...p })), fills: [...a.fills], events: [...a.events], equity: [...a.equity], marks: { ...a.marks }, auto: a.auto ? { ...a.auto, coins: [...a.auto.coins] } : null };
}

export interface TickOut {
  account: FuturesAccount;
  newFills: FuturesFill[];
}

/**
 * Walk the account from `lastTickAt` to `now` through closed hourly candles, in time order across all
 * symbols: at every UTC day start the auto trader decides first (at that hour's open), then each open
 * position of the symbol meets the hour (funding → liquidation/stop → target).
 */
export function futuresTick(a0: FuturesAccount, data: Record<string, SymData>, btcDaily: DailyBar[] | null, now: number): TickOut {
  const a = clone(a0);
  const before = a.fills.length;
  const closedTo = Math.floor(now / HOUR) * HOUR; // bars starting before this are complete
  const floor = closedTo - MAX_REPLAY_H * HOUR;
  if (a.lastTickAt < floor) {
    push(a.events, { at: now, kind: 'gap', text: `اپ بیش از ${fmt(MAX_REPLAY_H / 24, 0)} روز باز نشده بود؛ فقط ${fmt(MAX_REPLAY_H / 24, 0)} روز اخیر قیمت‌ها بررسی شد.` }, MAX_EVENTS, true);
  }
  const hours = new Set<number>();
  for (const d of Object.values(data)) for (const b of d.hourly) if (b.t < closedTo && b.t >= floor) hours.add(b.t);
  const timeline = [...hours].sort((x, y) => x - y);
  const barAt = new Map<string, Map<number, Ohlc>>();
  for (const [sym, d] of Object.entries(data)) barAt.set(sym, new Map(d.hourly.map((b) => [b.t, b])));

  for (const t of timeline) {
    // the auto trader, once per UTC day start that has not been decided yet
    if (a.auto && t % DAY === 0 && t > a.autoDay) {
      autoDecide(a, t, data, btcDaily, (sym) => barAt.get(sym)?.get(t)?.o ?? null);
      a.autoDay = t;
    }
    for (let k = 0; k < a.positions.length; k++) {
      const p = a.positions[k];
      const bar = barAt.get(p.sym)?.get(t);
      if (!bar || t < p.seenTo) continue;
      const d = data[p.sym];
      const out = applyBar(p, bar, HOUR, d.funding ?? ((): number => d.rate));
      if (out.fill) {
        a.positions.splice(k--, 1);
        record(a, out.fill, out.back, bar.t);
      } else {
        a.positions[k] = { ...(out.pos as FuturesPosition), seenTo: t + HOUR, ...(p.auto ? { auto: true } : {}) };
      }
      a.marks[p.sym] = bar.c;
    }
  }
  for (const [sym, d] of Object.entries(data)) if (isNum(d.last) && d.last! > 0) a.marks[sym] = d.last!;
  a.lastTickAt = now;
  push(a.equity, { t: now, v: equityOf(a) }, MAX_EQUITY);
  return { account: a, newFills: a.fills.slice(before) };
}

/** a received account is the user's own data but still drives a loop on the server: bound everything */
export function saneAccount(raw: any): FuturesAccount {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) throw new Error('حساب فیوچرز ارسال نشد.');
  const num = (v: unknown, d: number) => (isNum(v) ? (v as number) : d);
  const now = Date.now();
  const positions = (Array.isArray(raw.positions) ? raw.positions : []).slice(0, 30).filter((p: any) =>
    p && typeof p.sym === 'string' && /^[A-Z0-9]{2,12}$/.test(p.sym) && (p.side === 'long' || p.side === 'short') && isNum(p.qty) && p.qty > 0 && isNum(p.entry) && p.entry > 0 && isNum(p.margin) && isNum(p.lev) && p.lev >= 1 && p.lev <= 125 && isNum(p.mmr));
  const auto = raw.auto && Array.isArray(raw.auto.coins)
    ? { coins: raw.auto.coins.map(String).filter((s: string) => /^[A-Z0-9]{2,12}$/.test(s)).slice(0, 6), lev: Math.max(1, Math.min(125, num(raw.auto.lev, 1))), mode: raw.auto.mode === 'longshort' ? 'longshort' : 'long' } as FuturesAuto
    : null;
  return {
    v: 1, id: String(raw.id ?? now.toString(36)).slice(0, 20), createdAt: num(raw.createdAt, now), startCapital: num(raw.startCapital, 1000),
    wallet: num(raw.wallet, 0), positions, fills: (Array.isArray(raw.fills) ? raw.fills : []).slice(-MAX_FILLS), events: (Array.isArray(raw.events) ? raw.events : []).slice(0, MAX_EVENTS),
    equity: (Array.isArray(raw.equity) ? raw.equity : []).slice(-MAX_EQUITY), lastTickAt: Math.min(now, num(raw.lastTickAt, now)), auto, autoDay: num(raw.autoDay, Math.floor(now / DAY) * DAY),
    seq: num(raw.seq, 0), marks: raw.marks && typeof raw.marks === 'object' ? Object.fromEntries(Object.entries(raw.marks).filter(([k, v]) => /^[A-Z0-9]{2,12}$/.test(k) && isNum(v)).slice(0, 40)) as Record<string, number> : {},
  };
}

/** symbols a tick needs data for */
export function symbolsOf(a: FuturesAccount): string[] {
  return [...new Set([...a.positions.map((p) => p.sym), ...(a.auto?.coins ?? [])])];
}
