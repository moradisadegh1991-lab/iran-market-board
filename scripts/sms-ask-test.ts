/**
 * Pins how answers from the «نوعش چیست؟» notification reach the book (lib/finance/sms-ask.ts):
 * booked when the card's account is known, queued with the choice otherwise, never twice — the
 * same SMS also arrives through the inbox read — and never against what the bank said.
 * Run: npx tsx scripts/sms-ask-test.ts
 */
import assert from 'node:assert';
import { commitStaged, defaultChoice, rowsFromMessages } from '../lib/finance/importers';
import { emptyData, type FinanceData } from '../lib/finance/model';
import { smsParser } from '../lib/finance/sms';
import { applyAsked, type AskedSms } from '../lib/finance/sms-ask';
import { linkSource, queueSms, reconcile } from '../lib/finance/sources';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const TODAY = '2026-10-02';
const T = (h: number, m = 0, day = 2) => Date.parse(`2026-10-0${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:30`);
const W = 'برداشت: 1,250,000 ریال\nکارت: *4417\nسوپرمارکت رفاه\nمانده: 12,300,000';
const D = 'واریز 3,000,000 ریال به حساب شما کارت: *4417 مانده: 15,300,000';
const U = 'تراکنش حساب: 1234567890 به مبلغ 2,400,000 ریال ثبت شد';

/** a book with a «ملت» account that card 4417 is linked to */
function book(linked = true): FinanceData {
  const d = emptyData(TODAY);
  d.accounts.push({ id: 'a-mellat', name: 'ملت', kind: 'bank', openingRial: 0, openedOn: '2026-09-01' });
  d.accounts.push({ id: 'a-cash', name: 'نقد', kind: 'cash', openingRial: 0, openedOn: '2026-09-01' });
  if (linked) {
    queueSms(d, rowsFromMessages([{ body: 'برداشت: 5,000 ریال کارت: *4417', at: T(1, 0, 1) }], smsParser, TODAY).rows, T(1, 0, 1));
    linkSource(d, 'card:4417', 'a-mellat');
    d.inbox = [];
  }
  return d;
}
const asked = (body: string, at: number, choice: AskedSms['choice'], key = `k${at}`): AskedSms => ({ key, address: '+98700717', body, at, choice });
/** the inbox read of the same SMS: the provider's time is a few seconds after the receiver's */
const inboxRead = (d: FinanceData, body: string, at: number) => queueSms(d, rowsFromMessages([{ body, at: at + 4_000, address: '+98700717' }], smsParser, TODAY).rows, at + 60_000);

ok('«هزینه» on a linked card: booked at once, category from the text, and the inbox read adds nothing', () => {
  const d = book();
  const r = applyAsked(d, [asked(W, T(9), 'expense', 'k1')], TODAY, T(9, 1));
  assert.deepEqual([r.booked, r.queued, r.done], [1, 0, ['k1']]);
  assert.equal(d.txns.length, 1);
  const t = d.txns[0];
  assert.deepEqual([t.kind, t.amountRial, t.accountId, t.categoryId, t.date, t.time, t.src], ['expense', 1_250_000, 'a-mellat', 'c-food', TODAY, '09:00', 'sms']);
  assert.ok(t.smsKey && t.smsAt === T(9));
  assert.equal(d.inbox.length, 0);
  assert.equal(inboxRead(d, W, T(9)).added, 0, 'the same SMS from the inbox is not a second transaction');
  // the bank balance on the account came with it
  assert.equal(reconcile(d, 'a-mellat')!.reportedRial, 12_300_000);
});

ok('an unknown card: queued with the answer pre-selected, waiting for its account', () => {
  const d = book(false);
  const r = applyAsked(d, [asked(W, T(9), 'expense')], TODAY, T(9, 1));
  assert.deepEqual([r.booked, r.queued], [0, 1]);
  assert.equal(d.txns.length, 0);
  const s = d.inbox[0];
  assert.equal(defaultChoice(s), 'expense');
  assert.match(s.why, /اعلان گوشی گفتید: هزینه/);
  assert.equal(s.accountId, null);
  assert.equal(d.smsSources.find((x) => x.key === 'card:4417')?.count, 1, 'the card is learned like any SMS');
  assert.equal(inboxRead(d, W, T(9)).added, 0, 'and not queued twice');
});

ok('no direction in the SMS: the answer is the user\'s, so it sets one (rule 3 forbids guessing, not asking)', () => {
  const d = book();
  assert.equal(rowsFromMessages([{ body: U }], smsParser, TODAY).rows[0].direction, null);
  queueSms(d, rowsFromMessages([{ body: 'واریز 1,000 ریال حساب: 1234567890', at: T(1, 0, 1) }], smsParser, TODAY).rows, T(1, 0, 1));
  linkSource(d, 'acc:1234567890', 'a-mellat');
  d.inbox = [];
  const r = applyAsked(d, [asked(U, T(10), 'income')], TODAY, T(10, 1));
  assert.equal(r.booked, 1);
  assert.deepEqual([d.txns[0].kind, d.txns[0].amountRial], ['income', 2_400_000]);
});

