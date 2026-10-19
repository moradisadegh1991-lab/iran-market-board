// «سرمایه‌ها»: the assets of the book as the page shows them — one card per kind (all the gold bought on
// different days is one «طلای ۱۸ عیار» with its purchases as lots), and a total with the profit over what was
// paid. Pure. Values come from netWorth().byAsset, the same figure every other page uses (rule 87), so the
// total here is exactly netWorth's market + manual part.
//
// Profit counts only purchases whose cost is known (what was paid, from the asset's «کل مبلغ خرید») and whose
// value is known (priced): a lot without a cost has no profit, not a profit equal to its whole value. The page
// says how many purchases the profit covers.
import { MARKET_ASSETS, type Asset, type FinanceData, type MarketKey } from './model';
import { unitPrice, type NetWorth, type PriceItem } from './calc';

export interface AssetLot {
  id: string;
  asset: Asset;
  /** manual: the title; market: the group's label */
  name: string;
  qty: number | null;
  boughtOn: string | null;
  costRial: number | null;
  /** null: no price at all (not even a last one) */
  valueRial: number | null;
  /** value − cost, only when both are known */
  profitRial: number | null;
  profitPct: number | null;
  /** the day of the last price on record when the market was shut (null: live price) */
  asOf: string | null;
}

export interface AssetGroup {
  id: string;
  kind: 'market' | 'manual';
  key: MarketKey | null;
  label: string;
  unit: string | null;
  /** sum of the lots' quantities (market only) */
  qty: number | null;
  /** priced lots only */
  valueRial: number;
  /** cost of the lots that have both a cost and a value */
  costRial: number;
  /** null when no lot has both a cost and a value */
  profitRial: number | null;
  profitPct: number | null;
  /** lots counted in the profit / lots in the group */
  costedLots: number;
  lots: AssetLot[];
  unpricedLots: number;
  /** what one unit costs now (market only) */
  unitPriceRial: number | null;
  asOf: string | null;
}

export const MANUAL_GROUP_ID = 'manual';
export const MANUAL_GROUP_LABEL = 'سایر دارایی‌ها';

const byDateDesc = (a: AssetLot, b: AssetLot) => {
  if (a.boughtOn && b.boughtOn) return a.boughtOn < b.boughtOn ? 1 : a.boughtOn > b.boughtOn ? -1 : 0;
  return a.boughtOn ? -1 : b.boughtOn ? 1 : 0; // undated purchases last
};

export function groupAssets(d: FinanceData, nw: NetWorth, items: PriceItem[]): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();
  const lotOf = (a: Asset): AssetLot => {
    const row = nw.byAsset.find((x) => x.id === a.id);
    const value = row?.rial ?? null;
    const cost = a.costRial && a.costRial > 0 ? a.costRial : null;
    const profit = cost !== null && value !== null ? value - cost : null;
    return {
      id: a.id,
      asset: a,
      name: a.name,
      qty: a.kind === 'market' ? (a.qty ?? 0) : null,
      boughtOn: a.boughtOn ?? null,
      costRial: cost,
      valueRial: value,
      profitRial: profit,
      profitPct: profit !== null && cost ? (profit / cost) * 100 : null,
      asOf: row?.asOf ?? null,
    };
  };
  for (const a of d.assets) {
    const isMarket = a.kind === 'market' && !!a.key;
    const id = isMarket ? a.key! : MANUAL_GROUP_ID;
    let g = groups.get(id);
    if (!g) {
      const meta = isMarket ? MARKET_ASSETS.find((m) => m.key === a.key) : null;
      const up = isMarket ? unitPrice(a.key!, items) : null;
      g = {
        id, kind: isMarket ? 'market' : 'manual', key: isMarket ? a.key! : null,
        label: meta?.label ?? (isMarket ? a.name : MANUAL_GROUP_LABEL), unit: meta?.unit ?? null,
        qty: isMarket ? 0 : null, valueRial: 0, costRial: 0, profitRial: null, profitPct: null, costedLots: 0, lots: [], unpricedLots: 0,
        unitPriceRial: up?.rial ?? null, asOf: up?.asOf ?? null,
      };
      groups.set(id, g);
    }
    const lot = lotOf(a);
    g.lots.push(lot);
    if (g.qty !== null) g.qty += lot.qty ?? 0;
    if (lot.valueRial === null) g.unpricedLots++;
    else g.valueRial += lot.valueRial;
    if (lot.profitRial !== null) {
      g.costRial += lot.costRial!;
      g.profitRial = (g.profitRial ?? 0) + lot.profitRial;
      g.costedLots++;
    }
  }
  for (const g of groups.values()) {
    g.lots.sort(byDateDesc);
    g.profitPct = g.profitRial !== null && g.costRial > 0 ? (g.profitRial / g.costRial) * 100 : null;
  }
  return [...groups.values()];
}

export interface AssetsSummary {
  /** priced assets, market and manual */
  totalRial: number;
  /** what was paid for the purchases the profit covers */
  costRial: number;
  profitRial: number | null;
  profitPct: number | null;
  costedLots: number;
  lots: number;
  /** assets with no price at all: left out of the total, named */
  unpriced: string[];
}

export function summarizeAssets(groups: AssetGroup[]): AssetsSummary {
  let total = 0, cost = 0, profit: number | null = null, costed = 0, lots = 0;
  const unpriced: string[] = [];
  for (const g of groups) {
    total += g.valueRial;
    lots += g.lots.length;
    costed += g.costedLots;
    if (g.profitRial !== null) {
      cost += g.costRial;
      profit = (profit ?? 0) + g.profitRial;
    }
    for (const l of g.lots) if (l.valueRial === null) unpriced.push(l.name);
  }
  return { totalRial: total, costRial: cost, profitRial: profit, profitPct: profit !== null && cost > 0 ? (profit / cost) * 100 : null, costedLots: costed, lots, unpriced };
}

export type AssetSort = 'value' | 'profit' | 'profitPct' | 'name';
export const SORT_LABEL: Record<AssetSort, string> = { value: 'بیشترین ارزش', profit: 'بیشترین سود', profitPct: 'بیشترین درصد سود', name: 'نام' };

/** Groups with no profit figure go last when sorting by profit; ties keep the value order. */
export function sortGroups(groups: AssetGroup[], by: AssetSort): AssetGroup[] {
  const key = (g: AssetGroup) => (by === 'value' ? g.valueRial : by === 'profit' ? g.profitRial : by === 'profitPct' ? g.profitPct : 0);
  return [...groups].sort((a, b) => {
    if (by === 'name') return a.label.localeCompare(b.label, 'fa');
    const x = key(a), y = key(b);
    if (x === null && y === null) return b.valueRial - a.valueRial;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || b.valueRial - a.valueRial;
  });
}
