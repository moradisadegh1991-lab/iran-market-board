/**
 * Pins balances built on the bank's own statement, and the mismatch questions (lib/finance/balance.ts, rule 76).
 * Run: npx tsx scripts/balance-test.ts
 */
import assert from 'node:assert';
import { addReported, balanceOf, bookMissing, bookedBy, fixStart, ignoreCheck, monthCheck, monthStartOf, openChecks, setCurrentBalance } from '../lib/finance/balance';
import { accountBalances, netWorth } from '../lib/finance/calc';
import { editAccount } from '../lib/finance/actions';
import { reportBalance } from '../lib/finance/sources';
import { emptyData, normalizeData, type FinanceData, type Txn } from '../lib/finance/model';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
// ۱ مهر ۱۴۰۵ = 2026-09-23; ۱ شهریور = 2026-08-23
const MEHR1 = '2026-09-23';
const at = (iso: string, hm: string) => Date.parse(`${iso}T${hm}:00+03:30`);
let seq = 0;
const txn = (p: Partial<Txn> & Pick<Txn, 'date' | 'kind' | 'amountRial'>): Txn => ({ id: `t${++seq}`, accountId: 'b', ...p });
function book(): FinanceData {
  const d = emptyData('2026-10-05');
  d.accounts.push({ id: 'b', name: 'بانک ملت', kind: 'bank', openingRial: 10_000_000, openedOn: '2026-08-01' });
  return d;
}

ok('the month starts on the 1st of the Jalali month', () => {
  assert.equal(monthStartOf('2026-10-05'), MEHR1);
  assert.equal(monthStartOf(MEHR1), MEHR1);
  assert.equal(monthStartOf('2026-09-22'), '2026-08-23');
});

ok("the balance is the bank's last word + what was booked after it", () => {
  const d = book();
  d.txns.push(txn({ date: '2026-10-01', kind: 'expense', amountRial: 2_000_000 }));
  assert.equal(accountBalances(d).b, 8_000_000, 'no statement yet: the book');
  reportBalance(d, 'b', 30_000_000, at('2026-10-03', '10:00'), 'sms');
  assert.equal(accountBalances(d).b, 30_000_000, 'the bank says 30m: that is the balance, whatever the book thought');
  d.txns.push(txn({ date: '2026-10-03', time: '11:30', kind: 'expense', amountRial: 1_000_000 }));
  d.txns.push(txn({ date: '2026-10-04', kind: 'income', amountRial: 5_000_000 }));
  assert.equal(accountBalances(d).b, 34_000_000, 'booked after it: −1m at 11:30, +5m the next day');
  // the SMS's own row, booked from the queue at the bank's moment, is already in the balance
  d.txns.push(txn({ date: '2026-10-03', time: '10:00', kind: 'expense', amountRial: 700_000, src: 'sms' }));
  assert.equal(accountBalances(d).b, 34_000_000);
  // same day, no time: by when it was booked
  d.txns.push(txn({ date: '2026-10-03', kind: 'expense', amountRial: 100_000, addedAt: at('2026-10-03', '09:00') }));
  d.txns.push(txn({ date: '2026-10-03', kind: 'expense', amountRial: 200_000, addedAt: at('2026-10-03', '20:00') }));
  d.txns.push(txn({ date: '2026-10-03', kind: 'expense', amountRial: 400_000 }));
  assert.equal(accountBalances(d).b, 33_800_000, 'booked at 20:00 → after the 10:00 balance; 09:00 and unknown → before');
  assert.ok(bookedBy({ date: '2026-10-02' }, d.accounts[1].reported!) && !bookedBy({ date: '2026-10-04' }, d.accounts[1].reported!));
  // an older SMS read later does not replace the newer balance, but goes in the log
  reportBalance(d, 'b', 25_000_000, at('2026-10-02', '09:00'), 'sms');
  assert.equal(d.accounts[1].reported!.rial, 30_000_000);
  assert.deepEqual(d.accounts[1].reportedLog!.map((r) => r.rial), [25_000_000, 30_000_000]);
  assert.equal(netWorth(d, [], '2026-10-05').cashRial, 33_800_000 + 0, 'net worth uses the same balance');
});

ok('transfers between the user’s accounts move both balances', () => {
  const d = book();
  d.accounts.push({ id: 'c', name: 'کارت دوم', kind: 'bank', openingRial: 0, openedOn: '2026-08-01' });
  reportBalance(d, 'b', 10_000_000, at('2026-10-01', '08:00'), 'sms');
  reportBalance(d, 'c', 1_000_000, at('2026-10-01', '08:00'), 'sms');
  d.txns.push(txn({ date: '2026-10-02', kind: 'transfer', amountRial: 3_000_000, toAccountId: 'c' }));
  assert.deepEqual([accountBalances(d).b, accountBalances(d).c], [7_000_000, 4_000_000]);
});

ok('agreeing books: no question', () => {
  const d = book();
  // the bank last spoke in شهریور: 9m on 2026-09-10; then −1m on 09-15; month starts at 8m
  addReported(d.accounts[1], { rial: 9_000_000, date: '2026-09-10', time: '12:00', via: 'sms' });
  d.txns.push(txn({ date: '2026-09-15', time: '10:00', kind: 'expense', amountRial: 1_000_000 }));
  d.txns.push(txn({ date: '2026-09-25', time: '10:00', kind: 'expense', amountRial: 500_000 }));
  d.txns.push(txn({ date: '2026-09-28', time: '10:00', kind: 'income', amountRial: 2_000_000 }));
  reportBalance(d, 'b', 9_500_000, at('2026-10-01', '09:00'), 'sms');
  const c = monthCheck(d, 'b')!;
  assert.deepEqual([c.monthStart, c.startFrom, c.startRial, c.bookedRial, c.bookedCount, c.diffRial], [MEHR1, 'bank', 8_000_000, 1_500_000, 2, 0]);
  assert.equal(openChecks(d).length, 0);
});

