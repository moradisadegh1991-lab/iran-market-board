// کسب‌وکار من — reports: daily profit, the sales analyst, stock running out, prices under cost,
// and the yearly tax estimate. Pure functions; scripts/biz-test.ts pins the arithmetic.
//
// Revenue is what was sold net of discount and before VAT (VAT is collected for the state, not
// earned). Kasbai's daily_profit counted the pre-discount total as revenue and its tax page left the
// cost of goods out of the profit; both are fixed here.

import type { Iso } from '@/lib/finance/model';
import { addDays } from '@/lib/finance/calc';
import { SOLD, type Business, type Channel, type Ingredient, type Order, type Product } from './model';
import { productCost } from './ops';
import { minutesOf, tehranParts, weekdayOf } from './slots';

export interface DayRow {
  day: Iso;
  revenueRial: number;
  costRial: number;
  expensesRial: number;
  profitRial: number;
  orders: number;
  vatRial: number;
}

const sold = (b: Business, from: Iso, to: Iso) => b.orders.filter((o) => SOLD.includes(o.status) && o.saleDate && o.saleDate >= from && o.saleDate <= to);
const revenueOf = (o: Order) => o.totalRial - o.vatRial;

/** One row per day that had a sale or an expense, newest first. */
export function dailyProfit(b: Business, from: Iso, to: Iso): DayRow[] {
  const by = new Map<Iso, DayRow>();
  const row = (day: Iso) => {
    let r = by.get(day);
    if (!r) by.set(day, (r = { day, revenueRial: 0, costRial: 0, expensesRial: 0, profitRial: 0, orders: 0, vatRial: 0 }));
    return r;
  };
  for (const o of sold(b, from, to)) {
    const r = row(o.saleDate!);
    r.revenueRial += revenueOf(o);
    r.costRial += o.costRial;
    r.vatRial += o.vatRial;
    r.orders++;
  }
  for (const [day, s] of Object.entries(b.archive)) {
    if (day < from || day > to) continue;
    const r = row(day);
    r.revenueRial += s.revenueRial;
    r.costRial += s.costRial;
    r.vatRial += s.vatRial;
    r.orders += s.orders;
  }
  for (const e of b.expenses) if (e.date >= from && e.date <= to) row(e.date).expensesRial += e.amountRial;
  for (const r of by.values()) r.profitRial = r.revenueRial - r.costRial - r.expensesRial;
  return [...by.values()].sort((a, c) => (a.day < c.day ? 1 : -1));
}

export function sumRows(rows: DayRow[]) {
  return rows.reduce(
    (s, r) => ({ revenueRial: s.revenueRial + r.revenueRial, costRial: s.costRial + r.costRial, expensesRial: s.expensesRial + r.expensesRial, profitRial: s.profitRial + r.profitRial, orders: s.orders + r.orders, vatRial: s.vatRial + r.vatRial }),
    { revenueRial: 0, costRial: 0, expensesRial: 0, profitRial: 0, orders: 0, vatRial: 0 },
  );
}

/** what is low now: at or below its reorder point */
export const lowStock = (b: Business): Ingredient[] => b.ingredients.filter((i) => i.stock <= i.reorder);

export interface Overview {
  today: ReturnType<typeof sumRows>;
  pendingOrders: number;
  lowStock: number;
  todayBookings: number;
  creditOpenRial: number;
}
export function overview(b: Business, today: Iso, now: number): Overview {
  const day = tehranParts(now).date;
  return {
    today: sumRows(dailyProfit(b, today, today)),
    pendingOrders: b.orders.filter((o) => o.status === 'pending').length,
    lowStock: lowStock(b).length,
    todayBookings: b.bookings.filter((x) => x.status !== 'canceled' && tehranParts(x.startsAt).date === day).length,
    creditOpenRial: b.credit.reduce((s, c) => s + Math.max(0, c.entries.reduce((a, e) => a + (e.kind === 'sale' ? e.amountRial : -e.amountRial), 0)), 0),
  };
}

// ── the sales analyst (Kasbai's تحلیل‌گر فروش, last 90 days) ────────────────

export interface ProductStat {
  id: string;
  name: string;
  active: boolean;
  qty: number;
  revenueRial: number;
  marginRial: number;
}
export interface Analysis {
  orders: number;
  revenueRial: number;
  avgOrderRial: number;
  byHour: number[];
  byWeekday: number[];
  peakHour: number;
  peakWeekday: number;
  slowWeekday: number;
  /** four weeks, oldest first; the last is the 7 days ending today */
  weeks: number[];
  top: ProductStat[];
  /** active products that sold nothing in 90 days and are older than 14 days */
  unsold: ProductStat[];
  byChannel: { channel: Channel; revenueRial: number }[];
}

