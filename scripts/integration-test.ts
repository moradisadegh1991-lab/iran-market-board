/**
 * Every money feature in one book, checked against each other (the audit of 1405/07): personal accounts, a business
 * with a sale, loans with people (personal and the shop's), a home fund, a دنگ group, an installment loan given, an
 * asset, and a bank SMS of a loan. What one screen says must agree with what another says:
 *   – money is conserved: all accounts together = openings + income − spending;
 *   – personal income/spending leaves out own transfers, loans, the fund, the shop's sales and its loans;
 *   – net worth's parts add up, and «کی بهم بدهکاره؟» names every claim net worth counts;
 *   – an SMS of a loan is booked as that loan, not as spending (and not twice);
 *   – removing the business merges its loans into the personal person of the same name;
 *   – nothing with a person's name goes to the advisor (rule 7).
 * Run: npx tsx scripts/integration-test.ts
 */
import assert from 'node:assert';
import { answerQuestion, parseQuestion } from '../lib/assistant/ask';
import { addProduct, bizOf, quickSale, setupBusiness } from '../lib/biz/ops';
import { tehranMs } from '../lib/biz/slots';
import { deleteTxn } from '../lib/finance/actions';
import { accountBalances, advisorSummary, netWorth, totalsBetween } from '../lib/finance/calc';
import { createFund, pay } from '../lib/finance/fund';
import { choicesFor, commitStaged, enqueue, isDuplicate } from '../lib/finance/importers';
import { bookLend, detachBusinessAccounts, positions } from '../lib/finance/lending';
import { emptyData, isMoneyAccount, normalizeData, type FinanceData, type Staged } from '../lib/finance/model';
import { addExpense, createGroup } from '../lib/finance/split';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const T = '2026-10-08';
const M = 10_000_000; // a million toman in rial

function book(): FinanceData {
  const d = emptyData(T);
  d.accounts.push({ id: 'bank', name: 'بانک ملت', kind: 'bank', openingRial: 500 * M, openedOn: '2026-09-01' });
  d.accounts.push({ id: 'wallet', name: 'کیف پول', kind: 'cash', openingRial: 5 * M, openedOn: '2026-09-01' });
  setupBusiness(d, { name: 'نارنج', type: 'cafe', card: 'new', now: Date.now(), today: T });
  const b = bizOf(d);
  const latte = addProduct(b, { name: 'لاته', priceRial: 900_000 }, Date.now());
  if (typeof latte === 'string') throw new Error(latte);
  quickSale(d, { items: [{ itemId: latte.id, qty: 10 }], channel: 'walkin', pay: 'cash', at: tehranMs(T, '10:00') });
  bookLend(d, { kind: 'lend', person: 'علی', accountId: 'bank', amountRial: 20 * M, date: T });
  bookLend(d, { kind: 'lend', person: 'رضا', accountId: b.cashAccountId!, amountRial: 5_000_000, date: T });
  const fid = createFund(d, { name: 'خانواده', shareRial: 2 * M, loanRial: 10 * M, installments: 5, startMonth: '1405-7', members: [{ name: 'من', me: true }, { name: 'سارا' }] }, T) as string;
  assert.equal(pay(d, fid, d.funds[0].members[0].id, '1405-7', 'share', T, 'bank'), null);
  const gid = createGroup(d, 'سفر', [{ name: 'من', me: true }, { name: 'مینا' }], T) as string;
  const g = d.splitGroups.find((x) => x.id === gid)!;
  assert.equal(typeof addExpense(d, gid, { title: 'شام', amountRial: 4 * M, date: T, paidBy: g.members[0].id, mode: 'equal', among: g.members.map((m) => m.id) }, { accountId: 'bank' }), 'string');
  d.loans.push({ id: 'l1', name: 'قرض به برادر', direction: 'lent', principalRial: 30 * M, annualRatePct: 0, months: 10, firstDueDate: '2026-11-01', paidCount: 0 });
  return d;
}
const toman = (r: number) => r / 10;

ok('money is conserved across every feature; each account is either money or a position, never both', () => {
  const d = book();
  const bal = accountBalances(d);
  const all = d.accounts.reduce((s, a) => s + (bal[a.id] ?? 0), 0);
  const opening = d.accounts.reduce((s, a) => s + a.openingRial, 0);
  const inc = d.txns.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amountRial, 0);
  const exp = d.txns.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amountRial, 0);
  assert.equal(all, opening + inc - exp);
  const kinds = Object.fromEntries(d.accounts.map((a) => [a.kind + (a.bizId ? '/biz' : ''), isMoneyAccount(a)]));
  assert.deepEqual(kinds, { bank: true, cash: true, 'cash/biz': true, 'bank/biz': true, person: false, 'person/biz': false, homefund: false, split: false });
});

ok('personal spending is only the user’s own share of دنگ — not loans, the fund, the shop’s sale or its loan', () => {
  const t = totalsBetween(book(), '2026-10-01', T);
  assert.equal(toman(t.incomeRial), 0);
  assert.equal(toman(t.expenseRial), 2_000_000, 'half of the 4m dinner');
});

