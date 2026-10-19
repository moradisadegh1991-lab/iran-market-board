/**
 * «سرمایه‌ها» (rule 98): purchases of one kind are one group, the total is exactly netWorth's market + manual part
 * (rule 87), profit counts only purchases with a known cost and a known value, sorting, and an unpriced asset is
 * named, not zeroed.
 * Run: npx tsx scripts/asset-groups-test.ts
 */
import assert from 'node:assert';
import { netWorth, type PriceItem } from '../lib/finance/calc';
import { emptyData, type Asset } from '../lib/finance/model';
import { groupAssets, MANUAL_GROUP_ID, sortGroups, summarizeAssets } from '../lib/finance/asset-groups';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const T = '2026-10-10';
// toman per unit: gold 26,076,000 per gram, dollar 113,000
const items: PriceItem[] = [
  { key: 'g18', price: 26_076_000, unit: 'toman' },
  { key: 'usd', price: 113_000, unit: 'toman' },
  { key: 'nim', price: 140_100_000, unit: 'toman', asOf: '2026-10-08' },
];
const M = (id: string, key: Asset['key'], qty: number, cost: number | null, boughtOn: string | null): Asset => ({ id, name: String(key), kind: 'market', key, qty, costRial: cost === null ? null : cost * 10, boughtOn });

function book() {
  const d = emptyData(T);
  d.assets = [
    M('g1', 'g18', 9.21, 97_000_000, '2025-10-14'),
    M('g2', 'g18', 8, 112_000_000, '2025-09-23'),
    M('g3', 'g18', 20, null, null), // no cost: no profit, still in the value
    M('g4', 'g18', 6, 29_300_000, '2024-12-15'),
    M('u1', 'usd', 10_000, 762_700_000, '2025-02-01'),
    M('n1', 'nim', 1, 25_000_000, '2024-03-01'),
    M('x1', 'btc', 0.5, 1e9, '2025-01-01'), // no price in `items`
    { id: 'm1', name: 'پژو ۲۰۷', kind: 'manual', valueRial: 9e9, liquid: false, costRial: 6e9, boughtOn: '2023-05-01' },
    { id: 'm2', name: 'ودیعه رهن', kind: 'manual', valueRial: 5e9, liquid: false },
  ];
  return d;
}

ok('one group per kind, purchases are lots newest first (undated last), quantities add up, unit price and price day kept', () => {
  const d = book();
  const g = groupAssets(d, netWorth(d, items, T), items);
  assert.deepEqual(g.map((x) => x.id).sort(), ['btc', 'g18', MANUAL_GROUP_ID, 'nim', 'usd'].sort());
  const gold = g.find((x) => x.id === 'g18')!;
  assert.equal(gold.label, 'طلای ۱۸ عیار');
  assert.equal(gold.unit, 'گرم');
  assert.deepEqual(gold.lots.map((l) => l.id), ['g1', 'g2', 'g4', 'g3']);
  assert.ok(Math.abs(gold.qty! - (9.21 + 8 + 20 + 6)) < 1e-9);
  assert.equal(gold.unitPriceRial, 260_760_000);
  assert.equal(g.find((x) => x.id === 'nim')!.asOf, '2026-10-08', 'a last price carries its day');
  const manual = g.find((x) => x.id === MANUAL_GROUP_ID)!;
  assert.equal(manual.qty, null);
  assert.deepEqual(manual.lots.map((l) => l.id), ['m1', 'm2']);
});

ok('the total is exactly netWorth’s market + manual part; an asset with no price is named and left out, not zeroed', () => {
  const d = book();
  const nw = netWorth(d, items, T);
  const g = groupAssets(d, nw, items);
  const s = summarizeAssets(g);
  assert.equal(s.totalRial, nw.marketRial + nw.manualRial);
  assert.deepEqual(s.unpriced, [d.assets.find((a) => a.id === 'x1')!.name]);
  const btc = g.find((x) => x.id === 'btc')!;
  assert.equal(btc.valueRial, 0);
  assert.equal(btc.unpricedLots, 1);
  assert.equal(btc.profitRial, null, 'no value → no profit');
  assert.equal(s.lots, d.assets.length);
});

ok('profit: only purchases with a cost and a value; percent is over the cost of those', () => {
  const d = book();
  const nw = netWorth(d, items, T);
  const g = groupAssets(d, nw, items);
  const gold = g.find((x) => x.id === 'g18')!;
  assert.equal(gold.costedLots, 3, 'the purchase without a cost is not in the profit');
  const costed = gold.lots.filter((l) => l.profitRial !== null);
  const value = costed.reduce((s, l) => s + l.valueRial!, 0);
  const cost = costed.reduce((s, l) => s + l.costRial!, 0);
  assert.equal(gold.profitRial, value - cost);
  assert.ok(Math.abs(gold.profitPct! - ((value - cost) / cost) * 100) < 1e-9);
  assert.equal(gold.lots.find((l) => l.id === 'g3')!.profitRial, null);
  // a group whose purchases have no cost at all has no profit figure
  assert.equal(g.find((x) => x.id === MANUAL_GROUP_ID)!.costedLots, 1);
  const s = summarizeAssets(g);
  assert.equal(s.costedLots, g.reduce((a, x) => a + x.costedLots, 0));
  assert.equal(s.profitRial, g.reduce((a, x) => a + (x.profitRial ?? 0), 0));
  assert.ok(Math.abs(s.profitPct! - (s.profitRial! / s.costRial) * 100) < 1e-9);
  // nothing with a cost → no profit at all (not "profit = everything")
  const d2 = emptyData(T);
  d2.assets = [M('a', 'g18', 5, null, null)];
  const s2 = summarizeAssets(groupAssets(d2, netWorth(d2, items, T), items));
  assert.equal(s2.profitRial, null);
  assert.equal(s2.profitPct, null);
  assert.ok(s2.totalRial > 0);
});

ok('sorting: value, profit (no-profit groups last), percent, name; the input is not changed', () => {
  const d = book();
  const g = groupAssets(d, netWorth(d, items, T), items);
  const ids = (xs: typeof g) => xs.map((x) => x.id);
  const byValue = sortGroups(g, 'value');
  for (let i = 1; i < byValue.length; i++) assert.ok(byValue[i - 1].valueRial >= byValue[i].valueRial);
  const byProfit = sortGroups(g, 'profit');
  assert.equal(byProfit[byProfit.length - 1].profitRial, null, 'btc has none');
  for (let i = 1; i < byProfit.length - 1; i++) assert.ok(byProfit[i - 1].profitRial! >= byProfit[i].profitRial!);
  const byPct = sortGroups(g, 'profitPct');
  for (let i = 1; i < byPct.length - 1; i++) assert.ok(byPct[i - 1].profitPct! >= byPct[i].profitPct!);
  assert.deepEqual(ids(sortGroups(g, 'name')).length, g.length);
  assert.deepEqual(ids(g), ids(groupAssets(d, netWorth(d, items, T), items)), 'sort returned a copy');
});

ok('an empty book has no groups and a zero total', () => {
  const d = emptyData(T);
  const g = groupAssets(d, netWorth(d, items, T), items);
  assert.deepEqual(g, []);
  const s = summarizeAssets(g);
  assert.equal(s.totalRial, 0);
  assert.equal(s.profitRial, null);
});

console.log(`\n${n} asset-group checks passed`);