ok('a missed transaction: asked, and booked at the bank’s moment without moving the balance', () => {
  const d = book();
  addReported(d.accounts[1], { rial: 9_000_000, date: '2026-09-10', time: '12:00', via: 'sms' });
  d.txns.push(txn({ date: '2026-09-25', time: '10:00', kind: 'expense', amountRial: 500_000 }));
  reportBalance(d, 'b', 8_000_000, at('2026-10-01', '09:00'), 'sms'); // the bank: 8m, the book: 9m − 0.5m = 8.5m
  const c = openChecks(d)[0];
  assert.equal(c.diffRial, -500_000, 'half a million went out that the app does not know about');
  assert.equal(accountBalances(d).b, 8_000_000, 'the balance is the bank’s meanwhile');
  assert.equal(fixStart(d, 'b'), 0, 'the start came from the bank: it cannot be «wrong», this answer is not offered');
  const id = bookMissing(d, 'b', { categoryId: 'c-food', note: 'رستوران' })!;
  const t = d.txns.find((x) => x.id === id)!;
  assert.deepEqual([t.kind, t.amountRial, t.date, t.time, t.categoryId], ['expense', 500_000, '2026-10-01', '09:00', 'c-food']);
  assert.equal(monthCheck(d, 'b')!.diffRial, 0);
  assert.equal(accountBalances(d).b, 8_000_000, 'booked at the bank’s moment: already in the bank’s figure');
});

ok('a wrong opening balance: asked, and one tap moves it', () => {
  const d = book(); // opening 10m, no statement before the month
  d.txns.push(txn({ date: '2026-09-01', kind: 'expense', amountRial: 1_000_000 }));
  d.txns.push(txn({ date: '2026-09-30', time: '10:00', kind: 'expense', amountRial: 2_000_000 }));
  reportBalance(d, 'b', 12_000_000, at('2026-10-02', '09:00'), 'sms');
  const c = monthCheck(d, 'b')!;
  assert.deepEqual([c.startFrom, c.startRial, c.diffRial], ['opening', 9_000_000, 5_000_000]);
  assert.equal(fixStart(d, 'b'), 5_000_000);
  assert.equal(d.accounts[1].openingRial, 15_000_000);
  assert.equal(monthCheck(d, 'b')!.diffRial, 0);
});

ok('rows still in the queue count; one without a direction is reported, not guessed', () => {
  const d = book();
  reportBalance(d, 'b', 9_000_000, at('2026-10-02', '09:00'), 'sms');
  const row = { id: 'q', source: 'sms' as const, date: '2026-10-02', time: '09:00', amountRial: 1_000_000, direction: 'out' as const, why: '', description: '', raw: '', accountId: 'b', importedAt: 0 };
  d.inbox.push(row);
  const c = monthCheck(d, 'b')!;
  assert.deepEqual([c.pendingCount, c.pendingRial, c.diffRial], [1, -1_000_000, 0], 'the queued SMS explains the whole difference');
  d.inbox.push({ ...row, id: 'q2', direction: null, amountRial: 300_000 });
  assert.equal(monthCheck(d, 'b')!.pendingUnknown, 1);
});

ok('«leave it» hides the question until the bank states a new balance', () => {
  const d = book();
  reportBalance(d, 'b', 12_000_000, at('2026-10-02', '09:00'), 'sms');
  assert.equal(openChecks(d).length, 1);
  ignoreCheck(d, 'b');
  assert.equal(openChecks(d).length, 0);
  reportBalance(d, 'b', 11_000_000, at('2026-10-03', '09:00'), 'sms');
  assert.equal(openChecks(d).length, 1, 'a new statement, a new question');
});

ok('«موجودی الان» typed by the user is a statement at this moment; a cash wallet keeps the old way', () => {
  const d = book();
  reportBalance(d, 'b', 12_000_000, at('2026-10-02', '09:00'), 'sms');
  assert.equal(editAccount(d, 'b', { currentRial: 7_000_000 }, at('2026-10-04', '18:00')), null);
  assert.equal(accountBalances(d).b, 7_000_000);
  assert.equal(d.accounts[1].reported!.via, 'manual');
  d.txns.push(txn({ accountId: 'a-cash', date: '2026-10-01', kind: 'expense', amountRial: 50_000 }));
  editAccount(d, 'a-cash', { currentRial: 1_000_000 });
  assert.deepEqual([accountBalances(d)['a-cash'], d.accounts[0].openingRial, d.accounts[0].reported ?? null], [1_000_000, 1_050_000, null]);
  setCurrentBalance(d, 'b', 6_000_000, at('2026-10-05', '08:00'));
  assert.equal(balanceOf(d, d.accounts[1]), 6_000_000);
});

ok('backups: the new parts survive, an old backup without them loads', () => {
  const d = book();
  addReported(d.accounts[1], { rial: 1, date: '2026-10-01', via: 'sms' });
  const back = normalizeData(JSON.parse(JSON.stringify(d)), '2026-10-05');
  assert.deepEqual(back.accounts[1].reportedLog, d.accounts[1].reportedLog);
  const old = JSON.parse(JSON.stringify(d));
  delete old.funds;
  delete old.splitGroups;
  const o = normalizeData(old, '2026-10-05');
  assert.deepEqual([o.funds, o.splitGroups], [[], []]);
});

console.log(`\n${n} balance checks passed`);
