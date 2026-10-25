/**
 * لیست خرید روزمره (lib/finance/shopping.ts, rule 100): one expense per trip, never a second copy of the bank's
 * SMS of the same payment, booked items leave the list, «برگرداندن» undoes exactly what was done.
 * Run: npx tsx scripts/shopping-test.ts
 */
import assert from 'node:assert';
import { rowsFromMessages } from '../lib/finance/importers';
import { emptyData, type FinanceData } from '../lib/finance/model';
import { smsParser } from '../lib/finance/sms';
import { addItem, bookPurchase, boughtItems, listItems, listTotals, purchaseMatches, setBought, suggestItems, undoPurchase, type PurchaseReceipt } from '../lib/finance/shopping';
import { linkSource, queueSms } from '../lib/finance/sources';
import { balances } from '../lib/finance/balance';
import { monthForecast, monthOf } from '../lib/finance/calc';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-24';
const T = (h: number) => Date.parse(`${TODAY}T${String(h).padStart(2, '0')}:00:00+03:30`);

function book(): FinanceData {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'a-mellat', name: 'ملت', kind: 'bank', openingRial: 50_000_000, openedOn: '2026-09-01' });
  return d;
}
const id = (x: unknown) => (typeof x === 'string' ? assert.fail(x) : (x as { id: string }).id);

ok('adding: no duplicates of what is still to buy; empty names refused', () => {
  const d = book();
  const a = id(addItem(d, { name: 'شیر', qty: '۲ لیتر' }));
  assert.equal(id(addItem(d, { name: '  شير ' })), a, 'ي and spaces: the same thing');
  assert.equal(listItems(d).length, 1);
  assert.equal(typeof addItem(d, { name: '   ' }), 'string');
  addItem(d, { name: 'نان', estRial: 300_000 });
  addItem(d, { name: 'تخم‌مرغ', estRial: 1_500_000 });
  const t = listTotals(d);
  assert.equal(t.left, 3);
  assert.equal(t.leftEstRial, 1_800_000);
  assert.equal(t.leftUnpriced, 1);
});

ok('ticking: bought with or without a price; unticking clears the price', () => {
  const d = book();
  const milk = id(addItem(d, { name: 'شیر' }));
  const bread = id(addItem(d, { name: 'نان' }));
  setBought(d, milk, true, 450_000);
  setBought(d, bread, true);
  assert.deepEqual(boughtItems(d).map((x) => x.priceRial ?? null), [450_000, null]);
  assert.deepEqual(listTotals(d), { left: 0, leftEstRial: 0, leftUnpriced: 0, leftDk: 0, bought: 2, boughtRial: 450_000, boughtUnpriced: 1 });
  setBought(d, milk, false);
  assert.equal(listItems(d).find((x) => x.id === milk)!.priceRial, null);
});

ok('booking: one expense for the trip, items leave the list, the balance and the month see it once', () => {
  const d = book();
  const ids = ['شیر', 'نان', 'پنیر'].map((name) => id(addItem(d, { name })));
  ids.forEach((x) => setBought(d, x, true, 400_000));
  addItem(d, { name: 'برنج' }); // not bought: stays
  const r = bookPurchase(d, { itemIds: ids, amountRial: 1_200_000, accountId: 'a-mellat', categoryId: 'c-food', date: TODAY }) as PurchaseReceipt;
  assert.equal(typeof r, 'object');
  assert.equal(r.how, 'new');
  assert.equal(d.txns.length, 1);
  assert.equal(d.txns[0].note, 'لیست خرید: شیر، نان، پنیر');
  assert.equal(d.txns[0].categoryId, 'c-food');
  assert.equal(d.txns[0].link, undefined, 'everyday spending: the month forecast counts it in the pace (no link)');
  assert.deepEqual(listItems(d).map((x) => x.name), ['برنج']);
  assert.equal(balances(d)['a-mellat'], 48_800_000);
  assert.equal(monthForecast(d, monthOf(TODAY), TODAY).expenseActualRial, 1_200_000);
  assert.deepEqual(suggestItems(d, '').slice(0, 3).sort(), ['شیر', 'نان', 'پنیر'].sort(), 'bought things come first next time');
  assert.ok(!suggestItems(d, '').includes('برنج'), 'what is already on the list is not suggested');
});

