/**
 * A loan told by voice and the bank's SMS of the same money are one transaction (rule 88): «۵۰ تومن به علی از حساب بانک
 * تجارت قرض دادم» takes the SMS that is waiting (its amount decides ۵۰ هزار or ۵۰ میلیون), an SMS already booked as
 * spending becomes the loan, an SMS that arrives later attaches to it, and the shop's SMS never becomes a personal loan.
 * Run: npx tsx scripts/lend-sms-test.ts
 */
import assert from 'node:assert';
import { setupBusiness } from '../lib/biz/ops';
import { balances } from '../lib/finance/balance';
import { totalsBetween } from '../lib/finance/calc';
import { bookLendWithSms } from '../lib/finance/lend-sms';
import { lendSmsCandidates, positions } from '../lib/finance/lending';
import { emptyData, type FinanceData, type Staged } from '../lib/finance/model';
import { queueSms } from '../lib/finance/sources';
import { applyAsked } from '../lib/finance/sms-ask';
import { commitLend, lendAnswer, lendChoose, lendRows, lendStart, undoLend, type LendState } from '../lib/finance/voice-lend';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const T = '2026-10-09';
const SAY = '۵۰ تومن به علی از حساب بانک تجارت قرض دادم';

function book(withBiz = true): FinanceData {
  const d = emptyData(T);
  d.accounts.push({ id: 'tej', name: 'بانک تجارت', kind: 'bank', openingRial: 100_000_000, openedOn: '2026-09-01' });
  d.accounts.push({ id: 'mel', name: 'بانک ملت', kind: 'bank', openingRial: 100_000_000, openedOn: '2026-09-01' });
  if (withBiz) setupBusiness(d, { name: 'کافه نارنج', type: 'cafe', card: 'new', now: Date.now(), today: T });
  return d;
}
/** a bank SMS row: 50,000 toman left the Tejarat card (linked to the «بانک تجارت» account) at 10:12 */
function sms(p: Partial<Staged> = {}): Staged {
  return { id: 'sms1', source: 'sms', date: T, time: '10:12', amountRial: 500_000, direction: 'out', why: 'بانک گفت برداشت', description: 'انتقال کارت به کارت', raw: 'تجارت\nبرداشت 500,000', accountId: 'tej', bank: 'تجارت', smsKey: 'k-tej-1', at: Date.parse(`${T}T06:42:00Z`), importedAt: Date.parse(`${T}T06:43:00Z`), ...p };
}
const lendTxns = (d: FinanceData) => d.txns.filter((t) => t.link?.type === 'lend');

ok('the user’s sentence with the SMS waiting: amount from the SMS (۵۰ هزار), personal, read back with the SMS; booked once', () => {
  const d = book();
  d.inbox.push(sms());
  const st = lendStart(d, SAY, T)!;
  assert.equal(st.asking, 'confirm', st.say);
  assert.equal(st.draft.amountRial, 500_000, '«۵۰ تومن» is the SMS’s ۵۰ هزار تومان');
  assert.equal(st.draft.side, 'me', 'a personal account said: no «شخصی یا کسب‌وکار؟»');
  assert.match(st.say, /پنجاه هزار تومان به علی قرض دادی، از بانک تجارت \(پول شخصی\)؛ همون پیامک تجارت، امروز ساعت ۱۰:۱۲\. ثبت کنم؟/);
  assert.ok(lendRows(d, st).some((r) => r.label === 'پیامک بانک'));
  const saved = lendAnswer(d, st, 'بله');
  const u = commitLend(d, saved, T);
  assert.equal(typeof u, 'object');
  assert.equal(d.inbox.length, 0, 'the SMS left the queue');
  assert.equal(lendTxns(d).length, 1);
  assert.equal(d.txns.length, 1, 'one transaction for one event');
  const t = lendTxns(d)[0];
  assert.deepEqual([t.smsKey, t.time, t.date, t.src], ['k-tej-1', '10:12', T, 'sms'], 'the loan is at the bank’s moment (rule 76)');
  assert.equal(totalsBetween(d, '2026-10-01', T).expenseRial, 0, 'a loan is not spending');
  const ali = positions(d).find((p) => p.account.name === 'علی')!;
  assert.deepEqual([ali.balanceRial, ali.business], [500_000, false]);
  undoLend(d, u as Exclude<typeof u, string>);
  assert.deepEqual([d.txns.length, d.inbox.length], [0, 1], '«برگرداندن» puts the SMS back in the queue');
});