export function analyze(b: Business, today: Iso): Analysis {
  const from = addDays(today, -89);
  const os = sold(b, from, today);
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  const weeks = [0, 0, 0, 0];
  const stats = new Map<string, ProductStat>();
  const chan = new Map<Channel, number>();
  let revenueRial = 0;
  for (const o of os) {
    const r = revenueOf(o);
    revenueRial += r;
    byHour[Math.floor(minutesOf(o.saleTime ?? o.time) / 60) % 24] += r;
    byWeekday[weekdayOf(o.saleDate!)] += r;
    const ago = Math.floor((Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - Date.UTC(+o.saleDate!.slice(0, 4), +o.saleDate!.slice(5, 7) - 1, +o.saleDate!.slice(8, 10))) / (7 * 86_400_000));
    if (ago >= 0 && ago < 4) weeks[3 - ago] += r;
    chan.set(o.channel, (chan.get(o.channel) ?? 0) + r);
    const share = o.subtotalRial > 0 ? (o.subtotalRial - o.discountRial) / o.subtotalRial : 1;
    for (const l of o.lines) {
      if (l.kind !== 'product') continue;
      const p = b.products.find((x) => x.id === l.itemId);
      const s = stats.get(l.itemId) ?? { id: l.itemId, name: p?.name ?? l.name, active: p?.active ?? false, qty: 0, revenueRial: 0, marginRial: 0 };
      s.qty += l.qty;
      s.revenueRial += l.qty * l.unitRial * share;
      s.marginRial += l.qty * (l.unitRial * share - l.costRial);
      stats.set(l.itemId, s);
    }
  }
  const argmax = (a: number[]) => a.indexOf(Math.max(...a));
  const fortnight = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - 14 * 86_400_000;
  return {
    orders: os.length,
    revenueRial,
    avgOrderRial: os.length ? revenueRial / os.length : 0,
    byHour,
    byWeekday,
    peakHour: argmax(byHour),
    peakWeekday: argmax(byWeekday),
    slowWeekday: byWeekday.indexOf(Math.min(...byWeekday)),
    weeks,
    top: [...stats.values()].sort((a, c) => c.qty - a.qty).slice(0, 5),
    unsold: b.products
      .filter((p) => p.active && !stats.has(p.id) && p.createdAt < fortnight)
      .map((p) => ({ id: p.id, name: p.name, active: true, qty: 0, revenueRial: 0, marginRial: 0 })),
    byChannel: [...chan.entries()].map(([channel, revenueRial]) => ({ channel, revenueRial })).sort((a, c) => c.revenueRial - a.revenueRial),
  };
}

// ── stock running out (Kasbai advertised «پیش‌بینی کمبود موجودی»; this is the arithmetic) ──

export interface StockOutlook {
  ingredient: Ingredient;
  /** average use per day over the last 30 days */
  perDay: number;
  /** stock ÷ use per day; null when it was not used */
  daysLeft: number | null;
  low: boolean;
}
export function stockOutlook(b: Business, today: Iso): StockOutlook[] {
  const from = addDays(today, -29);
  const used = new Map<string, number>();
  for (const t of b.invTx) if (t.type === 'consumption' && t.date >= from && t.date <= today) used.set(t.ingredientId, (used.get(t.ingredientId) ?? 0) - t.qty);
  return b.ingredients
    .map((ingredient) => {
      const perDay = (used.get(ingredient.id) ?? 0) / 30;
      return { ingredient, perDay, daysLeft: perDay > 0 ? Math.max(0, ingredient.stock) / perDay : null, low: ingredient.stock <= ingredient.reorder };
    })
    .sort((a, c) => (a.daysLeft ?? Infinity) - (c.daysLeft ?? Infinity));
}

// ── prices: products sold under cost, or with a thin margin ──────────────

export interface PriceCheck {
  product: Product;
  costRial: number;
  marginPct: number | null;
  /** the price that leaves `targetPct` margin, rounded up to 1,000 toman */
  suggestedRial: number;
}
export function priceChecks(b: Business, targetPct = 30, floorPct = 15): PriceCheck[] {
  const out: PriceCheck[] = [];
  for (const p of b.products) {
    if (!p.active) continue;
    const c = productCost(b, p);
    if (c.unitRial <= 0) continue; // no recipe and no labour: nothing to compare against
    if (c.marginPct !== null && c.marginPct >= floorPct) continue;
    out.push({ product: p, costRial: c.unitRial, marginPct: c.marginPct, suggestedRial: Math.ceil(c.unitRial / (1 - targetPct / 100) / 10_000) * 10_000 });
  }
  return out.sort((a, c) => (a.marginPct ?? -Infinity) - (c.marginPct ?? -Infinity));
}

// ── tax estimate (Kasbai's دستیار مالیات) ───────────────────────────────

/**
 * Kasbai's figures, in rial: 15% / 20% / 25% steps (ماده ۱۳۱) at 20 and 40 billion rial (2 and 4
 * billion toman) and a default yearly exemption of 4.75 billion rial. Steps and exemption change every
 * year with the budget law and were not checked here: the page says so and every number is editable.
 */
export const TAX_BRACKETS = [
  { upToRial: 20_000_000_000, rate: 0.15 },
  { upToRial: 40_000_000_000, rate: 0.2 },
  { upToRial: Infinity, rate: 0.25 },
];
export const DEFAULT_EXEMPTION_RIAL = 4_750_000_000;

export function progressiveTax(taxableRial: number) {
  let left = Math.max(0, taxableRial);
  let lower = 0;
  let total = 0;
  const steps: { sliceRial: number; rate: number; taxRial: number }[] = [];
  for (const b of TAX_BRACKETS) {
    if (left <= 0) break;
    const slice = Math.min(left, b.upToRial - lower);
    steps.push({ sliceRial: slice, rate: b.rate, taxRial: slice * b.rate });
    total += slice * b.rate;
    left -= slice;
    lower = b.upToRial;
  }
  return { totalRial: Math.round(total), steps };
}

export function taxEstimate(p: { revenueRial: number; costRial: number; expensesRial: number; extraRial: number; exemptionRial: number }) {
  const profitRial = Math.max(0, p.revenueRial - p.costRial - p.expensesRial - p.extraRial);
  const taxableRial = Math.max(0, profitRial - p.exemptionRial);
  const t = progressiveTax(taxableRial);
  return { profitRial, taxableRial, ...t, effectivePct: profitRial > 0 ? (t.totalRial / profitRial) * 100 : 0 };
}

/** the last 365 days, as the tax page fills it in */
export function yearFigures(b: Business, today: Iso) {
  return sumRows(dailyProfit(b, addDays(today, -364), today));
}
