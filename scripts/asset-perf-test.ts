/**
 * Assets since purchase (rule 83): inflation from the World Bank CPI (official) and the user's rate after it (assumed),
 * growth in toman, in dollars of each day, and after inflation; the price on a past day never comes from after it.
 * Run: npx tsx scripts/asset-perf-test.ts
 */
import assert from 'node:assert';
import { CPI_OFFICIAL_UNTIL, inflationBetween } from '../lib/finance/inflation';
import { assetPerformance, portfolioPerformance } from '../lib/finance/performance';
import { closeOnOrBefore } from '../lib/long-history';
import { emptyData, type Asset } from '../lib/finance/model';
import { answerQuestion, parseQuestion } from '../lib/assistant/ask';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const near = (a: number, b: number, eps = 0.05) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

ok('inflation: official between two mid-years is the ratio of the CPI averages; after the series, the user’s rate', () => {
  const a = inflationBetween('2019-07-01', '2024-07-01', 40)!;
  near(a.pct, (2834.84629484158 / 550.929425291206 - 1) * 100);
  assert.equal(a.basis, 'official');
  const b = inflationBetween('2025-07-01', '2026-07-01', 40)!;
  near(b.pct, 40, 0.2);
  assert.equal(b.basis, 'assumed');
  assert.equal(inflationBetween('2025-01-01', '2026-01-01', 40)!.basis, 'partly-assumed');
  assert.equal(CPI_OFFICIAL_UNTIL, '2025-07-01');
  assert.equal(inflationBetween('2003-01-01', '2020-01-01', 40), null, 'no figure before the series');
  // half way between two yearly averages is the geometric middle (a constant monthly rate)
  const half = inflationBetween('2023-07-01', '2024-01-01', 40)!.pct;
  near(half, (Math.sqrt(2834.84629484158 / 2140.21942916994) - 1) * 100, 0.5);
});

const T = '2026-07-01';
const asset = (p: Partial<Asset>): Asset => ({ id: 'a', name: 'سکه', kind: 'manual', valueRial: 3e9, ...p });

ok('one asset: toman growth, dollars of each day, real growth and the verdicts', () => {
  // bought for 100m toman when the dollar was 500k; worth 300m now with the dollar at 1m
  const p = assetPerformance(asset({ costRial: 1e9, boughtOn: '2023-07-01', usdRialAtBuy: 5e6, usdAtBuyFor: '2023-07-01' }), 3e9, 1e7, T, 40)!;
  near(p.growthPct, 200);
  near(p.costUsd!, 200, 1e-6);
  near(p.valueUsd!, 300, 1e-6);
  near(p.usdGrowthPct!, 50);
  near(p.dollarMovePct!, 100);
  const infl = (4030.3356899712 / 2140.21942916994) * 1.4; // official to mid-2025, then 40% a year
  near(p.inflation!.pct, (infl - 1) * 100, 0.3);
  near(p.realPct!, (3 / infl - 1) * 100, 0.3);
  assert.equal(p.vsDollar, 'beat');
  assert.equal(p.vsInflation, 'beat');
  near(p.years, 3, 0.01);
  near(p.annualPct!, (Math.pow(3, 1 / 3) - 1) * 100, 0.05);
});

ok('no figure without a purchase date and amount, a value, or with a future date; no dollar figure without the day’s dollar', () => {
  assert.equal(assetPerformance(asset({ costRial: null, boughtOn: '2024-01-01' }), 1e9, 1e7, T, 40), null);
  assert.equal(assetPerformance(asset({ costRial: 1e9, boughtOn: null }), 1e9, 1e7, T, 40), null);
  assert.equal(assetPerformance(asset({ costRial: 1e9, boughtOn: '2026-08-01' }), 1e9, 1e7, T, 40), null);
  const p = assetPerformance(asset({ costRial: 1e9, boughtOn: '2024-01-01' }), 2e9, 1e7, T, 40)!;
  assert.equal(p.usdGrowthPct, null);
  assert.equal(p.vsDollar, null);
  assert.ok(p.realPct != null);
});

ok('all assets: cost and value added up, dollars of each day, inflation weighted by what was paid', () => {
  const a = assetPerformance(asset({ id: 'a', costRial: 1e9, boughtOn: '2023-07-01', usdRialAtBuy: 5e6 }), 3e9, 1e7, T, 40)!;
  const b = assetPerformance(asset({ id: 'b', costRial: 2e9, boughtOn: '2025-07-01', usdRialAtBuy: 8e6 }), 2e9, 1e7, T, 40)!;
  const t = portfolioPerformance([a, b])!;
  near(t.growthPct, (5e9 / 3e9 - 1) * 100);
  near(t.costUsd!, 200 + 250, 1e-6);
  near(t.valueUsd!, 300 + 200, 1e-6);
  const costToday = 1e9 * (1 + a.inflation!.pct / 100) + 2e9 * 1.4;
  near(t.realPct!, (5e9 / costToday - 1) * 100, 0.3);
  assert.equal(portfolioPerformance([]), null);
});

ok('price on a past day: that day, or the last trading day before it — never after (rule 4)', () => {
  const s: [string, number][] = [
    ['2024-01-01', 10],
    ['2024-01-03', 12],
    ['2024-01-06', 15],
  ];
  assert.deepEqual(closeOnOrBefore(s, '2024-01-03'), { date: '2024-01-03', value: 12 });
  assert.deepEqual(closeOnOrBefore(s, '2024-01-05'), { date: '2024-01-03', value: 12 });
  assert.deepEqual(closeOnOrBefore(s, '2030-01-01'), { date: '2024-01-06', value: 15 });
  assert.equal(closeOnOrBefore(s, '2023-12-31'), null);
});

ok('the assistant: «دارایی‌هام از تورم جلو زدن؟» answers from the same figures; without dates it says what to enter', () => {
  const d = emptyData(T);
  const q = parseQuestion(d, 'دارایی‌هام از تورم جلو زدن؟', T);
  assert.ok(q && q.type === 'more', 'parsed');
  assert.match(answerQuestion(d, [], T, q).text, /تاریخ و مبلغ خرید/);
  d.assets.push(asset({ costRial: 1e9, boughtOn: '2023-07-01', usdRialAtBuy: 5e6 }));
  const items = [{ key: 'usd', label: 'دلار', price: 1_000_000, unit: 'toman' as const, changePct: 0 }];
  const r = answerQuestion(d, items, T, parseQuestion(d, 'سکه نسبت به دلار چطور بوده؟', T)!);
  assert.match(r.text, /^سکه در ۳ سال: ۲۰۰٪ تومانی، ۵۰٪ دلاری/);
  assert.match(r.speech, /از دلار جلو زده و از تورم جلو زده/);
});

console.log(`\nasset performance: ${n} checks OK`);
