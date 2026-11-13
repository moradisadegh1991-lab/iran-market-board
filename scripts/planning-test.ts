import assert from 'node:assert/strict';
import { liquidityPlan } from '../lib/finance/planning';
import { addDays } from '../lib/finance/calc';
import { emptyData } from '../lib/finance/model';
const today = '2026-11-13';
let count = 0;
function test(name: string, fn: () => void) { fn(); console.log(`✓ ${name}`); count++; }
function fixture() {
  const d = emptyData(today);
  d.accounts = [{ id: 'bank', name: 'بانک', kind: 'bank', openingRial: 100_000, openedOn: today }];
  return d;
}
test('empty book has finite zero balances and no invented spending history', () => {
  const p = liquidityPlan(emptyData(today), today);
  assert.equal(p.basisDays, 0);
  assert.equal(p.dailyRial, 0);
  assert.equal(p.endRial, 0);
  assert.equal(p.firstShortfall, null);
  assert.equal(p.points.length, 31);
});
test('business, investments, exchange wallets, archived accounts and receivables are not spendable cash', () => {
  const d = fixture();
  for (const [id, extra] of Object.entries({ business: { bizId: 'b' }, fund: { kind: 'fund' }, person: { kind: 'person' }, archive: { archived: true }, exchange: { exchange: 'aban' } })) {
    d.accounts.push({ ...d.accounts[0], id, ...extra } as typeof d.accounts[number]);
  }
  assert.equal(liquidityPlan(d, today).startRial, 100_000);
});
test('future transactions and future bank reports do not inflate today’s balance', () => {
  const d = fixture();
  d.txns.push({ id: 'future', kind: 'income', accountId: 'bank', amountRial: 900_000, date: addDays(today, 1) });
  d.accounts[0].reported = { rial: 1_000_000, date: addDays(today, 1), via: 'manual' };
  assert.equal(liquidityPlan(d, today).startRial, 100_000);
});
test('daily spending uses a minimum 30-day basis and excludes linked payments and business costs', () => {
  const d = fixture();
  d.accounts.push({ ...d.accounts[0], id: 'business', bizId: 'b' });
  d.txns = [
    { id: 'food', kind: 'expense', accountId: 'bank', amountRial: 30_000, date: today },
    { id: 'shop', kind: 'expense', accountId: 'business', amountRial: 900_000, date: today },
    { id: 'paid', kind: 'expense', accountId: 'bank', amountRial: 10_000, date: today, link: { type: 'bill', id: 'bill' } },
  ];
  const p = liquidityPlan(d, today);
  assert.equal(p.basisDays, 1);
  assert.equal(p.dailyRial, 1_000);
  assert.equal(p.startRial, 60_000);
  assert.equal(p.endRial, 30_000);
  assert.equal(liquidityPlan(d, today, 90).endRial, -30_000);
});
test('overdue outflows reduce today while late receivables never become assumed income', () => {
  const d = fixture();
  d.cheques = [
    { id: 'out', direction: 'issued', amountRial: 120_000, dueDate: addDays(today, -1), counterparty: '', status: 'pending' },
    { id: 'late', direction: 'received', amountRial: 500_000, dueDate: addDays(today, -1), counterparty: '', status: 'pending' },
    { id: 'next', direction: 'received', amountRial: 50_000, dueDate: addDays(today, 1), counterparty: '', status: 'pending' },
  ];
  const p = liquidityPlan(d, today, 30, true);
  assert.equal(p.firstShortfall?.date, today);
  assert.equal(p.low.balanceRial, -20_000);
  assert.equal(p.endRial, 30_000);
  assert.equal(p.overdueReceiptsRial, 500_000);
  assert.equal(liquidityPlan(d, today).endRial, -20_000);
});
test('a cleared cheque is not charged again; horizon includes last day, excludes following day', () => {
  const d = fixture();
  d.cheques = [
    { id: 'paid', direction: 'issued', amountRial: 500_000, dueDate: today, counterparty: '', status: 'cleared' },
    { id: 'end', direction: 'issued', amountRial: 120_000, dueDate: addDays(today, 30), counterparty: '', status: 'pending' },
    { id: 'later', direction: 'issued', amountRial: 800_000, dueDate: addDays(today, 31), counterparty: '', status: 'pending' },
  ];
  const p = liquidityPlan(d, today);
  assert.equal(p.obligationsRial, 120_000);
  assert.equal(p.firstShortfall?.date, addDays(today, 30));
  assert.equal(p.endRial, -20_000);
});
test('personal debt is payable; business debt does not consume household cash', () => {
  const d = fixture();
  d.accounts.push({ id: 'p', name: 'شخص', kind: 'person', openingRial: -25_000, openedOn: today, dueOn: today });
  d.accounts.push({ id: 'b', name: 'تجاری', kind: 'person', openingRial: -500_000, openedOn: today, dueOn: today, bizId: 'biz' });
  assert.equal(liquidityPlan(d, today).endRial, 75_000);
});
test('calculation does not mutate the financial book', () => {
  const d = fixture();
  const before = structuredClone(d);
  liquidityPlan(d, today, 90, true);
  assert.deepEqual(d, before);
});
console.log(`${count} planning tests passed`);