ok('no SMS yet: «۵۰ تومن» is asked — ۵۰ هزار or ۵۰ میلیون — never guessed', () => {
  const d = book();
  const st = lendStart(d, SAY, T)!;
  assert.equal(st.asking, 'amount');
  assert.equal(st.say, '۵۰ هزار یا ۵۰ میلیون تومن؟');
  assert.deepEqual(st.options.map((o) => o.label), ['۵۰ هزار تومان', '۵۰ میلیون تومان']);
  const c = lendChoose(d, st, st.options[1].key);
  assert.equal(c.asking, 'confirm');
  assert.equal(c.draft.amountRial, 500_000_000);
  assert.equal(c.draft.sms ?? null, null);
});

ok('the SMS already booked as spending (the phone’s «نوعش چیست؟»): it becomes the loan; undo makes it spending again', () => {
  const d = book();
  d.txns.push({ id: 'tx-sms', date: T, time: '10:12', kind: 'expense', amountRial: 500_000, accountId: 'tej', toAccountId: null, categoryId: 'c-other', src: 'sms', smsKey: 'k-tej-1', smsAt: 1 });
  const st = lendAnswer(d, lendStart(d, '۵۰ هزار تومن به علی از بانک تجارت قرض دادم', T)!, 'بله');
  const u = commitLend(d, st, T) as Exclude<ReturnType<typeof commitLend>, string>;
  assert.equal(d.txns.length, 1);
  assert.deepEqual([d.txns[0].kind, d.txns[0].link?.type, d.txns[0].smsKey], ['transfer', 'lend', 'k-tej-1']);
  assert.equal(totalsBetween(d, '2026-10-01', T).expenseRial, 0, 'no longer spending');
  undoLend(d, u);
  assert.deepEqual(d.txns.map((t) => [t.id, t.kind]), [['tx-sms', 'expense']]);
});

ok('the SMS arrives after the loan was told: it attaches (not queued, not asked on the phone again)', () => {
  const d = book();
  const st = lendAnswer(d, lendStart(d, '۵۰ هزار تومن به علی از بانک تجارت قرض دادم', T)!, 'بله');
  commitLend(d, st, T);
  assert.equal(lendTxns(d)[0].smsKey, undefined);
  const r = queueSms(d, [sms()], Date.now());
  assert.equal(r.added, 0, 'not a new row');
  assert.equal(d.inbox.length, 0);
  const t = lendTxns(d)[0];
  assert.deepEqual([t.smsKey, t.time, t.src], ['k-tej-1', '10:12', 'sms']);
  assert.equal(queueSms(d, [sms({ id: 'again' })], Date.now()).added, 0, 'the same SMS again is seen');
  assert.equal(d.txns.length, 1);
});

ok('the shop’s card SMS never becomes a personal loan; said to be the shop’s, it is taken', () => {
  const d = book();
  const shopCard = d.biz!.cardAccountId!;
  d.inbox.push(sms({ accountId: shopCard, bank: 'ملت', smsKey: 'k-shop' }));
  // no account said, a business exists: asked, not taken from the shop's SMS
  const st = lendStart(d, '۵۰ تومن به علی قرض دادم', T)!;
  assert.equal(st.asking, 'side', st.say);
  const me = lendChoose(d, st, 'me');
  assert.equal(me.draft.sms ?? null, null, 'personal: the shop card’s SMS is left alone');
  assert.equal(lendSmsCandidates(d, { kind: 'lend', amountRial: 500_000, side: 'me', today: T }).length, 0);
  const shop = lendChoose(d, st, 'biz');
  assert.equal(shop.draft.sms?.id, 'sms1', 'the shop’s: its SMS');
  assert.equal(shop.draft.accountId, shopCard);
  assert.match(shop.say, /\(حساب کسب‌وکار\)؛ همون پیامک ملت/);
});

