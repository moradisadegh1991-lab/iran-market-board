/** Pins the personal-finance arithmetic in lib/finance/calc.ts. Run: npx tsx scripts/finance-test.ts */
import assert from 'node:assert';
import { jalaliToIso } from '../lib/jalali';
import {
  accountBalances,
  addJalaliMonths,
  advisorSummary,
  budgetStatus,
  cashForecast,
  goalPlan,
  impliedAnnualRatePct,
  khumsRial,
  loanSchedule,
  loanState,
  monthOf,
  monthTotals,
  monthlyAverages,
  netWorth,
  realReturnPct,
  unitPriceRial,
  upcoming,
  type PriceItem,
} from '../lib/finance/calc';
import { deleteTxn, settleDue } from '../lib/finance/actions';
import { emptyData, normalizeData, tomanToRial, type FinanceData } from '../lib/finance/model';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const TODAY = jalaliToIso(1405, 7, 10); // ۱۰ مهر ۱۴۰۵

ok('Jalali month arithmetic clamps to month length', () => {
  // ۳۱ شهریور + ۱ ماه → ۳۰ مهر (Mehr has 30 days)
  assert.equal(addJalaliMonths(jalaliToIso(1405, 6, 31), 1), jalaliToIso(1405, 7, 30));
  // across the year boundary
  assert.equal(addJalaliMonths(jalaliToIso(1405, 12, 5), 2), jalaliToIso(1406, 2, 5));
  assert.deepEqual(monthOf(TODAY), { jy: 1405, jm: 7 });
});

ok('annuity loan schedule matches the bank formula and repays exactly the principal', () => {
  const P = tomanToRial(100_000_000);
  const s = loanSchedule({ principalRial: P, annualRatePct: 23, months: 36, firstDueDate: TODAY });
  const r = 23 / 1200;
  const A = (P * r * (1 + r) ** 36) / ((1 + r) ** 36 - 1);
  near(s[0].paymentRial, A, 1, 'first installment');
  // ~3.87M toman a month is the well-known figure for 100M at 23% over 3 years
  near(s[0].paymentRial / 10, 3_871_000, 2_000, 'installment in toman');
  assert.equal(s.reduce((a, x) => a + x.principalRial, 0), P, 'principal sums to the loan');
  assert.equal(s[35].remainingRial, 0);
  assert.equal(s[1].dueDate, jalaliToIso(1405, 8, 10));
  const zero = loanSchedule({ principalRial: 1200, annualRatePct: 0, months: 12, firstDueDate: TODAY });
  assert.ok(zero.every((x) => x.paymentRial === 100 && x.interestRial === 0));
});

ok('loan state: paid count, overdue installments', () => {
  const l = { id: 'l1', name: 'وام', direction: 'borrowed' as const, principalRial: 12_000, annualRatePct: 0, months: 12, firstDueDate: jalaliToIso(1405, 5, 1), paidCount: 1 };
  const st = loanState(l, TODAY);
  assert.equal(st.remainingPrincipalRial, 11_000);
  // due ۱ شهریور and ۱ مهر, both before ۱۰ مهر, unpaid
  assert.equal(st.overdue.length, 2);
  assert.equal(st.next?.n, 2);
});

function sample(): FinanceData {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'a-bank', name: 'ملت', kind: 'bank', openingRial: tomanToRial(50_000_000), openedOn: TODAY });
  d.txns.push(
    { id: 't1', date: jalaliToIso(1405, 7, 1), kind: 'income', amountRial: tomanToRial(40_000_000), accountId: 'a-bank', categoryId: 'i-salary' },
    { id: 't2', date: jalaliToIso(1405, 7, 3), kind: 'expense', amountRial: tomanToRial(6_000_000), accountId: 'a-bank', categoryId: 'c-food', note: 'رستوران با علی' },
    { id: 't3', date: jalaliToIso(1405, 7, 4), kind: 'transfer', amountRial: tomanToRial(2_000_000), accountId: 'a-bank', toAccountId: 'a-cash' },
    { id: 't4', date: jalaliToIso(1405, 7, 5), kind: 'expense', amountRial: tomanToRial(1_000_000), accountId: 'a-cash', categoryId: 'c-transport' },
    { id: 't5', date: jalaliToIso(1405, 6, 20), kind: 'expense', amountRial: tomanToRial(3_000_000), accountId: 'a-bank', categoryId: 'c-food' },
  );
  return d;
}

