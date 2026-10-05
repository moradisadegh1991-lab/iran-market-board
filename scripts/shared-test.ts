/**
 * Pins the home fund (صندوق خانگی, lib/finance/fund.ts) and shared expenses (دنگ, lib/finance/split.ts):
 * the sums, the fair turns, and that the user's own money lands in their book once, as the right kind.
 * Run: npx tsx scripts/shared-test.ts
 */
import assert from 'node:assert';
import { accountBalances, monthTotals, monthOf, netWorth } from '../lib/finance/calc';
import { deleteTxn } from '../lib/finance/actions';
import { createFund, drawLottery, dueFor, eligible, fundCash, giveLoan, installmentNo, installmentRial, memberState, myPosition, nextMonth, pay, undoLoan, undoPayment } from '../lib/finance/fund';
import { addExpense, createGroup, deleteExpense, linkCandidates, netOf, settle, settleUp, splitAmount, undoSettlement } from '../lib/finance/split';
import { emptyData, normalizeData, type FinanceData } from '../lib/finance/model';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-05'; // ۱۳ مهر ۱۴۰۵
const MEHR = '1405-7';
const M = 10_000_000; // one million toman in rial
function book(): FinanceData {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'b', name: 'بانک', kind: 'bank', openingRial: 100 * M, openedOn: '2026-09-01' });
  return d;
}

// ── صندوق خانگی ─────────────────────────────────────────────────────────────

function fundBook() {
  const d = book();
  const id = createFund(
    d,
    { name: 'خانوادگی', shareRial: 2 * M, loanRial: 10 * M, installments: 3, startMonth: MEHR, members: [{ name: 'من', me: true }, { name: 'علی', shares: 2 }, { name: 'سارا' }, { name: '' }] },
    TODAY,
  ) as string;
  const f = d.funds.find((x) => x.id === id)!;
  return { d, f, me: f.members[0].id, ali: f.members[1].id, sara: f.members[2].id };
}

ok('fund: members, shares and the user’s own account', () => {
  const { d, f } = fundBook();
  assert.equal(f.members.length, 3, 'an empty name is not a member');
  assert.equal(d.accounts.find((a) => a.id === f.accountId)!.kind, 'homefund');
  assert.deepEqual(createFund(d, { name: '', shareRial: 0, loanRial: 0, installments: 0, startMonth: MEHR, members: [{ name: 'تنها' }] }, TODAY), [
    'نام صندوق را بنویسید.',
    'مبلغ سهم ماهانه را بنویسید.',
    'مبلغ وام را بنویسید.',
    'تعداد اقساط حداقل یک است.',
    'دست‌کم دو عضو لازم است.',
  ]);
});

ok('fund: dues — shares × share, installments from the month after the loan, adding up exactly', () => {
  assert.deepEqual([1, 2, 3].map((k) => installmentRial({ rial: 10 * M, installments: 3 }, k)), [33_333_330, 33_333_330, 33_333_340]);
  const l = { month: MEHR, installments: 3 };
  assert.deepEqual([MEHR, nextMonth(MEHR), nextMonth(MEHR, 3), nextMonth(MEHR, 4)].map((m) => installmentNo(l, m)), [0, 1, 3, 0]);
  const { f, ali } = fundBook();
  assert.equal(dueFor(f, ali, MEHR).shareRial, 4 * M, 'two shares');
  assert.equal(dueFor(f, ali, '1405-6').shareRial, 0, 'before the fund started');
});

ok('fund: the user’s share moves money in their book as a transfer, never as spending', () => {
  const { d, f, me, ali, sara } = fundBook();
  assert.equal(pay(d, f.id, me, MEHR, 'share', TODAY, 'b'), null);
  assert.equal(pay(d, f.id, me, MEHR, 'share', TODAY, 'b'), 'سهم این ماه قبلاً ثبت شده.');
  pay(d, f.id, ali, MEHR, 'share', TODAY);
  pay(d, f.id, sara, MEHR, 'share', TODAY);
  assert.equal(fundCash(f), 8 * M);
  const bal = accountBalances(d);
  assert.deepEqual([bal.b, bal[f.accountId!]], [98 * M, 2 * M]);
  assert.equal(myPosition(f)!.netRial, bal[f.accountId!], 'the fund account is the user’s position');
  assert.equal(monthTotals(d, monthOf(TODAY)).expenseRial, 0, 'a share is saving, not spending');
  const nw = netWorth(d, [], TODAY);
  assert.deepEqual([nw.cashRial, nw.receivableRial, nw.netRial], [98 * M, 2 * M, 100 * M], 'net worth unchanged: money moved, not spent');
});