ok('net worth’s parts add up; «کی بهم بدهکاره؟» and «دارایی خالصم» name the same claims', () => {
  const d = book();
  const nw = netWorth(d, [], T);
  assert.equal(nw.netRial, nw.cashRial + nw.marketRial + nw.manualRial + nw.receivableRial - nw.debtRial);
  // Ali 20m + Reza 0.5m (the shop's) + fund 2m + دنگ 2m + the installment loan 30m
  assert.equal(toman(nw.receivableRial), 54_500_000);
  const ask = (s: string) => answerQuestion(d, [], T, parseQuestion(d, s, T)!, Date.parse(T)).text;
  const nwText = ask('دارایی خالصم چقدره؟');
  assert.match(nwText, /طلب ۵۴٬۵۰۰٬۰۰۰/, nwText);
  const owed = ask('کی بهم بدهکاره؟');
  for (const part of ['علی ۲۰٬۰۰۰٬۰۰۰', 'صندوق خانگی: خانواده ۲٬۰۰۰٬۰۰۰', 'دنگ: سفر ۲٬۰۰۰٬۰۰۰', 'وام «قرض به برادر» ۳۰٬۰۰۰٬۰۰۰']) assert.ok(owed.includes(part), `${part} in: ${owed}`);
  assert.ok(!owed.includes('رضا'), 'the shop’s debtor is the shop’s');
  assert.match(ask('کی به مغازه بدهکاره؟'), /رضا ۵۰۰٬۰۰۰/);
});

ok('a bank SMS of a loan is booked as the loan (choice «قرض»), keeps its SMS key, and the same SMS is then a duplicate', () => {
  const d = book();
  const s: Staged = { id: 's1', source: 'sms', date: T, time: '12:00', amountRial: 3 * M, direction: 'out', why: 'برداشت', description: 'انتقال به علی', raw: 'برداشت ۳۰٬۰۰۰٬۰۰۰ ریال', accountId: 'bank', smsKey: 'k1', at: Date.parse(T), importedAt: Date.parse(T) };
  enqueue(d, [s]);
  assert.deepEqual(choicesFor(s), ['expense', 'transfer-out', 'lend-out']);
  assert.match(commitStaged(d, 's1', { choice: 'lend-out', accountId: 'bank', lendKind: 'borrow', person: 'علی' }) ?? '', /کدام قرض/, 'money left the bank: not «borrowed»');
  assert.match(commitStaged(d, 's1', { choice: 'lend-out', accountId: 'bank', lendKind: 'lend', person: ' ' }) ?? '', /نام/);
  assert.equal(commitStaged(d, 's1', { choice: 'lend-out', accountId: 'bank', lendKind: 'lend', person: 'علي' }), null);
  assert.equal(toman(positions(d).find((p) => p.account.name === 'علی')!.balanceRial), 23_000_000, 'one Ali (ي = ی), now owes 23m');
  const t = d.txns.find((x) => x.smsKey === 'k1')!;
  assert.deepEqual([t.kind, t.link?.type, t.link?.mk], ['transfer', 'lend', 'lend']);
  assert.equal(toman(totalsBetween(d, '2026-10-01', T).expenseRial), 2_000_000, 'still not spending');
  assert.ok(isDuplicate(d, { ...s, id: 's2' }), 'the same SMS again is a duplicate');
  deleteTxn(d, t.id);
  assert.equal(toman(positions(d).find((p) => p.account.name === 'علی')!.balanceRial), 20_000_000);
});

ok('removing the business: its loans become personal, merged into the person of the same name', () => {
  const d = book();
  const b = bizOf(d);
  bookLend(d, { kind: 'lend', person: 'علی', accountId: b.cashAccountId!, amountRial: 1 * M, date: T });
  assert.equal(positions(d).filter((p) => p.account.name === 'علی').length, 2, 'personal and the shop’s, apart');
  detachBusinessAccounts(d, b.id);
  d.biz = null;
  const alis = positions(d).filter((p) => p.account.name === 'علی');
  assert.equal(alis.length, 1);
  assert.equal(toman(alis[0].balanceRial), 21_000_000);
  assert.ok(!d.accounts.some((a) => a.bizId), 'no account is the business’s any more');
  const bal = accountBalances(d);
  assert.equal(d.accounts.reduce((s, a) => s + (bal[a.id] ?? 0), 0), d.accounts.reduce((s, a) => s + a.openingRial, 0) + d.txns.reduce((s, t) => s + (t.kind === 'income' ? t.amountRial : t.kind === 'expense' ? -t.amountRial : 0), 0));
});

ok('the advisor gets amounts only: no person, member, group or loan name (rule 7)', () => {
  const s = JSON.stringify(advisorSummary(book(), [], T));
  for (const name of ['علی', 'رضا', 'سارا', 'مینا', 'برادر', 'خانواده', 'سفر', 'نارنج', 'لاته']) assert.ok(!s.includes(name), `${name} leaked`);
});

ok("a backup restores to the same book: loans, the fund, دنگ, the business and assets survive normalizeData", () => {
  const d = book();
  d.assets.push({ id: "a1", name: "سکه", kind: "market", key: "coin", qty: 1, costRial: 900 * M, boughtOn: "2025-10-01", usdRialAtBuy: 1_000_000, usdAtBuyFor: "2025-10-01" });
  const back = normalizeData(JSON.parse(JSON.stringify(d)), T);
  assert.deepEqual(back.accounts, d.accounts);
  assert.deepEqual(back.txns, d.txns);
  assert.deepEqual(back.assets, d.assets);
  assert.deepEqual([back.funds.length, back.splitGroups.length, !!back.biz], [1, 1, true]);
  assert.equal(netWorth(back, [], T).netRial, netWorth(d, [], T).netRial);
});

console.log(`\nintegration: ${n} checks OK`);