ok('balances follow transfers; transfers are not income or spending', () => {
  const d = sample();
  const b = accountBalances(d);
  assert.equal(b['a-bank'], tomanToRial(50_000_000 + 40_000_000 - 6_000_000 - 2_000_000 - 3_000_000));
  assert.equal(b['a-cash'], tomanToRial(2_000_000 - 1_000_000));
  const t = monthTotals(d, { jy: 1405, jm: 7 });
  assert.equal(t.incomeRial, tomanToRial(40_000_000));
  assert.equal(t.expenseRial, tomanToRial(7_000_000));
  near(t.savingsRatePct!, 82.5, 1e-9, 'savings rate');
  assert.equal(t.byCategory[0].categoryId, 'c-food');
});

ok('budget pace flags spending ahead of the calendar', () => {
  const d = sample();
  d.budgets.push({ categoryId: 'c-food', monthlyRial: tomanToRial(10_000_000) }, { categoryId: 'c-transport', monthlyRial: tomanToRial(10_000_000) });
  const lines = budgetStatus(d, { jy: 1405, jm: 7 }, TODAY);
  const food = lines.find((x) => x.categoryId === 'c-food')!;
  // 60% used on day 10 of 30 → hot, not over
  near(food.usedPct, 60, 1e-9, 'used');
  near(food.pacePct, (10 / 30) * 100, 1e-9, 'pace');
  assert.equal(food.status, 'hot');
  assert.equal(lines.find((x) => x.categoryId === 'c-transport')!.status, 'ok');
});

ok('averages are not extrapolated from a few days of records', () => {
  const d = emptyData(TODAY);
  d.txns.push({ id: 'x', date: TODAY, kind: 'expense', amountRial: 1000, accountId: 'a-cash' });
  const a = monthlyAverages(d, TODAY);
  assert.equal(a.expenseRial, 1000); // one day of data is not multiplied into a month
  assert.equal(a.basisDays, 1);
});

ok('upcoming: installments, cheques and bills; paid bill months drop out', () => {
  const d = sample();
  d.loans.push({ id: 'l', name: 'وام مسکن', direction: 'borrowed', principalRial: 120_000, annualRatePct: 0, months: 12, firstDueDate: jalaliToIso(1405, 7, 15), paidCount: 0 });
  d.cheques.push({ id: 'c', direction: 'issued', amountRial: 5_000, dueDate: jalaliToIso(1405, 7, 20), counterparty: 'آقای احمدی', status: 'pending' });
  d.bills.push({ id: 'b', name: 'اجاره', amountRial: 30_000, dueDay: 5, categoryId: 'c-home', paidMonths: [], active: true });
  let u = upcoming(d, TODAY, 30);
  // اجاره ۵ مهر (overdue) + ۵ آبان; قسط ۱۵ مهر; چک ۲۰ مهر
  assert.deepEqual(u.map((x) => x.type), ['bill', 'loan', 'cheque', 'bill']);
  assert.ok(u[0].overdue && !u[1].overdue);
  d.bills[0].paidMonths.push('1405-7');
  u = upcoming(d, TODAY, 30);
  assert.equal(u.filter((x) => x.type === 'bill').length, 1);
  const f = cashForecast(d, TODAY, 30);
  assert.equal(f.points.length, 31);
  assert.ok(f.low.balanceRial < f.startRial);
});

ok('net worth converts USD-quoted coins through tether, never as toman', () => {
  const items: PriceItem[] = [
    { key: 'usdt', price: 100_000, unit: 'toman' },
    { key: 'btc', price: 60_000, unit: 'usd' },
    { key: 'g18', price: 8_000_000, unit: 'toman' },
  ];
  assert.equal(unitPriceRial('btc', items), 60_000 * 100_000 * 10);
  assert.equal(unitPriceRial('coin', items), null);
  const d = emptyData(TODAY);
  d.assets.push(
    { id: '1', name: 'بیت‌کوین', kind: 'market', key: 'btc', qty: 0.01 },
    { id: '2', name: 'طلا', kind: 'market', key: 'g18', qty: 10 },
    { id: '3', name: 'سکه', kind: 'market', key: 'coin', qty: 1 },
    { id: '4', name: 'خودرو', kind: 'manual', valueRial: tomanToRial(900_000_000) },
  );
  d.loans.push({ id: 'l', name: 'وام', direction: 'borrowed', principalRial: tomanToRial(100_000_000), annualRatePct: 0, months: 10, firstDueDate: TODAY, paidCount: 0 });
  const nw = netWorth(d, items, TODAY);
  assert.equal(nw.marketRial, tomanToRial(0.01 * 60_000 * 100_000 + 10 * 8_000_000));
  assert.deepEqual(nw.unpriced, ['سکه']);
  assert.equal(nw.debtRial, tomanToRial(100_000_000));
  assert.equal(nw.netRial, nw.marketRial + tomanToRial(900_000_000) - tomanToRial(100_000_000));
  assert.equal(nw.liquidRial, nw.marketRial); // the car is not liquid
});