ok('fund: a loan only from money the fund holds; the lottery picks among those whose turn it is', () => {
  const { d, f, me, ali, sara } = fundBook();
  for (const m of [me, ali, sara]) pay(d, f.id, m, MEHR, 'share', TODAY, 'b');
  assert.match(giveLoan(d, f.id, ali, MEHR, TODAY, 'lottery')!, /کافی نیست/, '8m in the fund, 10m loan');
  const m2 = nextMonth(MEHR);
  for (const m of [me, ali, sara]) pay(d, f.id, m, m2, 'share', '2026-10-25', 'b');
  assert.equal(drawLottery(f, () => 0.99)!.name, 'سارا');
  assert.equal(giveLoan(d, f.id, me, m2, '2026-10-25', 'lottery', { accountId: 'b' }), null);
  assert.deepEqual(eligible(f).map((m) => m.name), ['علی', 'سارا'], 'the user had their turn: not again before the others');
  assert.equal(accountBalances(d)[f.accountId!], 4 * M - 10 * M, 'paid in 4m, took 10m: owes the fund 6m');
  assert.equal(netWorth(d, [], TODAY).debtRial, 6 * M);
  // the repayment schedule shows up the month after
  const m3 = nextMonth(m2);
  assert.deepEqual(dueFor(f, me, m3).repay.map((r) => [r.n, r.rial]), [[1, 33_333_330]]);
  assert.equal(pay(d, f.id, me, m3, { loanId: f.loans[0].id }, '2026-11-25', 'b'), null);
  assert.equal(myPosition(f)!.owedRial, 10 * M - 33_333_330);
  assert.match(undoLoan(d, f.id, f.loans[0].id)!, /قسط ثبت شده/);
});

ok('fund: arrears, and undo — from the fund or from the transaction list', () => {
  const { d, f, me, ali } = fundBook();
  pay(d, f.id, ali, MEHR, 'share', TODAY);
  const st = memberState(f, ali, nextMonth(MEHR));
  assert.deepEqual([st.sharesPaidRial, st.shareArrearsRial], [4 * M, 4 * M], 'the next month is due and unpaid');
  pay(d, f.id, me, MEHR, 'share', TODAY, 'b');
  const p = f.payments.find((x) => x.memberId === me)!;
  undoPayment(d, f.id, p.id);
  assert.equal(d.txns.length, 0);
  pay(d, f.id, me, MEHR, 'share', TODAY, 'b');
  deleteTxn(d, f.payments.find((x) => x.memberId === me)!.txnId!);
  assert.ok(!f.payments.some((x) => x.memberId === me), 'deleting the transaction removes the payment');
});

// ── دنگ ────────────────────────────────────────────────────────────────────

function groupBook() {
  const d = book();
  const id = createGroup(d, 'سفر شمال', [{ name: 'من', me: true }, { name: 'رضا' }, { name: 'مینا' }], TODAY) as string;
  const g = d.splitGroups.find((x) => x.id === id)!;
  return { d, g, me: g.members[0].id, reza: g.members[1].id, mina: g.members[2].id };
}

ok('دنگ: splits add up to the rial, in whole toman', () => {
  const s = splitAmount(1_000_000, ['a', 'b', 'c']);
  assert.deepEqual(s.map((x) => x.rial), [333_340, 333_330, 333_330]);
  assert.equal(splitAmount(1_000_005, ['a', 'b']).reduce((t, x) => t + x.rial, 0), 1_000_005);
  assert.deepEqual(splitAmount(900_000, ['a', 'b'], [2, 1]).map((x) => x.rial), [600_000, 300_000]);
});

