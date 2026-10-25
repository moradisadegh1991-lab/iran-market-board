/**
 * اهداف با قیمت دیجی‌کالا و «وام خرید کالا یا پس‌انداز؟» (lib/finance/goal-price.ts, bnpl.ts, rule 105): the target is the
 * product's price × qty and follows each read; reads come due twice a month (a failed one waits a day); the product's own
 * trend is used only with ≥ 90 days and ≥ 3 prices; the loan's installment and real yearly cost match hand-computed
 * values; the comparison follows the money, both ways.
 * Run: npx tsx scripts/goal-price-test.ts
 */
import assert from 'node:assert';
import type { DkProduct } from '../lib/digikala/parse';
import { effectiveAnnualPct, installment, loanVsSave } from '../lib/finance/bnpl';
import { addGoalPrice, GOAL_REFRESH_MS, goalGrowth, goalsDue, lastPrice, linkGoalProduct, noteGoalTry, productTrend, unlinkGoalProduct } from '../lib/finance/goal-price';
import { goalPlan } from '../lib/finance/calc';
import type { Goal } from '../lib/finance/model';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const DAY = 86_400_000;
const T0 = Date.parse('2026-10-25T12:00:00+03:30');
const P = (priceRial: number | null, id = 9001): DkProduct => ({ id, title: 'یخچال ساید بای ساید', priceRial, rrpRial: null, discountPct: 0, available: !!priceRial, url: `https://www.digikala.com/product/dkp-${id}/`, image: null });
const goal = (): Goal => ({ id: 'g1', name: 'یخچال', targetRial: 1, targetDate: '2027-10-25', savedRial: 50_000_000, inflationAdjust: true });

ok('linking a product: target = price × qty; each read adds a point and the target follows; another product is not applied', () => {
  const g = goal();
  linkGoalProduct(g, P(1_200_000_000), 2, T0);
  assert.deepEqual([g.targetRial, g.followPrice, g.dk!.qty, g.dk!.history.length], [2_400_000_000, true, 2, 1]);
  addGoalPrice(g, P(1_300_000_000), T0 + 15 * DAY);
  assert.equal(g.targetRial, 2_600_000_000);
  addGoalPrice(g, P(null), T0 + 30 * DAY);
  assert.equal(g.targetRial, 2_600_000_000, 'out of stock: the last price stays the target');
  assert.equal(lastPrice(g)!.priceRial, 1_300_000_000);
  addGoalPrice(g, P(1, 42), T0 + 31 * DAY);
  assert.equal(g.dk!.history.length, 3, 'another product: ignored');
  g.followPrice = false;
  addGoalPrice(g, P(1_500_000_000), T0 + 45 * DAY);
  assert.equal(g.targetRial, 2_600_000_000, 'not following: the target the user set stays');
  unlinkGoalProduct(g);
  assert.deepEqual([g.dk, g.followPrice], [null, false]);
});

ok('due twice a month; a failed read waits a day; goals without a product never', () => {
  const g = goal();
  linkGoalProduct(g, P(1_000_000_000), 1, T0);
  assert.deepEqual(goalsDue([g, goal()], T0 + 14 * DAY), []);
  assert.deepEqual(goalsDue([g], T0 + GOAL_REFRESH_MS).map((x) => x.id), ['g1']);
  noteGoalTry(g, T0 + GOAL_REFRESH_MS);
  assert.deepEqual(goalsDue([g], T0 + GOAL_REFRESH_MS + 23 * 3_600_000), []);
  assert.equal(goalsDue([g], T0 + GOAL_REFRESH_MS + 25 * 3_600_000).length, 1);
});

ok('the product\'s own trend only with ≥ 90 days and ≥ 3 prices; otherwise the inflation setting', () => {
  const g = goal();
  linkGoalProduct(g, P(1_000_000_000), 1, T0);
  addGoalPrice(g, P(1_050_000_000), T0 + 60 * DAY);
  assert.equal(productTrend(g), null, '60 days, 2 prices');
  assert.deepEqual(goalGrowth(g, 40), { pct: 40, basis: 'inflation' });
  addGoalPrice(g, P(1_100_000_000), T0 + 120 * DAY);
  const t = productTrend(g)!;
  // exact growth 10% in 120 days → ≈ (1.1)^(365.25/120) − 1 ≈ 33.6% a year; the fit through 1.05 at day 60 is near it
  assert.ok(Math.abs(t.annualPct - 33.6) < 2.5, `trend ${t.annualPct}`);
  assert.equal(goalGrowth(g, 40).basis, 'product');
  // the plan uses that growth for the date's price
  const pl = goalPlan(g, '2026-10-25', goalGrowth(g, 40).pct, 30);
  assert.ok(pl.futureTargetRial > g.targetRial * 1.3 && pl.futureTargetRial < g.targetRial * 1.38);
});

ok('the installment and the real yearly cost, by hand: flat 24% ≈ 50.7% a year, declining 24% = 26.8%', () => {
  assert.ok(Math.abs(installment(10_000_000, 24, 12, 'flat') - 1_033_333.33) < 0.01);
  assert.ok(Math.abs(installment(10_000_000, 24, 12, 'declining') - 945_595.97) < 0.01);
  assert.ok(Math.abs(effectiveAnnualPct(10_000_000, 1_033_333.33, 12) - 50.67) < 0.05);
  assert.ok(Math.abs(effectiveAnnualPct(10_000_000, installment(10_000_000, 24, 12, 'declining'), 12) - 26.82) < 0.05);
  assert.equal(installment(10_000_000, 0, 10, 'declining'), 1_000_000);
});

ok('loan or save: a steady price and a paying fund → saving; a price racing ahead and a cheap loan → the loan; money already there → buy now', () => {
  const a = loanVsSave({ priceRial: 100_000_000, savedRial: 0, downPct: 0, months: 12, ratePct: 24, rateKind: 'flat', growthPct: 0, saveYieldPct: 30 });
  assert.equal(a.verdict, 'save');
  assert.ok(a.saveBuyMonth! >= 8 && a.saveBuyMonth! <= 10, `bought at ${a.saveBuyMonth}`);
  assert.ok(Math.abs(a.totalPaidRial - 124_000_000) < 1);
  assert.ok(a.diffRial > 0);
  const b = loanVsSave({ priceRial: 100_000_000, savedRial: 0, downPct: 0, months: 12, ratePct: 0, rateKind: 'declining', growthPct: 200, saveYieldPct: 0 });
  assert.equal(b.verdict, 'loan');
  assert.ok(b.saveLeftRial < 0, 'by the end of the term the money still does not reach the price');
  const c = loanVsSave({ priceRial: 100_000_000, savedRial: 120_000_000, downPct: 20, months: 6, ratePct: 24, rateKind: 'flat', growthPct: 40, saveYieldPct: 30 });
  assert.equal(c.saveBuyMonth, 0);
  assert.equal(c.verdict, 'save');
  assert.equal(c.downRial, 20_000_000);
  assert.equal(c.loanRial, 80_000_000);
  // a 0% loan, a price that does not move and money that earns nothing: the same either way
  const e = loanVsSave({ priceRial: 100_000_000, savedRial: 0, downPct: 0, months: 12, ratePct: 0, rateKind: 'declining', growthPct: 0, saveYieldPct: 0 });
  assert.equal(e.verdict, 'even');
});

console.log(`\n${n} goal-price checks passed`);