ok('goal planning applies inflation and the fixed-income hurdle', () => {
  const g = { id: 'g', name: 'خودرو', targetRial: 1_200_000, targetDate: '2027-10-02', savedRial: 0, inflationAdjust: false };
  const p0 = goalPlan(g, '2026-10-02', 40, 0);
  near(p0.monthsLeft, 365 / 30.44, 1e-9, 'months');
  near(p0.monthlyNoReturnRial, 1_200_000 / (365 / 30.44), 1, 'no-return monthly');
  const pi = goalPlan({ ...g, inflationAdjust: true }, '2026-10-02', 40, 30);
  near(pi.futureTargetRial, 1_200_000 * 1.4 ** (365 / 30.44 / 12), 1, 'inflated target');
  assert.ok(pi.monthlyAtSafeYieldRial < pi.monthlyNoReturnRial, 'earning a yield needs less saving');
  assert.ok(pi.realSafeYieldPct < 0, '30% fund under 40% inflation is a real loss');
  near(realReturnPct(30, 40), (1.3 / 1.4 - 1) * 100, 1e-9, 'real return');
  assert.equal(khumsRial(1000, 600), 80);
  assert.equal(khumsRial(500, 600), 0);
});

ok('advisor summary is numbers-only: no notes, no cheque counterparties, no account names', () => {
  const d = sample();
  d.cheques.push({ id: 'c', direction: 'issued', amountRial: 5_000, dueDate: jalaliToIso(1405, 7, 20), counterparty: 'آقای احمدی', status: 'pending' });
  const s = JSON.stringify(advisorSummary(d, [], TODAY));
  assert.ok(!s.includes('احمدی'), 'counterparty leaked');
  assert.ok(!s.includes('رستوران با علی'), 'note leaked');
  assert.ok(!s.includes('ملت'), 'account name leaked');
  const parsed = JSON.parse(s);
  assert.equal(parsed.thisMonth.incomeToman, 40_000_000);
  assert.equal(parsed.thisMonth.expenseToman, 7_000_000);
});

ok('backup import rejects foreign files and keeps real ones intact', () => {
  assert.throws(() => normalizeData({ foo: 1 }, TODAY));
  assert.throws(() => normalizeData(null, TODAY));
  const d = sample();
  const back = normalizeData(JSON.parse(JSON.stringify(d)), TODAY);
  assert.deepEqual(back, d);
});

ok('installment offers reveal their hidden rate', () => {
  // build an offer from a known 30% loan and recover the rate
  const s = loanSchedule({ principalRial: 90_000_000, annualRatePct: 30, months: 12, firstDueDate: TODAY });
  near(impliedAnnualRatePct(100_000_000, 10_000_000, s[0].paymentRial, 12)!, 30, 0.01, 'implied rate');
  assert.equal(impliedAnnualRatePct(100, 0, 8, 12), null); // pays back less than financed
  near(impliedAnnualRatePct(1200, 0, 100, 12)!, 0, 1e-6, 'zero-interest offer');
});

ok('settling a due records the money once and deleting it re-opens the obligation', () => {
  const d = sample();
  d.loans.push({ id: 'l', name: 'وام', direction: 'borrowed', principalRial: 120_000, annualRatePct: 0, months: 12, firstDueDate: jalaliToIso(1405, 7, 1), paidCount: 0 });
  d.bills.push({ id: 'b', name: 'شارژ', amountRial: 30_000, dueDay: 5, categoryId: 'c-bills', paidMonths: [], active: true });
  const dues = upcoming(d, TODAY, 30);
  const second = dues.find((x) => x.type === 'loan' && x.n === 2)!;
  assert.match(settleDue(d, second, 'a-bank', TODAY)!, /ترتیب/); // out of order is refused
  const before = accountBalances(d)['a-bank'];
  assert.equal(settleDue(d, dues.find((x) => x.type === 'loan' && x.n === 1)!, 'a-bank', TODAY), null);
  assert.equal(settleDue(d, dues.find((x) => x.type === 'bill')!, 'a-bank', TODAY), null);
  assert.equal(d.loans[0].paidCount, 1);
  assert.deepEqual(d.bills[0].paidMonths, ['1405-7']);
  assert.equal(accountBalances(d)['a-bank'], before - 10_000 - 30_000);
  const loanTxn = d.txns.find((t) => t.link?.type === 'loan')!;
  deleteTxn(d, loanTxn.id);
  assert.equal(d.loans[0].paidCount, 0);
  deleteTxn(d, d.txns.find((t) => t.link?.type === 'bill')!.id);
  assert.deepEqual(d.bills[0].paidMonths, []);
  assert.equal(accountBalances(d)['a-bank'], before);
});

console.log(`\n${n} finance checks passed`);