ok('a transfer keeps the row in the queue — the other account is the user\'s to pick', () => {
  const d = book();
  const r = applyAsked(d, [asked(D, T(11), 'transfer-in')], TODAY, T(11, 1));
  assert.deepEqual([r.booked, r.queued], [0, 1]);
  assert.equal(d.inbox[0].transfer, true);
  assert.equal(defaultChoice(d.inbox[0]), 'transfer-in');
  assert.equal(d.inbox[0].accountId, 'a-mellat');
  assert.equal(commitStaged(d, d.inbox[0].id, { choice: 'transfer-in', accountId: 'a-mellat', otherAccountId: 'a-cash' }), null);
  assert.equal(d.txns[0].toAccountId, 'a-mellat');
});

ok('not answered yet: the row is queued once, the phone keeps asking, and the inbox read is quiet about it', () => {
  const d = book();
  const items = [asked(W, T(9), null, 'k1')];
  const r1 = applyAsked(d, items, TODAY, T(9, 1));
  assert.deepEqual([r1.booked, r1.queued, r1.done.length, d.inbox.length], [0, 0, 0, 1]);
  const smsKey = d.inbox[0].smsKey!;
  assert.ok(r1.announced.has(smsKey), 'AppStartup sends no second notification for it');
  applyAsked(d, items, TODAY, T(9, 2));
  assert.equal(d.inbox.length, 1, 'applying again adds nothing');
  // answered later
  const r2 = applyAsked(d, [{ ...items[0], choice: 'expense' }], TODAY, T(12));
  assert.deepEqual([r2.booked, d.inbox.length, d.txns.length], [1, 0, 1]);
});

ok('an answer against the bank is not applied; the row stays as the bank said', () => {
  const d = book();
  const r = applyAsked(d, [asked(W, T(9), 'income', 'k1')], TODAY, T(9, 1));
  assert.deepEqual([r.booked, r.queued, r.done], [0, 0, ['k1']]);
  assert.equal(d.inbox[0].direction, 'out');
  assert.equal(d.txns.length, 0);
});

ok('booked in the app before the button was tapped: the late answer changes nothing', () => {
  const d = book();
  inboxRead(d, W, T(9));
  assert.equal(commitStaged(d, d.inbox[0].id, { choice: 'expense', accountId: 'a-mellat', categoryId: 'c-food' }), null);
  const r = applyAsked(d, [asked(W, T(9), 'expense', 'k1')], TODAY, T(9, 5));
  assert.deepEqual([r.booked, r.done, d.txns.length, d.inbox.length], [0, ['k1'], 1, 0]);
});

ok('look-alikes and half-read amounts wait for the user instead of being booked', () => {
  const d = book();
  d.txns.push({ id: 't-hand', date: TODAY, kind: 'expense', amountRial: 1_250_000, accountId: 'a-mellat' });
  const r = applyAsked(d, [asked(W, T(9), 'expense')], TODAY, T(9, 1));
  assert.deepEqual([r.booked, r.queued], [0, 1], 'a hand-entered twin: the queue flags it as a possible duplicate');
  const d2 = book();
  const half = 'حساب شما 5,000,000 ریال مانده 9,000,000 بانک';
  assert.equal(rowsFromMessages([{ body: half }], smsParser, TODAY).rows[0].uncertainAmount, true);
  assert.equal(applyAsked(d2, [asked(half, T(9), 'expense')], TODAY, T(9, 1)).queued, 1);
});

ok('the same text on another day is another transaction', () => {
  const d = book();
  const same = 'خرید 50,000 ریال کارت: *4417';
  applyAsked(d, [asked(same, T(9, 0, 1), 'expense', 'a')], TODAY, T(9, 1, 1));
  applyAsked(d, [asked(same, T(9, 0, 2), 'expense', 'b')], TODAY, T(9, 1, 2));
  assert.equal(d.txns.length, 2);
  // …but the same message within minutes is one
  assert.equal(inboxRead(d, same, T(9, 0, 2)).added, 0);
});

ok('malformed records from the phone are skipped', () => {
  const d = book();
  const r = applyAsked(d, [null as unknown as AskedSms, { key: 'x' } as AskedSms, asked(W, T(9), 'bogus' as AskedSms['choice'], 'k')], TODAY, T(9, 1));
  assert.deepEqual([r.booked, r.queued, r.done], [0, 0, []]);
  assert.equal(d.inbox.length, 1, 'the SMS itself is still queued for the user');
});

console.log(`\n${n} sms-ask checks passed`);