ok('the bank SMS already booked: the trip becomes that transaction, not a second one', () => {
  const d = book();
  // the «نوعش چیست؟» answer booked the card payment as an expense
  d.txns.push({ id: 't-sms', date: TODAY, kind: 'expense', amountRial: 1_200_000, accountId: 'a-mellat', categoryId: null, note: 'کارت ••4417', src: 'sms', smsKey: 'k1', smsAt: T(11) });
  const ids = ['شیر', 'نان'].map((name) => id(addItem(d, { name })));
  ids.forEach((x) => setBought(d, x, true));
  const m = purchaseMatches(d, 1_200_000, TODAY);
  assert.deepEqual(m.txns.map((t) => t.id), ['t-sms']);
  const r = bookPurchase(d, { itemIds: ids, amountRial: 1_200_000, accountId: 'a-mellat', categoryId: 'c-food', date: TODAY, linkTxnId: 't-sms' }) as PurchaseReceipt;
  assert.equal(r.how, 'linked');
  assert.equal(d.txns.length, 1, 'no second transaction');
  assert.equal(d.txns[0].note, 'لیست خرید: شیر، نان — کارت ••4417');
  assert.equal(d.txns[0].categoryId, 'c-food');
  assert.equal(purchaseMatches(d, 1_200_000, TODAY).txns.length, 0, 'a trip already booked is not offered again');
  undoPurchase(d, r);
  assert.equal(d.txns[0].note, 'کارت ••4417');
  assert.equal(d.txns[0].categoryId, null);
  assert.equal(boughtItems(d).length, 2, 'the items are back, still ticked');
});

ok('the bank SMS waiting in the queue: booked from it (one transaction, the SMS gone from the queue); undo puts it back', () => {
  const d = book();
  queueSms(d, rowsFromMessages([{ body: 'برداشت: 5,000 ریال کارت: *4417', at: T(8) }], smsParser, TODAY).rows, T(8));
  linkSource(d, 'card:4417', 'a-mellat');
  d.inbox = [];
  queueSms(d, rowsFromMessages([{ body: 'خرید: 1,200,000 ریال\nکارت: *4417\nمانده: 48,800,000', at: T(11), address: '+98700717' }], smsParser, TODAY).rows, T(11));
  assert.equal(d.inbox.length, 1);
  const ids = ['شیر', 'نان'].map((name) => id(addItem(d, { name })));
  ids.forEach((x) => setBought(d, x, true, 600_000));
  const m = purchaseMatches(d, 1_200_000, TODAY);
  assert.equal(m.staged.length, 1);
  const r = bookPurchase(d, { itemIds: ids, amountRial: 1_200_000, accountId: 'a-mellat', categoryId: 'c-food', date: TODAY, stagedId: m.staged[0].id }) as PurchaseReceipt;
  assert.equal(r.how, 'staged');
  assert.equal(d.inbox.length, 0);
  assert.equal(d.txns.length, 1);
  assert.equal(d.txns[0].smsKey, m.staged[0].smsKey, 'it is the SMS: reading the phone again will not queue it');
  assert.ok(d.txns[0].note!.startsWith('لیست خرید: شیر، نان'));
  assert.equal(balances(d)['a-mellat'], 48_800_000, 'the bank-stated balance, not one payment less');
  undoPurchase(d, r);
  assert.equal(d.txns.length, 0);
  assert.equal(d.inbox.length, 1);
  assert.equal(boughtItems(d).length, 2);
});

ok('refusals change nothing', () => {
  const d = book();
  const a = id(addItem(d, { name: 'شیر' }));
  setBought(d, a, true);
  const snap = JSON.stringify(d);
  assert.equal(typeof bookPurchase(d, { itemIds: [a], amountRial: 0, accountId: 'a-mellat', categoryId: null, date: TODAY }), 'string');
  assert.equal(typeof bookPurchase(d, { itemIds: [a], amountRial: 10_000, accountId: 'nope', categoryId: null, date: TODAY }), 'string');
  assert.equal(typeof bookPurchase(d, { itemIds: [], amountRial: 10_000, accountId: 'a-mellat', categoryId: null, date: TODAY }), 'string');
  assert.equal(typeof bookPurchase(d, { itemIds: [a], amountRial: 10_000, accountId: 'a-mellat', categoryId: null, date: TODAY, linkTxnId: 'missing' }), 'string');
  assert.equal(JSON.stringify(d), snap);
});

console.log(`\n${n} shopping checks passed`);
