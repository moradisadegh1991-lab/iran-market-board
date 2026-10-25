// A goal priced by Digikala (rule 105). The user picks the product; its price is read again twice a month (when the app is
// opened — nothing runs with the app closed, rule 15) and kept as a history, so the target is today's real price, not a
// guess, and the goal's growth can come from how this product's own price has moved — once there is enough of it to say.
// Pure.
import { qtyCount, type DkProduct } from '../digikala/parse';
import type { Goal } from './model';

/** «هر ماه دو بار» */
export const GOAL_REFRESH_MS = 15 * 24 * 3_600_000;
/** after a failed read, the next automatic one */
export const GOAL_RETRY_MS = 24 * 3_600_000;
const HISTORY_MAX = 48;
/** a product's own trend says something only over at least this long, with at least this many prices */
export const TREND_MIN_DAYS = 90;
export const TREND_MIN_POINTS = 3;

export const lastPrice = (g: Pick<Goal, 'dk'>): { at: number; priceRial: number } | null => {
  const h = g.dk?.history ?? [];
  for (let i = h.length - 1; i >= 0; i--) if (h[i].priceRial) return h[i] as { at: number; priceRial: number };
  return null;
};

/** Ties the goal to a product; the target becomes its price × qty (when it has one now). */
export function linkGoalProduct(g: Goal, p: DkProduct, qty = 1, now = Date.now()): void {
  const q = Math.max(1, Math.min(99, Math.round(qty) || 1));
  g.dk = { id: p.id, title: p.title.slice(0, 140), url: p.url, qty: q, history: [{ at: now, priceRial: p.priceRial }], triedAt: null };
  g.followPrice = true;
  if (p.priceRial) g.targetRial = p.priceRial * q;
}

/** A fresh read of the same product: one more point; the target follows when it is set to. */
export function addGoalPrice(g: Goal, p: DkProduct, now = Date.now()): void {
  if (!g.dk || g.dk.id !== p.id) return;
  g.dk.history.push({ at: now, priceRial: p.priceRial });
  if (g.dk.history.length > HISTORY_MAX) g.dk.history.splice(0, g.dk.history.length - HISTORY_MAX);
  g.dk.title = p.title.slice(0, 140);
  g.dk.url = p.url;
  g.dk.triedAt = null;
  if (g.followPrice && p.priceRial) g.targetRial = p.priceRial * g.dk.qty;
}

export const noteGoalTry = (g: Goal, now = Date.now()) => {
  if (g.dk) g.dk.triedAt = now;
};

export function unlinkGoalProduct(g: Goal): void {
  g.dk = null;
  g.followPrice = false;
}

/** goals whose product price is due again: 15 days since the last read, and not tried in the last day */
export function goalsDue(goals: Goal[], now = Date.now()): Goal[] {
  return goals.filter((g) => {
    if (!g.dk) return false;
    const last = g.dk.history.at(-1)?.at ?? 0;
    return now - last >= GOAL_REFRESH_MS && (!g.dk.triedAt || now - g.dk.triedAt >= GOAL_RETRY_MS);
  });
}

/**
 * How fast this product's price has moved, a year: the least-squares slope of log price over time (every read counts,
 * not just the first and the last), only with ≥ 90 days and ≥ 3 prices; clipped to −60…+300%. null = not enough yet.
 */
export function productTrend(g: Pick<Goal, 'dk'>): { annualPct: number; days: number; points: number } | null {
  const pts = (g.dk?.history ?? []).filter((h) => h.priceRial && h.priceRial > 0) as { at: number; priceRial: number }[];
  if (pts.length < TREND_MIN_POINTS) return null;
  const days = (pts.at(-1)!.at - pts[0].at) / 86_400_000;
  if (days < TREND_MIN_DAYS) return null;
  const xs = pts.map((p) => (p.at - pts[0].at) / (365.25 * 86_400_000));
  const ys = pts.map((p) => Math.log(p.priceRial));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const annualPct = Math.max(-60, Math.min(300, (Math.exp(slope) - 1) * 100));
  return { annualPct, days, points: pts.length };
}

/** The growth a goal's price is planned with: its product's own trend when there is one, else the user's inflation setting. */
export function goalGrowth(g: Goal, inflationPct: number): { pct: number; basis: 'product' | 'inflation' } {
  const t = productTrend(g);
  return t ? { pct: t.annualPct, basis: 'product' } : { pct: inflationPct, basis: 'inflation' };
}

/** the count a typed quantity states, for the goal form (same rule as the shopping list) */
export const goalQty = (s: string) => qtyCount(s);