ok('the typed form (TxnForm) uses the same booking: the waiting SMS is the loan', () => {
  const d = book(false);
  d.inbox.push(sms());
  const m = lendSmsCandidates(d, { kind: 'lend', amountRial: 500_000, accountId: 'tej', side: 'me', today: T })[0];
  assert.ok(m);
  bookLendWithSms(d, { kind: 'lend', person: 'علی', accountId: 'tej', amountRial: 500_000, date: T }, m);
  assert.deepEqual([d.txns.length, d.inbox.length, d.txns[0].smsKey], [1, 0, 'k-tej-1']);
  // a different amount or another account is not this SMS
  d.inbox.push(sms({ id: 's2', smsKey: 'k2' }));
  assert.equal(lendSmsCandidates(d, { kind: 'lend', amountRial: 600_000, accountId: 'tej', today: T }).length, 0);
  assert.equal(lendSmsCandidates(d, { kind: 'lend', amountRial: 500_000, accountId: 'mel', today: T }).length, 0);
  assert.equal(lendSmsCandidates(d, { kind: 'borrow', amountRial: 500_000, accountId: 'tej', today: T }).length, 0, 'money in is not money out');
  assert.equal(lendSmsCandidates(d, { kind: 'lend', amountRial: 500_000, accountId: 'tej', today: '2026-10-20' }).length, 0, 'not an SMS from long ago');
});

ok('without an amount, the recent SMS are offered to pick from', () => {
  const d = book(false);
  d.inbox.push(sms());
  const st: LendState = lendStart(d, 'به علی از بانک تجارت قرض دادم', T)!;
  assert.equal(st.asking, 'amount');
  assert.equal(st.options.length, 1);
  assert.match(st.options[0].label, /^۵۰٬۰۰۰ تومان \(پیامک تجارت، امروز ساعت ۱۰:۱۲\)$/);
  const c = lendChoose(d, st, st.options[0].key);
  assert.deepEqual([c.asking, c.draft.amountRial, c.draft.sms?.id], ['confirm', 500_000, 'sms1']);
});

ok('the phone’s «نوعش چیست؟» for the SMS of a loan already told: answered «هزینه», still booked once', () => {
  const d = book(false);
  d.smsSources.push({ key: 'card:1234', kind: 'card', ref: '1234', bank: 'Tejarat', accountId: 'tej', count: 1, firstAt: 0, lastAt: 0, lastBalanceRial: null, lastBalanceAt: null });
  commitLend(d, lendAnswer(d, lendStart(d, '۵۰ هزار تومن به علی از بانک تجارت قرض دادم', T)!, 'بله'), T);
  const body = 'بانک تجارت\nبرداشت از کارت 1234\nمبلغ: 500,000 ریال\nمانده: 99,500,000\n1405/07/17\n10:12';
  const r = applyAsked(d, [{ key: 'n1', body, at: Date.parse(`${T}T06:42:00Z`), address: 'Tejarat', choice: 'expense' }], T, Date.now());
  assert.deepEqual([r.booked, r.queued, r.done], [0, 0, ['n1']], 'answered, nothing new');
  assert.equal(d.txns.length, 1);
  assert.equal(d.txns[0].link?.type, 'lend');
  assert.equal(d.inbox.length, 0);
  // the bank's balance in that SMS already includes the loan: not subtracted twice
  assert.equal(d.accounts.find((a) => a.id === 'tej')!.reported?.rial, 99_500_000);
  assert.equal(balances(d).tej, 99_500_000, 'the balance is the bank’s: the loan is inside it, not on top');
});

console.log(`\nlend-sms: ${n} checks OK`);