ok('دنگ: the user paid — their part is spending, the rest is owed to them', () => {
  const { d, g, me, reza, mina } = groupBook();
  assert.equal(typeof addExpense(d, g.id, { date: TODAY, title: 'ویلا', amountRial: 9 * M, paidBy: me, mode: 'equal', among: [me, reza, mina], categoryId: 'c-fun' }, { accountId: 'b' }), 'string');
  const bal = accountBalances(d);
  assert.deepEqual([bal.b, bal[g.accountId!]], [91 * M, 6 * M], 'the bank saw 9m leave; friends owe 6m');
  assert.equal(netOf(g)[me], bal[g.accountId!]);
  assert.equal(monthTotals(d, monthOf(TODAY)).expenseRial, 3 * M, 'spending: only the user’s part');
  assert.equal(netWorth(d, [], TODAY).netRial, 97 * M);
});

ok('دنگ: someone else paid — the user’s part is spending and a debt; settle-up is the fewest transfers', () => {
  const { d, g, me, reza, mina } = groupBook();
  addExpense(d, g.id, { date: TODAY, title: 'ویلا', amountRial: 9 * M, paidBy: me, mode: 'equal', among: [me, reza, mina] }, { accountId: 'b' });
  addExpense(d, g.id, { date: TODAY, title: 'شام', amountRial: 3 * M, paidBy: reza, mode: 'equal', among: [me, reza, mina] });
  addExpense(d, g.id, { date: TODAY, title: 'بنزین', amountRial: 1_200_000, paidBy: mina, mode: 'shares', among: [reza, mina], values: [1, 2] });
  const net = netOf(g);
  assert.equal(net[me], 5 * M);
  assert.equal(Object.values(net).reduce((s, x) => s + x, 0), 0, 'a group’s nets add up to zero');
  assert.equal(accountBalances(d)[g.accountId!], net[me]);
  const plan = settleUp(g);
  assert.ok(plan.length <= g.members.length - 1);
  for (const p of plan) assert.equal(settle(d, g.id, p.from, p.to, p.rial, TODAY, 'b'), null);
  assert.deepEqual(Object.values(netOf(g)), [0, 0, 0], 'settled');
  assert.equal(accountBalances(d)[g.accountId!], 0);
  assert.equal(accountBalances(d).b, 96 * M, '100 − 9 paid + 5 received back');
  undoSettlement(d, g.id, g.settlements[0].id);
  assert.notEqual(netOf(g)[me], 0);
  assert.match(String(addExpense(d, g.id, { date: TODAY, title: 'x', amountRial: 1000, paidBy: me, mode: 'exact', among: [me, reza], values: [400, 500] })), /برابر نیست/);
});

ok('دنگ: a payment already booked from the bank SMS becomes the user’s part — not booked twice — and comes back on delete', () => {
  const { d, g, me, reza, mina } = groupBook();
  d.txns.push({ id: 'sms1', date: TODAY, time: '13:10', kind: 'expense', amountRial: 9 * M, accountId: 'b', categoryId: 'c-other', src: 'sms' });
  const cands = linkCandidates(d, 9 * M, TODAY);
  assert.deepEqual(cands.map((t) => t.id), ['sms1']);
  const id = addExpense(d, g.id, { date: TODAY, title: 'ویلا', amountRial: 9 * M, paidBy: me, mode: 'equal', among: [me, reza, mina], categoryId: 'c-fun' }, { linkTxnId: 'sms1' }) as string;
  assert.equal(accountBalances(d).b, 91 * M, 'still one 9m payment from the bank');
  assert.deepEqual([d.txns[0].amountRial, d.txns[0].categoryId], [3 * M, 'c-fun']);
  assert.equal(accountBalances(d)[g.accountId!], 6 * M);
  deleteExpense(d, g.id, id);
  assert.deepEqual([d.txns.length, d.txns[0].amountRial, d.txns[0].categoryId], [1, 9 * M, 'c-other'], 'the SMS row is as it was');
});

ok('backups keep funds and groups', () => {
  const { d } = groupBook();
  const back = normalizeData(JSON.parse(JSON.stringify(d)), TODAY);
  assert.deepEqual(back.splitGroups, d.splitGroups);
});

console.log(`\n${n} shared-money checks passed`);
