// Prices for valuing the book when the market is closed — the pure half.
//
// On a Friday, a holiday or when a source is down there is no live quote. The holdings are still
// worth something: the last price the market traded at. Two layers supply it, both dated so the
// page says «آخرین قیمت (۱۰ مهر)» rather than passing an old price off as live:
//  • the server fills an empty board row from its daily history (lib/snapshot.ts, BoardItem.asOf);
//  • the device remembers the last price it saw for each item (this file), for when a later board
//    lacks a row or the app opens offline.
// And when recording a purchase, the price «on the day you bought» is the close of that day — or,
// if the market was shut, of the last trading day before it (priceOnOrBefore).
import type { PriceItem } from './calc';
import type { Iso } from './model';

export const PRICE_MEMO_KEY = 'imf.pricememo.v1';
export type PriceMemo = Record<string, { price: number; unit: PriceItem['unit']; date: Iso }>;

const valid = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0;

/** Remembers each priced row of the board with its day; an older dated row never replaces a newer memory. */
export function rememberPrices(memo: PriceMemo, items: PriceItem[], today: Iso): PriceMemo {
  const out: PriceMemo = { ...memo };
  for (const it of items) {
    if (!valid(it.price)) continue;
    const date = it.asOf ?? today;
    const prev = out[it.key];
    if (prev && prev.date > date) continue;
    out[it.key] = { price: it.price, unit: it.unit, date };
  }
  return out;
}

/** The board with every empty or missing row filled from memory, marked with the day that price is from. */
export function withLastPrices(items: PriceItem[], memo: PriceMemo): PriceItem[] {
  const out = items.map((it) => {
    if (valid(it.price)) return it;
    const m = memo[it.key];
    return m && m.unit === it.unit ? { ...it, price: m.price, asOf: m.date } : it;
  });
  for (const [key, m] of Object.entries(memo)) if (!out.some((x) => x.key === key)) out.push({ key, price: m.price, unit: m.unit, asOf: m.date });
  return out;
}

export function normalizeMemo(raw: unknown): PriceMemo {
  const out: PriceMemo = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const x = v as { price?: unknown; unit?: unknown; date?: unknown };
    if (valid(x?.price) && (x.unit === 'toman' || x.unit === 'usd' || x.unit === 'point') && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date))
      out[k] = { price: x.price, unit: x.unit, date: x.date };
  }
  return out;
}

/** Tehran calendar day of a chart point (daily points are stamped at 12:00 UTC of their day). */
const dayOf = (ms: number): Iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/**
 * The close on `date`, or — when the market did not trade that day (Friday, a holiday) — on the
 * last day before it that has a price. Never a later day: the price of a purchase cannot come from
 * after it. Null when the series does not reach back that far.
 */
export function priceOnOrBefore(points: [number, number][], date: Iso): { price: number; date: Iso } | null {
  let best: { price: number; date: Iso } | null = null;
  for (const [ms, v] of points) {
    if (!valid(v)) continue;
    const d = dayOf(ms);
    if (d > date) continue;
    if (!best || d >= best.date) best = { price: v, date: d };
  }
  return best;
}

/**
 * Rial price of one unit of `key` on the day of a purchase (or the last trading day before it),
 * from the server's daily history — the past year only. Dollar-quoted coins are converted with
 * tether of that same day (CLAUDE.md rule 9: every toman figure at its own day's rate).
 */
export async function priceOnDay(key: string, unit: 'toman' | 'usd', date: Iso, fetchPoints: (asset: string) => Promise<[number, number][]>): Promise<{ rial: number; date: Iso } | null> {
  const p = priceOnOrBefore(await fetchPoints(key), date);
  if (!p) return null;
  if (unit === 'toman') return { rial: p.price * 10, date: p.date };
  const t = priceOnOrBefore(await fetchPoints('usdt'), date);
  if (!t) return null;
  return { rial: p.price * t.price * 10, date: p.date < t.date ? p.date : t.date };
}
