// «سبد من در برابر سبد پیشنهادی» — the pure half.
//
// The suggested portfolio (lib/engine/portfolio.ts) speaks in six classes: rial fixed income, dollar,
// gold, Tehran stocks, BTC/ETH, speculative coins. The book's holdings are mapped onto those same
// classes at today's price (or the last price on record when the market is shut — prices.ts), so the
// two can be laid side by side with the toman amount that would close each gap.
//
// What is left out is said, not hidden: assets with a hand-entered value (a house, a car, a رهن
// deposit) are not tradable sleeves of a portfolio, and an asset with no price at all cannot be
// weighed.
import type { AllocationLine } from '@/lib/types';
import { accountBalances, unitPrice, type PriceItem } from './calc';
import type { FinanceData, Iso, MarketKey } from './model';

export type PortfolioClass = AllocationLine['cls'];

/** Which suggested-portfolio class each priced holding belongs to. */
export const CLASS_OF: Record<MarketKey, PortfolioClass> = {
  usd: 'usd',
  usdt: 'usd',
  g18: 'gold',
  coin: 'gold',
  nim: 'gold',
  rob: 'gold',
  silver: 'gold',
  btc: 'btc',
  eth: 'btc',
};

export interface CompareRow {
  cls: PortfolioClass;
  label: string;
  mineRial: number;
  minePct: number;
  targetPct: number;
  /** percentage points: mine − target */
  gapPct: number;
  /** rial to buy (+) or sell (−) to reach the target weight with the same total */
  moveRial: number;
}

export interface Comparison {
  totalRial: number;
  rows: CompareRow[];
  /** hand-valued assets and assets with no price, by name */
  excluded: { name: string; why: 'manual' | 'unpriced' }[];
  /** holdings weighed at the last price on record, not a live one */
  lastPriced: { name: string; asOf: Iso }[];
  /** sum of |gap| / 2: the share of the portfolio that would have to change hands */
  turnoverPct: number;
}

export function compareWithSuggested(d: FinanceData, items: PriceItem[], lines: Pick<AllocationLine, 'cls' | 'label' | 'weight'>[], opts: { includeAccounts: boolean }): Comparison {
  const mine = new Map<PortfolioClass, number>(lines.map((l) => [l.cls, 0]));
  const excluded: Comparison['excluded'] = [];
  const lastPriced: Comparison['lastPriced'] = [];
  if (opts.includeAccounts) {
    const bal = accountBalances(d);
    const cash = d.accounts.filter((a) => !a.archived).reduce((s, a) => s + Math.max(0, bal[a.id] ?? 0), 0);
    mine.set('cash', (mine.get('cash') ?? 0) + cash);
  }
  for (const a of d.assets) {
    if (a.kind !== 'market' || !a.key) {
      excluded.push({ name: a.name, why: 'manual' });
      continue;
    }
    const p = unitPrice(a.key, items);
    if (!p) {
      excluded.push({ name: a.name, why: 'unpriced' });
      continue;
    }
    if (p.asOf) lastPriced.push({ name: a.name, asOf: p.asOf });
    const cls = CLASS_OF[a.key];
    mine.set(cls, (mine.get(cls) ?? 0) + p.rial * (a.qty ?? 0));
  }
  const totalRial = [...mine.values()].reduce((s, v) => s + v, 0);
  const rows: CompareRow[] = lines.map((l) => {
    const v = mine.get(l.cls) ?? 0;
    const minePct = totalRial > 0 ? (v / totalRial) * 100 : 0;
    const targetPct = l.weight * 100;
    return { cls: l.cls, label: l.label, mineRial: v, minePct, targetPct, gapPct: minePct - targetPct, moveRial: totalRial * l.weight - v };
  });
  const turnoverPct = rows.reduce((s, r) => s + Math.abs(r.gapPct), 0) / 2;
  return { totalRial, rows, excluded, lastPriced, turnoverPct };
}

/** Book holdings the live-trading engine can trade (same instrument, same unit) — the rest are named, not dropped silently. */
const LIVE_ASSET: Partial<Record<MarketKey, 'usd' | 'g18' | 'coin' | 'btc' | 'eth'>> = { usd: 'usd', g18: 'g18', coin: 'coin', btc: 'btc', eth: 'eth' };

export function holdingsForLive(d: FinanceData): { holdings: { asset: 'usd' | 'g18' | 'coin' | 'btc' | 'eth'; qty: number }[]; unsupported: string[] } {
  const qty = new Map<'usd' | 'g18' | 'coin' | 'btc' | 'eth', number>();
  const unsupported: string[] = [];
  for (const a of d.assets) {
    if (a.kind !== 'market' || !a.key || !(a.qty && a.qty > 0)) {
      if (a.kind !== 'market') unsupported.push(a.name);
      continue;
    }
    const k = LIVE_ASSET[a.key];
    if (!k) unsupported.push(a.name);
    else qty.set(k, (qty.get(k) ?? 0) + a.qty);
  }
  return { holdings: [...qty].map(([asset, q]) => ({ asset, qty: q })), unsupported };
}
